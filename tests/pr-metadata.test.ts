import assert from "node:assert/strict";
import { test } from "node:test";

// The action's code is plain CommonJS with no types: actions/github-script
// loads it at run time, so there is no build step to type it for.
const lib: any = require("../actions/pr-metadata/lib.cjs");

const rules = lib.compileAreaRules([
  { label: "icebar", prefixes: ["App/MenuBar/IceBar/"] },
  { label: "menubar", prefixes: ["App/MenuBar/"] },
  { label: "hotkeys", patterns: ["Hotkey"] },
  { label: "settings", kind: "fallback", prefixes: ["App/Settings/"] },
  { label: "ops", kind: "ops", prefixes: [".github/"], paths: ["README.md"] },
]);

const body = (sections: Record<string, string>) =>
  Object.entries(sections)
    .map(([heading, text]) => `## ${heading}\n\n${text}\n`)
    .join("\n");

test("the first matching rule decides a path's area", () => {
  const areas = lib.areasForPaths(["App/MenuBar/IceBar/Panel.swift"], rules);
  assert.deepEqual([...areas], ["icebar"]);
});

test("a pattern matches anywhere in the path, whatever its case", () => {
  const areas = lib.areasForPaths(["App/Other/hotkeyRecorder.swift"], rules);
  assert.deepEqual([...areas], ["hotkeys"]);
});

test("a fallback area gives way to a product area", () => {
  const areas = lib.areasForPaths(
    ["App/Settings/Pane.swift", "App/MenuBar/Bar.swift"],
    rules,
  );
  assert.deepEqual([...areas], ["menubar"]);
});

test("a fallback area stays beside an ops area", () => {
  const areas = lib.areasForPaths(["App/Settings/Pane.swift", "README.md"], rules);
  assert.deepEqual([...areas].sort(), ["ops", "settings"]);
});

test("a path no rule matches earns no area", () => {
  assert.equal(lib.areasForPaths(["LICENSE"], rules).size, 0);
});

test("a rule that can match nothing is refused", () => {
  assert.throws(() => lib.compileAreaRules([{ label: "empty" }]), /matches nothing/);
  assert.throws(() => lib.compileAreaRules([{ prefixes: ["a/"] }]), /needs a label/);
  assert.throws(
    () => lib.compileAreaRules([{ label: "a", prefixes: ["a/"], kind: "main" }]),
    /unknown kind/,
  );
});

test("ticked type boxes add their labels and unticked ones remove them", () => {
  const { toAdd, toRemove } = lib.labelChanges(
    body({ "PR Type": "- [x] Bug fix\n- [ ] Feature\n- [X] CI/CD" }),
    [],
    rules,
  );
  assert.ok(toAdd.has("fix") && toAdd.has("ci") && toAdd.has("cd"));
  assert.ok(toRemove.has("feature") && toRemove.has("breaking-change"));
  assert.ok(toRemove.has("bug"), "bug is never left on a PR");
  assert.ok(!toRemove.has("fix"));
});

test("a box ticked under another heading does not count", () => {
  const { toAdd } = lib.labelChanges(
    body({ "PR Type": "- [ ] Feature", "PR Checklist": "- [x] Feature" }),
    [],
    rules,
  );
  assert.ok(!toAdd.has("feature"));
});

test("a ticked area is added and never removes a path's area", () => {
  const { toAdd, toRemove } = lib.labelChanges(
    body({ Area: "- [x] hotkeys\n- [ ] menubar" }),
    ["App/MenuBar/Bar.swift"],
    rules,
  );
  assert.ok(toAdd.has("hotkeys") && toAdd.has("menubar"));
  assert.ok(!toRemove.has("menubar"));
});

test("a breaking change is labelled only when Yes is ticked", () => {
  const heading = "Does this PR introduce a breaking change?";
  assert.ok(lib.labelChanges(body({ [heading]: "- [x] Yes\n- [ ] No" }), [], rules).toAdd.has("breaking-change"));
  assert.ok(lib.labelChanges(body({ [heading]: "- [ ] Yes\n- [x] No" }), [], rules).toRemove.has("breaking-change"));
});

const commit = (message: string, email = "a@example.com", extra = {}) => ({
  sha: "0123456789abcdef",
  author: { login: "someone" },
  parents: [{}],
  commit: { author: { email }, message },
  ...extra,
});

test("a sign-off in the trailer block that matches the author passes", () => {
  const missing = lib.commitsMissingSignoff([
    commit("fix: a thing\n\nBody.\n\nSigned-off-by: A <A@Example.com>"),
  ]);
  assert.deepEqual(missing, []);
});

