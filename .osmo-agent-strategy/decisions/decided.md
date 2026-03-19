# Decisions Made

These decisions emerged through research, analysis, and stress-testing. Each is supported by evidence from the research files.

---

## Strategic Decisions

### D1: OSMO is a substrate, not a product

**Decision**: Position OSMO as an agentic substrate that enables emergent AI-driven capabilities, not as a fixed product with prescribed workflows.

**Reasoning**: The six market opportunities are not separate products to build sequentially. They are what emerges when capable agents get access to OSMO's primitives. Building the substrate (MCP server + domain knowledge + telemetry) enables all six simultaneously.

**Evidence**: Zero competitors in Physical AI workflow orchestration. Every adjacent category has strong incumbents. The unique opportunity is at the intersection.

### D2: Build pipeline intelligence, integrate everything else

**Decision**: Only build agent capabilities for Physical AI pipeline orchestration (Persona C). Integrate with existing tools for development (5-layer framework on Claude Code) and operations (kagent/Komodor/PagerDuty).

**Evidence**: Claude Code + AGENTS.md solves dev assistance. Komodor (95% accuracy), kagent (CNCF), PagerDuty solve operations. Only pipeline intelligence requires OSMO's unique primitives.

### D3: MCP server, not custom agent runtime

**Decision**: Expose OSMO as an MCP server so any agent runtime can consume it. Do not build a custom agent runtime.

**Evidence**: MCP is a Linux Foundation protocol with 10,000+ servers, 97M+ monthly SDK downloads. Plugin APIs change monthly (OpenClaw had 3 major refactors in 3 months). MCP survives agent runtime churn.

### D4: 8-10 tools maximum, outcome-oriented

**Decision**: The MCP server has 8-10 tools designed around agent goals, not API endpoints.

**Evidence**: Vercel: 15 tools -> 80% accuracy; 2 tools -> 100% accuracy with 3.5x speedup. Phil Schmid's MCP best practices: 5-15 tools per server.

---

## Tactical Decisions

### D5: Zero alpha dependencies in MVP

**Decision**: The MVP has no dependency on OpenShell, NemoClaw, or OpenClaw. Pure Python MCP server with stdio transport.

**Evidence**: All three released as alpha on March 16, 2026. Breaking API changes within weeks of release.

### D6: Start with 3-5 files, not 25

**Decision**: The file tree starts with AGENTS.md + progress files + verification scripts. No 25-file knowledge tree.

**Evidence**: OpenAI: giant AGENTS.md fails. Models degrade past ~100K tokens. 3 accurate files beat 25 stale files.

### D7: Cost controls are mandatory, not optional

**Decision**: The MCP server includes tool invocation limits, cost estimation before workflow submission, and a dead-man switch.

**Evidence**: The original plan's "No cost ceiling guarantee" is unacceptable for GPU workflows at $25-40K/GPU-day.

### D8: Validation before expansion

**Decision**: Run 5 real tasks with the framework. Measure human interventions, wall-clock time, failure modes. Only expand after evidence.

**Evidence**: Stripe: 3M tests before 1,300 autonomous PRs/week. Anthropic: incremental feature-by-feature progress.

### D9: Phase 1 starts with Self-Healing Training Infrastructure

**Decision**: The first market opportunity (after dogfood) is self-healing training infrastructure.

**Evidence**: Closest to existing operator code. Immediately measurable ROI (GPU-hours saved). Doesn't require accumulated telemetry.

### D10: Generate knowledge from code, don't manually author it

**Decision**: Where possible, derive knowledge files from code rather than manually writing them.

**Evidence**: 121 API routes that change with normal PRs. Manual knowledge goes stale. CI-based generation catches drift automatically.

---

## Framework Decisions (New)

### D11: Dogfood first

**Decision**: Prove the AI-native framework on OSMO's own development before targeting external users.

**Reasoning**: If the framework can't improve AI-assisted development of OSMO itself -- a complex multi-language, multi-service platform -- it won't work for Physical AI pipelines. OSMO development is the hardest test case we control.

### D12: 5-layer framework

**Decision**: Context, Decision, Quality, Continuity, Meta-cognition are the five layers needed for effective AI-assisted work.

**Reasoning**: Derived from analyzing what goes wrong with AI agents: they can't find information (Context), make architectural mistakes (Decision), declare done without verification (Quality), lose progress between sessions (Continuity), and get stuck without realizing it (Meta-cognition). Each layer addresses a specific failure mode.

