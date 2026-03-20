# E2E POC: Autonomous Agent Orchestrator

## Summary

Build an autonomous agent orchestrator that takes a natural language task, decomposes it into subtasks, executes them relentlessly across ephemeral compute sessions, communicates with humans asynchronously via object storage, and feeds intervention data back into the 5-layer framework. First task: Pydantic v1→v2.12.5 migration across the OSMO codebase.

## Context

The OSMO agent strategy defines a 5-layer AI-native framework (Context, Decision, Quality, Continuity, Meta-cognition) with DIF/LLM separation. The vertical slice is implemented: 8 DIF scripts, 5 knowledge docs, 4 service AGENTS.md files. What's missing is proof that this framework can drive a real, complex task end-to-end with minimal human intervention.

## Goals

1. Prove the 5-layer framework works on a real cross-cutting task
2. Demonstrate autonomous execution without babysitting
3. Measure human interventions (target: ≤2 for the entire migration)
4. Generate framework improvement patches from intervention analysis
5. Show the orchestrator is task-agnostic (Pydantic migration is just the first input)

## Non-Goals

- Building a production-grade web UI (static SPA is sufficient)
- Supporting multiple concurrent tasks (one task at a time for POC)
- Multi-user collaboration (single human operator for POC)
- Building a generic sample project (real OSMO task only)

---

## Architecture

### System Components

```
┌─────────────┐         ┌──────────────────────┐
│   Human     │         │   Object Storage     │
│  (Web UI)   │◄───────►│   (S3 bucket)        │
│  static SPA │  read/  │                      │
└─────────────┘  write  │  /{task-id}/         │
                        │    task.json          │
                        │    state.json         │
                        │    questions/         │
                        │    subtasks/          │
                        │    interventions.json │
                        │    artifacts/         │
                        └──────────┬───────────┘
                                   │ read/write
                        ┌──────────▼───────────┐
                        │  Agent Orchestrator   │
                        │  (ephemeral compute)  │
                        │  ┌─ Coordinator ────┐ │
                        │  │ DIF scripts      │ │
                        │  └───────┬──────────┘ │
                        │  ┌───────▼──────────┐ │
                        │  │ Sub-agents (LLM)  │ │
                        │  └──────────────────┘ │
                        └───────────────────────┘
```

1. **Object storage (S3)** — Single source of truth. All state survives ephemeral sessions.
2. **Agent orchestrator** — Runs in ephemeral compute. Bootstraps from stored state. Can die and resume.
3. **Static web UI** — S3-hosted SPA. Renders questions, accepts answers. No backend.

### Design Principles

- **No babysitting**: Orchestrator runs autonomously. Human checks in asynchronously.
- **Ephemeral compute, persistent state**: Sessions are disposable. S3 is durable.
- **Relentless execution**: Keep working on unblocked subtasks. Only pause when ALL subtasks are blocked.
- **Bounded self-correction**: 2 retry attempts before escalating to human.
- **Task-agnostic orchestrator**: Doesn't know what task it's running. Knowledge docs are pluggable.

---

## Orchestrator Core Loop

```
Start session → Load state from S3
    │
    ▼
Pending human answers? ──yes──► Incorporate, unblock subtasks
    │                                 │
    no                                │
    │◄────────────────────────────────┘
    ▼
Has a plan? ──no──► Discovery phase (DIF: scan codebase)
    │                 Planning phase (LLM: decompose, order, assess risk)
    yes
    │
    ▼
Pick next unfinished, unblocked subtask
    │
    ▼
Execute via sub-agent (LLM, scoped context)
    │
    ▼
Quality gate (DIF)
    │
    ├── pass → Mark done → More unblocked subtasks? → loop
    │
    └── fail → Self-correct (max 2)
                 └── still failing? → Write question → continue to next unblocked subtask
```

**Session lifecycle**:
- Cron or supervisor spawns sessions on a regular interval
- Human answer webhook triggers immediate session
- Session runs until: done, or all subtasks blocked, or compute timeout
- On exit: save state to S3

### Orchestrator Implementation

**Language**: Python coordinator script. Chosen because the codebase is predominantly Python, the S3 SDK (boto3) is mature, and it can shell out to DIF scripts and invoke Claude Code as a subprocess.

**Entry point**: `scripts/agent/orchestrator/run.py` — the coordinator. Reads `state.json` from S3, runs the core loop, writes state back.

**Sub-agent lifecycle**:
1. Coordinator prepares scoped context: target files, migration knowledge doc, learned decisions
2. Spawns Claude Code as subprocess with a structured prompt and scoped file list
3. Claude Code sub-agent executes the subtask (reads files, applies changes, runs lint)
4. Sub-agent writes results to a structured output file (JSON: status, changed files, errors)
5. Coordinator reads output, runs quality gate (DIF), updates state

