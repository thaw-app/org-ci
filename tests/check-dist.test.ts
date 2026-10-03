import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("check:dist rejects an untracked bundle before building", () => {
  const workspace = mkdtempSync(join(tmpdir(), "check-dist-"));
  const project: unknown = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(typeof project === "object" && project !== null && "scripts" in project);
  const scripts = project.scripts;
  assert.ok(typeof scripts === "object" && scripts !== null && "check:dist" in scripts);
  const checkDist = scripts["check:dist"];
  assert.equal(typeof checkDist, "string");
  try {
    writeFileSync(join(workspace, "package.json"), JSON.stringify({
      scripts: {
        "check:dist": checkDist,
        build: "bun -e 'require(\"node:fs\").writeFileSync(\"build-ran\", \"yes\")'",
      },
    }));
    const initialized = spawnSync("git", ["init", "--quiet"], { cwd: workspace });
    assert.equal(initialized.status, 0);
    const result = spawnSync("bun", ["run", "check:dist"], { cwd: workspace, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /did not match any file\(s\) known to git/);
    assert.throws(() => readFileSync(join(workspace, "build-ran")), { code: "ENOENT" });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
