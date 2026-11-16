import { findChangelogSection } from "../../release-notes/src/changelog-section.js";
import { listEntries } from "./changelog-entries.js";
import { markerFor, renderComment } from "./comment.js";
import { issueNumbersIn } from "./issue-references.js";
import type {
  ChangelogReader,
  Issue,
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

// The entries that name one issue, and whether one of them is under Fixed.
interface Reference {
  readonly entries: string[];
  fixed: boolean;
}

interface Plan {
  readonly planned: PlannedComment[];
  readonly unchanged: number[];
  readonly skipped: number[];
  readonly closing: number[];
}

const NOTHING: ShippedCommentsResult = { commented: [], unchanged: [], skipped: [], closed: [] };
const isFixed = (section: string): boolean => section.trim().toLowerCase() === "fixed";

// GitHub asks clients for one request at a time.
function inTurn<T>(items: Iterable<T>, step: (item: T) => Promise<void>): Promise<void> {
  return Array.from(items).reduce((previous, item) => previous.then(() => step(item)), Promise.resolve());
}

function skipReason(issue: Issue | undefined): string | undefined {
  if (issue === undefined) return "not found, deleted or moved";
  if (issue.isPullRequest) return "a pull request";
  if (issue.locked) return "locked";
  return undefined;
}

export class ShippedComments {
  constructor(
    private readonly changelogReader: ChangelogReader,
    private readonly api: IssueApi,
    private readonly log: Logger,
  ) {}

  async run(request: ShippedCommentsRequest): Promise<ShippedCommentsResult> {
    this.validate(request);
    const references = await this.referencesFor(request);
    if (references.size === 0) return NOTHING;

    const plan: Plan = { planned: [], unchanged: [], skipped: [], closing: [] };
    await inTurn(references, ([number, reference]) => this.planIssue(number, reference, request, plan));
    const touched = [...new Set([...plan.planned.map((comment) => comment.number), ...plan.closing])];
    if (touched.length > request.maxComments) {
      const numbers = touched.map((number) => `#${number}`).join(", ");
      throw new Error(
        `${request.tag} would comment on or close ${touched.length} issues, more than max-comments (${request.maxComments}): ` +
          `${numbers}. Nothing was posted.`,
      );
    }
    await inTurn(plan.planned, (comment) => this.post(comment, request.dryRun));
    await inTurn(plan.closing, (number) => this.close(number, request.dryRun));

    return {
      commented: plan.planned.map((comment) => comment.number),
      unchanged: plan.unchanged,
      skipped: plan.skipped,
      closed: plan.closing,
    };
  }

  // Issue number to the entries that mention it; empty when there is nothing to comment.
  private async referencesFor(request: ShippedCommentsRequest): Promise<Map<number, Reference>> {
    const read = await this.changelogReader.read(request.changelogPaths);
    if (read.kind === "missing") {
      this.log.warning(`No changelog found in ${request.changelogPaths.join(", ")}; nothing to comment.`);
      return new Map();
    }
    const section = findChangelogSection(read.changelog.content, request.tag);
    if (section === undefined) {
      this.log.warning(`${read.changelog.path} has no section for ${request.tag}; nothing to comment.`);
      return new Map();
    }
    const references = this.referencesIn(section, request);
    if (references.size === 0) {
      this.log.info(`No entry under ${request.sections.join(", ")} refers to an issue of ${request.repository}.`);
    }
    return references;
  }

  // Sorts one issue into the plan: skip, comment, leave as is, and whether to close.
  private async planIssue(number: number, reference: Reference, request: ShippedCommentsRequest, plan: Plan): Promise<void> {
    const issue = await this.api.getIssue(number);
    const reason = skipReason(issue);
    if (issue === undefined || reason !== undefined) {
      this.log.info(`Skipping #${number}: ${reason}.`);
      plan.skipped.push(number);
      return;
    }
    if (request.closeIssues && reference.fixed && issue.open) plan.closing.push(number);

    const body = renderComment({
      tag: request.tag,
      releaseUrl: request.releaseUrl,
      productName: request.productName,
      entries: reference.entries,
    });
    const marker = markerFor(request.tag);
    const existing = (await this.api.listComments(number)).find(
      (comment) => comment.byBot && comment.body.startsWith(marker),
    );
    if (existing?.body === body) {
      this.log.info(`#${number} already has this comment.`);
      plan.unchanged.push(number);
      return;
    }
    plan.planned.push({ number, body, existingId: existing?.id });
  }

  private async post(comment: PlannedComment, dryRun: boolean): Promise<void> {
    const isNew = comment.existingId === undefined;
    if (dryRun) {
      const verb = isNew ? "comment on" : "update the comment on";
      this.log.info(`Dry run: would ${verb} #${comment.number}:\n${comment.body}`);
      return;
    }
    if (comment.existingId === undefined) await this.api.createComment(comment.number, comment.body);
    else await this.api.updateComment(comment.existingId, comment.body);
    const done = isNew ? "Commented on" : "Updated the comment on";
    this.log.info(`${done} #${comment.number}.`);
  }

  private async close(number: number, dryRun: boolean): Promise<void> {
    if (dryRun) {
      this.log.info(`Dry run: would close #${number} as completed.`);
      return;
    }
    await this.api.closeIssue(number);
    this.log.info(`Closed #${number} as completed.`);
  }

  // Issue number to the entries that mention it, in changelog order.
  private referencesIn(section: string, request: ShippedCommentsRequest): Map<number, Reference> {
    const references = new Map<number, Reference>();
    for (const entry of listEntries(section, request.sections)) {
      for (const number of issueNumbersIn(entry.text, request.repository, request.serverUrl)) {
        const reference = references.get(number) ?? { entries: [], fixed: false };
        if (!reference.entries.includes(entry.text)) reference.entries.push(entry.text);
        reference.fixed ||= isFixed(entry.section);
        references.set(number, reference);
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
