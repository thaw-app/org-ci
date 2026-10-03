import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileChangelogReader } from "../actions/release-notes/src/file-changelog-reader.js";
import type {
  ChangelogReader,
  ChangelogReadResult,
  ReleaseNotesRequest,
  ReleaseNotesResult,
} from "../actions/release-notes/src/models.js";
import { ReleaseNotesResolver } from "../actions/release-notes/src/release-notes-resolver.js";

class FixtureChangelogReader implements ChangelogReader {
  readonly calls: (readonly string[])[] = [];

  constructor(private readonly result: ChangelogReadResult) {}

  async read(paths: readonly string[]): Promise<ChangelogReadResult> {
    this.calls.push(paths);
    return this.result;
  }
}

const request: ReleaseNotesRequest = {
  tag: "1.0.0",
  override: "",
  changelogPaths: ["CHANGELOG.md"],
};

function resolveContent(content: string, tag = request.tag): Promise<ReleaseNotesResult> {
  const reader = new FixtureChangelogReader({
    kind: "found",
    changelog: { path: "CHANGELOG.md", content },
  });
  return new ReleaseNotesResolver(reader).resolve({ ...request, tag });
}

function changelogNotes(body: string): ReleaseNotesResult {
  return { kind: "resolved", body, source: { kind: "changelog", path: "CHANGELOG.md" } };
}

test("override takes precedence without reading the changelog", async () => {
  const reader = new FixtureChangelogReader({ kind: "missing" });
  const resolver = new ReleaseNotesResolver(reader);
  for (const body of ["- First\n- Second", "<p>Release</p>\n<ul><li>Fix</li></ul>"]) {
    assert.deepEqual(await resolver.resolve({ ...request, override: ` \n${body}\n ` }), {
      kind: "resolved", body, source: { kind: "override" },
    });
  }
  assert.deepEqual(reader.calls, []);
});

test("blank override reads the configured changelog paths", async () => {
  const reader = new FixtureChangelogReader({ kind: "missing" });
  const paths = ["CHANGELOG.md", "Resources/CHANGELOG.md"];
  const result = await new ReleaseNotesResolver(reader).resolve({ ...request, override: " \n", changelogPaths: paths });
  assert.deepEqual(result, { kind: "missing", reason: "changelog-not-found" });
  assert.deepEqual(reader.calls, [paths]);
});

test("resolves a tagged section, retaining subsections and stopping at next release", async () => {
  const content = "# Changes\n## [Unreleased]\nFuture\n## [3.0.0-beta.1] - 2026-01-01\n\n### Fixed\n- Bug\n\n## [2.0.0]\nOld";
  assert.deepEqual(await resolveContent(content, "3.0.0-beta.1"), changelogNotes("### Fixed\n- Bug"));
});

test("supports Markdown-escaped brackets", async () => {
  for (const heading of [String.raw`## \[1.0.0\]`, String.raw`## \[1.0.0]`, String.raw`## [1.0.0\]`]) {
    assert.deepEqual(await resolveContent(`${heading} - date\nRelease notes\n## [0.9.0]\nOld`), changelogNotes("Release notes"));
  }
});

test("supports unbracketed headings, BOM, CRLF, and the final section", async () => {
  assert.deepEqual(await resolveContent("\uFEFF## 1.0.0 - date\r\n\r\nLast\r\n"), changelogNotes("Last"));
});

test("matches tags literally without prefix or regex matches", async () => {
  assert.deepEqual(await resolveContent("## 1.0.01\nWrong\n## [1x0x0]\nWrong"), {
    kind: "missing", reason: "section-not-found", path: "CHANGELOG.md",
  });
  assert.deepEqual(await resolveContent("## [v1.0.0+build]\nRight", "v1.0.0+build"), changelogNotes("Right"));
});

test("ignores release-like headings inside fenced code", async () => {
  const content = "```md\n## [1.0.0]\nFake\n```\n## [1.0.0]\nNotes\n~~~md\n## example\n~~~\nEnd\n## [0.9.0]\nOld";
  assert.deepEqual(await resolveContent(content), changelogNotes("Notes\n~~~md\n## example\n~~~\nEnd"));
});

test("a shorter or different fence does not close a code block", async () => {
  const content = "## [1.0.0]\n````md\n```\n~~~\n## example\n````\nEnd\n## [0.9.0]\nOld";
  assert.deepEqual(await resolveContent(content), changelogNotes("````md\n```\n~~~\n## example\n````\nEnd"));
});

test("distinguishes absent sections from empty sections", async () => {
  assert.deepEqual(await resolveContent("## [2.0.0]\nOther"), {
    kind: "missing", reason: "section-not-found", path: "CHANGELOG.md",
  });
  assert.deepEqual(await resolveContent("## [1.0.0]\n\n## [0.9.0]\nOld"), {
    kind: "missing", reason: "section-empty", path: "CHANGELOG.md",
  });
});

test("invalid tags fail before reading files, even with an override", async () => {
  const reader = new FixtureChangelogReader({ kind: "missing" });
  const resolver = new ReleaseNotesResolver(reader);
  for (const tag of ["", "  ", "one\ntwo", "one\rtwo", "one\0two"]) {
    await assert.rejects(resolver.resolve({ ...request, tag, override: "Override" }), /single-line/);
  }
  assert.deepEqual(reader.calls, []);
});

test("filesystem resolution selects the first existing candidate, not the first matching section", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "release-notes-"));
  try {
    const resolver = new ReleaseNotesResolver(new FileChangelogReader(workspace));
    await writeFile(join(workspace, "fallback.md"), "## [1.0.0]\nFallback");
    const candidates = { ...request, changelogPaths: ["first.md", "fallback.md"] };
    assert.deepEqual(await resolver.resolve(candidates), {
      kind: "resolved", body: "Fallback", source: { kind: "changelog", path: "fallback.md" },
    });
    await writeFile(join(workspace, "first.md"), "## [2.0.0]\nOther");
    assert.deepEqual(await resolver.resolve(candidates), {
      kind: "missing", reason: "section-not-found", path: "first.md",
    });
    assert.deepEqual(await resolver.resolve({ ...request, changelogPaths: ["missing.md"] }), {
      kind: "missing", reason: "changelog-not-found",
    });
    await mkdir(join(workspace, "directory"));
    await assert.rejects(resolver.resolve({ ...request, changelogPaths: ["directory", "fallback.md"] }));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
