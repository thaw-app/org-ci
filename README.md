# org-ci

Organization-wide CI/CD building blocks for [thaw-app](https://github.com/thaw-app).

Product repos (including apps that are **not** yet under `thaw-app`) should reference these actions by their **org-qualified GitHub path**, pinned to a commit SHA:

```yaml
uses: thaw-app/org-ci/actions/configure-signing@<sha>
uses: thaw-app/org-ci/actions/build@<sha>
uses: thaw-app/org-ci/actions/export-and-package@<sha>
uses: thaw-app/org-ci/actions/notarize-and-validate@<sha>
uses: thaw-app/org-ci/actions/sparkle-release@<sha>
```

`export-and-package` defaults to fetching DMG art from the public org repo [`thaw-app/brand-assets`](https://github.com/thaw-app/brand-assets). Override `brand-assets-repository` / `dmg-background` if needed.

## Actions

| Action | Purpose |
|--------|---------|
| `actions/configure-signing` | Import Developer ID cert + notarytool profile |
| `actions/build` | `xcodebuild archive` (Developer ID, hardened runtime) |
| `actions/export-and-package` | Export + signed DMG |
| `actions/notarize-and-validate` | notarytool + staple + Gatekeeper |
| `actions/sparkle-release` | Sparkle ZIP, appcast, optional gh-pages publish |

## Job contract

All five actions in a ship pipeline **must run in the same job** (shared `$RUNNER_TEMP` keychain, exported app, Sparkle env).

Typical order:

1. `configure-signing`
2. `build`
3. `export-and-package`
4. `notarize-and-validate`
5. `sparkle-release` (optional)

`configure-signing` and `notarize-and-validate` share a keychain path (default `$RUNNER_TEMP/buildagent.keychain`). Override both with the same `keychain-path` if needed.

### Permissions

- Release / Sparkle publish: `permissions: contents: write` (GitHub Release assets + `gh-pages` appcast push)
- Read-only DMG builds can omit write if they only upload artifacts

### Concurrency

If two Sparkle publishes can race on `gh-pages`, set a workflow concurrency group, for example:

```yaml
concurrency:
  group: sparkle-appcast
  cancel-in-progress: false
```

The publish step also retries refetch+push a few times on conflict.

### Build notes

- Pass exactly one of `project-name` or `workspace-name`
- `enable-hardened-runtime` defaults to `true` (needed for notarization unless the Xcode project already sets it)

## Notes

- Actions are product-agnostic: pass `app-name`, scheme, `asset-prefix`, etc. from the caller.
- No org membership is required to *use* these actions from a public consumer repo; only public read of `thaw-app/org-ci` (and `thaw-app/brand-assets` when used).
