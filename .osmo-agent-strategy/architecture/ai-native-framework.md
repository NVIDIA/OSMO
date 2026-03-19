# The AI-Native Framework: 5 Layers with DIF/LLM Separation

This is the core architectural document for OSMO's AI-native development approach.

---

## 1. The 5-Layer Model

Every effective agent harness must solve five problems. These are not optional features -- they are the minimum viable structure for reliable AI-assisted work.

### Layer 1: Context (Discoverable Knowledge)

**Problem**: Agents waste turns searching for information, or worse, hallucinate because they don't know what exists.

**Solution**: Route agents to relevant information deterministically. The agent should never have to guess where to look.

| Mechanism | Type | Purpose |
|-----------|------|---------|
| AGENTS.md hierarchy | File | Top-level map pointing to deeper sources |
| Service-level AGENTS.md | File | Per-service context (core, lib, runtime) |
| Decision tree | File | Given a task type, which files/modules to read |
| Cross-service impact map | File | Which services are affected by changes in shared code |
| Route-context script | DIF | Given a file path, return relevant context files |

**Key principle**: Context should be discoverable without LLM reasoning. A shell script that maps file paths to relevant docs is cheaper and more reliable than semantic search.

### Layer 2: Decision (Encoded Judgment)

**Problem**: Agents make architectural mistakes that humans catch only during review, wasting entire implementation cycles.

**Solution**: Encode architectural constraints and coding standards as mechanically enforceable rules. The agent should hit a wall before making a mistake, not learn about it after.

| Mechanism | Type | Purpose |
|-----------|------|---------|
| Architecture intent doc | File | Why the system is designed this way (for ambiguous cases) |
| Check-decisions script | DIF | Verify changes respect architectural boundaries |
| Linters (ruff, eslint) | DIF | Style and pattern enforcement |
| Pre-commit hooks | DIF | Gate before changes land |
| AGENTS.md coding standards | File | Language-specific rules already in the codebase |

**Key principle**: If a constraint matters enough to document, it matters enough to enforce with a script or linter.

### Layer 3: Quality (Self-Evaluation)

**Problem**: Agents declare "done" without verification, or run only partial checks, leaving bugs for humans to find.

**Solution**: Automated verification pipeline that must pass before any human review. The agent should prove correctness, not assert it.

| Mechanism | Type | Purpose |
|-----------|------|---------|
| Lint-fast script | DIF | Quick syntax/style check (<5 seconds) |
| Verify script | DIF | Full build + test verification |
| Quality-gate script | DIF | Orchestrates lint -> build -> test -> report |
| Per-language checks | DIF | Python: ruff + pytest, Go: go vet + go test, TS: tsc + vitest |

**Key principle**: Verification is the source of truth, not the agent's claim of success. Stripe's foundation is 3 million tests, not review processes.

### Layer 4: Continuity (Cross-Session State)

**Problem**: Agent sessions are ephemeral. Progress is lost between sessions. Handoff requires humans to re-explain context.

**Solution**: Persistent state that enables any session to pick up where the last one left off, without human intervention.

| Mechanism | Type | Purpose |
|-----------|------|---------|
| Save-progress script | DIF | Capture current state to structured file |
| Load-progress script | DIF | Bootstrap new session from saved state |
| Continuity protocol | File | Convention for progress file format and session startup |
| Git state | DIF | Descriptive commits as durable progress log |

