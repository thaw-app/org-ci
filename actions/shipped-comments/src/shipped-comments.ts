import { findChangelogSection } from "../../release-notes/src/changelog-section.js";
import { listEntries } from "./changelog-entries.js";
import { markerFor, renderComment } from "./comment.js";
import { issueNumbersIn } from "./issue-references.js";
import type {
  ChangelogReader,
  IssueApi,
  Logger,
  ShippedCommentsRequest,
  ShippedCommentsResult,
} from "./models.js";

interface PlannedComment {
  readonly number: number;
  readonly body: string;
  readonly existingId: number | undefined;
}

const NOTHING: ShippedCommentsResult = { commented: [], unchanged: [], skipped: [] };

export class ShippedComments {
  constructor(
    private readonly changelogReader: ChangelogReader,
    private readonly api: IssueApi,
    private readonly log: Logger,
  ) {}

  async run(request: ShippedCommentsRequest): Promise<ShippedCommentsResult> {
    this.validate(request);

    const read = await this.changelogReader.read(request.changelogPaths);
    if (read.kind === "missing") {
      this.log.warning(`No changelog found in ${request.changelogPaths.join(", ")}; nothing to comment.`);
      return NOTHING;
    }
    const section = findChangelogSection(read.changelog.content, request.tag);
    if (section === undefined) {
      this.log.warning(`${read.changelog.path} has no section for ${request.tag}; nothing to comment.`);
      return NOTHING;
    }

    const references = this.referencesIn(section, request);
    if (references.size === 0) {
      this.log.info(`No entry under ${request.sections.join(", ")} refers to an issue of ${request.repository}.`);
      return NOTHING;
    }

    const planned: PlannedComment[] = [];
    const unchanged: number[] = [];
    const skipped: number[] = [];
    for (const [number, entries] of references) {
      const issue = await this.api.getIssue(number);
      const reason =
        issue === undefined ? "not found, deleted or moved"
        : issue.isPullRequest ? "a pull request"
        : issue.locked ? "locked"
        : undefined;
      if (reason !== undefined) {
        this.log.info(`Skipping #${number}: ${reason}.`);
        skipped.push(number);
        continue;
      }

      const body = renderComment({
        tag: request.tag,
        releaseUrl: request.releaseUrl,
        productName: request.productName,
        entries,
      });
      const marker = markerFor(request.tag);
      const existing = (await this.api.listComments(number)).find(
        (comment) => comment.byBot && comment.body.startsWith(marker),
      );
      if (existing?.body === body) {
        this.log.info(`#${number} already has this comment.`);
        unchanged.push(number);
        continue;
      }
      planned.push({ number, body, existingId: existing?.id });
    }

    if (planned.length > request.maxComments) {
      throw new Error(
        `${request.tag} would comment on ${planned.length} issues, more than max-comments (${request.maxComments}): ` +
          `${planned.map((comment) => `#${comment.number}`).join(", ")}. Nothing was posted.`,
      );
    }

    for (const comment of planned) {
      const verb = comment.existingId === undefined ? "comment on" : "update the comment on";
      if (request.dryRun) {
        this.log.info(`Dry run: would ${verb} #${comment.number}:\n${comment.body}`);
        continue;
      }
      if (comment.existingId === undefined) await this.api.createComment(comment.number, comment.body);
      else await this.api.updateComment(comment.existingId, comment.body);
      this.log.info(`${comment.existingId === undefined ? "Commented on" : "Updated the comment on"} #${comment.number}.`);
    }

    return { commented: planned.map((comment) => comment.number), unchanged, skipped };
  }

  // Issue number to the entries that mention it, in changelog order.
  private referencesIn(section: string, request: ShippedCommentsRequest): Map<number, string[]> {
    const references = new Map<number, string[]>();
    for (const entry of listEntries(section, request.sections)) {
      for (const number of issueNumbersIn(entry.text, request.repository, request.serverUrl)) {
        const entries = references.get(number) ?? [];
        if (!entries.includes(entry.text)) entries.push(entry.text);
        references.set(number, entries);
      }
    }
    return references;
  }

  private validate(request: ShippedCommentsRequest): void {
    // The tag goes into an HTML comment and a URL.
    if (!/^[\w.+-]+$/.test(request.tag)) {
      throw new Error("tag must be a single word of letters, digits and . _ + -");
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(request.repository)) {
      throw new Error(`repository must be owner/name, got "${request.repository}"`);
    }
    if (!Number.isSafeInteger(request.maxComments) || request.maxComments < 1) {
      throw new Error("max-comments must be a whole number of at least 1");
    }
    if (request.sections.length === 0) throw new Error("sections must name at least one section");
  }
}
