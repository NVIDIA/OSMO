<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
-->

# Hierarchical Agent Orchestration Protocol

## The Company Model

Every agent at every level follows the same pattern — like roles in a company.
The difference between levels is scope, not kind.

```
CEO        "Migrate to Pydantic v2"           → strategic intent
  VP Eng   "Here's how we decompose across teams" → high-level plan
    Dir    "Service layer: here's the modules"     → tactical plan
      Mgr  "utils/connectors: 3 submodules"        → operational plan
        IC "postgres.py: 42 models to migrate"      → execution
```

Every agent:
1. **Receives a mandate** from its parent (or from the human at the top)
2. **Plans** how to accomplish it at their scope
3. **Delegates** to children (or executes directly if scope is small enough)
4. **Monitors** children's progress
5. **Re-plans** when things don't go as expected
6. **Reports** status back to parent

## Coordination: Split State Files

State is split so **each file has exactly one writer at any time**. This enables parallel planning and validation without git conflicts.

### Directory Structure

```
.agent/
├── task.json                  # Written once by root. Read-only after.
├── subtasks/
│   ├── st-001.json            # Created by parent. OWNED by st-001's agent.
│   ├── st-002.json            # Created by parent. OWNED by st-002's agent.
│   ├── st-002-a.json          # Created by st-002. OWNED by st-002-a's agent.
│   └── st-002-b.json          # Created by st-002. OWNED by st-002-b's agent.
└── decisions/
    ├── d-001.json             # Written by the agent that received answer to q-001
    └── d-002.json             # Written by the agent that received answer to q-002
```

### Ownership Rules

| File | Creator | Owner (sole writer after creation) | Others |
|------|---------|-------------------------------------|--------|
| `task.json` | Root agent | Nobody (immutable after creation) | All read |
| `subtasks/st-X.json` | Parent agent | The agent assigned to st-X | Parent reads status |
| `decisions/d-X.json` | Agent that received answer | Nobody (immutable after creation) | All read |

**No file has two concurrent writers.** Git conflicts are impossible because parallel agents write to different files.

### task.json (Immutable After Creation)

```json
{
  "version": 2,
  "prompt": "Migrate from Pydantic v1 to v2.12.5",
  "knowledge_doc": "docs/agent/pydantic-v2-migration.md",
  "commit_prefix": "migrate(pydantic)",
  "created": "2026-03-21T10:00:00Z"
}
```

### subtasks/st-X.json (Owned by One Agent)

```json
{
  "id": "st-002",
  "parent_id": "root",
  "ancestry": ["root"],
  "phase": "execute",
  "status": "in_progress",
  "scope": "utils/connectors",
  "file_count": 3,
  "description": "Migrate connector models",
  "files": ["src/utils/connectors/postgres.py", "src/utils/connectors/redis.py", "src/utils/connectors/cluster.py"],
  "depends_on": ["st-001"],
  "assigned_workflow": "agent-st-002-def456",
  "attempts": 1,
  "children": ["st-002-a", "st-002-b"],
  "plan_details": "postgres.py has 42 models, highest risk. redis.py and cluster.py are straightforward.",
  "completed_at": null
}
```

### decisions/d-X.json (Immutable)

```json
{
  "id": "d-001",
  "question_id": "q-001",
  "decision": "Always use ConfigDict() over Config inner class",
  "reasoning": "Human chose option C: idiomatic v2 everywhere",
  "created_by": "st-003",
  "created_at": "2026-03-21T12:00:00Z"
}
```

### Reading Full State

Any agent assembles the full picture by scanning:
```bash
# Read task
cat .agent/task.json

# Read all subtask statuses
for f in .agent/subtasks/st-*.json; do
  jq '{id: .id, phase: .phase, status: .status, scope: .scope}' "$f"
done

# Read all learned decisions
for f in .agent/decisions/d-*.json; do
  jq '.decision' "$f"
done
```

## Three-Phase Execution Model

Code changes are sequential. But planning and validation are safe to parallelize because they're read-only against the codebase.

