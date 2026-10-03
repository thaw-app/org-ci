import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ChangelogReader, ChangelogReadResult } from "./models.js";

export class FileChangelogReader implements ChangelogReader {
  constructor(private readonly workspace: string) {}

  async read(paths: readonly string[]): Promise<ChangelogReadResult> {
    const root = resolve(this.workspace);
    for (const path of paths) {
      if (isAbsolute(path)) throw new Error(`Changelog path must be relative and within the workspace: ${path}`);
      const target = resolve(root, path);
      this.assertContained(root, target);
      try {
        const canonicalRoot = await realpath(root);
        const canonicalTarget = await realpath(target);
        this.assertContained(canonicalRoot, canonicalTarget);
        const content = await readFile(canonicalTarget, "utf8");
        return { kind: "found", changelog: { path, content } };
      } catch (error: unknown) {
        if (this.isMissingFile(error)) continue;
        throw error;
      }
    }

    return { kind: "missing" };
  }

  private assertContained(root: string, target: string): void {
    const path = relative(root, target);
    if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      throw new Error(`Changelog path must resolve within the workspace: ${target}`);
    }
  }

  private isMissingFile(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
}
