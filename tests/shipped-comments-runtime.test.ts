import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const bundle = resolve("actions/shipped-comments/dist/index.js");

function runBundle(env: Record<string, string>): Promise<{ status: number | null; stdout: string }> {
  return new Promise((done) => {
    const child = spawn("node", [bundle], { env: { ...process.env, ...env } });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.on("close", (status) => done({ status, stdout }));
  });
}

test("bundled action runs in Node and comments through the REST API", async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      requests.push(`${request.method} ${request.url} ${request.headers.authorization} ${body}`);
      response.setHeader("content-type", "application/json");
      if (request.url === "/repos/o/r/issues/7") response.end(JSON.stringify({ number: 7, locked: false }));
      else if (request.url === "/repos/o/r/issues/8") response.end(JSON.stringify({ number: 8, pull_request: {} }));
      else if (request.url?.startsWith("/repos/o/r/issues/7/comments")) {
        response.statusCode = request.method === "POST" ? 201 : 200;
        response.end(request.method === "POST" ? "{}" : "[]");
      } else {
        response.statusCode = 404;
        response.end("{}");
      }
    });
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const workspace = mkdtempSync(join(tmpdir(), "shipped-comments-runtime-"));
  try {
    const output = join(workspace, "outputs");
    writeFileSync(output, "");
    writeFileSync(join(workspace, "CHANGELOG.md"), "## [1.0.0-rc.1]\n### Fixed\n- Bug (#7, #8)\n### Known issues\n- Other #9\n");
    const { port } = server.address() as AddressInfo;
    const result = await runBundle({
      GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: output,
      GITHUB_REPOSITORY: "o/r",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
      INPUT_TAG: "1.0.0-rc.1",
      "INPUT_CHANGELOG-PATHS": "CHANGELOG.md",
      INPUT_SECTIONS: "New\nChanged\nFixed",
      "INPUT_PRODUCT-NAME": "App",
      "INPUT_RELEASE-URL": "",
      "INPUT_DRY-RUN": "false",
      "INPUT_MAX-COMMENTS": "50",
      INPUT_TOKEN: "secret",
    });
    assert.equal(result.status, 0, result.stdout);
    const posted = requests.find((line) => line.startsWith("POST /repos/o/r/issues/7/comments Bearer secret "));
    assert.ok(posted, requests.join("\n"));
    const body = JSON.parse(posted.slice(posted.indexOf("{"))) as { body: string };
    assert.equal(
      body.body,
      "<!-- shipped-in 1.0.0-rc.1 -->\nThe change below shipped in App [1.0.0-rc.1](https://github.com/o/r/releases/tag/1.0.0-rc.1), a release candidate.\n\n> Bug (#7, #8)\n",
    );
    assert.ok(!requests.some((line) => line.includes("/issues/9")));
    const outputs = readFileSync(output, "utf8");
    assert.match(outputs, /commented<<[^\n]+\n7\n/);
    assert.match(outputs, /skipped<<[^\n]+\n8\n/);
  } finally {
    server.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});
