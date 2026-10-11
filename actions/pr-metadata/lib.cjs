// The parts of PR metadata that need no GitHub API: reading the PR template,
// mapping changed paths to area labels, and checking titles and sign-offs.

// PR change kinds. Bug is an Issue type; bug fixes use `fix` on PRs.
const TYPE_LABELS = {
  'Bug fix': ['fix'],
  'CI/CD': ['ci', 'cd'],
  'Documentation': ['docs'],
  'Feature': ['feature'],
  'Enhancement': ['enhancement'],
  'Refactor': ['refactor'],
  'Performance improvement': ['performance'],
  'Test addition or update': ['test'],
  'Other (please describe)': ['chore'],
};

const TITLE_RE = /^(feat|fix|chore|docs|ci|test|refactor|perf|build|style|revert)(\(.+\))?!?: .+/;

// Exemptions are an exact allowlist of verified bot identities; substring
// matching on the login would let any account named `…crowdin…` skip DCO.
const DCO_BOT_LOGINS = new Set([
  'dependabot[bot]',
  'renovate[bot]',
  'github-actions[bot]',
  'crowdin[bot]',
]);

const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

function getSection(body, heading) {
  const re = new RegExp(
    String.raw`##\s*${escapeRegExp(heading)}\s*\n([\s\S]*?)(?=\n##\s|$)`,
    'i',
  );
  const match = body.match(re);
  return match ? match[1] : '';
}

function isChecked(section, text) {
  const re = new RegExp(String.raw`-\s*\[[xX]\]\s*${escapeRegExp(text)}`);
  return re.test(section);
}

/**
 * Validates the caller's area rules and compiles them. A rule is
 * { label, prefixes?, paths?, patterns?, kind? }: a path matches when it starts
 * with a prefix, equals a path, or matches a pattern (a case-insensitive regular
 * expression). kind is "product" (the default), "fallback" or "ops".
 */
function compileAreaRules(rules) {
  if (!Array.isArray(rules)) throw new Error('area-rules must be a JSON array');
  return rules.map((rule, i) => {
    if (!rule || typeof rule.label !== 'string' || rule.label === '') {
      throw new Error(`area-rules[${i}] needs a label`);
    }
    const kind = rule.kind || 'product';
    if (!['product', 'fallback', 'ops'].includes(kind)) {
      throw new Error(`area-rules[${i}] has unknown kind "${kind}"`);
    }
    const prefixes = rule.prefixes || [];
    const paths = rule.paths || [];
    const patterns = (rule.patterns || []).map((p) => new RegExp(p, 'i'));
    if (prefixes.length + paths.length + patterns.length === 0) {
      throw new Error(`area-rules[${i}] (${rule.label}) matches nothing`);
    }
    return {
      label: rule.label,
      kind,
      test: (p) =>
        prefixes.some((prefix) => p.startsWith(prefix)) ||
        paths.includes(p) ||
        patterns.some((re) => re.test(p)),
    };
  });
}

/**
 * Returns the area labels for a set of changed paths. The first matching rule
 * wins for each path. A fallback area is dropped when a product area also
 * matched; an ops area never displaces it.
 */
function areasForPaths(paths, rules) {
  const areas = new Set();
  for (const path of paths) {
    for (const rule of rules) {
      if (rule.test(path)) {
        areas.add(rule.label);
        break;
      }
    }
  }
  const kindOf = new Map(rules.map((rule) => [rule.label, rule.kind]));
  const hasProduct = [...areas].some((label) => kindOf.get(label) === 'product');
  if (hasProduct) {
    for (const label of areas) {
      if (kindOf.get(label) === 'fallback') areas.delete(label);
    }
  }
  return areas;
}

/** Returns the labels to add and remove, from the PR body's checkboxes and its changed paths. */
function labelChanges(body, paths, rules) {
  const prTypeSection = getSection(body, 'PR Type');
  const areaSection = getSection(body, 'Area');
  const breakingSection = getSection(body, 'Does this PR introduce a breaking change?');

  const toAdd = new Set();
  const toRemove = new Set();

  for (const [text, labels] of Object.entries(TYPE_LABELS)) {
    const target = isChecked(prTypeSection, text) ? toAdd : toRemove;
    for (const label of labels) target.add(label);
  }

  if (isChecked(breakingSection, 'Yes')) {
    toAdd.add('breaking-change');
  } else {
    toRemove.add('breaking-change');
  }

  // Retired on issues and invalid on PRs: never leave `bug` on a PR.
  toRemove.add('bug');

  for (const label of areasForPaths(paths, rules)) toAdd.add(label);

  // Manual Area checkboxes only add (do not remove path-applied areas).
  for (const label of new Set(rules.map((rule) => rule.label))) {
    if (isChecked(areaSection, label)) toAdd.add(label);
  }

  // Do not remove a change-kind label we are also adding.
  for (const label of toAdd) toRemove.delete(label);

  return { toAdd, toRemove };
}

