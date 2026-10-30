"""Checks that every suppression in an OSV-Scanner config says why and until when.

A suppression with no reason cannot be reviewed, and one with no expiry is never
looked at again. Reads the config on standard input.
Usage: validate_suppressions.py <policy-url> < config.toml
"""

from __future__ import annotations

import datetime
import sys
import tomllib

# What the scanner's decoder leaves in an expiry it was not given.
_ZERO_TIME = datetime.datetime(1, 1, 1, tzinfo=datetime.timezone.utc)
_ZERO_TIME_TEXT = ("0001-01-01", "0001-01-01T00:00:00Z")


def _field(table: dict, key: str, where: str, errors: list[str]):
    # The scanner matches field names regardless of case, so this does too. Two
    # spellings of one field leave it unclear which the scanner takes.
    matches = [k for k in table if k.lower() == key.lower()]
    if len(matches) > 1:
        errors.append(f"{where} sets {key} more than once: {', '.join(sorted(matches))}")
    return table[matches[0]] if matches else None


def _is_unset(value) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip() or value.strip() in _ZERO_TIME_TEXT
    if isinstance(value, datetime.datetime):
        if value.tzinfo is None:
            return value == _ZERO_TIME.replace(tzinfo=None)
        return value == _ZERO_TIME
    if isinstance(value, datetime.date):
        return value == _ZERO_TIME.date()
    return False


def _suppresses_vulnerabilities(entry: dict, where: str, errors: list[str]) -> bool:
    vulnerability = _field(entry, "vulnerability", where, errors)
    return _field(entry, "ignore", where, errors) is True or (
        isinstance(vulnerability, dict)
        and _field(vulnerability, "ignore", f"{where}.vulnerability", errors) is True
    )


def _tables(config: dict, key: str, errors: list[str]) -> list:
    return _field(config, key, "The config", errors) or []


def _ignored_vuln_errors(config: dict, policy_url: str, errors: list[str]) -> None:
    for i, entry in enumerate(_tables(config, "IgnoredVulns", errors), start=1):
        where = f"IgnoredVulns[{i}]"
        if not isinstance(entry, dict):
            errors.append(f"{where} must be a table")
            continue
        vuln_id = _field(entry, "id", where, errors) or f"#{i}"
        reason = _field(entry, "reason", where, errors)
        if not isinstance(reason, str) or not reason.strip():
            errors.append(
                f"IgnoredVulns id={vuln_id!r} requires a non-empty reason "
                f"(see {policy_url})"
            )
        if _is_unset(_field(entry, "ignoreUntil", where, errors)):
            errors.append(
                f"IgnoredVulns id={vuln_id!r} requires ignoreUntil "
                f"(YYYY-MM-DD expiry; see {policy_url})"
            )


# A package override that ignores vulnerabilities is a suppression as well,
# with the scanner's own field names.
def _package_override_errors(config: dict, policy_url: str, errors: list[str]) -> None:
    for i, entry in enumerate(_tables(config, "PackageOverrides", errors), start=1):
        where = f"PackageOverrides[{i}]"
        if not isinstance(entry, dict):
            errors.append(f"{where} must be a table")
            continue
        if not _suppresses_vulnerabilities(entry, where, errors):
            continue
        name = _field(entry, "name", where, errors) or f"#{i}"
        reason = _field(entry, "reason", where, errors)
        if not isinstance(reason, str) or not reason.strip():
            errors.append(
                f"PackageOverrides name={name!r} that ignores vulnerabilities "
                f"requires a non-empty reason (see {policy_url})"
            )
        if _is_unset(_field(entry, "effectiveUntil", where, errors)):
            errors.append(
                f"PackageOverrides name={name!r} that ignores vulnerabilities "
                f"requires effectiveUntil (YYYY-MM-DD expiry; see {policy_url})"
            )


def suppression_errors(config: dict, policy_url: str) -> list[str]:
    errors: list[str] = []
    _ignored_vuln_errors(config, policy_url, errors)
    _package_override_errors(config, policy_url, errors)
    return errors


def main(argv: list[str]) -> int:
    policy_url = argv[1]
    config = tomllib.load(sys.stdin.buffer)
    errors = suppression_errors(config, policy_url)
    for message in errors:
        print(f"::error::{message}")
    if errors:
        return 1

    # Valid by now, so the lookups below add no errors.
    unused: list[str] = []
    overrides = [
        e for i, e in enumerate(_tables(config, "PackageOverrides", unused), start=1)
        if _suppresses_vulnerabilities(e, f"PackageOverrides[{i}]", unused)
    ]
    print(
        f"Validated {len(_tables(config, 'IgnoredVulns', unused))} IgnoredVulns suppression(s) "
        f"and {len(overrides)} PackageOverrides that ignore vulnerabilities"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