**DIF/LLM dispatch**: The coordinator is a state machine. Each transition is either DIF or LLM:
- Discovery: DIF (grep, file scanning, grouping — `discover.sh`)
- Planning: LLM (Claude Code with codebase context + migration guide)
- Subtask execution: LLM (Claude Code sub-agent with scoped context)
- Quality gate: DIF (`quality-gate.sh`)
- Progress tracking: DIF (read/write JSON to S3)
- Question generation: LLM (Claude Code explains what it's stuck on)

### Session Scheduling and Concurrency

**Cron interval**: 5 minutes. Frequent enough that answers are picked up quickly, cheap enough since sessions exit fast when nothing to do.

**Compute timeout**: 30 minutes. Long enough to complete several subtasks, short enough to avoid runaway costs.

**Mid-session save**: State is saved at subtask boundaries only. If a session dies mid-subtask, the subtask is retried from scratch on next session (sub-agents are idempotent — they read current file state).

**Answer webhook**: S3 event notification → Lambda → triggers compute session. Provides immediate resumption without waiting for cron.

**Concurrency control**: Session locking via S3 conditional writes. On session start, the coordinator writes `/{task-id}/session.lock` with a timestamp and ETag condition. If another session holds the lock, the new session exits immediately. Lock expires after compute timeout (30 min) — the coordinator checks the timestamp in the lock file, since S3 objects do not natively support TTL.

### Git Commit Strategy

Each completed subtask is a separate git commit with a descriptive message. This enables:
- Independent revert of any subtask if a regression is discovered later
- Clear audit trail of what changed per module
- Downstream re-validation: after an upstream change (e.g., `lib/utils/common.py`), the coordinator re-runs quality gates on already-completed downstream subtasks

**Rollback strategy**: If a subtask breaks tests in previously-completed subtasks, the coordinator: (1) reverts the failing commit, (2) marks the subtask as blocked, (3) writes a question asking the human how to resolve the dependency conflict.

---

## Object Storage Schema

### Directory Structure

```
s3://osmo-agent/{task-id}/
├── task.json              # Original prompt + decomposed plan
├── state.json             # Current orchestrator state
├── questions/
│   └── q-NNN.json         # Agent questions with context + options
├── subtasks/
│   └── st-NNN.json        # Per-subtask state + quality results
├── interventions.json     # Every human interaction, categorized
└── artifacts/
    ├── st-NNN.patch       # Code changes per subtask
    ├── st-NNN-quality.json # Quality gate results
    └── framework-improvements/  # Generated framework patches
```

### Schema Design: Strict Envelope, Fluid Content

- **Strict fields** (DIF-parseable): `id`, `status`, `type`, `timestamps`, `phase`, `current_subtask`. Validated by JSON Schema. The orchestrator and web UI depend on these.
- **Fluid fields** (LLM-generated): `context`, `question`, `reasoning`, `options[].label`, `framework_improvement`. Free-form strings rendered as-is. No schema constrains what the agent can express.

### `task.json`

```json
{
  "id": "task-001",
  "prompt": "Migrate from Pydantic v1 to v2.12.5, no regressions, full advantage of v2",
  "created": "2026-03-19T10:00:00Z",
  "status": "in_progress",
  "plan": {
    "phases": ["discovery", "planning", "execution", "validation"],
    "subtasks": ["st-001", "st-002", "..."],
    "dependency_graph": {"st-002": ["st-001"], "...": "..."}
  }
}
```

### `state.json`

```json
{
  "current_phase": "execution",
  "current_subtask": "st-003",
  "completed": ["st-001", "st-002"],
  "blocked": ["st-013"],
  "pending_questions": ["q-002"],
  "last_session": "2026-03-19T14:30:00Z",
  "sessions_count": 4,
  "total_interventions": 1
}
```

### `questions/q-NNN.json`

```json
{
  "id": "q-001",
  "status": "pending | answered",
  "asked": "2026-03-19T11:00:00Z",
  "context": "lib/utils/login.py uses BaseModel with Config inner class for 4 models...",
  "question": "Should I use model_config = ConfigDict() or keep backward-compatible Config inner class?",
  "options": [
    {"key": "A", "label": "Full v2 (ConfigDict)", "reasoning": "Clean, uses v2 idioms"},
    {"key": "B", "label": "Compatibility shim", "reasoning": "Less churn, v1 patterns remain"}
  ],
  "answer": {"key": "A", "by": "human", "at": "2026-03-19T12:15:00Z"},
  "impact": "Applied to all 212 BaseModel subclasses"
}
```

### `interventions.json`

```json
{
  "interventions": [
    {
      "id": "int-001",
      "question_id": "q-001",
      "timestamp": "2026-03-19T12:15:00Z",
      "category": "design_decision",
      "subtask": "st-003",
      "what_happened": "Agent couldn't determine migration style preference",
      "why_blocked": "architecture-intent.md has no guidance on migration patterns",
      "human_answer": "Always use idiomatic v2",
      "resolution_time": "1h15m",
      "avoidable": true,
      "framework_fix": {
        "type": "knowledge_doc",
        "target": "docs/agent/architecture-intent.md",
        "change": "Add: For library/framework migrations, prefer idiomatic target version over compatibility shims"
      }
    }
  ],
  "summary": {
    "total": 1,
    "avoidable": 1,
    "categories": {"design_decision": 1, "ambiguity": 0, "bug": 0, "failure": 0, "steering": 0}
  }
}
```

---

## Human Interaction

### Async Protocol

The orchestrator and human are never online at the same time by design.

| Agent Action | Human Action |
|---|---|
| Writes question with context + options to S3 | Reads question via web UI |
| Continues working on unblocked subtasks | Answers when convenient |
| Picks up answer on next session start | Gets notified of progress |
| Logs intervention for framework improvement | Reviews intervention log |

### Static Web UI

Single HTML file hosted on S3. No framework, no build step, no backend.

**Shows**:
- Task name and status
- Progress bar (completed/total subtasks)
- Pending questions with clickable option buttons + free-text fallback
- Recent activity log
- Intervention count and summary

**Reads**: `state.json`, `questions/*.json`, `interventions.json` via S3 GET (polling every 30s)

**Writes**: Answer field back to question file via presigned URL or tiny Lambda

**Auth**: Presigned URLs with short TTL, or API Gateway + Lambda with basic auth.

---

## Pydantic Migration: First Task

### Scope

- **Current version**: pydantic==1.10.26 (in `src/requirements.txt`)
- **Target version**: pydantic==2.12.5
- **Files affected**: ~68-72 (estimate; discovery DIF will produce authoritative count)
- **BaseModel subclasses**: 212 (across 40 files)
- **Total Pydantic usages**: 657
- **V1 migration targets**: 38 `.dict()` calls (across 23 files), 19 `class Config:` inner classes (across 13 files)
- **Heaviest modules**: `utils/connectors/postgres.py` (85 usages, 42 models), `service/core/workflow/objects.py` (49), `utils/backend_messages.py` (38), `utils/job/task.py` (34)
- **V1-specific patterns**: No `@validator` or `@root_validator` found (good news — fewer breaking patterns)

### Execution Phases

**Discovery (DIF)**:
- Scan `requirements.txt` → confirm current version
- Grep all Pydantic imports → group by module
- Detect v1 patterns: `Config` inner class, `.dict()`, `.json()`, `Field(...)`, `Optional` usage
- Build dependency graph (leaf modules first, shared libs last)
- Output: populated `task.json` with subtask list

**Planning (LLM)**:
- Read Pydantic v2 migration guide + `docs/agent/architecture-intent.md`
- Order subtasks: leaf modules first → shared libs → core services (tests stay green incrementally)
- Flag high-risk modules
- Produce subtask definitions with scope estimates

**Execution (per subtask, sub-agent)**:
- Each sub-agent gets scoped context: target files + migration knowledge doc + learned decisions from answered questions
- Apply v1→v2 transformations
- Run `scripts/agent/lint-fast.sh` on changed files
- Run module-level tests
- Pass → produce patch, mark done
- Fail → self-correct (2 tries) → still failing → write question, move on

**Validation (DIF)**:
- Run full `scripts/agent/quality-gate.sh` across entire codebase
- Verify no v1 patterns remain (grep for `.dict()`, `Config:` inner class, etc.)
- Run integration tests
- Produce final report

### What Makes This a Framework Proof

The orchestrator doesn't know it's doing a Pydantic migration. It executes a generic loop: prompt → discover → plan → execute subtasks → quality gate → done. The Pydantic-specific knowledge lives in a pluggable knowledge doc. Swap it for "add OpenTelemetry tracing" and the same orchestrator handles it.

---

## Intervention Feedback Loop

### Categories

| Category | Meaning | Framework Fix Type |
|---|---|---|
| **design_decision** | Agent lacked a rule | Add to architecture-intent.md or decision-tree.md |
| **ambiguity** | Conflicting signals in docs | Clarify in knowledge docs |
| **bug** | Broken code, self-correction failed | Add pattern to task knowledge doc |
| **failure** | Quality gate failed exhaustively | Improve quality gate or add pre-check |
| **steering** | Human wanted different direction | May not be avoidable (genuine judgment) |

### Post-Task Analysis

After task completion, the orchestrator:
1. Reads `interventions.json`
2. Groups avoidable interventions by `framework_fix.type`
3. Generates concrete patches to framework files (knowledge docs, DIF scripts, AGENTS.md)
4. Writes patches to `artifacts/framework-improvements/`
5. These become a PR — the framework improves itself

---

## Continuity Protocol Bridge

The existing continuity protocol (`docs/agent/continuity-protocol.md`) uses `.agent-progress.json` on the local filesystem and git state as the source of truth. The orchestrator uses `state.json` in S3. These need to coexist:

- **Orchestrator state** (`state.json` in S3): Task-level state — which subtasks are done, which are blocked, questions pending. The coordinator owns this.
- **Sub-agent state** (`.agent-progress.json` local): Session-level state — what the sub-agent is working on within a single subtask. Ephemeral, not synced to S3.
- **Bridge**: The coordinator's `state.json` supersedes local progress files for cross-session continuity. Sub-agents use local progress files for within-session checkpointing only. The existing `save-progress.sh` and `load-progress.sh` scripts work as-is for sub-agents; the coordinator handles S3 sync.

## Runtime

- **Agent runtime**: Claude Code first, agent-agnostic interface
- **Coordinator**: Python script (`scripts/agent/orchestrator/run.py`) — orchestrates DIF scripts and Claude Code sub-agents
- **Core DIF scripts**: Bash — portable across any agent runtime
- **LLM adapter**: Thin Claude Code-specific layer (sub-agent spawning, context injection)
- **Compute**: Ephemeral cloud sessions (SSH-accessible), 30-minute timeout
- **Storage**: S3-compatible object storage
- **Web UI**: Static HTML/JS on S3, presigned PUT URLs for answer submission

---

## Success Criteria

### Must-Have (POC passes)

1. Pydantic v1→v2 migration complete across all 68 files
2. All existing tests pass — zero regressions
3. No v1 patterns remaining in codebase (`.dict()`, `Config:` inner class, v1 imports)
4. Intervention log with categorization and avoidability analysis produced
5. Framework improvement patches generated from intervention data
6. Orchestrator ran autonomously without babysitting (human only answered async questions)

### Aspirational (thesis validated)

7. Total human interventions ≤ 2 for the entire migration
8. Orchestrator demonstrably task-agnostic (could accept a different task prompt with a different knowledge doc)

### Success With Learning (POC still valuable even if aspirational targets missed)

9. If interventions > 2 but ≤ 5: POC succeeds if all interventions are categorized, avoidability assessed, and framework patches generated. The feedback loop working is more important than hitting the target on the first task.
10. Task-agnosticism is a design goal to validate, not a guaranteed property. The discovery phase will contain Pydantic-specific logic. The goal is to minimize task-specific code and maximize reusable orchestration. A future task (e.g., "add OpenTelemetry") would validate how much orchestrator code is reusable.

---

## Resolved Questions

- **Q10**: Session scheduling — **Hybrid**: 5-minute cron + S3 event notification → Lambda for immediate answer pickup. (Resolved in Session Scheduling section above.)
- **Q11**: Sub-agent isolation — **Process-level**: Each sub-agent is a separate Claude Code subprocess with its own context. Stronger isolation, no state leakage. (Resolved in Orchestrator Implementation section above.)
- **Q12**: Subtask execution — **Sequential within the POC**. The core loop picks one unblocked subtask at a time. Parallelism across modules is a future optimization, not POC scope. Dependency conflicts are avoided by sequential execution + dependency-aware ordering in the plan.

---

## Decisions Made

| # | Decision | Rationale |
|---|---|---|
| D25 | Autonomous orchestrator, no babysitting | Agent runs without human watching. Object storage as state, async interaction. |
| D26 | Object storage as canonical state | Transport (web UI, Slack, GitHub) is pluggable. State lives in S3. |
| D27 | Strict envelope, fluid content schema | DIF/LLM separation applied to data. Structure for routing, freedom for expression. |
| D28 | Intervention feedback loop | Every interaction logged, categorized, fed back as framework improvement. |
| D29 | Relentless execution | Keep going on unblocked subtasks. Only pause when fully blocked. |
| D30 | Pydantic v1→v2 as first task | Cross-cutting, clear success criteria, exercises all 5 layers. |
| D31 | Static web UI for POC | Fastest path to demo. Orchestrator is the product, not the UI. |
