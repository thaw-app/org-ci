# Resolve Release Notes

Resolve notes from an explicit override or the exact release tag's changelog section. No API calls, token, or write permissions are required. Checkout the intended release source before invoking the action.

```yaml
- uses: thaw-app/org-ci/actions/release-notes@<commit-sha>
  id: notes
  with:
    tag: ${{ inputs.tag }}
    release-notes: ${{ inputs.release_notes }}
    changelog-paths: |
      CHANGELOG.md
      Thaw/Resources/CHANGELOG.md

# In your existing action-gh-release step:
# body: ${{ steps.notes.outputs.body }}
# generate_release_notes: ${{ steps.notes.outputs.generate == 'true' }}
```

The action is not published yet. Replace `<commit-sha>` with the reviewed commit after it lands in org-ci.

## Inputs

- `tag` (required): exact tag, including any `v` prefix or prerelease suffix. Empty or multiline tags fail.
- `release-notes`: optional Markdown or HTML override. A nonblank override takes precedence and avoids reading changelog files.
- `changelog-paths`: newline-separated paths, resolved relative to `GITHUB_WORKSPACE`. Defaults to `CHANGELOG.md`. The first existing file wins, even if it has no matching section. Missing files are skipped; other read errors fail the action. Absolute paths and paths that escape the workspace, including through symlinks, are rejected.

Supports `## [1.0.0] - date`, Markdown-escaped brackets (`## \[1.0.0\] - date`), and `## 1.0.0 - date` headings. Subsections are retained, fenced-code headings are ignored, and the section ends at the next level-two heading. Leading/trailing whitespace is trimmed and changelog CRLF is normalized to LF. There is no implicit `v` prefix removal or HTML/Markdown conversion.

## Outputs

- `body`: notes or an empty string.
- `generate`: `"true"` when the body is empty, otherwise `"false"`. This is a recommendation, not an API operation: callers decide whether to enable GitHub-generated notes.
- `source`: `release-notes input`, the selected changelog path, or `none`. An empty body can still have a changelog source if the section was absent or empty.

For Thaw's current behavior, keep `generate_release_notes: false`. For Floe's current fallback, use the `generate` output. Sparkle consumers can pass `body` directly.

## Implementation

`ReleaseNotesResolver.resolve(request)` owns validation, override precedence, candidate selection, and section extraction. Its result distinguishes resolved notes from a missing changelog, missing section, or empty section. Only the GitHub adapter translates those outcomes into `body`, `generate`, and `source` outputs.

The resolver accepts a `ChangelogReader`; `FileChangelogReader` implements filesystem access. Tests exercise the resolver using both a fixture reader and temporary files. Filesystem failures other than missing files propagate to the adapter and fail the action.

## Development

Bun 1.4.2 manages dependencies, runs tests, and bundles the action. Consumers execute the committed CommonJS bundle under GitHub's Node 24 runtime; they do not need Bun.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run check:dist
bun audit
```

Tests include executing the bundle under Node. CI installs Node 24 for these checks. Locally, install Node as well as Bun. Commit `dist/index.js` and `bun.lock` when changing source or dependencies. `check:dist` first requires the bundle to be tracked, then rebuilds it and checks for a diff.
