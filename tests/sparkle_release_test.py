import re
import subprocess
import tempfile
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

    def test_both_filters_compare_whole_release_lines(self):
        # A filter that compared channels alone would let 3.x betas back into a 2.x run.
        text = ACTION.read_text()
        self.assertIn('[[ "$(line_of_tag "$prior_tag")" == "$release_line" ]]', text)
        self.assertIn('staged_line="$(line_of_tag "$staged_tag")"', text)
        self.assertNotRegex(text, r'channel_of_tag "\$(prior|staged)_tag"')

    def test_the_release_line_uses_the_tag_major_version(self):
        self.assertRegex(
            ACTION.read_text(),
            re.escape('release_line="${CHANNEL:-stable}/$(major_of_tag "$TAG")"'),
        )


def keep_signed_priors():
    text = ACTION.read_text()
    start = text.index("        keep_signed_priors() {")
    end = text.index("        keep_signed_priors\n", start)
    return "\n".join(line[8:] for line in text[start:end].splitlines())


# Accepts a signature only when it is the first 16 hex digits of the file's SHA-256.
FAKE_SIGN_UPDATE = """#!/bin/bash
[[ "$1" == --verify && "$2" == --ed-key-file ]] || exit 2
[[ "$5" == "$(shasum -a 256 < "$4" | cut -c1-16)" ]]
"""

APPCAST = """<?xml version="1.0" standalone="yes"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
  <channel>
    <item>
      <title>1.0</title>
      <description><![CDATA[<p>Notes for 1.0</p>]]></description>
      <enclosure url="https://github.com/o/r/releases/download/1.0/App_1.0.zip" sparkle:edSignature="{good}"/>
      <sparkle:deltas>
        <enclosure url="https://github.com/o/r/releases/download/1.0/App2-1.delta" sparkle:edSignature="{good}"/>
      </sparkle:deltas>
    </item>
    <item>
      <title>0.9</title>
      <enclosure url="https://github.com/o/r/releases/download/0.9/App_0.9.zip" sparkle:edSignature="0000000000000000"/>
    </item>
  </channel>
</rss>
"""


class PriorArchiveTest(unittest.TestCase):
    def test_a_prior_zip_stays_only_with_its_appcast_signature_and_keeps_its_notes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archives, pages, tools = root / "archives", root / "pages", root / "bin"
            for path in (archives, pages, tools):
                path.mkdir()
            for name in ("App_2.0.zip", "App_1.0.zip", "App_0.9.zip", "App_0.8.zip"):
                (archives / name).write_bytes(name.encode())
            good = subprocess.run(
                ["shasum", "-a", "256", str(archives / "App_1.0.zip")],
                capture_output=True, text=True, check=True,
            ).stdout[:16]
            (pages / "appcast.xml").write_text(APPCAST.replace("{good}", good))
            sign_update = tools / "sign_update"
            sign_update.write_text(FAKE_SIGN_UPDATE)
            sign_update.chmod(0o755)

            result = subprocess.run(
                ["bash", "-c", keep_signed_priors() + "\nkeep_signed_priors"],
                capture_output=True, text=True, check=True,
                env={
                    "PATH": "/usr/bin:/bin",
                    "SPARKLE_ARCHIVES": str(archives),
                    "SPARKLE_PAGES": str(pages),
                    "SPARKLE_BIN": str(tools),
                    "ZIP_PATH": str(root / "build" / "App_2.0.zip"),
                    "key_file": str(root / "key"),
                },
            )

            self.assertEqual(
                sorted(path.name for path in archives.iterdir()),
                ["App_1.0.html", "App_1.0.zip", "App_2.0.zip"],
                result.stdout,
            )
            self.assertEqual((archives / "App_1.0.html").read_text(), "<p>Notes for 1.0</p>\n")
            self.assertIn("Dropping App_0.9.zip", result.stdout)
            self.assertIn("Dropping App_0.8.zip", result.stdout)

    def test_a_count_of_zero_fetches_no_prior_zip(self):
        # The count was checked after a download, so 0 still fetched one ZIP.
        text = ACTION.read_text()
        loop = text[text.index('while IFS= read -r release_tag; do'):]
        self.assertLess(
            loop.index('[[ "$fetched" -ge "$PREVIOUS_COUNT" ]] && break'),
            loop.index('download_prior_zip "$release_tag"'),
        )


if __name__ == "__main__":
    unittest.main()
