# Landscape Analysis: Agent Infrastructure Capabilities (March 2026)

What exists, what doesn't, and what OSMO should build vs. use vs. compose.

---

## The 7 Required Capabilities

The 5-layer AI-native framework requires these infrastructure capabilities:

1. **System prompt enrichment** — inject relevant context into agent sessions
2. **Memory** — persist state across sessions (decisions, progress, knowledge)
3. **Context management** — route agents to relevant information, manage context window
4. **Object storage** — structured data persistence
5. **File access** — read/write files in the workspace
6. **Tools (bash)** — shell execution
7. **Network access** — HTTP requests, API calls, web search

This document evaluates the current ecosystem across three layers: agent runtimes (Claude Code, Codex, etc.), MCP servers, and agent frameworks (LangGraph, CrewAI, etc.).

---

## 1. System Prompt Enrichment

### Status: Well-served. Build nothing — compose existing patterns.

Every major agent runtime supports project-level instruction files. This is table-stakes in 2026.

| Agent Runtime | Mechanism | Details |
|--------------|-----------|---------|
| **Claude Code** | CLAUDE.md, AGENTS.md, Skills | Hierarchical: project root + nested directories + `~/.claude/`. Auto-loaded every session. Skills add invocable knowledge modules. |
| **OpenAI Codex CLI** | AGENTS.md, AGENTS.override.md | Walks directory tree root-to-cwd, concatenating files. Override files take precedence. 32 KiB default limit. |
| **Cursor** | `.cursor/rules/*.mdc`, Notepads | Rules categorized as Always, Auto (by glob), or Agent-requested. Notepads are persistent docs invoked via @-mention. |
| **Windsurf** | `.windsurfrules.md`, Global rules | Global rules apply everywhere; workspace rules override. Loaded into Cascade pipeline automatically. |
| **Aider** | `CONVENTIONS.md`, `.aider.conf.yml` | Conventions file as read-only context. Arbitrary files via `--read` flag. |
| **Cline** | `.clinerules` (file or directory) | Single file or directory with multiple .md files. Project-scoped, sharable via version control. |
| **Roo Code** | `.roo/rules/`, `.roomodes` | Recursive rule loading. Mode-specific instructions with roleDefinition and whenToUse fields. |
| **Amazon Q** | `.amazonq/rules/**/*.md`, Profiles | Rules folder auto-included. Profiles switch between context sets. Context hooks for dynamic injection. |
| **Gemini CLI** | GEMINI.md | Hierarchical like Claude Code. SaveMemory tool auto-appends learned facts. |

**What's missing**: No tool does *dynamic* prompt enrichment based on task type. Asking "add an API endpoint" should automatically surface the core service AGENTS.md, relevant submodule docs, and cross-service impact warnings. This is deterministic routing, not LLM reasoning.

**What we built**: `scripts/agent/route-context.sh` + `docs/agent/decision-tree.md` fill this gap. Given a file path or task type, they return the relevant context files deterministically.

**What NemoClaw provides**: Nothing — NemoClaw operates at the sandbox/infrastructure layer, not the prompt layer.

**What superpowers provides**: SessionStart hook injects skill awareness (`using-superpowers`) into every session. Good pattern for framework awareness injection. All other skills loaded on-demand via the Skill tool.

### Recommendation

Use the AGENTS.md convention (cross-agent compatible). Superpowers' SessionStart hook pattern is the right model for injecting framework awareness. Our DIF routing scripts add the dynamic layer that no existing tool provides.

---

## 2. Memory

### Status: Fragmented. Biggest ecosystem gap. Needs composition.

Agent runtimes have basic memory. Agent frameworks have richer memory. Nobody provides a unified memory layer that works across agent runtimes.

#### Agent Runtimes

