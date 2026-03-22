# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# OSMO Agent Image
#
# Purpose-built image for all agent workflows (orchestrator + children).
# Pre-installs Claude Code and dev tools. OSMO CLI is provided by the
# runtime at /osmo/usr/bin — no need to install it here.
#
# Build:
#   docker build -t osmo-agent:latest -f docker/agent/Dockerfile .
#
# What's already available at runtime (from OSMO):
#   - /osmo/usr/bin/osmo    — OSMO CLI (workflow submit/query, data upload/download)
#   - Object storage access via `osmo data upload/download`
#
# What this image adds:
#   - Claude Code CLI       — LLM reasoning
#   - git, jq, python3      — DIF script support
#   - gh                    — GitHub PR creation

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# System tools
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
      git \
      jq \
      curl \
      python3 \
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

# Node.js (required for Claude Code)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y -qq --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code && \
    npm cache clean --force

# Ensure OSMO bin path is on PATH (runtime provides /osmo/usr/bin/osmo)
ENV PATH="/osmo/usr/bin:${PATH}"

WORKDIR /workspace

RUN git config --global init.defaultBranch main && \
    git config --global advice.detachedHead false

ENTRYPOINT ["/bin/bash"]
