import base64
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


def shell_step(action, name):
    lines = (ROOT / "actions" / action / "action.yml").read_text().splitlines()
    start = lines.index(f"    - name: {name}")
    start = lines.index("      run: |", start) + 1
    script = []
    for line in lines[start:]:
        if line and not line.startswith("        "):
            break
        script.append(line[8:])
    return "\n".join(script)


class SigningActionsTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="org-ci-signing-")
        self.addCleanup(self.scratch.cleanup)
        self.folder = Path(self.scratch.name)
        self.env = {
            **os.environ,
            "RUNNER_TEMP": str(self.folder),
            "HOME": str(self.folder / "home"),
            "GITHUB_OUTPUT": str(self.folder / "outputs"),
            "APPLE_TEAM_ID": "TESTTEAM01",
            "PROJECT_NAME": "App.xcodeproj",
            "WORKSPACE_NAME": "",
            "SCHEME_NAME": "App",
            "DEPLOYMENT_TARGET": "26.0",
            "CONFIGURATION": "Release",
            "ARCHIVE_PATH": "build/Archive.xcarchive",
            "EXPORT_PATH": "build/Export",
            "ENABLE_HARDENED_RUNTIME": "true",
            "BUILD_SETTINGS": "",
            "PROFILE_NAME": "",
            "BUNDLE_IDENTIFIER": "",
        }

    def run_step(self, action, name, stub, **inputs):
        env = {**self.env, "GITHUB_ACTION_PATH": str(ROOT / "actions" / action), **inputs}
        return subprocess.run(
            ["/bin/bash", "-c", stub + "\n" + shell_step(action, name)],
            env=env, cwd=self.folder, capture_output=True, text=True, timeout=10,
        )

    def export(self, **inputs):
        # Stop at the archive boundary: no signing, notarization, or packaging runs.
        stub = '''xcodebuild() {
python3 - "$RUNNER_TEMP/ExportOptions.plist" <<'PY'
import json, plistlib, sys
with open(sys.argv[1], "rb") as source:
    print(json.dumps(plistlib.load(source)))
PY
exit 0
}'''
        return self.run_step("export-and-package", "Export archive and create signed DMG", stub, **inputs)

    def test_export_serializer_uses_stdout_without_creating_files(self):
        result = subprocess.run(
            ["python3", str(ROOT / "actions/export-and-package/write-export-options.py")],
            env=self.env, cwd=self.folder, capture_output=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(plistlib.loads(result.stdout), {
            "method": "developer-id", "teamID": "TESTTEAM01",
            "signingStyle": "manual", "destination": "export",
        })
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_export_without_profile_preserves_existing_options(self):
        result = self.export()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout.splitlines()[-1]), {
            "method": "developer-id", "teamID": "TESTTEAM01",
            "signingStyle": "manual", "destination": "export",
        })

    def test_export_preserves_profile_names_verbatim(self):
        for name in ["Floe Developer ID", "Floe's Developer ID", 'Floe "Production" Developer ID',
                     r"Floe\Production", "Floe & <Production>: Développeur"]:
            with self.subTest(name=name):
                result = self.export(PROFILE_NAME=name, BUNDLE_IDENTIFIER="com.thaw.floe")
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                options = json.loads(result.stdout.splitlines()[-1])
                self.assertEqual(options["provisioningProfiles"], {"com.thaw.floe": name})

    def test_export_rejects_missing_or_invalid_bundle_identifier(self):
        for identifier in ["", "com.thaw:floe", "com.thaw.floe\n"]:
            with self.subTest(identifier=identifier):
                result = self.export(PROFILE_NAME="Floe Developer ID", BUNDLE_IDENTIFIER=identifier)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("needs a bundle-identifier", result.stdout + result.stderr)

    def build(self, settings=""):
        return self.run_step("build", "xcodebuild archive", 'xcodebuild() { printf "%s\\0" "$@"; }', BUILD_SETTINGS=settings)

    def test_build_without_extra_settings_preserves_arguments(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.split("\0")[:-1], [
            "archive", "-scheme", "App", "-destination", "platform=macOS",
            "-configuration", "Release", "-archivePath", "build/Archive.xcarchive",
            "-onlyUsePackageVersionsFromResolvedFile", "MACOSX_DEPLOYMENT_TARGET=26.0",
            "DEVELOPMENT_TEAM=TESTTEAM01", "CODE_SIGN_STYLE=Manual",
            "CODE_SIGN_IDENTITY=Developer ID Application", "-project", "App.xcodeproj",
            "ENABLE_HARDENED_RUNTIME=YES",
        ])

    def test_build_settings_are_literal_single_arguments(self):
        settings = ["FLOE_ENTITLEMENTS=Resources/Floe-iCloud.entitlements", "FLOE_PROFILE=Floe's $(touch should-not-exist) ID"]
        result = self.build("\n  \n" + "\n".join(settings) + "\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.split("\0")[-3:-1], settings)
        self.assertFalse((self.folder / "should-not-exist").exists())

    def test_build_rejects_options_and_bare_actions(self):
        for value in ["-derivedDataPath /tmp/x", "archive", "NAME=value\n-exportArchive"]:
            with self.subTest(value=value):
                result = self.build(value)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("takes NAME=value", result.stdout)
                self.assertNotIn("\0", result.stdout, "xcodebuild must not run")

    def install(self, team="TESTTEAM01", uuid="01234567-89AB-CDEF-0123-456789ABCDEF", name="Floe's Developer ID"):
        profile = plistlib.dumps({"UUID": uuid, "Name": name, "TeamIdentifier": [team]}).decode()
        # Exercise decoding, PlistBuddy, installation and outputs without a real CMS certificate.
        return self.run_step("configure-signing", "Install provisioning profile",
                             'security() { printf "%s" "$FIXTURE_PLIST"; }',
                             PROVISIONING_PROFILE=base64.b64encode(b"profile fixture").decode(), FIXTURE_PLIST=profile)

    def test_profile_installation_outputs_and_cleanup(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        uuid = "01234567-89AB-CDEF-0123-456789ABCDEF"
        for directory in ["Library/Developer/Xcode/UserData/Provisioning Profiles", "Library/MobileDevice/Provisioning Profiles"]:
            installed = self.folder / "home" / directory / f"{uuid}.provisionprofile"
            self.assertEqual(installed.read_bytes(), b"profile fixture")
        self.assertEqual((self.folder / "outputs").read_text(), f"name=Floe's Developer ID\nuuid={uuid}\n")
        self.assertFalse((self.folder / "profile.provisionprofile").exists())
        self.assertFalse((self.folder / "profile.plist").exists())

    def test_profile_name_cannot_add_output_entries_or_lose_trailing_newlines(self):
        for name in ["Floe\nuuid=another-value", "Floe\rname=another-value", "Floe\n", "Floe\r\n", ""]:
            with self.subTest(name=name):
                result = self.install(name=name)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("nonempty, single-line name", result.stdout)
                self.assertFalse((self.folder / "outputs").exists())
                self.assertFalse((self.folder / "home").exists())
                self.assertFalse((self.folder / "profile.provisionprofile").exists())
                self.assertFalse((self.folder / "profile.plist").exists())

    def test_profile_with_wrong_team_is_not_installed(self):
        result = self.install(team="WRONGTEAM0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("another team", result.stdout)
        self.assertFalse((self.folder / "home").exists())
        self.assertFalse((self.folder / "profile.provisionprofile").exists())
        self.assertFalse((self.folder / "profile.plist").exists())

    def test_profile_with_invalid_uuid_is_not_installed(self):
        result = self.install(uuid="../invalid")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no usable UUID", result.stdout)
        self.assertFalse((self.folder / "home").exists())


if __name__ == "__main__":
    unittest.main()
