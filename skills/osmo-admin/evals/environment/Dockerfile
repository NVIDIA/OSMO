# Eval environment for the osmo-admin skill.

FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends bash ca-certificates coreutils git jq python3 ripgrep sed && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /workspace
COPY input/ /workspace/input/

RUN bash /workspace/input/prepare-fixture-workspace.sh /workspace /workspace/input/repo

RUN for tool in osmo kubectl; do \
      printf '%s\n' '#!/usr/bin/env bash' \
        'printf "%s\n" "live admin command disabled in osmo-admin eval fixture; use provided config files" >&2' \
        'exit 2' > "/usr/local/bin/${tool}"; \
      chmod +x "/usr/local/bin/${tool}"; \
    done && \
    useradd --uid 10001 --create-home --shell /bin/bash agent && \
    chown -R agent:agent /workspace && \
    chown root:root /usr/local/bin/osmo /usr/local/bin/kubectl && \
    chmod 0555 /usr/local/bin/osmo /usr/local/bin/kubectl

USER agent

WORKDIR /workspace/repo