test("a sign-off quoted in the body does not count", () => {
  const missing = lib.commitsMissingSignoff([
    commit("fix: a thing\n\nSigned-off-by: A <a@example.com>\n\nMore prose after it."),
  ]);
  assert.deepEqual(missing, ["01234567"]);
});

test("a sign-off by someone other than the author does not count", () => {
  const missing = lib.commitsMissingSignoff([
    commit("fix: a thing\n\nSigned-off-by: B <b@example.com>"),
  ]);
  assert.deepEqual(missing, ["01234567"]);
});

test("merge commits and listed bots need no sign-off", () => {
  const missing = lib.commitsMissingSignoff([
    commit("Merge branch 'main'", "a@example.com", { parents: [{}, {}] }),
    commit("chore: bump", "bot@example.com", { author: { login: "dependabot[bot]" } }),
  ]);
  assert.deepEqual(missing, []);
});

test("a login that only contains a bot's name is not exempt", () => {
  const missing = lib.commitsMissingSignoff([
    commit("chore: bump", "x@example.com", { author: { login: "not-crowdin[bot]-really" } }),
  ]);
  assert.deepEqual(missing, ["01234567"]);
});

const pr = (overrides = {}) => ({
  title: "fix(menubar): keep the divider",
  body: "Closes: #12",
  base: { ref: "development" },
  author_association: "CONTRIBUTOR",
  changed_files: 2,
  additions: 10,
  deletions: 3,
  ...overrides,
});
const strict = {
  maintainerOnlyBase: "main",
  contributorBase: "development",
  titleExampleScope: "menubar",
  requireCloses: true,
  requireSignoff: false,
};

test("a well-formed PR has no findings", () => {
  assert.deepEqual(lib.conventionFindings(pr(), [], strict), { failures: [], warnings: [] });
});

test("an outside contributor may not target the maintainer-only base", () => {
  const outside = lib.conventionFindings(pr({ base: { ref: "main" } }), [], strict);
  assert.match(outside.failures[0], /External PRs must target `development`/);
  const member = lib.conventionFindings(
    pr({ base: { ref: "main" }, author_association: "MEMBER" }),
    [],
    strict,
  );
  assert.deepEqual(member.failures, []);
});

test("a title that is not a conventional commit fails, with the caller's example", () => {
  const { failures } = lib.conventionFindings(pr({ title: "Fix the divider" }), [], strict);
  assert.match(failures[0], /`fix\(menubar\): …`/);
});

test("the Closes line is only required when asked for", () => {
  const without = pr({ body: "No link." });
  assert.equal(lib.conventionFindings(without, [], strict).failures.length, 1);
  assert.equal(
    lib.conventionFindings(without, [], { ...strict, requireCloses: false }).failures.length,
    0,
  );
  assert.equal(lib.conventionFindings(pr({ body: "closes: N/A" }), [], strict).failures.length, 0);
});

test("a large PR is a warning, not a failure", () => {
  const { failures, warnings } = lib.conventionFindings(pr({ changed_files: 31 }), [], strict);
  assert.deepEqual(failures, []);
  assert.match(warnings[0], /31 files/);
});

test("a translation sync PR is one from the sync branch, this repo and a maintainer", () => {
  const sync = {
    head: { ref: "l10n_development", repo: { full_name: "o/r" } },
    author_association: "MEMBER",
  };
  assert.equal(lib.isTranslationSync(sync, "o/r", "l10n_development"), true);
  assert.equal(lib.isTranslationSync(sync, "o/r", ""), false);
  assert.equal(
    lib.isTranslationSync({ ...sync, head: { ...sync.head, repo: { full_name: "fork/r" } } }, "o/r", "l10n_development"),
    false,
  );
  assert.equal(
    lib.isTranslationSync({ ...sync, author_association: "CONTRIBUTOR" }, "o/r", "l10n_development"),
    false,
  );
});

test("the summary starts with the marker and lists what was found", () => {
  const text = lib.summaryComment({
    marker: "<!-- m -->",
    labels: ["fix"],
    failures: ["bad title"],
    warnings: [],
    author: "someone",
  });
  assert.ok(text.startsWith("<!-- m -->\n**Labels:** `fix`"));
  assert.match(text, /> - bad title/);
  assert.ok(text.endsWith("cc @someone"));
  assert.match(
    lib.summaryComment({ marker: "<!-- m -->", labels: [], failures: [], warnings: [], author: "" }),
    /All convention checks passed/,
  );
});
