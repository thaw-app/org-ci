import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChangelogReadResult } from "../actions/release-notes/src/models.js";
import { listEntries } from "../actions/shipped-comments/src/changelog-entries.js";
import { channelOfTag, markerFor, renderComment } from "../actions/shipped-comments/src/comment.js";
import { GitHubIssueApi } from "../actions/shipped-comments/src/github-issue-api.js";
import { issueNumbersIn } from "../actions/shipped-comments/src/issue-references.js";
import type {
  ChangelogReader,
  Issue,
  IssueApi,
  IssueComment,
  ShippedCommentsRequest,
} from "../actions/shipped-comments/src/models.js";
import { ShippedComments } from "../actions/shipped-comments/src/shipped-comments.js";

const REPO = "thaw-app/Thaw";
const SERVER = "https://github.com";
const issue = (n: number) => `[#${n}](https://github.com/thaw-app/Thaw/issues/${n})`;
const pull = (n: number) => `[#${n}](https://github.com/thaw-app/Thaw/pull/${n})`;

// The shapes of Thaw's CHANGELOG.md: a lead paragraph and a tip that point at
// an issue, ### sections with #### areas, Known issues, a Thanks section.
const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed

- Not released yet. Reported in ${issue(1600)}.

## [3.0.0-alpha.14] - 2026-11-14

**macOS 27 only · Build 125**

Layout gets a pop-out window. See ${issue(1528)}.

> [!TIP]
> If you'd like to help, ${issue(1529)} lists work that's ready to pick up.

### New

- **Layout warns when items don't fit.** Reported by @JosefGvirt in ${issue(1477)}.
- **The widget icon shows real readings.** Suggested by @joaofrgomes in ${issue(1378)}.
- **Export Logs** zips logs for a bug report.

### Changed

- **The Thaw Bar has its own switch again.** By @malash in ${pull(1339)}.
- **Zoom is off for now.** Reported in ${issue(1244)} and ${issue(1265)}.

### Fixed

#### Layout and items

- **Native hiding starts again.** Reported by @SebastienBn in ${issue(1513)}.
- **Items with a countdown stay put.** By @Omoeba in ${pull(1531)}, for ${issue(1477)}.

#### Thaw Bar

- **One click on Thaw's icon works** when double-click is slow (#1492).
- **A long click opens it,**
  and the arrow keys move the highlight. Fixes #1493 and thaw-app/Thaw#1494.
