import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ChangelogReader, ChangelogReadResult } from "./models.js";

export class FileChangelogReader implements ChangelogReader {
  constructor(private readonly workspace: string) {}

  async read(paths: readonly string[]): Promise<ChangelogReadResult> {
    for (const path of paths) {
      try {
        const content = await readFile(resolve(this.workspace, path), "utf8");
        return { kind: "found", changelog: { path, content } };
      } catch (error: unknown) {
        if (this.isMissingFile(error)) continue;
        throw error;
      }
    }

    return { kind: "missing" };
  }

  private isMissingFile(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
}
