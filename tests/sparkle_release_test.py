import re
import subprocess
import unittest
from pathlib import Path

ACTION = Path(__file__).parent.parent / "actions/sparkle-release/action.yml"


def helpers():
    text = ACTION.read_text()
    start = text.index("        channel_of_tag() {")
    end = text.index("        release_line=", start)
    return "\n".join(line[8:] for line in text[start:end].splitlines())


def line_of(tag):
    result = subprocess.run(
        ["bash", "-c", helpers() + '\nline_of_tag "$1"', "bash", tag],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


class ReleaseLineTest(unittest.TestCase):
    def test_tags_group_by_channel_and_major_version(self):
        cases = {
            "2.2.0-beta.2": "beta/2",
            "2.2.0-rc.1": "beta/2",
            "2.1.0": "stable/2",
            "v2.0.1": "stable/2",
            "3.0.0-beta.6": "beta/3",
            "3.0.0-alpha.13": "alpha/3",
            "3.0.0": "stable/3",
        }
        for tag, line in cases.items():
            with self.subTest(tag=tag):
                self.assertEqual(line_of(tag), line)

    def test_a_2x_beta_never_shares_a_line_with_3x_betas(self):
        # generate_appcast wrote nothing for 2.2.0-beta.2 when 3.0.0-beta.6's
        # higher build number came along as a prior archive.
        self.assertNotEqual(line_of("2.2.0-beta.2"), line_of("3.0.0-beta.6"))
        self.assertEqual(line_of("2.2.0-beta.2"), line_of("2.2.0-beta.1"))

    def test_the_release_line_uses_the_tag_major_version(self):
        self.assertRegex(
            ACTION.read_text(),
            re.escape('release_line="${CHANNEL:-stable}/$(major_of_tag "$TAG")"'),
        )


if __name__ == "__main__":
    unittest.main()