| Runtime | Memory Type | Scope | Notes |
|---------|-----------|-------|-------|
| **Claude Code** | Auto-memory files at `~/.claude/projects/` | Cross-session, project-scoped | Writes corrections, preferences, project facts. Survives compaction. Best native implementation. |
| **Codex CLI** | Workspace-scoped memories | Cross-session | Guardrails against stale facts. Threads persisted by cache key. |
| **Gemini CLI** | SaveMemory tool → GEMINI.md | Cross-session | Appends to `## Gemini Added Memories` section. Simple but effective. |
| **Windsurf** | Cascade Memories | Cross-session | Auto-detected useful facts during conversation. Distinct from Rules. |
| **Cline** | Memory Bank (file-based) | Cross-session | Structured markdown: `productContext.md`, `activeContext.md`, `progress.md`, `decisionLog.md`. Rebuilt after every session reset. |
| **Roo Code** | Memory Bank MCP server | Cross-session | MCP-mediated. Structured markdown with timestamped entries. Community-driven. |
| **Cursor** | @Past Chats, Notepads, Agent memory | Cross-session | Background agents learn from past runs via memory tool. |
| **Aider** | `.aider.history` only | Chat input history | No semantic memory. Relies on git history. |

#### MCP Servers

| Server | Storage Backend | Maturity | Notes |
|--------|----------------|----------|-------|
| **@modelcontextprotocol/server-memory** (official) | JSONL knowledge graph (entities, relations, observations) | Reference | Simple but not scalable. 9 tools. |
| **Qdrant MCP** (official) | Qdrant vector DB + FastEmbed | Production | Best transport coverage (stdio, SSE, streamable-http). Semantic memory. |
| **Chroma MCP** (official) | Chroma (ephemeral, persistent, HTTP, Cloud) | Production | 12 tools. Multiple embedding providers. Good for local/embedded use. |
| **Mem0 MCP** | Mem0 Cloud API | Beta | 9 tools. Scoped memories (user/agent/app/run). Requires cloud API key. |
| **cortex** | Local knowledge graph (file-watching + LLM extraction) | Alpha | Watches project files and builds entity graphs automatically. |

#### Agent Frameworks

| Framework | Memory Types | Persistence | Notes |
|-----------|-------------|-------------|-------|
| **CrewAI** | Short-term (ChromaDB/RAG), Long-term (SQLite3), Entity (RAG), Contextual (unified injection) | SQLite + ChromaDB | Richest memory taxonomy. Long-term tracks "what approach worked" — unique. |
| **Agno** | Sessions, Memory (user-specific), Knowledge (RAG) | PostgreSQL/SQLite | Auto-RAG: agents intelligently search knowledge bases. |
| **Semantic Kernel** | Vector store GA packages | Azure/Pinecone/Elasticsearch/in-memory | Most enterprise-ready. GA memory packages. |
| **LangGraph** | Checkpointers (superstep persistence), Store (cross-thread) | SQLite/PostgreSQL/Redis/Couchbase | Production-grade. Time-travel debugging. |

#### What NemoClaw Provides

Nothing. NemoClaw is a sandbox layer. It provides credential storage in OpenShell's encrypted store and sandbox metadata, but no agent memory.

#### What Superpowers Provides

**No memory system at all.** Specs and plans committed to git are the only persistence. No cross-session memory, no decision logs, no conversation summaries.

### Gap Analysis

The fundamental problem: **Claude Code's memory doesn't transfer to Codex. CrewAI's memory doesn't work in Claude Code.** Each tool's memory format is proprietary. For an agent-agnostic substrate, we need a portable memory format.

Cline's Memory Bank pattern is the best design for portable, file-based memory:
- `productContext.md` — what the project is, key decisions
- `activeContext.md` — current work focus, recent changes
- `progress.md` — what's done, what's next, blockers
- `decisionLog.md` — decisions made and rationale

This pattern works because it's markdown files in the repo — any agent can read them.

### Recommendation

- **For OSMO dev (now)**: Use Claude Code's auto-memory (already active) + our `save-progress.sh` / `load-progress.sh` for session continuity.
- **For agent-agnostic substrate**: Adopt a standardized markdown memory format inspired by Cline's Memory Bank. Files in the repo, readable by any agent. Not a database, not a vector store — just well-structured markdown.
- **For Physical AI pipelines (future)**: MCP server-memory or Qdrant MCP for semantic memory that accumulates pipeline intelligence.

---

## 3. Context Management

### Status: Biggest ecosystem gap. Nobody does this well.

