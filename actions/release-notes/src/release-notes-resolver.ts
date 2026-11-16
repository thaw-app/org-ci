import { findChangelogSection } from "./changelog-section.js";
import type {
  ChangelogReader,
  ReleaseNotesRequest,
  ReleaseNotesResult,
} from "./models.js";

export class ReleaseNotesResolver {
  constructor(private readonly changelogReader: ChangelogReader) {}

  async resolve(request: ReleaseNotesRequest): Promise<ReleaseNotesResult> {
    this.validateTag(request.tag);

    const override = request.override.trim();
    if (override.length > 0) {
      return { kind: "resolved", body: override, source: { kind: "override" } };
    }

    const readResult = await this.changelogReader.read(request.changelogPaths);
    if (readResult.kind === "missing") {
      return { kind: "missing", reason: "changelog-not-found" };
    }

    const { path, content } = readResult.changelog;
    const body = findChangelogSection(content, request.tag);
    if (body === undefined) {
      return { kind: "missing", reason: "section-not-found", path };
    }
    if (body.length === 0) {
      return { kind: "missing", reason: "section-empty", path };
    }

    return { kind: "resolved", body, source: { kind: "changelog", path } };
  }

  private validateTag(tag: string): void {
    if (tag.trim().length === 0 || /[\r\n\0]/.test(tag)) {
      throw new Error("tag must be a nonempty single-line value");
    }
  }
}