```
Phase 1: PLAN (parallel)
  Multiple agents explore the codebase simultaneously.
  Each writes only to its own .agent/subtasks/st-X.json.
  No code modifications. No conflicts.

Phase 2: CODE (sequential)
  One agent at a time modifies code, commits, validates.
  Each starts from the previous agent's green state.
  Every commit passes bazel test.

Phase 3: VALIDATE (parallel)
  Multiple agents run different validation checks simultaneously.
  Read-only. No code modifications. No conflicts.
```

### Phase 1: PLAN — Parallel

The parent creates subtask files with `phase: "plan"` and submits planning children in parallel:

```
Parent:
  1. Create .agent/subtasks/st-001.json { phase: "plan", status: "pending", scope: "lib/data/storage" }
  2. Create .agent/subtasks/st-002.json { phase: "plan", status: "pending", scope: "utils/connectors" }
  3. Create .agent/subtasks/st-003.json { phase: "plan", status: "pending", scope: "service/core" }
  4. git add, commit, push
  5. Submit planning children in parallel:
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │ Plan st-001  │ │ Plan st-002  │ │ Plan st-003  │
     │ explore lib/ │ │ explore util/│ │ explore svc/ │
     │ count files  │ │ find patterns│ │ assess risk  │
     │ write plan   │ │ write plan   │ │ write plan   │
     └──────────────┘ └──────────────┘ └──────────────┘
```

Each planning child:
1. Clones repo, checks out branch, pulls
2. Reads its subtask file: `phase: "plan"`
3. Explores its scope: counts files, identifies patterns, assesses complexity
4. Updates its own subtask file: `file_count`, `files`, `plan_details`, `children` (if decomposing), `status: "planned"`
5. `git pull --rebase` then push (only its own subtask file changed — no conflict)

**Why no conflicts**: Each child writes to a different file. `git pull --rebase` succeeds because the files don't overlap.

### Phase 2: CODE — Sequential

The parent reads all planned subtasks, determines execution order from dependencies, and submits coding children **one at a time**:

```
Parent:
  1. git pull — gets all planning results
  2. Read all subtask files — determine dependency order
  3. Update st-001.json: phase: "execute"
  4. Submit child for st-001
  5. Wait for completion (poll-workflow.sh)
  6. git pull — get st-001's code changes
  7. Verify: bazel test //... passes ✓
  8. Update st-002.json: phase: "execute"
  9. Submit child for st-002 (inherits st-001's green state)
  10. Wait, pull, verify...
  11. Repeat for all subtasks
```

Each coding child:
1. Clones repo, checks out branch, pulls (gets ALL prior code changes)
2. Reads its subtask file: `phase: "execute"`
3. Reads decisions: `for f in .agent/decisions/d-*.json` (applies learned decisions)
4. Modifies code files, runs lint
5. Commits code changes with descriptive message
6. Updates its own subtask file: `status: "executed"`, `attempts`
7. Pushes both code changes and subtask file

**Why sequential**: Code is interdependent. `bazel test //...` validates everything together. Each agent must start from the previous agent's validated state.

### Phase 3: VALIDATE — Parallel

After all coding is done, the parent submits validation children in parallel:

```
Parent:
  1. git pull — has all code changes
  2. Submit validation children in parallel:
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │ Full lint    │ │ Pattern scan │ │ Integration  │
     │ lint-fast.sh │ │ grep for old │ │ quality-gate │
     │              │ │ patterns     │ │ .sh          │
     └──────────────┘ └──────────────┘ └──────────────┘
```

Validation children are read-only. They run checks and write results to their own subtask files. No code changes, no conflicts.

## Agent Lifecycle (Updated)

```
Start
  │
  ▼
git pull, read .agent/task.json + my subtask file
  │
  ▼
What is my phase?
  │
  ├── phase: "plan"
  │   └── Explore codebase (read-only)
  │       Count files, assess complexity, identify patterns
  │       If scope too large: create child subtask files
  │       Update MY subtask file: status="planned", plan_details=...
  │       git pull --rebase, push
  │
  ├── phase: "execute"
  │   └── Read plan_details from my subtask file
  │       Read all decisions from .agent/decisions/
  │       Delegate-or-execute decision:
  │         ├── Small scope → modify code directly, lint, commit
  │         └── Large scope → create children, submit sequentially
  │       Update MY subtask file: status="executed"
  │       Push code + subtask file
  │
  └── phase: "validate"
      └── Run validation checks (read-only)
          Write results to MY subtask file: status="validated"
          git pull --rebase, push
```

