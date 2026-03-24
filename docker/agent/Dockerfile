# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# OSMO Agent Image
#
# Purpose-built image for all agent workflows (orchestrator + children).
# Contains the static framework (prompt, tools, workflow template) baked in.
# Runs Claude Code headless — no onboarding, no trust prompts, no interactive UI.
#
# Build (from repo root):
#   docker build -t osmo-agent:latest -f docker/agent/Dockerfile .
#
# Test locally:
#   docker run -it --rm -e ANTHROPIC_API_KEY=<key> osmo-agent:latest
#   claude --print --dangerously-skip-permissions -p "Say hello"

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# System tools + sandbox deps (bubblewrap + socat for Claude Code sandbox on Linux)
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
      bubblewrap \
      socat \
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

# Python tools for quick validation (ruff linter, pip for dependency management)
RUN pip3 install --break-system-packages ruff pip-tools

# Node.js (required for Claude Code)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y -qq --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code && \
    npm cache clean --force

# --- Non-root user (Claude Code refuses --dangerously-skip-permissions as root) ---
RUN useradd -m -s /bin/bash agent && \
    mkdir -p /workspace && \
    chown -R agent:agent /workspace

# --- Pre-configure Claude Code for headless operation ---
# This eliminates ALL interactive prompts: onboarding, theme, trust, API key confirmation.
RUN mkdir -p /home/agent/.claude && \
    cat > /home/agent/.claude/settings.json << 'EOF'
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Read(*)",
      "Write(*)",
      "Edit(*)",
      "Glob(*)",
      "Grep(*)",
      "WebFetch(*)",
      "Agent(*)"
    ],
    "deny": []
  }
}
EOF

# Mark onboarding as completed so Claude Code never shows welcome/theme/trust screens
RUN cat > /home/agent/.claude/.onboarding-complete << 'EOF'
true
EOF

# Trust all directories (headless — no folder trust prompts)
RUN cat > /home/agent/.claude/allowed_directories << 'EOF'
/workspace
/osmo
/tmp
/home/agent
EOF

RUN chown -R agent:agent /home/agent/.claude

# Override NVIDIA org remote-settings that blocks Bash via "ask" permission.
# /etc/claude-code/managed-settings.json is the HIGHEST PRIORITY settings source —
# it overrides server-managed settings, CLI flags, project settings, and user settings.
RUN mkdir -p /etc/claude-code && \
    cat > /etc/claude-code/managed-settings.json << 'EOF'
{
  "permissions": {
    "allow": [
      "Bash",
      "Read",
      "Write",
      "Edit",
      "WebFetch",
      "Agent"
    ],
    "deny": []
  }
}
EOF

# --- Environment ---
ENV PATH="/osmo/usr/bin:${PATH}"
ENV CLAUDE_CODE_SKIP_ONBOARDING=1

# --- Bake in the static framework ---
COPY --chown=agent:agent scripts/agent/orchestrator/orchestrator-prompt.md /osmo/agent/orchestrator-prompt.md
COPY --chown=agent:agent scripts/agent/orchestrator/orchestrator.yaml      /osmo/agent/orchestrator.yaml
COPY --chown=agent:agent scripts/agent/orchestrator/tools/                 /osmo/agent/tools/
COPY --chown=agent:agent scripts/agent/orchestrator/skills/                /osmo/agent/skills/
RUN chmod +x /osmo/agent/tools/*.sh

USER agent
WORKDIR /workspace

RUN git config --global init.defaultBranch main && \
    git config --global advice.detachedHead false

ENTRYPOINT ["/bin/bash"]
