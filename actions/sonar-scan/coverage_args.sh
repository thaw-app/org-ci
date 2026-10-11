#!/usr/bin/env bash
# Writes args=<scanner arguments> to GITHUB_OUTPUT. REPORTS holds one
# sonar.property=path per line; each one whose file exists becomes a
# -Dproperty=path argument.
set -euo pipefail

args=""
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [[ -z "$line" ]] && continue
  if [[ "$line" != *=* ]]; then
    echo "::error::reports: \"$line\" is not sonar.property=path" >&2
    exit 1
  fi
  path="${line#*=}"
  if [[ -f "$path" ]]; then
    args="${args:+$args }-D${line}"
    echo "Using $path ($(wc -c < "$path" | tr -d ' ') bytes)"
  fi
done <<< "$REPORTS"

if [[ -z "$args" ]]; then
  echo "::warning::No coverage report available; the Sonar scan is skipped unless this run built the code."
fi
echo "args=${args}" >> "$GITHUB_OUTPUT"
