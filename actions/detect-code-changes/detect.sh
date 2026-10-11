#!/usr/bin/env bash
# Writes code=true or code=false to GITHUB_OUTPUT. Reads EVENT_NAME, BASE_REF,
# BEFORE, SHA and PATTERNS from the environment.
set -euo pipefail

code_changed() {
  echo "code=true" >> "$GITHUB_OUTPUT"
  echo "$1"
  exit 0
}

if [[ "$EVENT_NAME" == "pull_request" ]]; then
  # A full checkout already has the base branch. Fetch it only when it is
  # missing, since a checkout without persisted credentials cannot fetch from a
  # private repo.
  if ! git rev-parse --verify --quiet "origin/${BASE_REF}" >/dev/null; then
    git fetch --no-tags --depth=1 origin "$BASE_REF"
  fi
  range="origin/${BASE_REF}...HEAD"
elif [[ "$EVENT_NAME" == "push" ]]; then
  if [[ -z "$BEFORE" || "$BEFORE" =~ ^0+$ ]]; then
    code_changed "No usable before SHA; treating as code change."
  fi
  # Two dots: what the push changed, even when it rewrote history.
  range="${BEFORE}..${SHA}"
else
  code_changed "${EVENT_NAME}: treating as code change."
fi

# A range that cannot be compared must not read as "nothing changed". Renames
# are listed as a removal and an addition, so a code file moved out still counts.
# Git quotes and escapes a non-ASCII path unless told not to, and a quoted path
# would never match an anchored pattern.
if ! changed="$(git -c core.quotePath=false diff --name-only --no-renames "$range")"; then
  code_changed "Could not compare ${range}; treating as code change."
fi

# grep exits 1 for no match and 2 or more for a pattern it cannot use. Only the
# first means that no code changed.
status=0
grep -E -e "$PATTERNS" <<< "$changed" >/dev/null || status=$?
if (( status == 0 )); then
  code_changed "Code-related paths changed."
elif (( status == 1 )); then
  echo "code=false" >> "$GITHUB_OUTPUT"
  echo "No code-related paths changed; heavy jobs will no-op."
else
  echo "::error::patterns is not a valid extended regular expression: ${PATTERNS}"
  exit 1
fi
