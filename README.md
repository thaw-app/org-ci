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
| `dependency-sca` | `pull_request`, `schedule` | `contents: read`, `actions: read`, `security-events: write` |
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

### CI steps

`detect-code-changes` and `sonar-scan` are the two parts of an app's CI workflow
that do not depend on how the app builds.

`detect-code-changes` reports `code` as `"true"` when a pull request or a push
changed a path matching `patterns`, so the build can be skipped for a docs-only
change. A manual run, or a push with no previous commit, counts as code.

```yaml
changes:
  runs-on: ubuntu-latest
  outputs:
    code: ${{ steps.filter.outputs.code }}
  steps:
    - uses: actions/checkout@<sha>
      with:
        fetch-depth: 0
        persist-credentials: false
    - uses: thaw-app/org-ci/actions/detect-code-changes@<sha>
      id: filter
      with:
        patterns: '(\.swift$|^MyApp\.xcodeproj/|^scripts/)'
```

`sonar-scan` runs the scan with coverage. When the run built the code, it
downloads the build job's coverage artifact and caches it. When the run skipped
the build, it restores the coverage cached by an earlier run of the same branch
or pull request, then by the base or default branch. A run with no build and no cached coverage does not
scan, since that would publish 0% coverage.

```yaml
sonarqube:
  needs: [changes, build]
  runs-on: ubuntu-latest
  env:
    SONAR_ENABLED: ${{ github.actor != 'dependabot[bot]' && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) }}
  steps:
    - uses: actions/checkout@<sha>
      if: env.SONAR_ENABLED == 'true'
      with:
        fetch-depth: 0
        persist-credentials: false
    - uses: thaw-app/org-ci/actions/sonar-scan@<sha>
      if: env.SONAR_ENABLED == 'true'
      with:
        sonar-token: ${{ secrets.SONAR_TOKEN }}
        code-changed: ${{ needs.changes.outputs.code }}
        cache-path: coverage.xml
        reports: |
          sonar.coverageReportPaths=coverage.xml
```

Forks and Dependabot get no `SONAR_TOKEN` on a pull request, so the caller skips
the action for them, as `SONAR_ENABLED` does above. The `build` job has to run
on a docs-only change and skip its own steps: GitHub skips a job whose `needs`
were skipped, and the scan would never restore the cached coverage. Keep the report paths out of `sonar-project.properties`: a
report exists only when this run built or restored it.

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

## Reusable workflows

### Building a release

`.github/workflows/build-macos-app.yml` builds, signs, notarizes and attests a
macOS app in two jobs of its own. The build job runs `checkout-source`,
`configure-signing`, `build`, `export-and-package` and `notarize-and-validate`,
then generates a CycloneDX SBOM with a pinned syft, writes sha256 checksums,
zips the exported `.app` with `ditto` and uploads everything as one workflow
artifact. The attest job downloads that artifact, checks the files against the
digests the build job reported, attests the DMG and the SBOM by digest and
uploads the bundles as a second artifact. It is the only job with the
`id-token` permission: the app's prepare script and build phases run in the
build job and never see the identity that signs the provenance, which is what
SLSA Build L3 asks of a builder.

It exists for SLSA Build L3. When a caller runs the actions in its own job, the
caller's workflow is the builder named in the provenance, and GitHub grants
Build L2. When the build runs in this reusable workflow, the caller only chooses
what to build; the provenance names this file as its signer, which is Build L3.
The level is about who defines the build steps and signs the provenance. The
project's own build phases and its `prepare-script` still run from the
checked-out source, as in any build of that source. Verify a download with:

```sh
gh attestation verify App.dmg --owner <org> \
  --signer-workflow thaw-app/org-ci/.github/workflows/build-macos-app.yml
```

The provenance names the commit that triggered the caller, so with `attest` on
the workflow builds that commit and fails when `ref` resolves to another one.
Dispatch a release run on its tag, `gh workflow run release.yml --ref 1.2.3`,
not on a branch with the tag as an input. `ref` can then stay empty. With
`attest` off there is no provenance, so any `ref` builds: a development build
passes the branch and leaves `version` empty. The job holds the signing and
notarization secrets either way, so only build refs the caller trusts, such as
branches of its own repository that someone with write access asked for, as
`pr-build-command` enforces.

Call it as a job. The caller's job needs `id-token: write` and
`attestations: write`; the called workflow asks for nothing more. A `uses:` job
cannot set an `environment`, so the workflow takes the environment's name as an
input and applies its protection rules before any secret is read. Pass the
secrets with `secrets: inherit`, which matches them by the names below. It is the
only way environment secrets reach a called workflow, and it works for callers
in the same organization. A caller that keeps them as repository secrets can
map them one by one under `secrets:` instead.

```yaml
jobs:
  build:
    uses: thaw-app/org-ci/.github/workflows/build-macos-app.yml@<sha>
    permissions:
      contents: read
      id-token: write
      attestations: write
    with:
      version: ${{ github.ref_type == 'tag' && github.ref_name || '' }}
      project-name: MyApp.xcodeproj
      target-name: MyApp
      scheme-name: MyApp
      app-name: MyApp.app
      dmg-name: MyApp.dmg
      asset-prefix: MyApp
      environment: release
      runner: macos-latest
      prepare-script: scripts/install-swiftlint.sh
      attest: ${{ !inputs.dry_run }}
    secrets: inherit
```

