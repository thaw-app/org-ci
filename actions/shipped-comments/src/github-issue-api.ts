import type { Issue, IssueApi, IssueComment } from "./models.js";

type Fetch = typeof fetch;

// The REST calls on one repository's issues, with the run's token.
export class GitHubIssueApi implements IssueApi {
  constructor(
    private readonly apiUrl: string,
    private readonly repository: string,
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async getIssue(number: number): Promise<Issue | undefined> {
    const response = await this.request("GET", `/repos/${this.repository}/issues/${number}`);
    // 301: moved to another repository. Following it would comment there.
    if ([301, 404, 410].includes(response.status)) return undefined;
    await this.check(response, `read #${number}`);
    const issue = (await response.json()) as { number: number; state?: string; locked?: boolean; pull_request?: unknown };
    return {
      number: issue.number,
      isPullRequest: issue.pull_request != null,
      locked: issue.locked === true,
      open: issue.state === "open",
    };
  }

  listComments(number: number): Promise<IssueComment[]> {
    return this.commentsFrom(`${this.base()}/repos/${this.repository}/issues/${number}/comments?per_page=100`, number);
  }

  // Reads one page of comments, then the pages after it.
  private async commentsFrom(url: string, number: number): Promise<IssueComment[]> {
    const response = await this.request("GET", url);
    await this.check(response, `list the comments on #${number}`);
    const page = (await response.json()) as { id: number; body?: string | null; user?: { type?: string } | null }[];
    const comments = page.map((comment) => ({
      id: comment.id,
      body: comment.body ?? "",
      byBot: comment.user?.type === "Bot",
    }));
    const next = nextPageUrl(response.headers.get("link"));
    return next === undefined ? comments : [...comments, ...(await this.commentsFrom(next, number))];
  }

  async createComment(number: number, body: string): Promise<void> {
    const response = await this.request("POST", `/repos/${this.repository}/issues/${number}/comments`, { body });
    await this.check(response, `comment on #${number}`);
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    const response = await this.request("PATCH", `/repos/${this.repository}/issues/comments/${commentId}`, { body });
    await this.check(response, `update comment ${commentId}`);
  }

  async closeIssue(number: number): Promise<void> {
    const response = await this.request("PATCH", `/repos/${this.repository}/issues/${number}`, {
      state: "closed",
      state_reason: "completed",
    });
    await this.check(response, `close #${number}`);
  }

  private base(): string {
    let end = this.apiUrl.length;
    while (end > 0 && this.apiUrl[end - 1] === "/") end -= 1;
    return this.apiUrl.slice(0, end);
  }

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = path.startsWith("/") ? `${this.base()}${path}` : path;
    return this.fetchImpl(url, {
      method,
      redirect: "manual",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "User-Agent": "thaw-app-org-ci-shipped-comments",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  private async check(response: Response, action: string): Promise<void> {
    if (response.ok) return;
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Could not ${action}: HTTP ${response.status} ${detail}`);
  }
}

// The rel="next" target of a Link header, such as <https://…&page=2>; rel="next", <https://…&page=5>; rel="last".
function nextPageUrl(link: string | null): string | undefined {
  for (const part of (link ?? "").split(",")) {
    const [target = "", ...params] = part.split(";").map((piece) => piece.trim());
    if (params.includes('rel="next"') && target.startsWith("<") && target.endsWith(">")) return target.slice(1, -1);
  }
  return undefined;
}
