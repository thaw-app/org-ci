#!/usr/bin/env bash
# "plain" prints the findings and exits with zizmor's status, not zero when a finding is left.
# "sarif <file>" writes the report and fails only when zizmor itself fails.
# An empty GH_TOKEN runs the offline audits only.
set -euo pipefail

format="${1:?usage: run.sh plain | run.sh sarif <file>}"

args=(--no-progress --persona "$PERSONA")
[[ -n "$MIN_SEVERITY" ]] && args+=(--min-severity "$MIN_SEVERITY")
[[ -n "$CONFIG" ]] && args+=(--config "$CONFIG")
if [[ -z "${GH_TOKEN:-}" ]]; then
  unset GH_TOKEN
  args+=(--offline)
fi

targets=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [[ -n "$line" ]] && targets+=("$line")
done <<< "$PATHS"
if [[ ${#targets[@]} -eq 0 ]]; then
  echo "::error::paths names nothing to audit" >&2
  exit 1
fi

case "$format" in
  plain)
    "$ZIZMOR" --format plain "${args[@]}" -- "${targets[@]}"
    ;;
  sarif)
    output="${2:?usage: run.sh sarif <file>}"
    "$ZIZMOR" --format sarif "${args[@]}" -- "${targets[@]}" > "$output"
    ;;
  *)
    echo "::error::unknown format $format" >&2
    exit 1
    ;;
esac