| Source | Approach | Maturity |
|--------|----------|----------|
| **Claude Code** | Auto-compaction at ~98% window. Session Memory writes background summaries continuously, making `/compact` instant. | Production |
| **Windsurf** | Multi-layer pipeline: Rules → Memories → Open files → Codebase RAG → Recent actions → Final prompt | Production (proprietary) |
| **Aider** | AST-based repo map with graph ranking. Selects most important file portions to fit token budget. | Production |
| **Superpowers** | Subagent context isolation: controller crafts exactly what each subagent needs. Never inherits session history. | Production |
| **LangGraph** | Explicit state schemas with reducer-driven updates. State fields isolate tool-call context from LLM context. | Production |
| **Agno** | Per-run context control. Compression and memory update events. | Production |
| **MCP: @sdsrs/code-graph** | AST knowledge graph, semantic search, call graph traversal | Alpha |

**The gap**: No framework provides automatic context curation — summarization, relevance ranking, intelligent eviction. Most rely on "throw it all in a large context window." Windsurf's multi-layer pipeline is the most sophisticated but proprietary and not composable.

#### What NemoClaw Provides

Nothing for context management. NemoClaw is below this layer.

#### What Superpowers Provides

Subagent context isolation is the key contribution. The controller constructs exactly what each subagent needs — subagents never inherit session history. Token efficiency guidelines for skill authoring. But no context window monitoring, no automatic summarization, no priority-based eviction.

### Recommendation

The DIF approach is the right answer. Context routing should be deterministic, not LLM-based:

- `route-context.sh` — given a file path, return relevant docs (milliseconds, $0)
- `decision-tree.md` — given a task type, which files to read first
- Superpowers' subagent isolation — fresh, small context per sub-agent
- Claude Code's auto-compaction — handles the window management automatically

What to build: nothing beyond what we have. The existing DIF scripts + superpowers' subagent pattern + Claude Code's compaction cover the need.

---

## 4. Object Storage / Structured Data

### Status: Partially served via MCP. File system is sufficient for framework state.

#### MCP Servers

| Server | Backend | Maturity | Notes |
|--------|---------|----------|-------|
| **mcp-alchemy** | Any SQLAlchemy DB (PostgreSQL, MySQL, SQLite, Oracle, MSSQL) | Production | "Daily use without known bugs." Best multi-DB option. |
| **Supabase MCP** | PostgreSQL (Supabase) | Production | 2.5k stars. Database + storage + auth. Read-only mode. |
| **Neon MCP** | PostgreSQL (Neon) | Production | Branching, migration, schema comparison. |
| **mcp-server-s3** | AWS S3 | Beta | List, browse, upload/download, presigned URLs. |
| **Upstash MCP** | Redis + QStash + Workflow | Beta | 17 releases. Monitoring + management. |
| **Atlas MCP** | Neo4j | Stable | Projects/tasks/knowledge hierarchy. Most mature task management MCP. |

**Gaps**: No MCP server for GCS or Azure Blob storage. OSMO's own storage SDK (6 backends: S3/Azure/GCS/Swift/TOS/local) is more capable than anything in the MCP ecosystem.

#### What NemoClaw Provides

Sandbox filesystem (volatile) and credential storage in OpenShell's encrypted store. Not useful for agent state persistence.

### Recommendation

- **For framework state**: File system (JSON/markdown). Simplest, most portable, works with every agent runtime.
- **For OSMO's pipeline data**: OSMO's own storage SDK exposed via MCP tools (already planned in substrate-design.md).
- **For future database needs**: mcp-alchemy (production-grade, multi-DB) or Supabase MCP.

---

## 5. File Access

### Status: Fully solved. Build nothing.

Every agent runtime provides full file read/write with sandbox controls:

| Runtime | Read | Write | Search | Sandbox |
|---------|------|-------|--------|---------|
| **Claude Code** | Full | Full (sandboxed) | Glob, Grep, Read tools | Allowlist controls write paths |
| **Codex CLI** | Full | Configurable | Shell-based | seatbelt (macOS) / Landlock (Linux) |
| **Cursor** | Full | Full | Codebase indexing | Directory/file access controls |
| **Gemini CLI** | Full | Full (sandboxed) | FindFiles, SearchText | Docker/gVisor sandbox |
| **All others** | Full | Full or approval-gated | Varies | Varies |

