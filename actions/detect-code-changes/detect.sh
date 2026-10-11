#!/usr/bin/env bash
# Writes code=true or code=false to GITHUB_OUTPUT. Reads EVENT_NAME, BASE_REF,
# BEFORE, SHA and PATTERNS from the environment.
set -euo pipefail
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
    echo "code=true" >> "$GITHUB_OUTPUT"
    echo "No usable before SHA; treating as code change."
    exit 0
  fi
  # Two dots: what the push changed, even when it rewrote history.
  range="${BEFORE}..${SHA}"
else
  echo "code=true" >> "$GITHUB_OUTPUT"
  echo "${EVENT_NAME}: treating as code change."
  exit 0
fi

# A range that cannot be compared must not read as "nothing changed". Renames
# are listed as a removal and an addition, so a code file moved out still counts.
if ! changed="$(git diff --name-only --no-renames "$range")"; then
  echo "code=true" >> "$GITHUB_OUTPUT"
  echo "Could not compare ${range}; treating as code change."
  exit 0
fi

if grep -E "$PATTERNS" <<< "$changed" >/dev/null; then
  echo "code=true" >> "$GITHUB_OUTPUT"
  echo "Code-related paths changed."
else
  echo "code=false" >> "$GITHUB_OUTPUT"
  echo "No code-related paths changed; heavy jobs will no-op."
fi
