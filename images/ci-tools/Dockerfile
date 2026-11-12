# Linux CI tools for the thaw-app repositories. Keep the versions in step with
# .swiftlint-version, .swiftformat-version and the org-ci action defaults.

# SwiftLint needs the Swift runtime libraries this base image carries.
ARG SWIFTLINT_IMAGE=ghcr.io/realm/swiftlint:0.65.1@sha256:f47e083201e47a136cda5ae847595bfe00226c444ca226fa74fa5dc648a9b057

FROM ${SWIFTLINT_IMAGE} AS fetch

ARG SWIFTFORMAT_VERSION=0.64.6
ARG SWIFTFORMAT_SHA256=5b9b03a383409a4bf60b0cacd6b18fb36fc3fbacd8b8af156a2865b80ff20ebe
ARG ACTIONLINT_VERSION=1.7.12
ARG ACTIONLINT_SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
ARG OSV_SCANNER_VERSION=2.4.0
ARG OSV_SCANNER_SHA256=15314940c10d26af9c6649f150b8a47c1262e8fc7e17b1d1029b0e479e8ed8a0

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /fetch
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

RUN curl --proto '=https' --tlsv1.2 -sSfL --retry 3 -o swiftformat.zip \
        "https://github.com/nicklockwood/SwiftFormat/releases/download/${SWIFTFORMAT_VERSION}/swiftformat_linux.zip" \
    && echo "${SWIFTFORMAT_SHA256}  swiftformat.zip" | sha256sum -c - \
    && unzip -q swiftformat.zip \
    && install -D -m 0755 swiftformat_linux /out/swiftformat

RUN curl --proto '=https' --tlsv1.2 -sSfL --retry 3 -o actionlint.tar.gz \
        "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" \
    && echo "${ACTIONLINT_SHA256}  actionlint.tar.gz" | sha256sum -c - \
    && tar -xzf actionlint.tar.gz actionlint \
    && install -D -m 0755 actionlint /out/actionlint

RUN curl --proto '=https' --tlsv1.2 -sSfL --retry 3 -o osv-scanner \
        "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64" \
    && echo "${OSV_SCANNER_SHA256}  osv-scanner" | sha256sum -c - \
    && install -D -m 0755 osv-scanner /out/osv-scanner

FROM ${SWIFTLINT_IMAGE}

ARG SWIFTFORMAT_VERSION=0.64.6
ARG ACTIONLINT_VERSION=1.7.12
ARG OSV_SCANNER_VERSION=2.4.0

LABEL org.opencontainers.image.source=https://github.com/thaw-app/org-ci
LABEL org.opencontainers.image.description="SwiftLint, SwiftFormat, actionlint, OSV-Scanner, Python and Git for thaw-app CI"

# actions/checkout needs git for a full clone; python3 runs the baseline and XCStrings checks.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 \
    && rm -rf /var/lib/apt/lists/*

# Steps run as root on a checkout the runner's user owns, which Git refuses as dubious ownership.
RUN git config --system --add safe.directory '*'

COPY --from=fetch /out/ /usr/local/bin/

SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

# A missing tool or a wrong version fails the image build.
RUN swiftlint version \
    && [ "$(swiftformat --version)" = "${SWIFTFORMAT_VERSION}" ] \
    && [ "$(actionlint -version | head -n 1)" = "${ACTIONLINT_VERSION}" ] \
    && osv-scanner --version | grep -q "osv-scanner version: ${OSV_SCANNER_VERSION}" \
    && python3 --version \
    && git --version

# Replace the base image's swiftlint entrypoint so a job gets a shell.
ENTRYPOINT []
CMD ["/bin/bash"]
