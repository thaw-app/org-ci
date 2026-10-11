import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / "actions/checkout-source/resolve_deployment_target.py"
spec = importlib.util.spec_from_file_location("resolve_deployment_target", SCRIPT)
resolve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolve)


def project(target_settings: dict, project_settings: dict) -> dict:
    return {
        "proj": {"isa": "PBXProject", "buildConfigurationList": "projList"},
        "projList": {"buildConfigurations": ["projDebug", "projRelease"]},
        "projDebug": {"name": "Debug", "buildSettings": {"MACOSX_DEPLOYMENT_TARGET": "1.0"}},
        "projRelease": {"name": "Release", "buildSettings": project_settings},
        "app": {"isa": "PBXNativeTarget", "name": "App", "buildConfigurationList": "appList"},
        "other": {"isa": "PBXNativeTarget", "name": "Helper", "buildConfigurationList": "projList"},
        "appList": {"buildConfigurations": ["appRelease"]},
        "appRelease": {"name": "Release", "buildSettings": target_settings},
    }


class DeploymentTargetTest(unittest.TestCase):
    def test_the_targets_own_setting_wins(self):
        objects = project({"MACOSX_DEPLOYMENT_TARGET": "27.0"}, {"MACOSX_DEPLOYMENT_TARGET": "26.0"})
        self.assertEqual(resolve.deployment_target(objects, "App"), "27.0")

    def test_the_project_setting_is_the_fallback(self):
        objects = project({}, {"MACOSX_DEPLOYMENT_TARGET": "26.0"})
        self.assertEqual(resolve.deployment_target(objects, "App"), "26.0")

    def test_an_unknown_target_is_an_error(self):
        objects = project({}, {"MACOSX_DEPLOYMENT_TARGET": "26.0"})
        with self.assertRaises(StopIteration):
            resolve.deployment_target(objects, "Missing")

    def test_no_setting_anywhere_is_an_error(self):
        with self.assertRaises(KeyError):
            resolve.deployment_target(project({}, {}), "App")


if __name__ == "__main__":
    unittest.main()
