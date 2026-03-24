<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Skill: Recovery

Read this when resuming from a previous session (`.agent/` directory exists in the repo).

## How to Assess Prior State

```bash
# What was the task?
cat .agent/task.json

# What did prior agents learn? (read this FIRST — most valuable context)
cat .agent/memory/long-term.json 2>/dev/null
ls .agent/memory/episodes/ 2>/dev/null

# What did discovery find?
ls .agent/discovered/
cat .agent/discovered/repo-profile.json
cat .agent/discovered/quality-gates.json

# What subtasks exist and what's their status?
for f in .agent/subtasks/st-*.json; do
  jq '{id:.id, status:.status}' "$f"
done

# What decisions have been made?
for f in .agent/decisions/d-*.json; do
  jq '.decision' "$f"
done

# What did children discover?
for f in .agent/discovered/st-*-discovery.json 2>/dev/null; do
  jq '.findings' "$f"
done

# What code has been committed?
git log --oneline -20
```

## What to Do

1. **Read discovered artifacts**: `.agent/discovered/` has the repo profile, quality gates, conventions, and possibly a generated knowledge doc. You don't need to rediscover — just read.

2. **Check for in-progress subtasks**: If a subtask says "in_progress" with an assigned workflow, check if that workflow is still running: `osmo workflow query <id>`. If completed, pull and validate. If failed, decide next steps.

3. **Check for human answers**: Run `/osmo/agent/tools/check-answers.sh`. If answers arrived, write decision files and unblock affected subtasks.

4. **Verify current state**: Use the quality gates from `.agent/discovered/quality-gates.json` to confirm the codebase is healthy.

5. **Continue from where it stopped**: Find the next subtask that's pending and whose dependencies are met. Pick up from there.

## Rules

- Don't redo completed work. If a subtask is marked done and its code is committed, move on.
- Don't redo discovery. If `.agent/discovered/` exists, read it.
- Don't blindly trust prior work. A quick quality check confirms the codebase is healthy.
- Git is the source of truth for code. Subtask files are the source of truth for coordination. Discovered artifacts are the source of truth for repo knowledge.
