# E2E POC: OSMO-Native Autonomous Agent Orchestrator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OSMO-native meta-framework where Claude Code IS the orchestrator. Given any natural language task, it autonomously discovers scope, decomposes into subtasks, submits OSMO child workflows, monitors them, validates results, and asks humans when stuck. The Pydantic v1→v2 migration is the first task to validate the framework.

**Architecture:** The orchestrator is Claude Code running inside an OSMO workflow task. It has OSMO CLI + git. It reasons about the task (LLM), then uses infrastructure scripts (DIF) to submit child workflows, poll status, manage git, and communicate with humans via S3. The intelligence is in the LLM. The plumbing is in the scripts.

**Tech Stack:** OSMO workflows (YAML), bash (infrastructure DIF scripts), Claude Code CLI (orchestrator + child agents), git (state), S3 (human interaction), vanilla HTML/JS (web UI)

**Spec:** `docs/superpowers/specs/2026-03-19-e2e-poc-autonomous-orchestrator-design.md`

---

## The Key Insight

The orchestrator does NOT have pre-written discovery scripts, planners, or module orderers. Those are task-specific. Instead:

| Layer | DIF (we build — infrastructure) | LLM (Claude Code at runtime — intelligence) |
|---|---|---|
| **Discovery** | Git clone, file access | Read codebase, understand scope, identify what needs to change |
| **Planning** | — | Decompose task into subtasks, determine order and dependencies |
| **Execution** | Submit child OSMO workflow, poll status | Write code changes in child workflows |
| **Quality** | Run quality-gate.sh, lint-fast.sh | Self-correct failures, reason about errors |
| **Communication** | Write/read S3 JSON files | Decide WHAT to ask humans, formulate questions |
| **Continuity** | Git commit/push/pull | Decide what to commit, what message to write |
| **Meta-cognition** | Track attempt counts, elapsed time | Decide when to change strategy, when to ask for help |

---

## File Structure

```
scripts/agent/orchestrator/
├── orchestrator.yaml              # OSMO workflow: runs Claude Code as orchestrator (DONE)
├── child-workflow-template.yaml   # OSMO workflow template: one child task (DONE)
├── child-prompt.md                # Claude Code prompt template for children (DONE)
├── orchestrator-prompt.md         # THE KEY FILE: meta-prompt that makes Claude Code an orchestrator
├── tools/
│   ├── submit-child.sh            # DIF: generate child YAML from template, osmo workflow submit
│   ├── poll-workflow.sh           # DIF: poll osmo workflow query until done/failed
│   ├── write-question.sh          # DIF: write question JSON to S3
│   ├── check-answers.sh           # DIF: check S3 for answered questions
│   └── log-intervention.sh        # DIF: append intervention to S3 log

web/
└── index.html                     # Static SPA for async human interaction
```

---

## Task 1: Orchestrator Meta-Prompt

**THE core artifact.** This is the prompt that transforms Claude Code into an autonomous orchestrator. Everything else is plumbing.

**Files:**
- Create: `scripts/agent/orchestrator/orchestrator-prompt.md`

- [ ] **Step 1: Write the orchestrator meta-prompt**

This markdown file is the system prompt for Claude Code running inside the OSMO orchestrator task. It defines:

**Identity and role:**
- You are an autonomous agent orchestrator running inside an OSMO workflow
- You have access to: the full repo (git), OSMO CLI, S3 (via aws cli), quality gate scripts
- Your job: take a task prompt, understand it, decompose it, execute it via child workflows, validate results

**Available tools (DIF scripts):**
- `scripts/agent/orchestrator/tools/submit-child.sh <module> <files> <description>` — submit a child OSMO workflow
- `scripts/agent/orchestrator/tools/poll-workflow.sh <workflow-id>` — poll until done/failed
- `scripts/agent/orchestrator/tools/write-question.sh <id> <subtask> <context> <question> <options-json>` — ask human
- `scripts/agent/orchestrator/tools/check-answers.sh` — check for human answers
- `scripts/agent/orchestrator/tools/log-intervention.sh <question-id> <category> <avoidable> <fix-json>` — log intervention
- `scripts/agent/quality-gate.sh` — run full quality verification
- `scripts/agent/lint-fast.sh` — quick lint check

**The autonomous loop:**
```
1. Read the task prompt from $TASK_PROMPT
2. Read the knowledge doc from $KNOWLEDGE_DOC (if provided)
3. Explore the codebase to understand the scope
4. Decompose into subtasks (modules/files that need changes)
5. For each subtask:
   a. Check for pending human answers (check-answers.sh)
   b. Generate child workflow (submit-child.sh)
   c. Wait for completion (poll-workflow.sh)
   d. Pull changes (git pull)
   e. Validate (lint-fast.sh or quality-gate.sh)
   f. If validation fails:
      - Attempt self-correction (resubmit with error context, max 2 retries)
      - If still failing: revert (git revert HEAD), ask human (write-question.sh), continue to next
6. After all subtasks: run final quality-gate.sh
7. Generate intervention analysis
8. Push final branch state
```