MCP `server-filesystem` adds 14 tools with directory-based ACL and Roots protocol.

**Gap worth noting**: No MCP server provides **file watching / change detection**. Not needed for the framework but relevant for future Physical AI pipeline event hooks.

---

## 6. Tools (Bash/Shell)

### Status: Fully solved. Build nothing.

Every agent runtime except Aider provides full shell execution with varying sandbox granularity:

| Runtime | Shell | Sandbox | Notable |
|---------|-------|---------|---------|
| **Claude Code** | Full bash | Allowlist sandbox, permission prompts | Plus: Read, Write, Edit, Grep, Glob, TodoWrite, LSP |
| **Codex CLI** | Full shell (Rust) | OS-level seatbelt/Landlock | Three modes: suggest/auto-edit/full-auto |
| **Cursor** | Full terminal | Agent mode auto-executes | Plus: background agents, subagents |
| **Gemini CLI** | Full shell | Docker/gVisor/LXC sandbox | Plus: GoogleSearch, WebFetch, WriteTodos, SaveMemory |
| **NemoClaw/OpenShell** | Full (in sandbox) | Kernel-level Landlock + seccomp + netns | Most secure option. Binary-level egress matching. |

### What to Leverage from NemoClaw

Two patterns worth adopting (not the implementation, the design):

1. **Policy YAML format**: Static policies locked at creation, dynamic policies hot-reloadable without restart. Clean separation.
2. **Operator approval workflow**: Unknown/dangerous actions surface in a TUI for human approval. Maps to our "AI recommends, humans approve" consensus.

These patterns apply to OSMO agent permissions in workflow contexts — not to dev-mode framework usage.

---

## 7. Network Access

### Status: Mostly solved. Minor gaps.

| Source | Capability | Maturity |
|--------|-----------|----------|
| **Claude Code** | WebFetch + WebSearch built-in | Production |
| **Gemini CLI** | GoogleSearch + WebFetch built-in | Production |
| **MCP: Playwright** | Full browser automation | Production (5.3k stars) |
| **MCP: Perplexity** | Web search + reasoning | Production (2k stars) |
| **MCP: server-fetch** | HTML→markdown conversion | Production |
| **NemoClaw/OpenShell** | Per-binary, per-destination egress control | Alpha |

**Gaps**: No MCP server provides persistent WebSocket client connections — relevant for OSMO's real-time cluster monitoring but not for the framework itself.

**NemoClaw's unique contribution**: Binary-level network egress matching (both destination AND originating binary must match policy). More granular than typical sandbox controls. Worth studying for high-security Physical AI agent deployments.

---

## Cross-Cutting: Agent Frameworks

Agent frameworks provide higher-level orchestration that complements the primitives above.

### Most Relevant for OSMO

| Framework | Best At | License | LLM-Agnostic | Cloud-Agnostic |
|-----------|---------|---------|--------------|----------------|
| **LangGraph** | Stateful agent workflows, checkpointing, time-travel debug | MIT | Yes | Yes (self-host) |
| **CrewAI** | Multi-agent coordination, richest memory taxonomy | MIT | Yes (LiteLLM) | Yes (self-host) |
| **Agno** | Batteries-included: memory + knowledge + tools + teams | Apache 2.0 | Yes (23+ providers) | Yes (self-host) |
| **Temporal** | Durable execution (gold standard). Not agent-specific. | MIT | N/A | Yes (full self-host) |
| **kagent** | K8s-native agents, MCP tools for K8s/Istio/Helm/Argo | Apache 2.0 | Yes | K8s-required |
| **Composio** | Tool integration (850+ managed, OAuth) | MIT | Framework-agnostic | Yes |
| **n8n** | Visual workflows, bidirectional MCP (consume AND expose) | Fair-code | Yes | Yes (self-host) |
| **Semantic Kernel** | Enterprise-ready, A2A protocol interop, GA memory | MIT | Yes | Yes (Azure-deep) |

### Key Observations

1. **Durable execution is under-used**: Temporal and Inngest solve failure recovery, state persistence, and retry — exactly the problems long-running Physical AI pipelines face. Yet most agent frameworks build their own inferior persistence.

