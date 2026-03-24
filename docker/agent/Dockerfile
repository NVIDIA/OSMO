# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# OSMO Agent Image
#
# Runs the agent harness (Python SDK) to call Claude via NVIDIA inference API.
# No Claude Code CLI. No permission system. Direct API calls with tool execution.
#
# Build (from repo root):
#   docker build -t osmo-agent:latest -f docker/agent/Dockerfile .
#
# Test locally:
#   python3 /osmo/agent/agent-harness.py --model azure/anthropic/claude-sonnet-4-6 --prompt "hello"

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# System tools
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
      git \
      jq \
      curl \
      python3 \
      python3-pip \
      python3-yaml \
      ca-certificates \
      openssh-client \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends gh && \
    rm -rf /var/lib/apt/lists/*

# Bazel 8.1.1 (matches .bazelversion in OSMO repo — for running tests)
RUN curl -fsSL "https://github.com/bazelbuild/bazel/releases/download/8.1.1/bazel-8.1.1-linux-x86_64" \
      -o /usr/local/bin/bazel && \
    chmod +x /usr/local/bin/bazel

# Python tools: openai SDK (agent harness), ruff (linter), pip-tools (dependency management)
RUN pip3 install --break-system-packages openai ruff pip-tools

# Non-root user
RUN useradd -m -s /bin/bash agent && \
    mkdir -p /workspace && \
    chown -R agent:agent /workspace

# OSMO runtime bin path
ENV PATH="/osmo/usr/bin:${PATH}"

# --- Bake in the static framework ---
COPY --chown=agent:agent scripts/agent/orchestrator/orchestrator-prompt.md /osmo/agent/orchestrator-prompt.md
COPY --chown=agent:agent scripts/agent/orchestrator/orchestrator.yaml      /osmo/agent/orchestrator.yaml
COPY --chown=agent:agent scripts/agent/orchestrator/tools/                 /osmo/agent/tools/
COPY --chown=agent:agent scripts/agent/orchestrator/skills/                /osmo/agent/skills/
COPY --chown=agent:agent scripts/agent/orchestrator/agent-harness.py       /osmo/agent/agent-harness.py
RUN chmod +x /osmo/agent/tools/*.sh

USER agent
WORKDIR /workspace

RUN git config --global init.defaultBranch main && \
    git config --global advice.detachedHead false

ENTRYPOINT ["/bin/bash"]
