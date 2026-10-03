import * as core from "@actions/core";
import { readChangelog } from "./changelog.js";
import { resolveNotes, validateTag } from "./notes.js";

async function run(): Promise<void> {
  try {
    const tag = core.getInput("tag", { required: true });
    validateTag(tag);
    const override = core.getInput("release-notes", { trimWhitespace: false });
    const changelog = override.trim() ? undefined : await readChangelog(
      process.env.GITHUB_WORKSPACE ?? process.cwd(),
      core.getInput("changelog-paths"),
    );
    const notes = resolveNotes(tag, override, changelog);
    core.setOutput("body", notes.body);
    core.setOutput("generate", String(notes.generate));
    core.setOutput("source", notes.source);
    core.info(`Release notes source: ${notes.source}`);
    if (notes.generate) core.info(`No release notes found for ${tag}; GitHub-generated notes can be enabled by the caller.`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

void run();