2. **Context management is the biggest framework gap**: No framework provides production-grade automatic context curation. Most rely on large context windows. This validates our DIF approach.

3. **A2A protocol is early**: Google/Linux Foundation's Agent-to-Agent protocol aims to standardize agent communication. Semantic Kernel is the first major adopter. Worth watching but not mature enough to build on.

4. **Composio solves the hardest integration problem**: Managed OAuth, API keys, token refresh, rate limiting across 850+ integrations. If OSMO's MCP server needs to call external APIs, Composio is the best integration layer.

---

## Superpowers: Detailed Leverage Assessment

Superpowers (obra, 98.9k stars, MIT, v5.0.5) is already installed and active in this project. It provides a workflow orchestration layer with sophisticated persuasion engineering.

### What Superpowers Provides (and Maps to Our Layers)

| Superpowers Capability | Our Layer | Leverage? |
|----------------------|-----------|-----------|
| **Brainstorming skill** — hard gate: no code before design approved. Socratic Q&A → 2-3 approaches → design sections → spec review loop. | Decision | **Yes.** Already using. Prevents implementation without design. |
| **Writing-plans skill** — break spec into 2-5 min tasks with exact file paths. | Decision | **Yes.** Structured planning before execution. |
| **Subagent-driven development** — fresh subagent per task, controller crafts context, two-stage review (spec compliance + code quality). | Context + Quality | **Yes.** The orchestrator/sub-agent pattern. Matches our framework's DIF orchestrator + LLM sub-agents. |
| **TDD enforcement** — "Iron Law": no production code without failing test. Rationalization table with 11 excuses and counters. Delete-and-restart if code written before test. | Quality | **Yes.** Use for implementation tasks. |
| **Verification-before-completion** — evidence before claims. Forbidden: "should work now", "I'm confident". Must run verification and show output. | Quality | **Yes.** Complements `quality-gate.sh`. |
| **Systematic debugging** — 4-phase root cause analysis. Sub-techniques: root-cause tracing, defense-in-depth, condition-based waiting. | Meta-cognition | **Yes.** Use when agents are stuck. |
| **Code review** — dispatch code-reviewer subagent with git SHA range. Anti-performative-agreement: no "You're absolutely right!" Push back when feedback is technically incorrect. | Quality | **Yes.** Post-implementation verification. |
| **Rationalization tables** — 11 patterns the agent uses to justify skipping steps, each with a "Reality" counter. Cialdini-inspired persuasion defense. | Meta-cognition | **Yes.** Static self-monitoring. |
| **SessionStart hook** — injects `using-superpowers` skill awareness into every session. | Context | **Yes.** Pattern for framework awareness injection. |
| **Git worktrees** — isolated branches with setup verification. | Continuity | **Yes.** Isolated implementation without polluting main branch. |
| **Finishing branches** — merge/PR/keep/discard decision workflow. | Continuity | **Yes.** Structured completion. |

### What Superpowers Does NOT Provide

| Gap | Our Layer | What We Built |
|-----|-----------|--------------|
| **No memory system** — specs/plans in git only | Memory | `save-progress.sh`, `load-progress.sh`, Claude Code auto-memory |
| **No context window monitoring** — no tracking of fill level | Context | `route-context.sh` (deterministic routing avoids window waste) |
| **No session continuity** — no "where were we?" restoration | Continuity | `load-progress.sh` + continuity-protocol.md |
| **No dynamic meta-cognition** — rationalization tables are static, not runtime | Meta-cognition | `meta-check.sh` (detects spinning, drift, stale progress) |
| **No project-aware adaptation** — skills are generic | Context | Service-level AGENTS.md files, `route-context.sh` |
| **No architectural enforcement** — quality gates are procedural, not structural | Decision | `check-decisions.sh` (mechanical boundary checking) |

### Architecture Notes

