# Prior Art: n8n, OpenManus, OpenShell, NemoClaw, OpenClaw

## n8n -- What to Learn, What to Ignore

### What It Is

Self-hostable workflow automation (180K GitHub stars, 626 contributors, 900+ templates, $50M+ funded). Visual DAG editor + code escape hatches (JavaScript/Python). 400+ built-in integrations. Scales via BullMQ + Redis queue (remarkably similar to OSMO's Kombu pattern).

### Architecture

- **Monorepo** (TypeScript ~91%): `packages/core` (runtime), `packages/workflow` (definitions), `packages/cli` (server/API), `packages/frontend` (Vue.js), `packages/nodes-base` (400+ integrations)
- **Queue mode**: BullMQ + Redis for distributed execution. Leader election for queue recovery. Priority-based scheduling. Graceful shutdown with drain.
- **Database**: PostgreSQL or SQLite. Credentials encrypted at rest.

### AI Agent Story (Massive Strategic Bet)

- **Six agent types** (all LangChain-based): Conversational, OpenAI Functions, Plan-and-Execute, ReAct, SQL, Tools Agent
- **Infrastructure**: Memory (Redis, PostgreSQL, MongoDB, Zep), Vector stores (Pinecone, Weaviate, Qdrant, Chroma, PGVector, Milvus), Embeddings (OpenAI, Cohere, Google, Ollama), LLMs (OpenAI, Anthropic, Google, Mistral, Groq, Ollama, DeepSeek)
- **MCP Integration**: Client node (call external MCP servers), Server Trigger (expose workflows as MCP tools), Client Tool (wrap MCP tools for agent nodes)

### What OSMO Should Learn

1. **Bidirectional MCP**: n8n workflows can call MCP tools AND be exposed as MCP tools for external agents. OSMO should do the same: expose OSMO operations as MCP tools for Claude Code/Codex/etc.

2. **Template ecosystem**: 900+ workflow templates drive adoption. For OSMO: curated workflow templates for common Physical AI patterns (SDG pipeline, training sweep, evaluation harness) as agent-consumable YAML.

3. **Queue recovery and dangling execution detection**: Critical for long-running GPU workflows. n8n's leader-elected recovery pattern is clean and worth comparing to OSMO's existing Kombu queue.

4. **Multiple agent strategies as composable nodes**: n8n offers 6 agent types as reusable components. OSMO harness should support multiple reasoning strategies depending on task type.

5. **Credential management + encryption at rest**: n8n's UX around credential management is mature. OSMO has SecretManager (JWE-based MEK/UEK) but could learn from n8n's patterns.

### What OSMO Should NOT Replicate

- 400+ SaaS connectors (not OSMO's domain)
- Visual drag-and-drop for business processes
- No-code positioning (OSMO's users are engineers)
- General chatbot/agent UX

### User Complaints to Note

- OAuth2/SSO credential setup is a frequent pain point
- Queue mode stability issues -- timeout errors, execution recovery edge cases
- Scaling limitations -- workflow concurrency is a hot request (22 replies, 2,079 views)
- License ambiguity -- "fair-code" is not truly open-source

---

## OpenManus -- Clean Abstractions, Limited Infrastructure

### What It Is

MIT-licensed Python agent framework (55K GitHub stars, 58 contributors). Created by former MetaGPT contributors. Positions as the open alternative to Manus AI.

### Architecture

**Agent hierarchy** (elegant, ~1000 lines of meaningful code):
```
BaseAgent (state machine, step loop, memory)
  -> ReActAgent (think-act cycle)
    -> ToolCallAgent (LLM tool calling, execution)
      -> Manus (concrete agent with default tools, MCP, browser)
```

**BaseAgent state machine**: IDLE -> RUNNING -> FINISHED | ERROR. Execution loop with max_steps. Sequential message memory. Stuck detection (duplicate messages, threshold: 2).

**ToolCallAgent**: think() via LLM with tool definitions, act() by executing calls. Three-layer error handling.

**Tools**: Bash, BrowserUseTool (Playwright), PythonExecute, StrReplaceEditor, PlanningTool, WebSearch, sandbox (Docker isolation).

**Multi-agent flows** (experimental): `PlanningFlow` with LLM-assisted task decomposition. Steps: NOT_STARTED -> IN_PROGRESS -> COMPLETED | BLOCKED. Agent assignment by type annotation matching.

### What OSMO Should Learn

1. **Clean agent abstraction hierarchy**: BaseAgent -> ReActAgent -> ToolCallAgent is extensible and easy to understand. Worth studying as a pattern.

2. **MCP as first-class citizen**: Both client (agent calls external tools via SSE + stdio) and server (FastMCP-based, exposes tools to external LLMs). Validates OSMO's MCP server approach.

3. **Stuck detection**: Automatic identification of reasoning loops with strategy adjustment prompts. OSMO agents need a dead-man switch.

4. **PlanningFlow**: LLM-generated task decomposition with typed agent assignment. Relevant for multi-stage Physical AI pipelines.

5. **Simplicity**: The entire framework is ~1000 lines. Easy to fork and modify. Complexity is the enemy.

### What Doesn't Apply to OSMO

- **Single-process/in-memory only**: No persistence, no checkpointing, no resume. OSMO's ctrl/user/rsync model is fundamentally more sophisticated.
- **No distributed execution**: Single machine only.
- **No auth/multi-tenancy**: No users, permissions, or resource limits.
- **No K8s awareness**: Pure Python process.
- **Sequential tool execution only**: No parallelism.

### Comparison: File-Tree-as-Harness vs. OpenManus Code-as-Harness

| Dimension | OpenManus (code) | File-tree harness |
|-----------|-----------------|-------------------|
| State location | Python heap | Filesystem |
| Persistence | None | Inherent |
| Resumability | None | Natural (read files, continue) |
| Multi-agent | Python flow objects | File conventions + locks |
| Debugging | Attach debugger, read logs | ls, cat, diff |
| K8s integration | None | Natural (volumes, ConfigMaps) |
| Scalability | Single process | Distribute via volumes/storage |

The file-tree approach aligns better with OSMO because OSMO already manages containers that operate on filesystems, K8s volumes are native, checkpointing is built into osmo_user, and multi-task barriers already coordinate via Redis.

---

## OpenShell -- The Sandbox Runtime

### What It Is

NVIDIA's open-source runtime for autonomous AI agents (Apache 2.0, released March 16, 2026).

**Key features**:
- **Out-of-process policy enforcement**: Constraints run in the environment, not the agent -- agent cannot override even if compromised
- K3s Kubernetes cluster inside a single Docker container
- Declarative YAML policies: static (filesystem, process) locked at creation; dynamic (network, inference) hot-reloadable
- Credentials injected as environment variables, never touch disk
- GPU passthrough for local inference
- Compatible with Claude Code, Codex, Cursor unmodified

### Current Status: ALPHA

NVIDIA's own docs: **"Alpha software -- single-player mode."** Multi-gateway (required for multi-agent) is a future goal, not shipping. This is the critical dependency risk identified in the critical review.

### What to Take Away

The out-of-process enforcement model and YAML policy approach are sound patterns worth studying. The credential isolation pattern (env vars, never disk) maps to OSMO's SecretManager. But **do not couple to OpenShell's alpha APIs**. Use the patterns, not the product.

---

## NemoClaw -- The Plugin Pattern

### What It Is

OpenClaw plugin for OpenShell. Pattern: TypeScript plugin + Python blueprint + YAML policies + inference profiles. Creates sandboxed OpenClaw with strict network/filesystem policies and NVIDIA inference routing.

### Current Status: ALPHA

Described by NVIDIA as "early-stage alpha release."

### What to Take Away

The plugin + blueprint + policies pattern is a clean abstraction for execution environment setup. But the original plan's ~1,350 LOC of plugin+blueprint+Dockerfile code solves a problem (sandbox orchestration) that Docker Compose solves in 50 lines of YAML.

---

## OpenClaw -- The Agent Runtime

### What It Is

Open-source "always-on personal AI assistant" (247K GitHub stars). Plugin-extensible agent runtime with tool execution, context management, and TUI.

### Current Status: ACTIVE BUT UNSTABLE

Three major refactors in three months (Clawdbot -> Moltbot -> OpenClaw). Plugin API changed substantially in v2026.3.7 (89 commits, 200+ bug fixes). ContextEngine API just released in v2026.3.7 beta. Industry advice: wait 6-12 months for production use.

### What to Take Away

Do not write an OsmoClaw plugin. Coupling to a rapidly changing plugin API is coupling to quicksand. Instead, expose OSMO as an MCP server that any agent runtime (including OpenClaw) can consume. MCP is a stable protocol; plugin APIs are not.

---

## Synthesis: What OSMO's Harness Should Take from Each

**From n8n**: Bidirectional MCP, template ecosystem, queue recovery, multiple agent strategies

**From OpenManus**: Clean agent abstractions, stuck detection, PlanningFlow pattern

**From OpenShell**: Out-of-process policy enforcement pattern, credential isolation, YAML policies

**From NemoClaw**: Plugin + blueprint + policies pattern (as concept, not implementation)

**From OpenClaw**: MCP as first-class citizen (via MCP server, not plugin)

**From NONE of them**: GPU topology awareness, multi-cluster orchestration, Physical AI domain knowledge, checkpoint-based resumability, distributed barrier coordination -- these are OSMO's unique additions.
