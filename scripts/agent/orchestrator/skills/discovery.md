<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Skill: Discovery

Your first job. Learn the repo, then write what you find to `.agent/discovered/` so every future agent inherits your knowledge.

## If `.agent/discovered/` Already Exists

Read it. Skip to your next phase.

## If Not — Generate These Artifacts

### 1. `repo-profile.json`

What languages, frameworks, build system, and tooling does this repo use? Explore:

```bash
ls AGENTS.md CLAUDE.md CONTRIBUTING.md README.md 2>/dev/null
ls *.py pyproject.toml go.mod package.json Cargo.toml 2>/dev/null
ls Makefile BUILD MODULE.bazel Dockerfile 2>/dev/null
ls .github/workflows/*.yml .gitlab-ci.yml 2>/dev/null
ls scripts/agent/ 2>/dev/null
```

Write what you find. Format is up to you.

### 2. `quality-gates.json`

How do you validate code in this repo? This is critical — you can't work without it.

Check CI configs, Makefile targets, package.json scripts, existing agent scripts. Write the commands and when to use each (quick check vs. full check).

If nothing exists, document language-level fallbacks. See `/osmo/agent/skills/discovery-quality-fallbacks.md` for defaults.

### 3. `conventions.md`

Extract coding rules from repo instruction files (AGENTS.md, CONTRIBUTING.md, etc.). If none exist, note that.

### 4. `knowledge.md` (optional)

Only if `$KNOWLEDGE_DOC` is not provided. Generate a best-effort guide from the task prompt and codebase.

### Commit

```bash
git add .agent/discovered/ && git commit -m "$COMMIT_PREFIX: discovery" && git push
```

## Children Contributing

If you discover something during your work, write `.agent/discovered/<your-subtask-id>-discovery.json`. Future agents read all discovery files on startup.