// Sign-off must live in the trailing trailer block (as `git commit -s`
// writes it), so a `Signed-off-by:` line quoted in the body does not count.
function trailerBlock(message) {
  const lines = message.trimEnd().split('\n');
  let start = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === '') break;
    // A trailer is `Key: value`, or a folded continuation line.
    if (!/^[A-Za-z][A-Za-z0-9-]*:\s/.test(line) && !/^\s+\S/.test(line)) break;
    start = i;
  }
  return lines.slice(start);
}

/** Returns the short SHAs of commits with no Signed-off-by trailer matching the author email. */
function commitsMissingSignoff(commits) {
  const missing = [];
  for (const entry of commits) {
    if (DCO_BOT_LOGINS.has(entry.author?.login || '')) continue;
    if ((entry.parents || []).length > 1) continue; // merge commit
    const authorEmail = (entry.commit?.author?.email || '').trim().toLowerCase();
    const message = entry.commit?.message || '';
    if (!authorEmail) {
      missing.push(entry.sha.slice(0, 8));
      continue;
    }
    const signoffEmails = [];
    for (const line of trailerBlock(message)) {
      const match = line.match(/^Signed-off-by:[^<]+<([^>]+)>\s*$/i);
      if (match) signoffEmails.push(match[1].trim().toLowerCase());
    }
    if (!signoffEmails.includes(authorEmail)) missing.push(entry.sha.slice(0, 8));
  }
  return missing;
}

/** True for a PR from the sync branch, in this repo, opened by a maintainer. */
function isTranslationSync(pr, fullName, syncBranch) {
  if (!syncBranch) return false;
  return (
    pr.head?.ref === syncBranch &&
    pr.head?.repo?.full_name === fullName &&
    MAINTAINER_ASSOCIATIONS.has(pr.author_association || '')
  );
}

function isDependencyBot(pr) {
  const login = pr.user?.login || '';
  return login === 'dependabot[bot]' || login === 'renovate[bot]';
}

/**
 * Returns failures, which block the check, and warnings, which do not.
 * commits is only read when options.requireSignoff is set.
 */
function conventionFindings(pr, commits, options) {
  const title = pr.title || '';
  const body = pr.body || '';
  const failures = [];
  const warnings = [];

  if (
    options.maintainerOnlyBase &&
    (pr.base?.ref || '') === options.maintainerOnlyBase &&
    !MAINTAINER_ASSOCIATIONS.has(pr.author_association || '')
  ) {
    failures.push(
      `Base branch is \`${options.maintainerOnlyBase}\`. External PRs must target \`${options.contributorBase}\` (see CONTRIBUTING).`,
    );
  }

  if (!TITLE_RE.test(title)) {
    failures.push(
      `Title must match conventional commits, e.g. \`fix(${options.titleExampleScope}): …\` or \`feat(settings): …\`. Got: \`${title}\`.`,
    );
  }

  if (options.requireCloses && !/\bCloses:\s*(?:#\d+|N\/A)\b/i.test(body)) {
    failures.push(
      `PR body must include a \`Closes:\` line (e.g. \`Closes: #123\` or \`Closes: N/A\`).`,
    );
  }

  if (options.requireSignoff) {
    const missing = commitsMissingSignoff(commits);
    if (missing.length > 0) {
      failures.push(
        `DCO: commit(s) missing a \`Signed-off-by\` trailer matching the author email: \`${missing.join('`, `')}\`. Use \`git commit -s\` (or \`git rebase --signoff\` then force-push). See CONTRIBUTING.`,
      );
    }
  }

  const changedFiles = pr.changed_files || 0;
  const churn = (pr.additions || 0) + (pr.deletions || 0);
  if (changedFiles > 30 || churn > 1000) {
    warnings.push(
      `This PR looks large (${changedFiles} files, ${churn} lines changed). Consider splitting if possible (see CONTRIBUTING: aim ≤20 files / ≤500 LOC).`,
    );
  }

  return { failures, warnings };
}

/** Builds the summary comment. It starts with the marker so a later run can find and update it. */
function summaryComment({ marker, labels, failures, warnings, author }) {
  const lines = [marker];

  if (labels.length > 0) {
    lines.push(`**Labels:** ${labels.map((l) => '`' + l + '`').join(', ')}`);
  }

  if (failures.length > 0) {
    lines.push(
      '',
      `> [!CAUTION]`,
      `> **Convention issues found**: please fix before merge.`,
      ...failures.map((f) => `> - ${f}`),
    );
  }

  if (warnings.length > 0) {
    lines.push('', `> [!WARNING]`, ...warnings.map((w) => `> ${w}`));
  }

  if (failures.length === 0 && warnings.length === 0) {
    lines.push('', 'All convention checks passed. :white_check_mark:');
  }

  if (author) {
    lines.push('', `cc @${author}`);
  }

  return lines.join('\n');
}

module.exports = {
  areasForPaths,
  commitsMissingSignoff,
  compileAreaRules,
  conventionFindings,
  getSection,
  isChecked,
  isDependencyBot,
  isTranslationSync,
  labelChanges,
  summaryComment,
  trailerBlock,
};
