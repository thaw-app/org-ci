// Labels a pull request and checks its shape. Called by actions/github-script
// with its github, context and core; reads its settings from the environment.

const lib = require('./lib.cjs');

const flag = (name) => (process.env[name] || '').toLowerCase() === 'true';

module.exports = async function run({ github, context, core }) {
  const pr = context.payload.pull_request;
  if (!pr) return;

  const owner = context.repo.owner;
  const repo = context.repo.repo;

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

  const existing = new Set(
    (
      await github.paginate(github.rest.issues.listLabelsOnIssue, {
        owner,
        repo,
        issue_number: pr.number,
      })
    ).map((l) => l.name),
  );

  const addList = [...toAdd].filter((l) => !existing.has(l));
  if (addList.length > 0) {
    await github.rest.issues.addLabels({ owner, repo, issue_number: pr.number, labels: addList });
  }
  for (const label of toRemove) {
    if (!existing.has(label)) continue;
    try {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: pr.number, name: label });
    } catch (error) {
      // Someone, or another run, took the label off first.
      if (error.status !== 404) throw error;
    }
  }

  const options = {
    maintainerOnlyBase: process.env.MAINTAINER_ONLY_BASE || '',
    contributorBase: process.env.CONTRIBUTOR_BASE || '',
    titleExampleScope: process.env.TITLE_EXAMPLE_SCOPE || 'settings',
    requireCloses: flag('REQUIRE_CLOSES'),
    requireSignoff: flag('REQUIRE_SIGNOFF'),
  };
  const commits = options.requireSignoff
    ? await github.paginate(github.rest.pulls.listCommits, {
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
      })
    : [];
  const { failures, warnings } = lib.conventionFindings(pr, commits, options);

  const currentLabels = (
    await github.paginate(github.rest.issues.listLabelsOnIssue, {
      owner,
      repo,
      issue_number: pr.number,
    })
  ).map((l) => l.name);

  const marker = process.env.COMMENT_MARKER;
  const commentBody = lib.summaryComment({
    marker,
    labels: currentLabels,
    failures,
    warnings,
    author: pr.user?.login || '',
  });

  // Upsert: find the bot comment that starts with our marker, update or create.
  // A comment that only quotes the marker further down is someone else's.
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pr.number,
    per_page: 100,
  });
  const botComment = comments.find(
    (c) => c.user?.type === 'Bot' && (c.body || '').startsWith(marker),
  );
  if (botComment) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: botComment.id, body: commentBody });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number: pr.number, body: commentBody });
  }

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
