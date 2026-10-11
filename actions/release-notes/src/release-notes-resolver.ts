import type {
  ChangelogReader,
  ReleaseNotesRequest,
  ReleaseNotesResult,
} from "./models.js";

type SectionResult =
  | { readonly kind: "found"; readonly body: string }
  | { readonly kind: "missing" };

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
    const section = this.extractSection(content, request.tag);
    if (section.kind === "missing") {
      return { kind: "missing", reason: "section-not-found", path };
    }
    if (section.body.length === 0) {
      return { kind: "missing", reason: "section-empty", path };
    }

    return { kind: "resolved", body: section.body, source: { kind: "changelog", path } };
  }

  private validateTag(tag: string): void {
    if (tag.trim().length === 0 || /[\r\n\0]/.test(tag)) {
      throw new Error("tag must be a nonempty single-line value");
    }
  }

  private extractSection(content: string, tag: string): SectionResult {
    const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
    const sectionLines: string[] = [];
    let collecting = false;
    let fence: string | null = null;

    for (const line of lines) {
      // A line is code when it sits inside a fence or is the fence marker itself.
      const wasFenced = fence !== null;
      fence = this.fenceAfter(fence, line);
      const isCode = wasFenced || fence !== null;

      if (!collecting) {
        collecting = !isCode && this.isReleaseHeading(line, tag);
        continue;
      }
      if (!isCode && /^##(?:[\t ]|$)/.test(line)) break;
      sectionLines.push(line);
    }

    if (!collecting) return { kind: "missing" };
    return { kind: "found", body: sectionLines.join("\n").trim() };
  }

  // Returns the open fence after reading the line, or null when no fence is open.
  private fenceAfter(fence: string | null, line: string): string | null {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker === null) return fence;

    const opening = marker[0].trimStart();
    if (fence === null) return opening;

    const closes =
      opening.startsWith(fence.charAt(0)) &&
      opening.length >= fence.length &&
      /^ {0,3}(`+|~+)\s*$/.test(line);
    return closes ? null : fence;
  }

  private isReleaseHeading(line: string, tag: string): boolean {
    const prefix = /^##[\t ]+/.exec(line);
    if (prefix === null) return false;

    const heading = line.slice(prefix[0].length);
    const candidates = [
      tag,
      `[${tag}]`,
      String.raw`\[${tag}]`,
      String.raw`[${tag}\]`,
      String.raw`\[${tag}\]`,
    ];
    return candidates.some((candidate) => {
      if (!heading.startsWith(candidate)) return false;
      const suffix = heading.slice(candidate.length);
      return suffix.length === 0 || /^[\t ]/.test(suffix);
    });
  }
}
