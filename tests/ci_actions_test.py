import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ACTIONS = Path(__file__).parent.parent / "actions"
DETECT = ACTIONS / "detect-code-changes/detect.sh"
COVERAGE_ARGS = ACTIONS / "sonar-scan/coverage_args.sh"


def run(script, cwd, **env):
    output = Path(cwd) / "github_output"
    output.write_text("")
    result = subprocess.run(
        ["bash", str(script)],
        cwd=cwd,
        env={**os.environ, "GITHUB_OUTPUT": str(output), **env},
        capture_output=True,
        text=True,
    )
    return result, output.read_text()


def git(cwd, *args):
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.com",
         "-c", "commit.gpgsign=false", *args],
        cwd=cwd, check=True, capture_output=True, text=True,
    ).stdout.strip()


class DetectCodeChangesTest(unittest.TestCase):
    PATTERNS = r"(\.swift$|^scripts/)"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = self.tmp.name
        git(self.repo, "init", "-q")
        self.before = self.commit("README.md")

    def tearDown(self):
        self.tmp.cleanup()

    def commit(self, path):
        target = Path(self.repo) / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(path)
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", path)
        return git(self.repo, "rev-parse", "HEAD")

    def detect(self, **env):
        defaults = {"EVENT_NAME": "push", "BASE_REF": "", "BEFORE": self.before,
                    "SHA": "HEAD", "PATTERNS": self.PATTERNS}
        result, output = run(DETECT, self.repo, **{**defaults, **env})
        self.assertEqual(result.returncode, 0, result.stderr)
        return output

    def test_a_push_that_touches_code_is_a_code_change(self):
        self.commit("Sources/App.swift")
        self.assertEqual(self.detect(), "code=true\n")

    def test_a_push_that_touches_only_docs_is_not(self):
        self.commit("docs/guide.md")
        self.assertEqual(self.detect(), "code=false\n")

    def test_a_pattern_anchored_to_a_folder_matches_inside_it_only(self):
        self.commit("docs/scripts/note.md")
        self.assertEqual(self.detect(), "code=false\n")
        self.commit("scripts/build.sh")
        self.assertEqual(self.detect(), "code=true\n")

    def test_a_push_with_no_previous_commit_counts_as_code(self):
        self.assertEqual(self.detect(BEFORE="0" * 40), "code=true\n")
        self.assertEqual(self.detect(BEFORE=""), "code=true\n")

    def test_a_range_that_cannot_be_compared_counts_as_code(self):
        self.commit("docs/guide.md")
        self.assertEqual(self.detect(BEFORE="1" * 40), "code=true\n")

    def test_a_code_file_renamed_out_of_the_pattern_counts_as_code(self):
        self.commit("Sources/App.swift")
        self.before = git(self.repo, "rev-parse", "HEAD")
        (Path(self.repo) / "docs").mkdir()
        git(self.repo, "mv", "Sources/App.swift", "docs/App.md")
        git(self.repo, "commit", "-q", "-m", "move")
        self.assertEqual(self.detect(), "code=true\n")

    def test_a_push_that_removes_a_code_commit_counts_as_code(self):
        self.before = self.commit("Sources/App.swift")
        git(self.repo, "reset", "-q", "--hard", "HEAD~1")
        self.commit("docs/guide.md")
        self.assertEqual(self.detect(), "code=true\n")

    def test_a_code_file_with_a_non_ascii_name_counts_as_code(self):
        self.commit("Sources/Café.swift")
        self.assertEqual(self.detect(), "code=true\n")

    def test_a_code_file_with_a_quote_in_its_name_counts_as_code(self):
        self.commit('Sources/Say "hi".swift')
        self.assertEqual(self.detect(), "code=true\n")

    def test_a_doc_file_with_a_quote_in_its_name_is_not(self):
        self.commit('docs/Say "hi".md')
        self.assertEqual(self.detect(), "code=false\n")

    def test_a_path_with_a_line_break_counts_as_code(self):
        self.commit("docs/two\nlines.md")
        self.assertEqual(self.detect(), "code=true\n")

    def test_a_pattern_that_is_not_a_valid_expression_fails_the_step(self):
        self.commit("Sources/App.swift")
        for patterns in (r"(\.swift$", "-swift("):
            result, output = run(DETECT, self.repo, EVENT_NAME="push", BASE_REF="",
                                 BEFORE=self.before, SHA="HEAD", PATTERNS=patterns)
            self.assertNotEqual(result.returncode, 0, patterns)
            self.assertEqual(output, "")
            self.assertIn("::error::", result.stderr)

    def test_a_manual_run_counts_as_code(self):
        self.assertEqual(self.detect(EVENT_NAME="workflow_dispatch"), "code=true\n")

    def test_a_pull_request_is_compared_with_its_base_branch(self):
        git(self.repo, "branch", "-M", "main")
        origin = tempfile.TemporaryDirectory()
        self.addCleanup(origin.cleanup)
        git(origin.name, "init", "-q", "--bare")
        git(self.repo, "remote", "add", "origin", origin.name)
        git(self.repo, "push", "-q", "origin", "main")
        git(self.repo, "switch", "-q", "-c", "feature")
        self.commit("docs/guide.md")
        self.assertEqual(
            self.detect(EVENT_NAME="pull_request", BASE_REF="main"), "code=false\n"
        )
        self.commit("Sources/App.swift")
        self.assertEqual(
            self.detect(EVENT_NAME="pull_request", BASE_REF="main"), "code=true\n"
        )


class CoverageArgsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def args(self, reports):
        result, output = run(COVERAGE_ARGS, self.dir, REPORTS=reports)
        return result, output

    def test_a_report_that_exists_becomes_a_scanner_argument(self):
        (self.dir / "coverage.xml").write_text("<coverage/>")
        result, output = self.args("sonar.coverageReportPaths=coverage.xml\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, "args=-Dsonar.coverageReportPaths=coverage.xml\n")

    def test_a_missing_report_is_left_out(self):
        (self.dir / "coverage").mkdir()
        (self.dir / "coverage/swift.xml").write_text("<coverage/>")
        reports = (
            "  sonar.coverageReportPaths=coverage/swift.xml\n"
            "\n"
            "  sonar.javascript.lcov.reportPaths=coverage/runtime/lcov.info\n"
        )
        _, output = self.args(reports)
        self.assertEqual(output, "args=-Dsonar.coverageReportPaths=coverage/swift.xml\n")

    def test_every_report_that_exists_is_passed(self):
        (self.dir / "a.xml").write_text("a")
        (self.dir / "b.info").write_text("b")
        _, output = self.args("sonar.a=a.xml\nsonar.b=b.info\n")
        self.assertEqual(output, "args=-Dsonar.a=a.xml -Dsonar.b=b.info\n")

    def test_no_reports_gives_empty_args_and_a_warning(self):
        result, output = self.args("sonar.coverageReportPaths=coverage.xml\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, "args=\n")
        self.assertIn("::warning::", result.stdout)

    def test_a_line_without_a_property_is_an_error(self):
        result, _ = self.args("coverage.xml\n")
        self.assertEqual(result.returncode, 1)
        self.assertIn("::error::", result.stderr)


if __name__ == "__main__":
    unittest.main()
