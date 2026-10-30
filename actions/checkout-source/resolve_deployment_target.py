"""Prints an app target's MACOSX_DEPLOYMENT_TARGET for its Release configuration.

Reads the project as JSON (plutil -convert json) on standard input. XcodeGen
writes the setting on the project and not the target, so the project's Release
configuration is the fallback. Usage: resolve_deployment_target.py <target name>
"""

import json
import re
import sys

KEY = "MACOSX_DEPLOYMENT_TARGET"
# A version such as 26.0: the value ends up on one line of GITHUB_OUTPUT.
VERSION = re.compile(r"^\d+(\.\d+)*$", re.ASCII)


def deployment_target(objects: dict, target_name: str) -> str:
    def release_settings(owner: dict) -> dict:
        configs = objects[owner["buildConfigurationList"]]["buildConfigurations"]
        release = next(objects[c] for c in configs if objects[c]["name"] == "Release")
        return release["buildSettings"]

    target = next(
        o
        for o in objects.values()
        if o.get("isa") == "PBXNativeTarget" and o.get("name") == target_name
    )
    project = next(o for o in objects.values() if o.get("isa") == "PBXProject")
    value = release_settings(target).get(KEY) or release_settings(project)[KEY]
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise ValueError(f"{KEY} must be a version such as 26.0, got {value!r}")
    return value


if __name__ == "__main__":
    print(deployment_target(json.load(sys.stdin)["objects"], sys.argv[1]))