- **Plugin structure**: `.claude-plugin/plugin.json` manifest + `hooks/` + `skills/` directories. Single SessionStart hook. All skills loaded via Claude Code's native Skill tool.
- **Skill format**: Markdown files (`SKILL.md`) with YAML frontmatter (name, description). Subagent prompt templates in separate .md files.
- **Key design insight**: Skills are "persuasion documents" — they use psychological techniques (Cialdini's authority, commitment, scarcity) to prevent the LLM from rationalizing its way out of following the process. This is unique and effective.

---

## NemoClaw: Detailed Leverage Assessment

NemoClaw (NVIDIA, Apache 2.0, alpha) is an OpenClaw plugin for OpenShell. It provides sandbox isolation and policy enforcement for AI agents, NOT prompt/memory/context management.

### What NemoClaw/OpenShell Provides

| Capability | Description | OSMO Relevance |
|-----------|-------------|----------------|
| **Kernel-level sandboxing** | Landlock LSM + seccomp + network namespaces. Even hallucinated malicious commands are kernel-blocked. | **Low direct reuse.** OSMO's K8s pod isolation is more appropriate for multi-tenant orchestration. OpenShell's K3s-in-Docker is for single-user local dev. |
| **Binary-level network egress** | Per-binary, per-destination, per-method egress rules. Proxy matches outbound connections to originating binary — both must match. | **Medium.** More granular than K8s NetworkPolicies. Pattern worth studying for agent permission models. |
| **Inference credential isolation** | Privacy router strips agent credentials, injects backend credentials. API keys never enter sandbox. | **High conceptual value.** Directly applicable if OSMO adds agent-mediated LLM calls. Prevents credential leakage via prompt injection. |
| **Declarative policy YAML** | Static policies (filesystem, process) locked at creation. Dynamic policies (network, inference) hot-reloadable at runtime. | **High pattern value.** Clean separation of immutable vs. mutable policies. Applicable to OSMO agent workflow permissions. |
| **Operator approval workflow** | Unknown egress attempts surface in TUI for human approval. | **Medium.** The UX pattern maps to our "AI recommends, humans approve" consensus. Implementation would be OSMO-native (UI, not TUI). |
| **Blueprint architecture** | Versioned, digest-verified, immutable orchestration artifacts. 5-stage lifecycle: Resolve → Verify → Plan → Apply → Report. | **Medium.** Supply-chain-safety pattern applicable to OSMO workflow app specs. |
| **MCP support** (via NVIDIA Agent Toolkit) | MCP client + server, 3 transports (stdio, SSE, streamable-http), auth. | **High.** Most reusable component for OSMO's future MCP server. |

### What NemoClaw Does NOT Provide

- No system prompt enrichment
- No memory / persistence (beyond sandbox metadata)
- No context management
- No quality gates
- No session continuity
- No meta-cognition

NemoClaw is infrastructure *beneath* the agent, not the agent harness itself.

---

## Synthesis: Build vs. Use vs. Compose

| Capability | Verdict | What to Do |
|-----------|---------|------------|
| **System prompt enrichment** | **USE** existing patterns | AGENTS.md convention (cross-agent). Superpowers SessionStart hook for framework injection. Our DIF scripts for dynamic routing. |
| **Memory** | **COMPOSE** from existing | Claude Code auto-memory (OSMO dev). Standardized markdown memory format inspired by Cline Memory Bank (agent-agnostic). MCP server-memory or Qdrant for future pipeline intelligence. |
| **Context management** | **BUILT** (DIF layer) | `route-context.sh` + `decision-tree.md` + superpowers subagent isolation + Claude Code compaction. No existing tool does deterministic context routing — this is our unique contribution. |
| **Object storage** | **USE** file system + MCP | File system for agent state. OSMO storage SDK via MCP for pipeline data. mcp-alchemy if database access needed. |
| **File access** | **USE** existing | Solved by every runtime. No action needed. |
| **Tools (bash)** | **USE** existing | Solved by every runtime. Adopt NemoClaw's policy YAML pattern for future agent permissions. |
| **Network access** | **USE** existing | Solved by runtimes + MCP. No action needed. |

### What the Ecosystem Provides Well

- File access, shell execution, network access — fully commoditized
- System prompt injection — standardized via AGENTS.md convention
- Quality gates — superpowers provides excellent workflow enforcement
- Durable execution — Temporal/Inngest for long-running pipelines (future)
- Tool integration — Composio for managed auth across 850+ APIs (future)

### What the Ecosystem Does Poorly

- **Context management** — no automatic context curation. Our DIF routing fills this gap.
- **Cross-runtime memory** — every tool's memory is proprietary. Need a portable format.
- **Session continuity** — no standard handoff protocol between sessions.
- **Dynamic meta-cognition** — no runtime self-monitoring. Our `meta-check.sh` fills this gap.
- **Multi-agent coordination standards** — MCP standardized tools but not agent-to-agent communication. A2A protocol is early.

### The Key Insight

The ecosystem has good **primitives** (file access, tools, network) but poor **orchestration** of those primitives (context routing, memory management, self-monitoring). That's exactly what the 5-layer framework with DIF scripts provides. We're building in the right gap — the layer between raw agent capabilities and effective agent behavior.

---

## Recommended Next Steps

1. **Standardize memory format**: Design a portable markdown-based memory format (inspired by Cline Memory Bank) that works with any agent runtime via the AGENTS.md convention.

2. **Integrate with superpowers**: Our DIF scripts complement superpowers' workflow skills. Map the integration: brainstorming → `check-decisions.sh` → TDD/subagent-development → `quality-gate.sh` → `save-progress.sh`.

3. **Evaluate Temporal for Physical AI pipelines**: When building the MCP server for pipeline orchestration, use Temporal as the durable execution substrate for multi-hour training runs.

4. **Watch A2A protocol**: Google/Linux Foundation's agent-to-agent protocol could become the standard for multi-agent coordination. Monitor Semantic Kernel's adoption as a maturity signal.

5. **Adopt NemoClaw patterns selectively**: Policy YAML format (static/dynamic split), inference credential isolation, operator approval workflow — as design patterns, not as dependencies.

---

## Sources

### Agent Runtimes
- Claude Code: code.claude.com/docs (features, memory, hooks, skills)
- OpenAI Codex CLI: developers.openai.com/codex (agents-md, features, mcp, config)
- Cursor: cursor.com/docs (mcp, background-agent), cursor.com/changelog/2-5
- Windsurf: docs.windsurf.com (memories, mcp, context engine)
- Aider: aider.chat/docs (repomap, modes, conventions)
- Cline: docs.cline.bot (memory-bank, features)
- Roo Code: docs.roocode.com (custom-modes, instructions, boomerang, mcp)
- Amazon Q: docs.aws.amazon.com/amazonq (project-rules, custom-agents, mcp)
- Gemini CLI: github.com/google-gemini/gemini-cli, geminicli.com/docs

### MCP Ecosystem
- Official: github.com/modelcontextprotocol (servers, sdks, spec)
- Qdrant MCP: github.com/qdrant/mcp-server-qdrant
- Chroma MCP: github.com/chroma-core/chroma-mcp
- Mem0 MCP: github.com/mem0ai/mem0-mcp
- mcp-alchemy: github.com/runekaagaard/mcp-alchemy
- Supabase MCP: github.com/supabase-community/supabase-mcp
- Playwright MCP: github.com/nicholasoxford/mcp-playwright
- Atlas MCP: github.com/cyanheads/atlas-mcp-server

### Agent Frameworks
- LangGraph: github.com/langchain-ai/langgraph, docs.langchain.com
- CrewAI: crewai.com/open-source, docs.crewai.com
- Agno: github.com/agno-agi/agno, agno.com
- Semantic Kernel: github.com/microsoft/semantic-kernel, devblogs.microsoft.com
- kagent: kagent.dev, github.com/kagent-dev/kagent
- Composio: github.com/ComposioHQ/composio, composio.dev
- Temporal: temporal.io, github.com/temporalio
- Inngest: github.com/inngest/inngest, inngest.com
- n8n: github.com/n8n-io/n8n, docs.n8n.io

### NVIDIA
- NemoClaw: nvidia.com/en-us/ai/nemoclaw, github.com/NVIDIA/NemoClaw
- OpenShell: github.com/NVIDIA/OpenShell
- NVIDIA Agent Toolkit: docs.nvidia.com/nemo/agent-toolkit

### Superpowers
- github.com/obra/superpowers (v5.0.5, MIT, 98.9k stars)
