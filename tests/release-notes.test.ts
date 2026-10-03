import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readChangelog } from "../actions/release-notes/src/changelog.js";
import { extractSection, resolveNotes } from "../actions/release-notes/src/notes.js";

test("override takes precedence and preserves multiline Markdown or HTML", () => {
  for (const body of ["- First\n- Second", "<p>Release</p>\n<ul><li>Fix</li></ul>"]) {
    assert.deepEqual(resolveNotes("1.0.0", ` \n${body}\n `, { path: "CHANGELOG.md", text: "## [1.0.0]\nIgnored" }), {
      body, generate: false, source: "release-notes input",
    });
  }
});

test("extracts a bracketed release, retaining subsections and stopping at next release", () => {
  const text = "# Changes\n## [Unreleased]\nFuture\n## [3.0.0-beta.1] - 2026-01-01\n\n### Fixed\n- Bug\n\n## [2.0.0]\nOld";
  assert.equal(extractSection(text, "3.0.0-beta.1"), "### Fixed\n- Bug");
});

test("supports unbracketed headings, BOM, CRLF, and the final section", () => {
  assert.equal(extractSection("\uFEFF## 1.0.0 - date\r\n\r\nLast\r\n", "1.0.0"), "Last");
});

test("matches tags exactly, including regex metacharacters", () => {
  assert.equal(extractSection("## 1.0.01\nWrong\n## [1x0x0]\nWrong", "1.0.0"), "");
  assert.equal(extractSection("## [v1.0.0+build]\nRight", "v1.0.0+build"), "Right");
});

test("ignores release-like headings inside fenced code", () => {
  assert.equal(extractSection("```md\n## [1.0.0]\nFake\n```\n## [1.0.0]\nNotes\n~~~md\n## example\n~~~\nEnd\n## [0.9.0]\nOld", "1.0.0"), "Notes\n~~~md\n## example\n~~~\nEnd");
});

test("missing, unmatched, and empty sections request generated notes", () => {
  assert.deepEqual(resolveNotes("1.0.0", " \n"), { body: "", generate: true, source: "none" });
  for (const text of ["## [2.0.0]\nOther", "## [1.0.0]\n\n## [0.9.0]\nOld"]) {
    assert.deepEqual(resolveNotes("1.0.0", "", { path: "CHANGELOG.md", text }), { body: "", generate: true, source: "CHANGELOG.md" });
  }
});

test("invalid tags fail early", () => {
  for (const tag of ["", "  ", "one\ntwo", "one\rtwo", "one\0two"]) {
    assert.throws(() => resolveNotes(tag, "Override"), /single-line/);
  }
});

test("candidate files are checked in order, relative to workspace", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "release-notes-"));
  try {
    await writeFile(join(workspace, "fallback.md"), "Fallback");
    assert.deepEqual(await readChangelog(workspace, "missing.md\r\nfallback.md"), { path: "fallback.md", text: "Fallback" });
    await writeFile(join(workspace, "first.md"), "First");
    assert.deepEqual(await readChangelog(workspace, "first.md\nfallback.md"), { path: "first.md", text: "First" });
    assert.equal(await readChangelog(workspace, "missing.md"), undefined);
    await mkdir(join(workspace, "directory"));
    await assert.rejects(readChangelog(workspace, "directory\nfallback.md"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
