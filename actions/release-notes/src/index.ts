import * as core from "@actions/core";
import { FileChangelogReader } from "./file-changelog-reader.js";
import type { ReleaseNotesRequest, ReleaseNotesResult } from "./models.js";
import { ReleaseNotesResolver } from "./release-notes-resolver.js";

function readRequest(): ReleaseNotesRequest {
  return {
    tag: core.getInput("tag", { required: true }),
    override: core.getInput("release-notes", { trimWhitespace: false }),
    changelogPaths: core.getInput("changelog-paths")
      .split(/\r?\n/)
      .map((path) => path.trim())
      .filter((path) => path.length > 0),
  };
}

function publishResult(result: ReleaseNotesResult): void {
  if (result.kind === "resolved") {
    const source = result.source.kind === "override" ? "release-notes input" : result.source.path;
    core.setOutput("body", result.body);
    core.setOutput("generate", "false");
    core.setOutput("source", source);
    core.info(`Release notes source: ${source}`);
    return;
  }

  const source = result.reason === "changelog-not-found" ? "none" : result.path;
  core.setOutput("body", "");
  core.setOutput("generate", "true");
  core.setOutput("source", source);
  core.info(`No release notes: ${result.reason}. GitHub-generated notes can be enabled by the caller.`);
}

async function run(): Promise<void> {
  try {
    const reader = new FileChangelogReader(process.env.GITHUB_WORKSPACE ?? process.cwd());
    const resolver = new ReleaseNotesResolver(reader);
    publishResult(await resolver.resolve(readRequest()));
  } catch (error: unknown) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

void run();