### Decision: Execute Directly vs. Delegate

The hierarchy terminates naturally — not through arbitrary limits, but through two mechanisms that guarantee convergence.

#### The Delegate-or-Execute Decision Tree

```
Should I delegate this subtask?
  │
  ├── Is scope ≤ 15 files and single module?
  │     └── YES → Execute directly (IC mode)
  │
  ├── Would each child's scope be strictly < my scope?
  │     └── NO → Execute directly (scope not reducing)
  │
  ├── Does this scope appear in my ancestry chain?
  │     └── YES → Execute directly (cycle detected)
  │
  └── All checks pass → Delegate (spawn child workflow)
        ├── Record ancestry chain in child subtask
        └── Commit and push plan.json
```

#### Safety Mechanism 1: Strict Scope Reduction (Natural Terminator)

Every child's scope MUST be strictly smaller than its parent's. This is what actually terminates recursion — like a real company, the work gets smaller at every level until one person can do it.

```
CEO: 68 files across 15 modules
  VP: 20 files across 4 modules     ← smaller ✓
    Dir: 8 files in 1 module         ← smaller ✓
      IC: executes directly           ← small enough
```

**Check**: Before spawning, verify `child.file_count < parent.file_count`. If a decomposition produces children whose individual scopes are not smaller than the parent's, the agent must execute directly or re-decompose differently.

This is a mathematical guarantee of termination: `file_count` is a positive integer that strictly decreases at every level, so it must converge to a scope small enough to execute directly.

#### Safety Mechanism 2: Cycle Detection (Sanity Check)

Each subtask tracks its **ancestry chain** — the full path from root to itself:

```json
{
  "id": "st-002-a",
  "parent_id": "st-002",
  "ancestry": ["root", "st-002", "st-002-a"],
  "scope": "utils/connectors/postgres"
}
```

If a child's `scope` matches any ancestor's `scope`, the agent is decomposing in circles. Stop and execute directly.

#### Why No Max-Depth or Budgets

Arbitrary limits (max-depth, workflow budgets, time budgets) constrain the problem space without adding safety. Scope reduction already provides a mathematical guarantee of termination. Cycle detection catches broken decomposition. Together they are sufficient — the hierarchy is as deep as the problem needs, and no deeper.

### Decision: When to Re-Plan

Re-plan when:
- A child reports an unexpected dependency ("I can't migrate X without Y being done first")
- A child fails and the error reveals a systemic issue
- A human answer changes the approach for multiple remaining subtasks
- The agent discovers scope that wasn't in the original plan

Re-planning means: update `subtasks` in plan.json, adjust ordering/dependencies, commit.

## Session Crash Recovery

Because plan.json is in git, recovery is automatic:

1. New session starts
2. `git pull` — gets latest plan.json
3. Read plan.json — see which subtasks are completed, which are in_progress
4. For `in_progress` subtasks: check if the assigned workflow is still running (`osmo workflow query`)
   - If completed: pull changes, validate, update status
   - If failed: increment attempts, re-plan or escalate
   - If still running: wait for it
5. For `pending` subtasks: pick the next one respecting dependencies
6. Continue the loop

No context window dependency. No lost plans. Pure git state.

## Human Interaction

