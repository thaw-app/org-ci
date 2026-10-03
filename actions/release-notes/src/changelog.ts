import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function readChangelog(workspace: string, paths: string): Promise<{ path: string; text: string } | undefined> {
  for (const path of paths.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    try {
      return { path, text: await readFile(resolve(workspace, path), "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}
