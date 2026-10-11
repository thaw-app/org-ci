# org-ci

Organization-wide CI/CD building blocks for [thaw-app](https://github.com/thaw-app).

Product repos (including apps that are **not** yet under `thaw-app`) should reference these actions by their **org-qualified GitHub path**, pinned to a commit SHA:

```yaml
uses: thaw-app/org-ci/actions/configure-signing@<sha>
uses: thaw-app/org-ci/actions/build@<sha>
uses: thaw-app/org-ci/actions/export-and-package@<sha>
uses: thaw-app/org-ci/actions/notarize-and-validate@<sha>
uses: thaw-app/org-ci/actions/sparkle-release@<sha>
uses: thaw-app/org-ci/actions/publish-file-to-branch@<sha>
```

`export-and-package` defaults to fetching DMG art from the public org repo [`thaw-app/brand-assets`](https://github.com/thaw-app/brand-assets). Override `brand-assets-repository` / `dmg-background` if needed.

## Actions

| Action | Purpose |
|--------|---------|
| [`actions/release-notes`](actions/release-notes/README.md) | Resolve notes from an override or tagged changelog section (TypeScript, bundled for Node 24) |
| `actions/configure-signing` | Import Developer ID cert + notarytool profile, and an optional provisioning profile |
| `actions/build` | `xcodebuild archive` (Developer ID, hardened runtime) |
| `actions/export-and-package` | Export + signed DMG |
| `actions/notarize-and-validate` | notarytool + staple + Gatekeeper |
| `actions/sparkle-release` | Sparkle ZIP + signed `appcast.xml` (does not publish) |
| `actions/publish-file-to-branch` | Commit one file onto a branch, retrying on push conflict |
| `actions/checkout-source` | Check out the caller at a ref and report its Xcode project and deployment target |
| `actions/pr-metadata` | Label a pull request from its template and changed paths, and check its title and body |
| `actions/dependency-sca` | Scan lockfiles with OSV-Scanner and fail on a vulnerability that is not suppressed |
| `actions/close-stale-issues` | Mark inactive issues stale, then close them |
| `actions/block-translation-prs` | Close a pull request that only edits String Catalogs and point to Crowdin |
| `actions/pr-build-command` | Run a build workflow on a pull request's branch when a maintainer comments `.build` |
| `actions/remove-skipped-runs` | Delete the repository's skipped workflow runs |

### Sparkle updates repository

By default, `sparkle-release` keeps ZIP download URLs and appcast Pages on the
**caller** repository (legacy). To split installers from update payloads:

| Artifact | Typical home |
| --- | --- |
| DMG / human GitHub Release | Application repo (for example `thaw-app/Thaw`) |
| Sparkle ZIP, deltas, `appcast.xml` | Dedicated updates repo (for example `thaw-app/updates`) |

Pass:

```yaml
- uses: thaw-app/org-ci/actions/sparkle-release@<sha>
  with:
    # …
    updates-repository: thaw-app/updates
    updates-token: ${{ secrets.UPDATES_GITHUB_TOKEN }}
    release-html-url: https://github.com/${{ github.repository }}/releases/tag/${{ inputs.tag }}
```

`sparkle-release` generates the appcast but does not publish it. Push the
`appcast-path` output yourself, which lets one run update several feeds:

```yaml
- uses: thaw-app/org-ci/actions/publish-file-to-branch@<sha>
  with:
    repository: thaw-app/updates
    branch: gh-pages
    source-path: ${{ steps.sparkle.outputs.appcast-path }}
    destination-path: appcast.xml
    token: ${{ secrets.UPDATES_GITHUB_TOKEN }}
    commit-message: "chore(sparkle): publish appcast for ${{ inputs.tag }}"
    create-branch-if-missing: "true"
    gitignore-allowlist: |
      *
      !appcast.xml
      !.gitignore
```

`updates-token` reads the existing feed and prior ZIPs. The token passed to
`publish-file-to-branch` needs `contents: write` on the target repo. When
`updates-repository` is empty, behavior is unchanged and `github.token` is
enough.

## Repository upkeep actions

These hold steps every app repo runs in the same form. Each repo keeps
its own workflow file for what differs: the trigger, the `if:` that limits it to
the upstream repo, the runner and the job's permissions. Because the job stays in
the caller, a check keeps its name, so a branch rule that requires
`dependency-sca` keeps working.

| Action | Trigger in the caller | Job permissions |
| --- | --- | --- |
| `pr-metadata` | `pull_request_target` | `contents: read`, `pull-requests: write`, `issues: write` |
| `dependency-sca` | `pull_request`, `push`, `schedule` | `contents: read`, `actions: read`, `security-events: write` |
| `close-stale-issues` | `schedule` | `issues: write` |
| `block-translation-prs` | `pull_request` on `**/*.xcstrings` | `pull-requests: write`, `issues: write` |
| `pr-build-command` | `issue_comment` | `actions: write`, `issues: write`, `pull-requests: write` |
| `remove-skipped-runs` | `workflow_dispatch` | `actions: write` |

`dependency-sca` reads the repository, so check it out first:

```yaml
jobs:
  dependency-sca:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
      security-events: write
    steps:
      - uses: actions/checkout@<sha>
        with:
          persist-credentials: false
      - uses: thaw-app/org-ci/actions/dependency-sca@<sha>
        with:
          lockfiles: |
            MyApp.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
          config: osv-scanner.toml
```

Every suppression in that config needs a `reason` and an `ignoreUntil`; the action
fails otherwise and quotes `policy-url`.

`pr-build-command` passes the pull request's branch name to the shell through the
environment. The name is chosen by whoever opened the pull request, so it must
never be written into a script.

### PR metadata

`pr-metadata` runs on `pull_request_target`, so it has a write token on pull
requests from forks. It reads the pull request through the API and never checks
out its code; keep it that way in the calling workflow.

What differs between repos is passed in: the comment marker, which checks apply,
and `area-rules`, a JSON array that maps changed paths to area labels.

```yaml
- uses: thaw-app/org-ci/actions/pr-metadata@<sha>
  with:
    comment-marker: "<!-- myapp-pr-conventions -->"
    require-closes: "true"
    area-rules: |
      [
        {"label": "runtime", "prefixes": ["runtime/"]},
        {"label": "settings", "kind": "fallback", "prefixes": ["Sources/Settings/"]},
        {"label": "ops", "kind": "ops", "prefixes": [".github/", "scripts/"], "paths": ["README.md"]}
      ]
```

The first rule that matches a path gives it its area. A `fallback` area is
dropped when a product area also matched. The area checkboxes in the pull
request template must use the same labels as the rules.

### Checking out a release

`checkout-source` checks the caller out at a ref, then reports the commit, the
Xcode project and the app target's Release deployment target. A release tag can
be older than the workflow's own local actions, so the action sets
`local-actions-path` aside before the checkout and puts it back after.

```yaml
- uses: thaw-app/org-ci/actions/checkout-source@<sha>
  id: source
  with:
    ref: refs/tags/${{ inputs.tag }}
    project-name: MyApp.xcodeproj
    target-name: MyApp
```

## Job contract

The build actions in a ship pipeline **must run in the same job** (shared `$RUNNER_TEMP` keychain, exported app, Sparkle env).

Typical order:

1. `configure-signing`
2. `build`
3. `export-and-package` (notarizes + staples the `.app`, then builds the DMG)
4. `notarize-and-validate` (notarizes + staples the DMG)
5. `sparkle-release` (optional)
6. `publish-file-to-branch` (optional, once per feed)

Two notary submissions per build is deliberate: stapling only the DMG leaves
the enclosed `.app` without a ticket, so it fails Gatekeeper on first launch
without network access.

`configure-signing` and `notarize-and-validate` share a keychain path (default `$RUNNER_TEMP/buildagent.keychain`). Override both with the same `keychain-path` if needed.

### Permissions

- Release / Sparkle publish on the caller repo: `permissions: contents: write` (DMG / GitHub Release)
- Dedicated updates feed: a PAT or GitHub App token with `contents: write` on the updates repo (`updates-token`), plus caller `contents: write` for the DMG release
- Read-only DMG builds can omit write if they only upload artifacts

### Concurrency

If two Sparkle publishes can race on `gh-pages`, set a workflow concurrency group, for example:

```yaml
concurrency:
  group: sparkle-appcast
  cancel-in-progress: false
```

`publish-file-to-branch` retries refetch+push on conflict (`max-attempts`,
default 5).

### Build notes

- Pass exactly one of `project-name` or `workspace-name`
- `enable-hardened-runtime` defaults to `true` (needed for notarization unless the Xcode project already sets it)

### Tests

Run `bun install --frozen-lockfile`, then `bun run typecheck`, `bun run test`, and `bun run check:dist`.

On macOS, `python3 -m unittest discover -s tests -p '*_test.py' -v` tests the signing action scripts, the `dependency-sca` suppression check and the `checkout-source` deployment target lookup.
These tests use scratch directories and mock the archive and CMS boundaries; they need no signing credentials
and never import a certificate, build an app, or contact the notary service. CI runs them on a macOS runner.

## Notes

- Actions are product-agnostic: pass `app-name`, scheme, `asset-prefix`, etc. from the caller.
- No org membership is required to *use* these actions from a public consumer repo; only public read of `thaw-app/org-ci` (and `thaw-app/brand-assets` when used).
