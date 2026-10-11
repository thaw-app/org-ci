#!/usr/bin/env bash
# Writes args=<scanner arguments> to GITHUB_OUTPUT: one -Dproperty=path for each
# line of REPORTS (sonar.property=path) whose file exists.
set -euo pipefail

args=""
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [[ -z "$line" ]] && continue
  if [[ "$line" != *=* ]]; then
    echo "::error::reports: \"$line\" is not sonar.property=path"
    exit 1
  fi
  path="${line#*=}"
  if [[ -f "$path" ]]; then
    args="${args:+$args }-D${line}"
    echo "Using $path ($(wc -c < "$path" | tr -d ' ') bytes)"
  fi
done <<< "$REPORTS"

if [[ -z "$args" ]]; then
  echo "::warning::No coverage report found; the scan is skipped unless this run built the code."
fi
echo "args=${args}" >> "$GITHUB_OUTPUT"
