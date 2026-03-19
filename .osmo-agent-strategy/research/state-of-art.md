# State of the Art: Agent Harness Patterns (March 2026)

## The Industry Consensus

**"2025 was agents. 2026 is agent harnesses."** The competitive moat is no longer model selection but harness quality. The same model swings from 42% to 78% success rate based solely on harness quality.

**Mental model**: Model = CPU, Context Window = RAM, Agent Harness = OS.

The harness is "everything except the LLM": prompt presets, tool execution, lifecycle management, memory, and recovery.

---

## What the Leaders Proved

### Anthropic: Two-Agent Pattern for Long-Running Agents

**Source**: [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

**Architecture**:
- **Initializer Agent**: Runs once. Creates JSON feature list (200+ requirements with `passes` boolean flags). Establishes environment.
- **Coding Agent**: Runs in subsequent sessions. Works feature-by-feature incrementally. Bootstraps from git logs + progress files + feature list.
- **State artifacts**: `claude-progress.txt` (chronological log), git repo (descriptive commits), `init.sh` (environment startup).
- **Session startup protocol**: `pwd` -> read git logs -> read progress files -> review feature list -> select next incomplete item -> run `init.sh` -> begin.
- **Verification**: End-to-end browser automation (Puppeteer MCP), not just unit tests.

**Six Composable Patterns** ([Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)):
1. Prompt chaining
2. Routing
3. Parallelization
4. Orchestrator-workers
5. Evaluator-optimizer
6. Augmented LLM (retrieval + tools + memory)

**Key insight**: The most successful implementations use simple, composable patterns -- not complex frameworks.

**OSMO relevance**: The two-agent pattern maps to OSMO's workflow lifecycle: init phase discovers cluster state, followed by incremental task execution. Progress file pattern is analogous to OSMO's task status tracking.

---

### OpenAI: Harness Engineering with Codex

**Sources**: [Harness Engineering](https://openai.com/index/harness-engineering/) | [AGENTS.md Spec](https://developers.openai.com/codex/guides/agents-md) | [Codex Agent Loop](https://openai.com/index/unrolling-the-codex-agent-loop/)

**Core result**: Built a **1M+ line production application with zero manually-written code** in 5 months.

**AGENTS.md as Map, Not Encyclopedia**:
- Initial approach (one big AGENTS.md) failed -- context crowds out the task
- Winning approach: short AGENTS.md (~100 lines) as table of contents pointing to deeper sources
- Nested hierarchy: `AGENTS.override.md` at subdirectory level
- Default limit: 32 KiB (option to increase to 65 KiB)
- Anti-patterns: empty files (silently skipped), exceeding limits (silently truncated), stale overrides

**Strict Dependency Layers**: `Types -> Config -> Repo -> Service -> Runtime -> UI`. Dependencies flow one direction. Structural tests validate compliance mechanically.

**Golden Principles**: Prefer shared utilities over hand-rolled helpers. Don't probe data YOLO-style. Mechanical enforcement via linters and CI, not just documentation. "If an architectural constraint matters enough to document, it matters enough to enforce with a linter."

**Entropy Management**: Periodic "garbage collection" agents detect documentation inconsistencies, discover architectural violations, prevent decay.

**OSMO relevance**: OSMO already has a well-structured AGENTS.md. The dependency layer model is directly applicable to OSMO's service architecture. Structural tests to enforce layer boundaries would catch cross-module drift.

---

### Datadog: Harness-First with Verification Loops

**Source**: [Closing the Verification Loop](https://www.datadoghq.com/blog/ai/harness-first-agents/)

**Core principle**: "Instead of reading every line of agent-generated code, invest in automated checks that can tell us with high confidence, in seconds, whether the code is correct."

**Verification Pyramid**:

| Layer | Tool | Duration | Confidence |
|-------|------|----------|------------|
| Symbolic | TLA+ specs | 2 min read | Understanding |
| Primary | Deterministic Simulation Testing (DST) | ~5 seconds | High |
| Exhaustive | Model checking (Stateright) | 30-60 seconds | Proof |
| Bounded | Kani verification | ~60 seconds | Bounded proof |
| Empirical | Telemetry + benchmarks | Seconds-minutes | Ground truth |

**DST** is the workhorse: Each run exercises production code through 500 deterministic seeds per component, escalating to 10M system-wide. Makes execution deterministic, abstracts physical time, injects faults.

**Scalability Inversion**: With agents, formal methods become economically justified. Code review shifts from "source of correctness" to a bloom filter.

**OSMO relevance**: DST with fault injection maps directly to testing workflow orchestration reliability. TLA+ specs for OSMO's distributed barrier protocol, Redis job queue deduplication, and consensus patterns could catch bug classes that unit tests miss.

---

### Stripe: Minions at Scale

**Sources**: [ByteByteGo](https://blog.bytebytego.com/p/how-stripes-minions-ship-1300-prs) | [MindStudio](https://www.mindstudio.ai/blog/what-is-ai-agent-harness-stripe-minions)

- **1,300 autonomous PRs/week**, 30% week-over-week growth
- Heavily modified fork of Block's open-source Goose agent
- Three-tier verification: (1) local linters/type-checkers <5s, (2) selective CI, (3) human escalation after 2 failed attempts
- **Foundation: 3 million existing tests**
- Core insight: "AI reliability scales with the quality of its constraints, not just the size of the model."

---

### Vercel: Fewer Tools = Higher Accuracy

- Started with 15 tools, 80% accuracy
- Stripped to 2 tools, achieved **100% accuracy with 3.5x speedup**
- Proved empirically in agent benchmarks

---

### Manus: Context Engineering

**Source**: [Context Engineering for AI Agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

- **KV-cache hit rate is the single most critical metric**. 100:1 input-to-output token ratio. 10x cost difference cached ($0.30/MTok) vs uncached ($3/MTok).
- Filesystem as unlimited external memory. Drop observations from context when restorable.
- Leave failed actions in context -- agents implicitly update internal beliefs.
- Introduce structured variation to prevent repetitive rhythm.
- Action names with consistent prefixes (`browser_*`, `shell_*`) enable stateless logit masking.
- Rebuilt harness 4 times; each rebuild reduced complexity. Biggest gains from removing things.

---

## DIF (Deterministic Infrastructure Functions) in Current Practice

**New section**: Analyzing the DIF/LLM split across existing harness architectures reveals that the industry is already defaulting to deterministic infrastructure without naming it.

### DIF Patterns Already in Production

| Company | DIF Mechanism | What It Replaces |
|---------|--------------|-----------------|
| **Stripe** | Local linters + type-checkers (<5s) | LLM-based code review for style/correctness |
| **Stripe** | 3M existing tests | LLM-based output verification |
| **Datadog** | DST with 500 deterministic seeds | LLM-based reasoning about correctness |
| **Datadog** | TLA+ specs + model checking | LLM-based formal reasoning |
| **OpenAI** | Structural tests for dependency layers | LLM-based architecture review |
| **OpenAI** | Garbage collection agents (periodic, rule-based) | Manual documentation maintenance |
| **Anthropic** | Shell script (`init.sh`) for session bootstrap | LLM-based environment setup |
| **Anthropic** | JSON feature list with boolean flags | LLM-based progress tracking |
| **Manus** | Logit masking with action name prefixes | LLM-based tool selection |
| **Vercel** | Reduced from 15 to 2 tools | LLM-based tool routing |

### The Pattern

Every successful harness moves toward:
1. **Deterministic checks first** (linters, tests, structural validation)
2. **LLM reasoning second** (only for tasks that require judgment)
3. **Less LLM over time** (each iteration removes LLM dependency)

This is exactly the DIF/LLM separation principle: **default to deterministic, escalate to LLM**. The industry arrived at this empirically. OSMO's framework names it explicitly and structures it as a design principle.

### What's Missing from Current Practice

No existing harness explicitly designs for all five layers:

| Layer | Stripe | Datadog | OpenAI | Anthropic | OSMO Framework |
|-------|--------|---------|--------|-----------|----------------|
| Context | Partial (AGENTS.md) | Partial (specs) | Yes (AGENTS.md hierarchy) | Yes (progress files) | **Yes** (routing scripts + decision tree) |
| Decision | Yes (linters) | Yes (TLA+ specs) | Yes (structural tests) | Partial | **Yes** (check-decisions.sh) |
| Quality | Yes (3M tests) | Yes (DST) | Partial | Yes (Puppeteer) | **Yes** (quality-gate.sh) |
| Continuity | Implicit (PRs) | Implicit | Partial (git) | Yes (progress.txt) | **Yes** (save/load-progress.sh) |
| Meta-cognition | No | No | Partial (entropy management) | No | **Yes** (meta-check.sh) |

The 5-layer framework fills the gap by providing explicit coverage of all five concerns, with DIF as the default mechanism for each.

---

## Hybrid Harness Consensus

Pure file-tree works. Pure code works. **Hybrid wins**:

| Layer | What | Examples |
|-------|------|---------|
| **File-tree** (context engineering) | Knowledge base in codebase, dynamic context access | AGENTS.md, docs/, progress files |
| **Code** (mechanical enforcement) | Deterministic linters, structural tests, pre-commit hooks | Bazel rules, ruff, eslint |
| **Operational** (entropy management) | Periodic agents detecting drift and violations | Doc-gardening agents, violation scanners |

**Martin Fowler's Three Components** ([Harness Engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)):
1. Context Engineering
2. Architectural Constraints (deterministic enforcement)
3. Entropy Management (periodic agent maintenance)

---

## MCP Ecosystem Maturity

- **10,000+ active public MCP servers** as of 2026
- Official SDKs (Python, TypeScript) have **97M+ monthly downloads**
- Donated to Agentic AI Foundation under Linux Foundation (late 2025)

**2026 Roadmap priorities**: Transport scalability (Streamable HTTP), agent communication (Tasks primitive), enterprise readiness (audit trails, SSO, gateway standardization).

**MCP Server Best Practices** ([Phil Schmid](https://www.philschmid.de/mcp-best-practices)):
1. **Outcomes, not operations**: One `track_latest_order(email)` instead of three separate tools
2. **Flatten arguments**: Top-level primitives, no `filters: dict`
3. **Instructions as context**: Detailed docstrings specifying when/how/what
4. **Curate ruthlessly**: 5-15 tools per server
5. **Name tools for discovery**: `{service}_{action}_{resource}` pattern
6. **Paginate large results**: Default 20-50, return `has_more`/`next_offset`

**Critical insight**: MCP is a user interface for a non-human user. Don't convert REST endpoints 1:1.

---

## Existing K8s/DevOps MCP Servers

| Server | Status |
|--------|--------|
| `containers/kubernetes-mcp-server` (Native Go) | Production-ready |
| Terraform MCP | Production-ready |
| GitHub MCP | Production-ready |
| Datadog MCP | Production-ready |
| PagerDuty MCP | Production-ready |
| Prometheus MCP | Beta |
| ArgoCD MCP | Beta |

---

## Framework Comparison

| Framework | Architecture | Best For | Status (2026) |
|-----------|-------------|----------|---------------|
| **LangGraph** | Directed graph with shared state | Stateful, complex workflows with cycles | Most battle-tested for production |
| **CrewAI** | Role-based agent teams | Linear multi-agent workflows, fast prototyping | 40% faster time-to-production |
| **AutoGen** | Conversational agents | Flexible conversation-driven workflows | Maintenance mode |
| **Manus** | Context-optimized harness | General-purpose long-running tasks | Rewrote harness 5 times |

**Key takeaway**: "The framework matters less than the infrastructure you build around it." Reliability comes from state persistence, retry handling, deployment, and monitoring -- not framework choice.
