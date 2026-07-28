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
    publish-appcast: "true"
```

`updates-token` needs `contents: write` on the updates repo (release assets are
uploaded by the caller workflow; this token is used for appcast `gh-pages`
push and for reading the existing feed / prior ZIPs). When `updates-repository`
is empty, behavior is unchanged and `github.token` is enough.

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

The publish step also retries refetch+push a few times on conflict.

### Build notes

- Pass exactly one of `project-name` or `workspace-name`
- `enable-hardened-runtime` defaults to `true` (needed for notarization unless the Xcode project already sets it)

## Notes

- Actions are product-agnostic: pass `app-name`, scheme, `asset-prefix`, etc. from the caller.
- No org membership is required to *use* these actions from a public consumer repo; only public read of `thaw-app/org-ci` (and `thaw-app/brand-assets` when used).