**Key principle**: The next session should need zero human explanation to continue work. Git logs + progress files + feature lists = self-bootstrapping sessions (Anthropic's pattern).

### Layer 5: Meta-cognition (Self-Awareness)

**Problem**: Agents get stuck in loops, repeat failed approaches, or drift from the objective without realizing it.

**Solution**: Monitoring mechanisms that detect ineffective behavior and trigger strategy changes.

| Mechanism | Type | Purpose |
|-----------|------|---------|
| Meta-check script | DIF | Detect iteration count, time elapsed, repetition patterns |
| Meta-cognition protocol | File | When to escalate, delegate, or change strategy |
| Iteration budgets | DIF | Max attempts per approach before switching |
| Stuck detection | DIF | Same tool call 3x = flag for review |

**Key principle**: An agent that knows it's stuck is more valuable than an agent that keeps trying. Detection enables delegation or strategy change.

---

## 2. DIF/LLM Separation Per Layer

**The principle**: Default to Deterministic Infrastructure Functions (DIF). Escalate to LLM only when deterministic approaches fail.

### Full Table

| Layer | DIF (Default) | LLM (Escalation) | DIF/LLM Ratio |
|-------|---------------|-------------------|----------------|
| **Context** | File routing, grep, AGENTS.md navigation | Semantic search, "which module handles X?" | 90/10 |
| **Decision** | Linters, pre-commit hooks, boundary checks | Trade-off analysis, "should we add this dependency?" | 95/5 |
| **Quality** | Tests, type-checks, builds | Code quality judgment, "is this the right abstraction?" | 85/15 |
| **Continuity** | Progress files, git state, structured handoff | Session summarization, "what was I trying to do?" | 80/20 |
| **Meta-cognition** | Iteration counters, time budgets, repetition | Strategy adaptation, "should I try a different approach?" | 70/30 |

### Why Default DIF

1. **Cost**: A shell script costs $0. An LLM call costs tokens. Over thousands of agent runs, the difference is enormous.
2. **Reliability**: `grep -r "func.*Submit" src/` returns the same result every time. An LLM might miss it.
3. **Auditability**: A deterministic script's behavior can be verified by reading it. An LLM's reasoning varies per invocation.
4. **Speed**: A shell script runs in milliseconds. An LLM call takes seconds.
5. **Composability**: DIF outputs are structured and pipeable. LLM outputs require parsing.

### When to Escalate to LLM

- DIF returned no results (file routing didn't find relevant context)
- The question requires judgment, not lookup ("should we split this into two services?")
- The task involves synthesis across multiple sources
- The task requires natural language generation (commit messages, PR descriptions)

---

## 3. The Orchestrator + Sub-Agent Pattern

### Architecture

```
Orchestrator (predominantly DIF)
  |
  |-- Route: which sub-agent handles this? (DIF: decision tree)
  |-- Enforce: what constraints apply? (DIF: check-decisions.sh)
  |-- Track: what's the current state? (DIF: load-progress.sh)
  |-- Monitor: is the agent being effective? (DIF: meta-check.sh)
  |
  +-- Sub-Agent 1 (predominantly LLM)
  |     Fresh, small context
  |     Writes code, reasons about design
  |     Returns structured result
  |
  +-- Sub-Agent 2 (predominantly LLM)
  |     Fresh, small context
  |     Different task, parallel execution
  |     Returns structured result
  |
  +-- Synthesis (LLM)
        Combine sub-agent results
        Resolve conflicts
        Produce coherent output
```

### Why This Pattern

1. **Fresh context per sub-agent**: Each sub-agent starts with only the context it needs. No accumulated cruft from previous tasks. Small, focused context > large, accumulated context.

2. **Orchestrator is cheap**: Routing, enforcement, tracking, and monitoring are all DIF. The expensive LLM calls happen only in sub-agents doing actual work.

3. **Parallelization**: Independent sub-agents can run concurrently. The orchestrator synthesizes results.

4. **Failure isolation**: One sub-agent failing doesn't corrupt another's context.

5. **Auditability**: The orchestrator's decisions are deterministic and logged. Sub-agent reasoning is contained.

---

## 4. Generalization Model

The framework is domain-agnostic. The content is domain-specific.

### For OSMO Development (Vertical Slice -- Now)

| Layer | Domain-Specific Content |
|-------|------------------------|
| **Context** | Codebase structure (AGENTS.md), service boundaries, API routes, test locations |
| **Decision** | Coding standards (Python/Go/TS), architectural boundaries, import rules, copyright headers |
| **Quality** | Bazel builds, pytest, go test, vitest, ruff, eslint, type-check |
| **Continuity** | Git state, progress files, feature lists, descriptive commits |
| **Meta-cognition** | Build time budgets, test pass rates, code review feedback patterns |

### For Physical AI Pipelines (After Proof)

| Layer | Domain-Specific Content |
|-------|------------------------|
| **Context** | Pipeline semantics (SDG/train/eval), GPU topology, cluster state, dataset metadata |
| **Decision** | Safety rules, cost caps, resource constraints, topology requirements |
| **Quality** | Pipeline validation, sim-to-real metrics, checkpoint verification |
| **Continuity** | Multi-hour pipeline state, checkpoint/resume, cross-stage handoff |
| **Meta-cognition** | Pipeline divergence detection, strategy adaptation, resource optimization |

### For Any Domain (Framework Generalization)

| Layer | What Changes Per Domain |
|-------|------------------------|
| **Context** | Knowledge files and routing rules |
| **Decision** | Constraints and enforcement scripts |
| **Quality** | Verification commands and success criteria |
| **Continuity** | State schema and handoff format |
| **Meta-cognition** | Effectiveness metrics and escalation triggers |

The framework stays the same. The content plugs in.

---

## 5. Implementation: Vertical Slice Approach

### Strategy

**Thin through all 5 layers**, not deep in one. A system with basic context + basic decisions + basic quality + basic continuity + basic meta-cognition is more valuable than a system with perfect context and nothing else.

### Why Thin Over Deep

1. **End-to-end validation**: Only a full-stack slice proves the framework works
2. **Identifies integration issues early**: Layers interact -- quality gates need context routing, meta-cognition needs quality results
3. **Provides immediate value**: Even basic versions of all 5 layers improve agent effectiveness
4. **Guides deepening priorities**: Real usage data shows which layers need more investment

### Vertical Slice for OSMO Development

```
Context Layer:
  AGENTS.md (exists) + service AGENTS.md files (new)
  + route-context.sh + decision-tree.md

Decision Layer:
  check-decisions.sh + architecture-intent.md

Quality Layer:
  lint-fast.sh + verify.sh + quality-gate.sh

Continuity Layer:
  save-progress.sh + load-progress.sh + continuity-protocol.md

Meta-cognition Layer:
  meta-check.sh + meta-cognition-protocol.md
```

### Validation Criteria

1. **Run 5 real unstructured tasks** through the full framework
2. **Measure human interventions** per task (target: <=2)
3. **Measure time to completion** vs. baseline (without framework)
4. **Identify which layer** causes most interventions (deepen that layer next)
5. **No layer should be skipped** during a task -- all 5 must engage

---

## References

- Anthropic: Two-agent pattern, progress files, session bootstrapping
- OpenAI: AGENTS.md as map not encyclopedia, structural tests, entropy management
- Datadog: Verification loops, DST, harness-first development
- Stripe: 3M tests, three-tier verification, constraints compound
- Manus: KV-cache optimization, filesystem as memory, context engineering
- Martin Fowler: Context engineering + architectural constraints + entropy management
