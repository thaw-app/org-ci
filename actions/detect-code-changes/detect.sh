#!/usr/bin/env bash
# Writes code=true or code=false to GITHUB_OUTPUT. Reads EVENT_NAME, BASE_REF,
# BEFORE, SHA and PATTERNS from the environment.
set -euo pipefail
if [[ "$EVENT_NAME" == "pull_request" ]]; then
  git fetch --no-tags --depth=1 origin "$BASE_REF"
  range="origin/${BASE_REF}...HEAD"
elif [[ "$EVENT_NAME" == "push" ]]; then
  if [[ -z "$BEFORE" || "$BEFORE" =~ ^0+$ ]]; then
    echo "code=true" >> "$GITHUB_OUTPUT"
    echo "No usable before SHA; treating as code change."
    exit 0
  fi
  range="${BEFORE}...${SHA}"
else
  echo "code=true" >> "$GITHUB_OUTPUT"
  echo "${EVENT_NAME}: treating as code change."
  exit 0
fi

if git diff --name-only "$range" | grep -E "$PATTERNS" >/dev/null; then
  echo "code=true" >> "$GITHUB_OUTPUT"
  echo "Code-related paths changed."
else
  echo "code=false" >> "$GITHUB_OUTPUT"
  echo "No code-related paths changed; heavy jobs will no-op."
fi