### D13: DIF/LLM separation

**Decision**: Default to Deterministic Infrastructure Functions (DIF). Escalate to LLM only when deterministic approaches fail.

**Reasoning**: Most harness work doesn't need an LLM. File routing is grep. Constraint checking is scripting. Verification is running tests. DIF is cheaper ($0 vs. tokens), more reliable (deterministic), auditable (readable scripts), and faster (milliseconds vs. seconds).

### D14: NVIDIA market-maker model

**Decision**: Fully open-source code AND data. K8s/Linux model: ecosystem gravity, not data moat.

**Reasoning**: OSMO's success metric is GPU-hours orchestrated, not software revenue. Data moats create lock-in which slows adoption. Ecosystem gravity creates pull which accelerates adoption. Faster adoption = more GPU demand = NVIDIA revenue.

### D15: GTM wedge is scale transition, not self-healing

**Decision**: The go-to-market entry point is helping existing OSMO users through scale transitions (1->3 clusters, 8->64 GPUs, 1->5 teams), not selling self-healing to new users.

**Reasoning**: Self-healing requires explaining latent pain. Scale transition is acute pain that existing users experience at predictable inflection points.

### D16: Positioning: "How Physical AI goes from research to production fleets"

**Decision**: This is the one-sentence positioning statement for OSMO's agent capabilities.

**Reasoning**: Specific enough to be meaningful, broad enough to be true. Captures the full pipeline lifecycle without being vague.

### D17: Multi-cluster heterogeneous is THE differentiator within NVIDIA stack

**Decision**: Within the NVIDIA ecosystem, OSMO's unique contribution is orchestrating workflows ACROSS clusters with different GPU types and configurations.

**Reasoning**: Isaac Sim, Omniverse, NIM, Data Factory each operate on one cluster. OSMO is the connective tissue that enables cross-cluster pipelines.

### D18: Capability unlock (Version B), not friction reduction (Version A)

**Decision**: OSMO enables workloads that CAN'T EXIST without multi-cluster orchestration, not just faster versions of existing workloads.

**Reasoning**: "Run SDG on CPU cluster, training on H100 cluster, eval on edge devices -- as one pipeline" is a capability only OSMO provides. "Submit jobs in 2 clicks instead of 20" can be replicated by any tool.

### D19: Ecosystem gravity, not data moat

**Decision**: Replace all "data moat" language with "ecosystem gravity." The flywheel data is fully open.

**Reasoning**: K8s/Linux model. Fully open, community-contributed. NVIDIA benefits from deepest integration. No lock-in, maximum adoption velocity.

### D20: Promise 2 of 6 opportunities in 2026, build substrate for all 6

**Decision**: Only self-healing and compliance are feasible in 2026. The others require accumulated telemetry (12-18 months) or market maturity.

**Reasoning**: Honest sequencing prevents over-promising. Phase 1 builds the substrate that enables all 6 over time.

### D21: Hybrid MCP + event hooks architecture

**Decision**: MCP for agent-initiated queries (pull), event hooks for push notifications (cluster health changed, run failed).

**Reasoning**: MCP alone is insufficient. Events the agent needs to know about but didn't ask for require a push mechanism.

### D22: Phase 1 tools valuable without flywheel

**Decision**: Phase 1 tools use hard-coded domain knowledge, not data-driven recommendations. The flywheel data (pipeline intelligence) takes 12-18 months to accumulate.

**Reasoning**: Cold-start reality. Tools must be useful on day 1. Historical telemetry makes them better over time but isn't required for initial value.

### D23: Vertical slice implementation

**Decision**: Implement thin through all 5 layers, not deep in one. Basic context + basic decisions + basic quality + basic continuity + basic meta-cognition > perfect context alone.

**Reasoning**: Only a full-stack slice proves the framework works end-to-end. Layers interact (quality gates need context routing, meta-cognition needs quality results). Real usage data guides deepening priorities.

### D24: Agent-agnostic: AGENTS.md convention, not Claude-specific

**Decision**: All framework files use the AGENTS.md convention (works with any agent runtime), not CLAUDE.md or any vendor-specific format.

**Reasoning**: Claude Code, Codex, kagent, and future agents all read AGENTS.md. Vendor lock-in on the framework defeats the market-maker model.
