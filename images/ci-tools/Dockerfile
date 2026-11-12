# Linux CI tools for the thaw-app repositories. Keep the versions in step with
# .swiftlint-version, .swiftformat-version and the org-ci action defaults.

# SwiftLint 0.65.1. SwiftLint needs the Swift runtime libraries this base image carries.
ARG SWIFTLINT_IMAGE=ghcr.io/realm/swiftlint@sha256:f47e083201e47a136cda5ae847595bfe00226c444ca226fa74fa5dc648a9b057

FROM ${SWIFTLINT_IMAGE} AS fetch

ARG SWIFTFORMAT_VERSION=0.64.6
ARG ACTIONLINT_VERSION=1.7.12
ARG OSV_SCANNER_VERSION=2.4.0

# ADD fails the build when a download's SHA-256 differs from --checksum.
ADD --checksum=sha256:5b9b03a383409a4bf60b0cacd6b18fb36fc3fbacd8b8af156a2865b80ff20ebe \
    https://github.com/nicklockwood/SwiftFormat/releases/download/${SWIFTFORMAT_VERSION}/swiftformat_linux.zip \
    /fetch/swiftformat.zip
ADD --checksum=sha256:8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 \
    https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz \
    /fetch/actionlint.tar.gz
ADD --checksum=sha256:15314940c10d26af9c6649f150b8a47c1262e8fc7e17b1d1029b0e479e8ed8a0 \
    https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64 \
    /fetch/osv-scanner

WORKDIR /fetch
RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/* \
    && unzip -q swiftformat.zip \
    && tar -xzf actionlint.tar.gz actionlint \
    && install -D -m 0755 swiftformat_linux /out/swiftformat \
    && install -D -m 0755 actionlint /out/actionlint \
    && install -D -m 0755 osv-scanner /out/osv-scanner

FROM ${SWIFTLINT_IMAGE}

ARG SWIFTFORMAT_VERSION=0.64.6
ARG ACTIONLINT_VERSION=1.7.12
ARG OSV_SCANNER_VERSION=2.4.0

LABEL org.opencontainers.image.source=https://github.com/thaw-app/org-ci
LABEL org.opencontainers.image.description="SwiftLint, SwiftFormat, actionlint, OSV-Scanner, Python and Git for thaw-app CI"

# actions/checkout needs git for a full clone; python3 runs the baseline and XCStrings checks.
# UID 1001 is the GitHub-hosted runner's user, so the job owns its checkout without running as root.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1001 --user-group --create-home runner

COPY --from=fetch /out/ /usr/local/bin/

SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

# A missing tool or a wrong version fails the image build.
RUN swiftlint version \
    && [ "$(swiftformat --version)" = "${SWIFTFORMAT_VERSION}" ] \
    && [ "$(actionlint -version | head -n 1)" = "${ACTIONLINT_VERSION}" ] \
    && osv-scanner --version | grep -q "osv-scanner version: ${OSV_SCANNER_VERSION}" \
    && python3 --version \
    && git --version

USER runner

# Replace the base image's swiftlint entrypoint so a job gets a shell.
ENTRYPOINT []
CMD ["/bin/bash"]
