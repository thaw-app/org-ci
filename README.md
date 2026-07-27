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
| `actions/build` | `xcodebuild archive` (Developer ID) |
| `actions/export-and-package` | Export + signed DMG |
| `actions/notarize-and-validate` | notarytool + staple + Gatekeeper |
| `actions/sparkle-release` | Sparkle ZIP, appcast, optional gh-pages publish |

## Notes

- Actions are product-agnostic: pass `app-name`, `project-name`, `scheme-name`, `asset-prefix`, etc. from the caller.
- No org membership is required to *use* these actions from a public consumer repo; only public read of `thaw-app/org-ci` (and `thaw-app/brand-assets` when used).
