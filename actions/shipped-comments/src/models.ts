import type { ChangelogReader } from "../../release-notes/src/models.js";

export type { ChangelogReader };

export interface Issue {
  readonly number: number;
  readonly isPullRequest: boolean;
  readonly locked: boolean;
}

export interface IssueComment {
  readonly id: number;
  readonly body: string;
  readonly byBot: boolean;
}

// The GitHub calls the action makes, all on the calling repository.
export interface IssueApi {
  // Undefined when the issue does not exist, was deleted or moved to another repository.
  getIssue(number: number): Promise<Issue | undefined>;
  listComments(number: number): Promise<IssueComment[]>;
  createComment(number: number, body: string): Promise<void>;
  updateComment(commentId: number, body: string): Promise<void>;
}

export interface Logger {
  info(message: string): void;
  warning(message: string): void;
}

export interface ShippedCommentsRequest {
  readonly tag: string;
  readonly changelogPaths: readonly string[];
  readonly sections: readonly string[];
  readonly repository: string;
  readonly serverUrl: string;
  readonly releaseUrl: string;
  readonly productName: string;
  readonly dryRun: boolean;
  readonly maxComments: number;
}

export interface ShippedCommentsResult {
  // Issues that got a new or updated comment, or would have in a dry run.
  readonly commented: readonly number[];
  // Issues whose comment for this tag already says the same.
  readonly unchanged: readonly number[];
  // Numbers that were skipped: pull requests, locked, missing or moved issues.
  readonly skipped: readonly number[];
}
