"""Checks that every suppression in an OSV-Scanner config says why and until when.

A suppression with no reason cannot be reviewed, and one with no expiry is never
looked at again. Reads the config on standard input.
Usage: validate_suppressions.py <policy-url> < config.toml
"""

from __future__ import annotations

import sys
import tomllib


def suppression_errors(config: dict, policy_url: str) -> list[str]:
    errors: list[str] = []
    for i, entry in enumerate(config.get("IgnoredVulns") or [], start=1):
        if not isinstance(entry, dict):
            errors.append(f"IgnoredVulns[{i}] must be a table")
            continue
        vuln_id = entry.get("id") or f"#{i}"
        reason = entry.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            errors.append(
                f"IgnoredVulns id={vuln_id!r} requires a non-empty reason "
                f"(see {policy_url})"
            )
        ignore_until = entry.get("ignoreUntil")
        if ignore_until is None or (
            isinstance(ignore_until, str) and not ignore_until.strip()
        ):
            errors.append(
                f"IgnoredVulns id={vuln_id!r} requires ignoreUntil "
                f"(YYYY-MM-DD expiry; see {policy_url})"
            )
    return errors


def main(argv: list[str]) -> int:
    policy_url = argv[1]
    config = tomllib.load(sys.stdin.buffer)
    errors = suppression_errors(config, policy_url)
    for message in errors:
        print(f"::error::{message}")
    if errors:
        return 1

    print(f"Validated {len(config.get('IgnoredVulns') or [])} IgnoredVulns suppression(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