Questions and interventions still go through S3 (not git — they're not code).
But `learned_decisions` in plan.json are synced from answered questions,
so all agents at all levels can see them.

```
Agent writes question to S3 → Human answers via UI → Agent reads answer
  │
  └── Agent appends to learned_decisions in plan.json, commits
      └── All future agents (at any level) see this decision on git pull
```

## Workflow Submission Pattern

Every agent uses the same image, the same tools, and the same meta-prompt.
The only difference is what's in plan.json when they start.

```bash
# Top-level (human submits)
osmo workflow submit orchestrator.yaml \
  --set task_prompt="Migrate Pydantic v1 to v2" \
  --set knowledge_doc=docs/agent/pydantic-v2-migration.md \
  --set storage_uri=s3://my-bucket/agent/pydantic-v2

# Child (agent submits via submit-child.sh)
# Same image, same prompt, but plan.json already has their mandate
scripts/agent/orchestrator/tools/submit-child.sh "st-002" "utils/connectors" "Migrate connectors"
```

The child reads plan.json, finds its subtask entry (`st-002`), and works on it.
If the scope is too large, it further decomposes into `st-002-a`, `st-002-b`, etc.

## Docker Image Requirements

All agents (every level) run the same image. OSMO provides `/osmo/usr/bin/osmo` at runtime.

| Tool | Purpose | Source |
|------|---------|--------|
| Claude Code | LLM reasoning + code changes | npm: @anthropic-ai/claude-code |
| OSMO CLI | Submit/query/cancel workflows, data upload/download | Provided by OSMO runtime at `/osmo/usr/bin` |
| git | Clone, commit, push, pull | apt |
| jq | JSON processing in DIF scripts | apt |
| python3 | YAML parsing, JSON validation | apt |
| gh | GitHub PR creation | apt |

Image is pre-built (`docker/agent/Dockerfile`). No runtime `apt-get` or `npm install`.

## Preventing Misalignment and Duplication

In human organizations, parallel teams drift apart — duplicating work, making conflicting decisions, or solving the same problem differently. The agent hierarchy prevents this through structural mechanisms:

### Single Source of Truth: plan.json

Every agent reads the same plan.json before acting. This prevents:
- **Duplicated work**: An agent checks `status` before starting. If another agent already completed or claimed a subtask, it moves on.
- **Conflicting decisions**: `learned_decisions` is append-only and visible to all. A decision made at any level propagates to every agent on `git pull`.

### File-Level Ownership

Each subtask declares its `files[]` list. The meta-prompt enforces: **only modify files in your subtask**. This prevents:
- Two agents editing the same file simultaneously
- Overlapping changes that create merge conflicts

If an agent discovers it needs to modify a file outside its mandate, it must either:
1. Request the parent to reassign the file, or
2. Create a new subtask for the cross-cutting concern

### Conflict Detection on Pull

Before starting work, every agent runs `git pull` and checks for conflicts with its planned changes:

```bash
# After git pull, check if any of my files were modified since plan was written
for file in $MY_FILES; do
  if git diff origin/main..HEAD --name-only | grep -q "$file"; then
    echo "WARNING: $file was modified by another agent"
    # Re-read plan.json, check if a sibling completed work on this file
    # If so, adjust approach or skip
  fi
done
```

### Cross-Cutting Concern Escalation

When an agent discovers a concern that spans multiple subtasks (e.g., "all models using `.dict()` need a compatibility wrapper"), it:
1. Does NOT implement the fix across all files (that's outside its scope)
2. Adds a `learned_decision` to plan.json describing the pattern
3. All subsequent agents inherit this decision and apply it consistently

This ensures **consistency without duplication** — the insight is captured once, applied everywhere.

### Deduplication at Decomposition Time

When a parent decomposes work, it must verify:
- No two children have overlapping `files[]` lists
- No two children have the same `scope`
- Dependencies between children are explicit in `dependencies`

If overlap is unavoidable (e.g., a shared header file), the parent creates an explicit dependency: child B waits for child A, then builds on A's changes.

---

## Summary

| Aspect | Description |
|--------|-------------|
| **Hierarchy** | Recursive — agents delegate or execute based on scope |
| **Termination** | Two mechanisms: strict scope reduction (mathematical convergence) + cycle detection |
| **No arbitrary limits** | No max-depth, no budgets. Depth emerges from problem complexity. |
| **Coordination** | plan.json in git — single source of truth for all agents at all levels |
| **No duplication** | File-level ownership, conflict detection, cross-cutting escalation |
| **Crash recovery** | Read plan.json from git, resume exactly where last session stopped |
| **Re-planning** | Any agent can update plan.json when circumstances change |
| **Learned decisions** | Append-only, visible to all — consistency without coordination overhead |
| **Agent identity** | Same image, same prompt, same pattern — scope determines behavior |
