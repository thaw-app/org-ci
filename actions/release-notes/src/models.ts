export interface ReleaseNotesRequest {
  readonly tag: string;
  readonly override: string;
  readonly changelogPaths: readonly string[];
}

export interface Changelog {
  readonly path: string;
  readonly content: string;
}

export type ChangelogReadResult =
  | { readonly kind: "found"; readonly changelog: Changelog }
  | { readonly kind: "missing" };

export interface ChangelogReader {
  read(paths: readonly string[]): Promise<ChangelogReadResult>;
}

export type ReleaseNotesSource =
  | { readonly kind: "override" }
  | { readonly kind: "changelog"; readonly path: string };

export type ReleaseNotesResult =
  | {
      readonly kind: "resolved";
      readonly body: string;
      readonly source: ReleaseNotesSource;
    }
  | {
      readonly kind: "missing";
      readonly reason: "changelog-not-found";
    }
  | {
      readonly kind: "missing";
      readonly reason: "section-not-found" | "section-empty";
      readonly path: string;
    };
