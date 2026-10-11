// Labels a pull request and checks its shape. Called by actions/github-script
// with its github, context and core; reads its settings from the environment.

const lib = require('./lib.cjs');

const flag = (name) => (process.env[name] || '').toLowerCase() === 'true';

/** The names of the labels on the pull request right now. */
async function labelNames(github, target) {
  const labels = await github.paginate(github.rest.issues.listLabelsOnIssue, target);
  return labels.map((l) => l.name);
}

/** Adds and removes labels so the pull request matches its template and paths. */
async function syncLabels(github, pr, target, rules) {
  const { owner, repo } = target;
  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pr.number,
    per_page: 100,
  });
  const { toAdd, toRemove } = lib.labelChanges(
    pr.body || '',
    files.map((file) => file.filename),
    rules,
  );

  const existing = new Set(await labelNames(github, target));

  const addList = [...toAdd].filter((l) => !existing.has(l));
  if (addList.length > 0) {
    await github.rest.issues.addLabels({ ...target, labels: addList });
  }

  await Promise.all(
    [...toRemove]
      .filter((label) => existing.has(label))
      .map((label) =>
        github.rest.issues.removeLabel({ ...target, name: label }).catch((error) => {
          // Someone, or another run, took the label off first.
          if (error.status !== 404) throw error;
        }),
      ),
  );
}

/** Updates the bot comment that starts with the marker, or creates it. */
async function upsertComment(github, target, marker, body) {
  const { owner, repo } = target;
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...target,
    per_page: 100,
  });
  // A comment that only quotes the marker further down is someone else's.
  const botComment = comments.find(
    (c) => c.user?.type === 'Bot' && (c.body || '').startsWith(marker),
  );
  if (botComment) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: botComment.id, body });
  } else {
    await github.rest.issues.createComment({ ...target, body });
  }
}

/** The pull request's commits, fetched only when sign-offs are checked. */
function commitsFor(github, pr, target, options) {
  if (!options.requireSignoff) return [];
  return github.paginate(github.rest.pulls.listCommits, {
    owner: target.owner,
    repo: target.repo,
    pull_number: pr.number,
    per_page: 100,
  });
}

module.exports = async function run({ github, context, core }) {
  const pr = context.payload.pull_request;
  if (!pr) return;

  const { owner, repo } = context.repo;
  const target = { owner, repo, issue_number: pr.number };

  // Translation sync and dependency bot PRs carry their own bodies, with no
  // template checkboxes. Both are matched by branch, repo or verified login,
  // never by title, which a fork could set.
  if (lib.isTranslationSync(pr, `${owner}/${repo}`, process.env.TRANSLATION_SYNC_BRANCH || '')) {
    core.info('Skipping PR metadata for translation sync PR.');
    return;
  }
  if (lib.isDependencyBot(pr)) {
    core.info(`Skipping PR metadata for bot dependency PR (${pr.user.login}).`);
    return;
  }

  const rules = lib.compileAreaRules(JSON.parse(process.env.AREA_RULES || '[]'));
  await syncLabels(github, pr, target, rules);

  const options = {
    maintainerOnlyBase: process.env.MAINTAINER_ONLY_BASE || '',
    contributorBase: process.env.CONTRIBUTOR_BASE || '',
    titleExampleScope: process.env.TITLE_EXAMPLE_SCOPE || 'settings',
    requireCloses: flag('REQUIRE_CLOSES'),
    requireSignoff: flag('REQUIRE_SIGNOFF'),
  };
  const commits = await commitsFor(github, pr, target, options);
  const { failures, warnings } = lib.conventionFindings(pr, commits, options);

  const marker = process.env.COMMENT_MARKER;
  const body = lib.summaryComment({
    marker,
    labels: await labelNames(github, target),
    failures,
    warnings,
    author: pr.user?.login || '',
  });
  await upsertComment(github, target, marker, body);

  if (warnings.length > 0) {
    await core.summary
      .addHeading('PR size heads-up')
      .addList(warnings)
      .addRaw('_Informational only, does not block merge._')
      .write();
  }

  if (failures.length > 0) {
    core.setFailed(failures.join('\n'));
  } else {
    core.info('PR conventions checks passed.');
  }
};
