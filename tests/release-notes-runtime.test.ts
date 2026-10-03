import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const bundle = resolve("actions/release-notes/dist/index.js");

test("bundled action runs in Node and writes multiline GitHub outputs", () => {
  const workspace = mkdtempSync(join(tmpdir(), "release-notes-runtime-"));
  try {
    const output = join(workspace, "outputs");
    writeFileSync(output, "");
    writeFileSync(join(workspace, "CHANGELOG.md"), "## [1.0.0]\n### Fixed\n- Bug\n## [0.9.0]\nOld");
    execFileSync("node", [bundle], {
      env: { ...process.env, GITHUB_WORKSPACE: workspace, GITHUB_OUTPUT: output, INPUT_TAG: "1.0.0", "INPUT_RELEASE-NOTES": "", "INPUT_CHANGELOG-PATHS": "CHANGELOG.md" },
    });
    const outputs = readFileSync(output, "utf8");
    assert.match(outputs, /body<<[^\n]+\n### Fixed\n- Bug\n/);
    assert.match(outputs, /generate<<[^\n]+\nfalse\n/);
    assert.match(outputs, /source<<[^\n]+\nCHANGELOG.md\n/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("bundled action fails in Node for an invalid tag", () => {
  const result = spawnSync("node", [bundle], {
    encoding: "utf8",
    env: { ...process.env, INPUT_TAG: "bad\ntag" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /tag must be a nonempty single-line value/);
});
