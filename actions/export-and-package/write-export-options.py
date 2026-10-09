import os
import plistlib
import re
import sys


options = {
    "method": "developer-id",
    "teamID": os.environ["APPLE_TEAM_ID"],
    "signingStyle": "manual",
    "destination": "export",
}
profile_name = os.environ["PROFILE_NAME"]
if profile_name:
    bundle_identifier = os.environ["BUNDLE_IDENTIFIER"]
    if not re.fullmatch(r"[A-Za-z0-9.-]+", bundle_identifier):
        sys.exit("::error::provisioning-profile-name needs a bundle-identifier.")
    # Profile names are data, not commands: preserve quotes, backslashes and XML characters.
    options["provisioningProfiles"] = {bundle_identifier: profile_name}

with open(sys.argv[1], "wb") as destination:
    plistlib.dump(options, destination)
