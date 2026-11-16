import * as core from "@actions/core";
import { FileChangelogReader } from "../../release-notes/src/file-changelog-reader.js";
import { GitHubIssueApi } from "./github-issue-api.js";
import type { ShippedCommentsRequest } from "./models.js";
import { ShippedComments } from "./shipped-comments.js";

const lines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

function readRequest(): ShippedCommentsRequest {
  const tag = core.getInput("tag", { required: true });
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const releaseUrl = core.getInput("release-url") || `${serverUrl}/${repository}/releases/tag/${encodeURIComponent(tag)}`;
  return {
    tag,
    changelogPaths: lines(core.getInput("changelog-paths")),
    sections: lines(core.getInput("sections")),
    repository,
    serverUrl,
    releaseUrl,
    productName: core.getInput("product-name"),
    dryRun: core.getBooleanInput("dry-run"),
    maxComments: Number(core.getInput("max-comments")),
  };
}

async function run(): Promise<void> {
  try {
    const request = readRequest();
    const token = core.getInput("token", { required: true });
    core.setSecret(token);
    const api = new GitHubIssueApi(process.env.GITHUB_API_URL ?? "https://api.github.com", request.repository, token);
    const reader = new FileChangelogReader(process.env.GITHUB_WORKSPACE ?? process.cwd());
    const result = await new ShippedComments(reader, api, core).run(request);
    core.setOutput("commented", result.commented.join(" "));
    core.setOutput("skipped", result.skipped.join(" "));
  } catch (error: unknown) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

void run();