**Decision-making guidance:**
- Decompose by module boundaries — each child workflow should touch files in one module
- Order by dependency: shared libraries first, consumers last
- Each child gets scoped context: only the files it needs to change + the knowledge doc
- If a child fails and self-correction fails: don't loop. Ask human and move on.
- If blocked on multiple questions with no unblocked subtasks: exit cleanly. The next session resumes when answers arrive.

**Question protocol:**
- Only ask when genuinely stuck — not for confirmation of obvious choices
- Always provide options (A/B/C) with reasoning, not open-ended questions
- Include enough context for the human to answer without reading code
- After receiving an answer, log it as a learned decision for future children

**Resumption protocol:**
- On startup, check git log to see what's already been done
- Check S3 for pending answers
- Resume from where the previous session left off
- Never redo work that's already committed

- [ ] **Step 2: Review the prompt for task-agnosticism**

Verify: the prompt contains ZERO references to Pydantic, migration, or any specific task. It should work equally well for "add OpenTelemetry tracing" or "upgrade React 18 to 19."

- [ ] **Step 3: Commit**

```bash
git add scripts/agent/orchestrator/orchestrator-prompt.md
git commit -m "feat(orchestrator): add meta-prompt — the core orchestrator intelligence"
```

---

## Task 2: Infrastructure DIF Scripts (tools/)

The plumbing that the orchestrator calls. Pure infrastructure — no task-specific logic.

**Files:**
- Create: `scripts/agent/orchestrator/tools/submit-child.sh`
- Create: `scripts/agent/orchestrator/tools/poll-workflow.sh`
- Create: `scripts/agent/orchestrator/tools/write-question.sh`
- Create: `scripts/agent/orchestrator/tools/check-answers.sh`
- Create: `scripts/agent/orchestrator/tools/log-intervention.sh`

- [ ] **Step 1: Create submit-child.sh**

Usage: `submit-child.sh <module> <files-csv> <description>`

What it does:
1. Read `child-workflow-template.yaml`
2. Replace placeholders (`__MODULE__`, `__GITHUB_REPO__`, `__BRANCH__`, `__DESCRIPTION__`, `__COMMIT_PREFIX__`, `__PROMPT_CONTENTS__`) with actual values from args + environment
3. Build the prompt from `child-prompt.md` template with the same placeholder replacement
4. Write rendered YAML to temp file
5. Run `osmo workflow submit <temp>.yaml`
6. Parse workflow ID from output, print it to stdout
7. Clean up temp file

Environment vars used: `GITHUB_REPO`, `BRANCH_NAME`, `KNOWLEDGE_DOC`, `COMMIT_PREFIX`

- [ ] **Step 2: Create poll-workflow.sh**

Usage: `poll-workflow.sh <workflow-id> [poll-interval-seconds]`

What it does:
1. Loop: `osmo workflow query <id>` → parse status
2. If COMPLETED → exit 0
3. If FAILED_* → print failure info, exit 1
4. Otherwise → sleep for poll interval (default 30s), repeat
5. Timeout after 30 minutes → exit 2

- [ ] **Step 3: Create write-question.sh**

Usage: `write-question.sh <question-id> <subtask-id> <context> <question> <options-json>`

What it does:
1. Build JSON: `{"id": "...", "status": "pending", "asked": "<timestamp>", "subtask": "...", "context": "...", "question": "...", "options": [...]}`
2. Upload to `s3://$S3_BUCKET/$TASK_ID/questions/<question-id>.json`

- [ ] **Step 4: Create check-answers.sh**

Usage: `check-answers.sh`

What it does:
1. List `s3://$S3_BUCKET/$TASK_ID/questions/`
2. Download each, check for `"status": "answered"`
3. Print answered question IDs and their answer keys to stdout
4. Exit 0 if any answers found, exit 1 if none

- [ ] **Step 5: Create log-intervention.sh**

Usage: `log-intervention.sh <question-id> <category> <avoidable> <framework-fix-json>`

What it does:
1. Download existing `s3://$S3_BUCKET/$TASK_ID/interventions.json` (or create empty)
2. Append new intervention record
3. Update summary counts
4. Upload back to S3

- [ ] **Step 6: Make all scripts executable**

Run: `chmod +x scripts/agent/orchestrator/tools/*.sh`

- [ ] **Step 7: Commit**

```bash
git add scripts/agent/orchestrator/tools/
git commit -m "feat(orchestrator): add infrastructure DIF scripts (submit, poll, question, intervention)"
```

---

## Task 3: Wire Orchestrator YAML to Meta-Prompt

Update the orchestrator.yaml entry script to invoke Claude Code with the meta-prompt instead of a hardcoded bash script.

**Files:**
- Modify: `scripts/agent/orchestrator/orchestrator.yaml`

- [ ] **Step 1: Update the entry script**

Change the entry script (`/tmp/entry.sh`) so that after cloning and checking out the branch, instead of `exec bash scripts/agent/orchestrator/orchestrator.sh`, it runs:

```bash
# Build the orchestrator prompt with environment context
PROMPT=$(cat scripts/agent/orchestrator/orchestrator-prompt.md)
PROMPT="$PROMPT

## Current Task
Prompt: $TASK_PROMPT
Knowledge doc: $KNOWLEDGE_DOC
Branch: $BRANCH_NAME
Commit prefix: $COMMIT_PREFIX

## Environment
- OSMO CLI: available (osmo workflow submit/query/cancel/logs)
- S3 bucket: $S3_BUCKET
- Task ID: $TASK_ID
- Tools: scripts/agent/orchestrator/tools/ (submit-child.sh, poll-workflow.sh, etc.)
- Quality gates: scripts/agent/lint-fast.sh, scripts/agent/quality-gate.sh
"

# Run Claude Code as the orchestrator
claude --print --dangerously-skip-permissions -p "$PROMPT"
```

- [ ] **Step 2: Verify YAML is still valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('scripts/agent/orchestrator/orchestrator.yaml'))"`

- [ ] **Step 3: Commit**

```bash
git add scripts/agent/orchestrator/orchestrator.yaml
git commit -m "feat(orchestrator): wire entry script to meta-prompt + Claude Code"
```

---

## Task 4: Static Web UI

Single HTML file for async human interaction. Task-agnostic — renders whatever questions the orchestrator writes.

**Files:**
- Create: `web/index.html`

- [ ] **Step 1: Create the static SPA**

Create `web/index.html` — single HTML file with embedded CSS and JS:
- Config via URL params: `?api=<s3-http-base>&task=<task-id>`
- Polls for questions every 30s (fetches question JSON files from S3 via HTTP GET)
- Renders: task ID, pending questions with clickable option buttons + free-text fallback, answered questions log
- On answer submit: writes answer to question file via presigned PUT URL or API Gateway
- No framework, no dependencies, no build step
- Clean, functional design

- [ ] **Step 2: Commit**

```bash
git add web/index.html
git commit -m "feat: add static web UI for async human-agent interaction"
```

---

## Task 5: Dry-Run Integration Test

Validate the full pipeline works without OSMO (mocked osmo CLI).

**Files:**
- Create: `scripts/agent/orchestrator/tests/test-dry-run.sh`

- [ ] **Step 1: Write dry-run test**

Create a test that:
1. Creates a mock `osmo` command on PATH that returns fake workflow IDs and success
2. Creates a mock `aws` command that simulates S3 read/write to local temp dir
3. Runs `submit-child.sh` with test args → verify it generates valid YAML and calls osmo
4. Runs `write-question.sh` with test args → verify it produces valid JSON
5. Runs `check-answers.sh` → verify it reads from the mock S3
6. Runs `log-intervention.sh` → verify it appends correctly
7. Verifies all scripts exit cleanly

- [ ] **Step 2: Run the test**

Run: `bash scripts/agent/orchestrator/tests/test-dry-run.sh`
Expected: All checks pass

- [ ] **Step 3: Commit**

```bash
git add scripts/agent/orchestrator/tests/
git commit -m "test(orchestrator): add dry-run integration test with mocked osmo/S3"
```

---

## Summary

| Task | What | Type | Key Artifact |
|------|------|------|---|
| 1 | Orchestrator Meta-Prompt | Intelligence (LLM prompt) | `orchestrator-prompt.md` |
| 2 | Infrastructure DIF Scripts | Plumbing (bash) | `tools/*.sh` (5 scripts) |
| 3 | Wire YAML to Meta-Prompt | Integration | `orchestrator.yaml` update |
| 4 | Static Web UI | Human interface | `web/index.html` |
| 5 | Dry-Run Test | Validation | `tests/test-dry-run.sh` |

**Total: 5 tasks, ~10 files, 5 commits**

**Already done (from previous tasks):**
- `orchestrator.yaml` — OSMO workflow spec (Task 1 of old plan)
- `child-workflow-template.yaml` — child workflow template
- `child-prompt.md` — child agent prompt template

**What's different from the old plan:**
- No `discovery.sh` — the LLM reads the codebase and discovers scope
- No `planner.sh` — the LLM reasons about decomposition and ordering
- No `orchestrator.sh` bash loop — Claude Code IS the loop
- No Python coordinator — bash DIF scripts for plumbing, LLM for intelligence
- Task 1 (the meta-prompt) is 80% of the value. Everything else is plumbing.

**To run the Pydantic migration:**
```bash
osmo workflow submit scripts/agent/orchestrator/orchestrator.yaml \
  --set github_repo=https://github.com/NVIDIA/osmo.git \
  --set branch_name=agent/pydantic-v2-migration \
  --set task_prompt="Migrate from Pydantic v1 to v2.12.5, no regressions, full advantage of v2" \
  --set knowledge_doc=docs/agent/pydantic-v2-migration.md \
  --set commit_prefix="migrate(pydantic)"
```

**To run a different task (zero orchestrator changes):**
```bash
osmo workflow submit scripts/agent/orchestrator/orchestrator.yaml \
  --set github_repo=https://github.com/NVIDIA/osmo.git \
  --set branch_name=agent/add-otel-tracing \
  --set task_prompt="Add OpenTelemetry tracing to all Python services" \
  --set knowledge_doc=docs/agent/otel-tracing-guide.md \
  --set commit_prefix="feat(otel)"
```
