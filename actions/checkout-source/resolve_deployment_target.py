"""Prints an app target's MACOSX_DEPLOYMENT_TARGET for its Release configuration.

Reads the project as JSON (plutil -convert json). XcodeGen writes the setting on
the project and not the target, so the project's Release configuration is the
fallback. Usage: resolve_deployment_target.py <project.json> <target name>
"""

import json
import sys

KEY = "MACOSX_DEPLOYMENT_TARGET"


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
    return release_settings(target).get(KEY) or release_settings(project)[KEY]


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as handle:
        print(deployment_target(json.load(handle)["objects"], sys.argv[2]))