- Spacing changes no longer kill services (#1070, thanks @wiper2).
- Moved from the old repository: [#687](https://github.com/stonerl/Thaw/issues/687), stonerl/Thaw#688 and thaw-app/Floe#12.
- A fix with a \`#999\` in code.

### Known issues

- **With about 240 apps running, icons can go missing.** Reported in ${issue(1367)}.

### Thanks

- @Omoeba fixed the tests (${pull(1533)}, ${issue(1534)}).

## [3.0.0-alpha.13] - 2026-11-05

### Fixed

- Older fix for ${issue(1449)}.
`;

test("only list entries under the chosen sections count, #### areas included", () => {
  const section = CHANGELOG.slice(CHANGELOG.indexOf("**macOS 27"), CHANGELOG.indexOf("## [3.0.0-alpha.13]"));
  const entries = listEntries(section, ["New", "Changed", "Fixed"]);
  assert.deepEqual(
    entries.map((entry) => entry.section),
    ["New", "New", "New", "Changed", "Changed", "Fixed", "Fixed", "Fixed", "Fixed", "Fixed", "Fixed", "Fixed"],
  );
  const text = entries.map((entry) => entry.text).join("\n");
  for (const excluded of ["1528", "1529", "1367", "1534"]) assert.ok(!text.includes(excluded), excluded);
  assert.equal(
    entries[8]?.text,
    "**A long click opens it,**\nand the arrow keys move the highlight. Fixes #1493 and thaw-app/Thaw#1494.",
  );
  assert.deepEqual(listEntries(section, ["known ISSUES"]).map((entry) => entry.section), ["Known issues"]);
});

test("ordered items, nested items and code blocks stay inside their entry", () => {
  const entries = listEntries(
    "### Fixed\n\n1. First (#1).\n   - nested #2\n\n   ```\n   #3\n   ```\n2. Second\nlazy line\n\nAfter the list #4.\n\n---\n",
    ["Fixed"],
  );
  assert.deepEqual(entries.map((entry) => entry.text), ["First (#1).\n- nested #2\n```\n#3\n```", "Second\nlazy line"]);
});

test("each reference form names an issue of the calling repository", () => {
  const cases: [string, number[]][] = [
    [`Reported in ${issue(1477)}.`, [1477]],
    ["See https://github.com/thaw-app/Thaw/issues/1478#issuecomment-1 too", [1478]],
    ["Fixed (#1492).", [1492]],
    ["Fixes #1493.", [1493]],
    ["Also thaw-app/thaw#1494.", [1494]],
    [`Twice: ${issue(1495)} and #1495.`, [1495]],
  ];
  for (const [text, numbers] of cases) assert.deepEqual(issueNumbersIn(text, REPO, SERVER), numbers, text);
});

test("pull requests, other repositories and code are not issue references", () => {
  for (const text of [
    `By @malash in ${pull(1339)}.`,
    "https://github.com/thaw-app/Thaw/pull/1340",
    "[#687](https://github.com/stonerl/Thaw/issues/687)",
    "stonerl/Thaw#688 and thaw-app/Floe#12",
    "https://github.com/thaw-app/Floe/issues/13",
    "A fix with a `#999` in code.",
    "[docs](https://example.com/page#12) and C# and &#8203;",
  ]) {
    assert.deepEqual(issueNumbersIn(text, REPO, SERVER), [], text);
  }
});

test("the channel comes from the tag's pre-release identifier", () => {
  const cases: [string, string][] = [
    ["3.0.0-alpha.14", "alpha"],
    ["3.0.0-alpha.12.1", "alpha"],
    ["3.0.0-beta.6", "beta"],
    ["2.2.0-beta.2", "beta"],
    ["2.0.1-rc.2", "rc"],
    ["3.0.0", "stable"],
    ["v2.1.0", "stable"],
    ["3.0.0+125", "stable"],
    ["3.0.0-preview.1", "prerelease"],
  ];
  for (const [tag, channel] of cases) assert.equal(channelOfTag(tag), channel, tag);
});

test("the comment names the version, its channel and the release, and quotes the entries", () => {
  const body = renderComment({
    tag: "3.0.0-beta.6",
    releaseUrl: "https://github.com/thaw-app/Thaw/releases/tag/3.0.0-beta.6",
    productName: "Thaw",
    entries: ["**One.** By @malash.", "Two\nlines"],
  });
  assert.equal(
    body,
    [
      "<!-- shipped-in 3.0.0-beta.6 -->",
      "The changes below shipped in Thaw [3.0.0-beta.6](https://github.com/thaw-app/Thaw/releases/tag/3.0.0-beta.6), a beta release.",
      "",
      "> **One.** By @&#8203;malash.",
      "",
      "> Two",
      "> lines",
      "",
    ].join("\n"),
  );
  assert.match(
    renderComment({ tag: "3.0.0", releaseUrl: "u", productName: "", entries: ["One"] }),
    /^<!-- shipped-in 3\.0\.0 -->\nThe change below shipped in \[3\.0\.0\]\(u\), a stable release\.\n/,
  );
});

class FixtureReader implements ChangelogReader {
  constructor(private readonly content: string | undefined) {}

  async read(): Promise<ChangelogReadResult> {
    return this.content === undefined
      ? { kind: "missing" }
      : { kind: "found", changelog: { path: "CHANGELOG.md", content: this.content } };
  }
}

class FakeIssues implements IssueApi {
  readonly issues = new Map<number, Issue>();
  readonly comments = new Map<number, (IssueComment & { issue: number })>();
  readonly writes: string[] = [];
  private nextId = 1;

  constructor(numbers: number[], pulls: number[] = [], locked: number[] = []) {
    for (const number of numbers) this.issues.set(number, { number, isPullRequest: false, locked: false });
    for (const number of pulls) this.issues.set(number, { number, isPullRequest: true, locked: false });
    for (const number of locked) this.issues.set(number, { number, isPullRequest: false, locked: true });
  }

  async getIssue(number: number): Promise<Issue | undefined> {
    return this.issues.get(number);
  }

  async listComments(number: number): Promise<IssueComment[]> {
    return [...this.comments.values()].filter((comment) => comment.issue === number);
  }

  async createComment(number: number, body: string): Promise<void> {
    this.writes.push(`create #${number}`);
    const id = this.nextId++;
    this.comments.set(id, { id, issue: number, body, byBot: true });
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    const comment = this.comments.get(commentId);
    assert.ok(comment);
    this.writes.push(`update #${comment.issue}`);
    this.comments.set(commentId, { ...comment, body });
  }
}

const logs: string[] = [];
const logger = { info: (message: string) => logs.push(message), warning: (message: string) => logs.push(message) };

const request: ShippedCommentsRequest = {
  tag: "3.0.0-alpha.14",
  changelogPaths: ["CHANGELOG.md"],
  sections: ["New", "Changed", "Fixed"],
  repository: REPO,
  serverUrl: SERVER,
  releaseUrl: "https://github.com/thaw-app/Thaw/releases/tag/3.0.0-alpha.14",
  productName: "Thaw",
  dryRun: false,
  maxComments: 50,
};

// Every issue the fixture's alpha.14 New, Changed and Fixed entries name.
const ISSUES = [1477, 1378, 1244, 1265, 1513, 1492, 1493, 1494, 1070];

test("one comment per issue, quoting every entry that names it", async () => {
  const api = new FakeIssues(ISSUES);
  const result = await new ShippedComments(new FixtureReader(CHANGELOG), api, logger).run(request);
  assert.deepEqual(result, { commented: ISSUES, unchanged: [], skipped: [] });
  assert.deepEqual(api.writes, ISSUES.map((n) => `create #${n}`));
  const on1477 = (await api.listComments(1477))[0]?.body ?? "";
  assert.ok(on1477.startsWith(`${markerFor("3.0.0-alpha.14")}\nThe changes below shipped in Thaw [3.0.0-alpha.14]`));
  assert.ok(on1477.includes("an alpha release"));
  assert.ok(on1477.includes("> **Layout warns when items don't fit.**"));
  assert.ok(on1477.includes("> **Items with a countdown stay put.**"));
});

test("a bare number that is a pull request, a locked issue and a missing one are skipped", async () => {
  const api = new FakeIssues([1477, 1378, 1244, 1265, 1513, 1494], [1492], [1493]);
  const result = await new ShippedComments(new FixtureReader(CHANGELOG), api, logger).run(request);
  assert.deepEqual(result.skipped, [1492, 1493, 1070]);
  assert.ok(!api.writes.some((write) => /#(1492|1493|1070)$/.test(write)));
  assert.ok(logs.includes("Skipping #1493: locked."));
  assert.ok(logs.includes("Skipping #1070: not found, deleted or moved."));
});

test("a second run for the same tag updates its comment instead of posting again", async () => {
  const api = new FakeIssues(ISSUES);
  const action = new ShippedComments(new FixtureReader(CHANGELOG), api, logger);
  await action.run(request);
  const again = await action.run(request);
  assert.deepEqual(again, { commented: [], unchanged: ISSUES, skipped: [] });

  const edited = CHANGELOG.replace("Layout warns when items don't fit.", "Layout warns when items don't fit, now.");
  const result = await new ShippedComments(new FixtureReader(edited), api, logger).run(request);
  assert.deepEqual(result.commented, [1477]);
  assert.deepEqual(api.writes.slice(ISSUES.length), ["update #1477"]);
  assert.equal((await api.listComments(1477)).length, 1);

  // Another tag gets its own comment, and someone quoting the marker is not the bot.
  await api.createComment(1449, `${markerFor("3.0.0-alpha.13")}\nold`);
  const quoted = [...api.comments.values()].find((comment) => comment.issue === 1449);
  assert.ok(quoted);
  api.comments.set(quoted.id, { ...quoted, byBot: false });
  api.issues.set(1449, { number: 1449, isPullRequest: false, locked: false });
  const older = await new ShippedComments(new FixtureReader(CHANGELOG), api, logger).run({ ...request, tag: "3.0.0-alpha.13" });
  assert.deepEqual(older.commented, [1449]);
  assert.equal((await api.listComments(1449)).length, 2);
});

test("a dry run logs each comment and posts nothing", async () => {
  const api = new FakeIssues(ISSUES);
  logs.length = 0;
  const result = await new ShippedComments(new FixtureReader(CHANGELOG), api, logger).run({ ...request, dryRun: true });
  assert.deepEqual(result.commented, ISSUES);
  assert.deepEqual(api.writes, []);
  assert.ok(logs.some((line) => line.startsWith("Dry run: would comment on #1477:\n<!-- shipped-in 3.0.0-alpha.14 -->")));
});

test("more comments than the cap fail the run before anything is posted", async () => {
  const api = new FakeIssues(ISSUES);
  await assert.rejects(
    new ShippedComments(new FixtureReader(CHANGELOG), api, logger).run({ ...request, maxComments: 8 }),
    /would comment on 9 issues, more than max-comments \(8\).*Nothing was posted/,
  );
  assert.deepEqual(api.writes, []);
});

test("a missing changelog or section posts nothing and does not fail", async () => {
  const api = new FakeIssues(ISSUES);
  for (const reader of [new FixtureReader(undefined), new FixtureReader("## [2.0.0]\n- #1477")]) {
    assert.deepEqual(await new ShippedComments(reader, api, logger).run(request), {
      commented: [], unchanged: [], skipped: [],
    });
  }
  assert.deepEqual(api.writes, []);
});

test("a tag that cannot go into a marker and a bad cap are refused", async () => {
  const api = new FakeIssues(ISSUES);
  const action = new ShippedComments(new FixtureReader(CHANGELOG), api, logger);
  for (const tag of ["", "1.0 -->", "a\nb"]) await assert.rejects(action.run({ ...request, tag }), /tag must be/);
  for (const maxComments of [0, Number.NaN, 1.5]) {
    await assert.rejects(action.run({ ...request, maxComments }), /max-comments/);
  }
});

test("the API client reads issues, skips moved ones and follows comment pages", async () => {
  const calls: string[] = [];
  const responses: Record<string, () => Response> = {
    "GET https://api.test/repos/o/r/issues/1": () => Response.json({ number: 1, locked: false }),
    "GET https://api.test/repos/o/r/issues/2": () => Response.json({ number: 2, pull_request: {} }),
    "GET https://api.test/repos/o/r/issues/3": () => new Response(null, { status: 301 }),
    "GET https://api.test/repos/o/r/issues/4": () => new Response("{}", { status: 404 }),
    "GET https://api.test/repos/o/r/issues/1/comments?per_page=100": () =>
      Response.json([{ id: 10, body: "a", user: { type: "User" } }], {
        headers: { link: '<https://api.test/repos/o/r/issues/1/comments?per_page=100&page=2>; rel="next"' },
      }),
    "GET https://api.test/repos/o/r/issues/1/comments?per_page=100&page=2": () =>
      Response.json([{ id: 11, body: null, user: { type: "Bot" } }]),
    "POST https://api.test/repos/o/r/issues/1/comments": () => new Response("{}", { status: 201 }),
    "PATCH https://api.test/repos/o/r/issues/comments/11": () => new Response("{}", { status: 403 }),
  };
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method} ${String(url)}`;
    calls.push(key);
    assert.equal(init?.redirect, "manual");
    const respond = responses[key];
    assert.ok(respond, key);
    return respond();
  }) as typeof fetch;
  const api = new GitHubIssueApi("https://api.test/", "o/r", "token", fake);

  assert.deepEqual(await api.getIssue(1), { number: 1, isPullRequest: false, locked: false });
  assert.deepEqual(await api.getIssue(2), { number: 2, isPullRequest: true, locked: false });
  assert.equal(await api.getIssue(3), undefined);
  assert.equal(await api.getIssue(4), undefined);
  assert.deepEqual(await api.listComments(1), [
    { id: 10, body: "a", byBot: false },
    { id: 11, body: "", byBot: true },
  ]);
  await api.createComment(1, "hi");
  await assert.rejects(api.updateComment(11, "hi"), /HTTP 403/);
});
