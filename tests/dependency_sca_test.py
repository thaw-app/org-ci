import datetime
import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / "actions/dependency-sca/validate_suppressions.py"
spec = importlib.util.spec_from_file_location("validate_suppressions", SCRIPT)
validate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate)

POLICY = "https://example.com/policy"


class SuppressionErrorsTest(unittest.TestCase):
    def test_no_suppressions_is_valid(self):
        self.assertEqual(validate.suppression_errors({}, POLICY), [])

    def test_a_reason_and_an_expiry_are_enough(self):
        config = {
            "IgnoredVulns": [
                {"id": "GHSA-1", "reason": "not reachable", "ignoreUntil": "2027-01-01"}
            ]
        }
        self.assertEqual(validate.suppression_errors(config, POLICY), [])

    def test_a_missing_reason_is_reported_with_the_policy(self):
        config = {"IgnoredVulns": [{"id": "GHSA-1", "ignoreUntil": "2027-01-01"}]}
        errors = validate.suppression_errors(config, POLICY)
        self.assertEqual(len(errors), 1)
        self.assertIn("requires a non-empty reason", errors[0])
        self.assertIn(POLICY, errors[0])

    def test_a_blank_reason_counts_as_missing(self):
        config = {
            "IgnoredVulns": [{"id": "GHSA-1", "reason": "  ", "ignoreUntil": "2027-01-01"}]
        }
        self.assertEqual(len(validate.suppression_errors(config, POLICY)), 1)

    def test_a_missing_expiry_is_reported(self):
        config = {"IgnoredVulns": [{"id": "GHSA-1", "reason": "not reachable"}]}
        errors = validate.suppression_errors(config, POLICY)
        self.assertEqual(len(errors), 1)
        self.assertIn("requires ignoreUntil", errors[0])

    def test_an_entry_that_is_not_a_table_is_reported(self):
        errors = validate.suppression_errors({"IgnoredVulns": ["GHSA-1"]}, POLICY)
        self.assertEqual(errors, ["IgnoredVulns[1] must be a table"])

    def test_a_package_override_that_ignores_vulnerabilities_needs_both(self):
        for override in (
            {"name": "foo", "ecosystem": "npm", "ignore": True},
            {"name": "foo", "ecosystem": "npm", "vulnerability": {"ignore": True}},
        ):
            errors = validate.suppression_errors({"PackageOverrides": [override]}, POLICY)
            self.assertEqual(len(errors), 2, override)
            self.assertIn("requires a non-empty reason", errors[0])
            self.assertIn("requires effectiveUntil", errors[1])

    def test_a_package_override_with_a_reason_and_an_expiry_is_valid(self):
        config = {
            "PackageOverrides": [
                {"name": "foo", "ignore": True, "reason": "dev only", "effectiveUntil": "2027-01-01"}
            ]
        }
        self.assertEqual(validate.suppression_errors(config, POLICY), [])

    def test_a_package_override_that_only_changes_the_license_is_not_a_suppression(self):
        config = {"PackageOverrides": [{"name": "foo", "license": {"override": ["MIT"]}}]}
        self.assertEqual(validate.suppression_errors(config, POLICY), [])

    def test_the_zero_time_counts_as_no_expiry(self):
        zero = datetime.datetime(1, 1, 1, tzinfo=datetime.timezone.utc)
        for until in (zero, "0001-01-01T00:00:00Z", datetime.date(1, 1, 1)):
            config = {
                "PackageOverrides": [
                    {"name": "foo", "ignore": True, "reason": "dev only", "effectiveUntil": until}
                ]
            }
            errors = validate.suppression_errors(config, POLICY)
            self.assertEqual(len(errors), 1, until)
            self.assertIn("requires effectiveUntil", errors[0])

    def test_field_names_match_regardless_of_case(self):
        config = {
            "packageoverrides": [{"name": "foo", "Vulnerability": {"Ignore": True}}]
        }
        errors = validate.suppression_errors(config, POLICY)
        self.assertEqual(len(errors), 2)
        self.assertIn("requires effectiveUntil", errors[1])

    def test_a_field_spelled_twice_is_reported(self):
        config = {
            "PackageOverrides": [
                {"name": "foo", "ignore": False, "Ignore": True,
                 "reason": "dev only", "effectiveUntil": "2027-01-01"}
            ]
        }
        errors = validate.suppression_errors(config, POLICY)
        self.assertEqual(errors, ["PackageOverrides[1] sets ignore more than once: Ignore, ignore"])

    def test_a_package_override_that_is_not_a_table_is_reported(self):
        errors = validate.suppression_errors({"PackageOverrides": ["foo"]}, POLICY)
        self.assertEqual(errors, ["PackageOverrides[1] must be a table"])


if __name__ == "__main__":
    unittest.main()
