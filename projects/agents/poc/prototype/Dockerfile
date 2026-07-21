ARG UBUNTU_BASE_IMAGE
FROM ${UBUNTU_BASE_IMAGE}

# Re-declare the parent argument inside the stage before verifying it.
ARG UBUNTU_BASE_IMAGE
ARG NODE_VERSION=24.15.0
ARG NODE_ARCHIVE_SHA256=472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6
ARG CODEX_VERSION=0.144.6
ARG CODEX_NPM_INTEGRITY=sha512-wk+2CWiBNXiJLBoN2D08N9RceWkSBnlgk5g2K1a4CXrP/C0gdlHyRUG7RFzm9y41DCK/7tvCct233JVxyFmznw==

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN [[ "${UBUNTU_BASE_IMAGE}" =~ ^ubuntu:22\.04@sha256:[0-9a-f]{64}$ ]] \
    || { echo "UBUNTU_BASE_IMAGE must be a digest-pinned ubuntu:22.04 reference" >&2; exit 2; } \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git python3 tini xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl --fail --location --silent --show-error "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" --output /tmp/node.tar.xz \
    && echo "${NODE_ARCHIVE_SHA256}  /tmp/node.tar.xz" | sha256sum --check --status \
    && tar --extract --xz --file /tmp/node.tar.xz --directory /opt \
    && ln -s "/opt/node-v${NODE_VERSION}-linux-x64/bin/node" /usr/local/bin/node \
    && ln -s "/opt/node-v${NODE_VERSION}-linux-x64/bin/npm" /usr/local/bin/npm \
    && rm /tmp/node.tar.xz \
    && test "$(npm view "@openai/codex@${CODEX_VERSION}" dist.integrity)" = "${CODEX_NPM_INTEGRITY}" \
    && npm install --global --ignore-scripts "@openai/codex@${CODEX_VERSION}" \
    && codex --version

RUN useradd --create-home --shell /bin/bash agent \
    && mkdir -p /opt/agent-runtime /home/agent/.codex

COPY runtime/codex-config.toml /home/agent/.codex/config.toml
COPY runtime/model-catalog.json /home/agent/.codex/model-catalog.json
COPY runtime/run-agent.sh /opt/agent-runtime/run-agent.sh

RUN chmod 0555 /opt/agent-runtime/run-agent.sh \
    && chown -R agent:agent /opt/agent-runtime /home/agent

USER agent
ENV HOME=/home/agent CODEX_HOME=/home/agent/.codex PATH=${PATH} PYTHONDONTWRITEBYTECODE=1
WORKDIR /workspace
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/opt/agent-runtime/run-agent.sh", "--help"]
