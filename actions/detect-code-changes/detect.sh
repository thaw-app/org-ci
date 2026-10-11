#!/usr/bin/env bash
# Writes code=true or code=false to GITHUB_OUTPUT. Reads EVENT_NAME, BASE_REF,
# BEFORE, SHA and PATTERNS from the environment.
set -euo pipefail

report() {
  echo "code=$1" >> "$GITHUB_OUTPUT"
  echo "$2"
}

case "$EVENT_NAME" in
  pull_request)
    git fetch --no-tags --depth=1 origin "$BASE_REF"
    range="origin/${BASE_REF}...HEAD"
    ;;
  push)
    if [[ -z "$BEFORE" || "$BEFORE" =~ ^0+$ ]]; then
      report true "No usable before SHA; treating as code change."
      exit 0
    fi
    range="${BEFORE}...${SHA}"
    ;;
  *)
    report true "${EVENT_NAME}: treating as code change."
    exit 0
    ;;
esac

if git diff --name-only "$range" | grep -E "$PATTERNS" > /dev/null; then
  report true "Code-related paths changed."
else
  report false "No code-related paths changed; heavy jobs will no-op."
fi