Inputs:

| Input | Required | Purpose |
| --- | --- | --- |
| `ref` | no | Ref to build. Empty builds the triggering commit; with `attest` on, another ref must name that same commit |
| `version` | no | Version being built. Names the SBOM and the artifact; empty names them `dev-<short sha>` |
| `project-name` | yes | Xcode project relative to the checkout |
| `target-name` | yes | App target whose Release deployment target is used |
| `scheme-name` | yes | Scheme to archive |
| `app-name` | yes | Name of the `.app` bundle: letters, digits, `._ -`, starting with a letter, digit or `_` and ending in `.app` |
| `dmg-name` | yes | Name of the DMG to produce: letters, digits, `._-`, starting with a letter, digit or `_` and ending in `.dmg` |
| `asset-prefix` | yes | Prefix of the SBOM file name (`Prefix_version.cdx.json`): letters, digits, `._-` |
| `environment` | yes | Caller environment that holds the signing secrets |
| `runner` | no | Runner label, default `macos-latest` |
| `xcode-version` | no | Passed to setup-xcode, default `latest` |
| `prepare-script` | no | Script inside the checkout to run with `sh` before the build |
| `build-settings` | no | Extra xcodebuild settings, one `NAME=value` per line |
| `bundle-identifier` | no | Needed with a provisioning profile |
| `attest` | no | Default `true`. Off for dry runs: an attestation is a permanent public record. Off also skips the attest job and the triggering-commit check |
| `retention-days` | no | Days the artifact is kept, default 7 |

Secrets: `APPLE_APPLICATION_CERT`, `APPLE_APPLICATION_CERT_PASSWORD`,
`APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID`, and `PROVISIONING_PROFILE`
when the app needs one.

Outputs:

| Output | Content |
| --- | --- |
| `commit` | Commit that was built |
| `version` | Version that named the SBOM and the artifact |
| `artifact-name` | Workflow artifact holding the DMG, the SBOM, their `.sha256` files and the app ZIP |
| `app-zip-name` | Exported `.app` as a ZIP |
| `dmg-name`, `dmg-digest` | DMG file name and `sha256:<hex>` |
| `sbom-name`, `sbom-digest` | SBOM file name and `sha256:<hex>` |
| `provenance-artifact-name` | Workflow artifact holding the attestation bundles. Empty when `attest` was off |
| `dmg-bundle-name`, `sbom-bundle-name` | Attestation bundles, `<file>.intoto.jsonl`. Empty when `attest` was off |

The caller finishes the release in a job that `needs` the build, either with
`release-macos-app.yml` below or with its own steps: check out the repository,
download the build artifact and the provenance artifact, unzip the app with
`ditto -x -k` into `build/Export`, sign the DMG and the SBOM with
`cosign sign-blob --bundle <file>.sigstore.json`, create the GitHub Release with
the DMG, the SBOM, the `.sha256` files, the `.sigstore.json` signatures and the
`*.intoto.jsonl` bundles, then run `sparkle-release` on the unzipped app and
publish its ZIP and appcast as described under Sparkle updates repository. The
app ZIP keeps the bundle's symlinks, resource forks and notarization ticket,
which a plain artifact upload loses.

Both workflows pin this repository's own actions by SHA, like a caller does,
because they check out the caller and not org-ci. When one of those actions
changes, bump the pins in the workflows too.

### Publishing a release

