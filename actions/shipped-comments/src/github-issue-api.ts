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
    const issue = (await response.json()) as { number: number; locked?: boolean; pull_request?: unknown };
    return { number: issue.number, isPullRequest: issue.pull_request != null, locked: issue.locked === true };
  }

  async listComments(number: number): Promise<IssueComment[]> {
    const comments: IssueComment[] = [];
    let url: string | undefined = `${this.base()}/repos/${this.repository}/issues/${number}/comments?per_page=100`;
    while (url !== undefined) {
      const response = await this.request("GET", url);
      await this.check(response, `list the comments on #${number}`);
      const page = (await response.json()) as { id: number; body?: string | null; user?: { type?: string } | null }[];
      for (const comment of page) {
        comments.push({ id: comment.id, body: comment.body ?? "", byBot: comment.user?.type === "Bot" });
      }
      url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1];
    }
    return comments;
  }

  async createComment(number: number, body: string): Promise<void> {
    const response = await this.request("POST", `/repos/${this.repository}/issues/${number}/comments`, { body });
    await this.check(response, `comment on #${number}`);
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    const response = await this.request("PATCH", `/repos/${this.repository}/issues/comments/${commentId}`, { body });
    await this.check(response, `update comment ${commentId}`);
  }

  private base(): string {
    return this.apiUrl.replace(/\/+$/, "");
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