`.github/workflows/release-macos-app.yml` takes the artifacts of
`build-macos-app.yml` and publishes them. In one macOS job it checks out the
caller at the tag, resolves the release notes with `release-notes`, downloads
the build and the provenance, restores the app with `ditto`, checks its signature, its stapled
ticket, both attested digests and the attestation bundles (`gh attestation
verify`, against the caller's repository and the build workflow), runs
`sparkle-release` for the ZIP, the deltas and the signed appcast, signs the DMG
and the SBOM with cosign, creates the GitHub Release as a draft with every file
and the attestation bundles, and when asked publishes the release and pushes
the appcast. A dry run produces every file except the signatures and the
provenance bundles, and writes a report to the job summary instead.

The order is fixed so that no release and no feed is public until the end: an
unknown discussion category, a missing bundle or a failed Sparkle step stops the
run while both releases are still drafts. Signing is not covered: cosign writes
to the public Rekor log before anything is published, and that entry stays when
the run fails afterwards. The caller's release is published first,
then the updates release, then the appcast, so no feed item names a ZIP that is
not there yet. A tag whose release is already published is refused, and so is a
tag that names another commit than the one the build job built. One exception:
when a run published the caller's release and then failed before the updates
release, re-running it with the same build (the published DMG checksum must
match) skips the caller's release and publishes the updates release and the
appcast. An updates release that is already published is always refused.

That leaves a run that failed on the appcast push after both releases went
public. Re-running it is refused, because a new run makes a new Sparkle ZIP that
the published one would not match. Recover by hand instead: the failed run keeps
the appcast it made as the `appcast-<tag>` artifact (and the legacy appcast, when
there is one). Download it with `gh run download <run-id> -n appcast-<tag>`, then
commit it as `appcast.xml` to the appcast branch, or push it with
`publish-file-to-branch`.

```yaml
jobs:
  release:
    needs: [meta, build]
    uses: thaw-app/org-ci/.github/workflows/release-macos-app.yml@<sha>
    permissions:
      contents: write
      id-token: write
    with:
      tag: ${{ needs.meta.outputs.tag }}
      channel: ${{ needs.meta.outputs.channel }}
      prerelease: ${{ needs.meta.outputs.prerelease == 'true' }}
      project-name: MyApp.xcodeproj
      target-name: MyApp
      app-name: MyApp.app
      asset-prefix: MyApp
      commit: ${{ needs.build.outputs.commit }}
      build-artifact: ${{ needs.build.outputs.artifact-name }}
      provenance-artifact: ${{ needs.build.outputs.provenance-artifact-name }}
      app-zip-name: ${{ needs.build.outputs.app-zip-name }}
      dmg-name: ${{ needs.build.outputs.dmg-name }}
      dmg-digest: ${{ needs.build.outputs.dmg-digest }}
      sbom-name: ${{ needs.build.outputs.sbom-name }}
      sbom-digest: ${{ needs.build.outputs.sbom-digest }}
      dmg-bundle-name: ${{ needs.build.outputs.dmg-bundle-name }}
      sbom-bundle-name: ${{ needs.build.outputs.sbom-bundle-name }}
      release-notes: ${{ inputs.release_notes }}
      sparkle-version: "2.10.0"
      sparkle-sha256: <sha256 of Sparkle-2.10.0.tar.xz>
      environment: release
      runner: macos-latest
      publish-release: ${{ inputs.publish_release }}
      publish-appcast: ${{ inputs.publish_appcast }}
      dry-run: ${{ inputs.dry_run }}
    secrets: inherit
```

Inputs:

| Input | Required | Purpose |
| --- | --- | --- |
| `tag` | yes | Release tag |
| `channel` | no | Sparkle channel, default `stable` |
| `prerelease` | no | Mark the release as a prerelease, default `false` |
| `project-name`, `target-name` | yes | For `checkout-source` |
| `app-name` | yes | Name of the `.app` bundle |
| `asset-prefix` | yes | Prefix of the Sparkle ZIP and the SBOM |
| `appcast-title` | no | Title of a new appcast; empty uses `asset-prefix` |
| `commit`, `build-artifact`, `app-zip-name`, `dmg-name`, `dmg-digest`, `sbom-name`, `sbom-digest` | yes | The build workflow's outputs of the same names; the tag must name `commit` |
| `provenance-artifact`, `dmg-bundle-name`, `sbom-bundle-name` | no | The build's provenance artifact and bundle names; required unless `dry-run` |
| `release-notes` | no | Notes override; empty reads the changelog, and GitHub generates them when it has no section for the tag |
| `changelog-paths` | no | Changelog files to look in, one per line, default `CHANGELOG.md` |
| `sparkle` | no | Default `true`. Off ships the DMG alone |
| `sparkle-version`, `sparkle-sha256` | yes | Sparkle tools, matching the app's `Package.resolved` |
| `updates-repository` | no | Repository that gets the ZIP and deltas as a release of its own; empty attaches them to the caller's release |
| `appcast-repository`, `appcast-branch` | no | Where `appcast.xml` is served; default the caller's `gh-pages` |
| `appcast-url` | no | Live appcast URL, for the dry run's diff |
| `appcast-script` | no | Script in the checkout that edits the appcast before publishing; see the workflow for its contract |
| `legacy-appcast-repository`, `legacy-appcast-branch`, `legacy-appcast-url` | no | A second feed fed by the script's `legacy-appcast-path` |
| `environment` | yes | Caller environment that holds the release secrets |
| `runner` | no | macOS runner label, default `macos-latest` |
| `publish-release` | no | Publish at the end, default `false` leaves a draft |
| `publish-appcast` | no | Push the appcast once the release is published, default `true` |
| `discussion-category` | no | Open a release discussion in this category when publishing |
| `dry-run` | no | Produce and report every file, publish nothing |

Secrets, matched by name through `secrets: inherit`:
`SPARKLE_ED25519_PRIVATE_KEY` when `sparkle` is on, `UPDATES_GITHUB_TOKEN` when
`updates-repository` or `appcast-repository` is another repository, and
`LEGACY_APPCAST_TOKEN` with `legacy-appcast-repository`. The run's own token is
used for the caller's release and branches, so the calling job needs
`contents: write`, and `id-token: write` for cosign's keyless signing.

The cosign signature names this workflow, at the revision the caller pinned, as
the signer. Verify a release asset against that revision and the caller's
repository:

```sh
cosign verify-blob --bundle App.dmg.sigstore.json \
  --certificate-identity 'https://github.com/thaw-app/org-ci/.github/workflows/release-macos-app.yml@<sha>' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-github-workflow-repository <owner>/<repo> \
  App.dmg
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
