# OSMO Agent Strategy

**Thesis**: OSMO proves that complex development can be AI-native. The 5-layer framework (Context, Decision, Quality, Continuity, Meta-cognition) with DIF/LLM separation reduces human intervention from ~10+ per task to <=2. Dogfooded on OSMO's own development, generalizable to Physical AI pipelines and any domain. Fully open-source NVIDIA market-maker -- ecosystem gravity, not data moat.

---

## How to Read These Docs

**Start here.** Each linked file is self-contained. Recommended reading order:

### 1. Vision -- The Thesis and Why OSMO

| File | One-line summary |
|------|-----------------|
| [vision/thesis.md](vision/thesis.md) | The core argument: why AI-native development needs a framework, not just better models |
| [vision/why-osmo.md](vision/why-osmo.md) | OSMO's ecosystem position within NVIDIA stack, what NOT to build |
| [vision/personas.md](vision/personas.md) | Three personas sequenced: Developer (dogfood) -> Pipeline (product) -> Operator (integrate) |

### 2. Market -- Where and How Big

| File | One-line summary |
|------|-----------------|
| [market/landscape.md](market/landscape.md) | Competitive landscape with NVIDIA stack positioning |
| [market/opportunities.md](market/opportunities.md) | Six opportunities -- 2 feasible in 2026, with Phase 0 dogfood prerequisite |
| [market/physical-ai-gaps.md](market/physical-ai-gaps.md) | The 8-stage Physical AI loop and where it breaks |

### 3. Research -- What We Learned

| File | One-line summary |
|------|-----------------|
| [research/state-of-art.md](research/state-of-art.md) | Agent harness patterns from Anthropic, OpenAI, Datadog, Stripe + DIF integration |
| [research/landscape-analysis.md](research/landscape-analysis.md) | **NEW** — Full capability matrix: agent runtimes, MCP servers, frameworks, NemoClaw, superpowers |
| [research/prior-art.md](research/prior-art.md) | n8n, OpenManus, OpenShell, NemoClaw, OpenClaw -- lessons |
| [research/anti-patterns.md](research/anti-patterns.md) | What fails, what to avoid, proven failure modes |

### 4. Architecture -- How to Build It

| File | One-line summary |
|------|-----------------|
| [architecture/ai-native-framework.md](architecture/ai-native-framework.md) | **THE CORE DOCUMENT** -- the 5-layer framework with DIF/LLM separation |
| [architecture/critical-review.md](architecture/critical-review.md) | What was wrong with the original plan, how thinking evolved |
| [architecture/primitives.md](architecture/primitives.md) | OSMO's actual primitives today -- what exists in the codebase |
| [architecture/substrate-design.md](architecture/substrate-design.md) | Implementation architecture: vertical slice for OSMO dev + future Physical AI |

### 5. Decisions -- What We've Decided

| File | One-line summary |
|------|-----------------|
| [decisions/decided.md](decisions/decided.md) | 24 firm decisions with evidence |
| [decisions/open-questions.md](decisions/open-questions.md) | 9 refined open questions (strategic, technical, product) |
| [decisions/stress-test-findings.md](decisions/stress-test-findings.md) | 8 stress-test challenges and how they reshaped the strategy |

### Reference

| File | One-line summary |
|------|-----------------|
| [sources.md](sources.md) | Every URL and reference, organized by topic |

---

## Current Status

**Where we are**: Framework designed, vertical slice implementation in progress.

1. Strategy docs restructured to reflect evolved thesis (5-layer framework, DIF/LLM, market-maker model)
2. Vertical slice implementation underway: thin through all 5 layers on OSMO's own development
3. Next: validate end-to-end on real tasks, measure human interventions per task

## Key Decisions (Top 5)

| # | Decision | Rationale |
|---|----------|-----------|
| D11 | Dogfood first | Prove AI-native on OSMO development before external users |
| D12 | 5-layer framework | Context, Decision, Quality, Continuity, Meta-cognition -- covers full agent lifecycle |
| D13 | DIF/LLM separation | Default deterministic, escalate to LLM -- cheaper, more reliable, auditable |
| D14 | NVIDIA market-maker | Fully open-source code AND data -- K8s/Linux model |
| D24 | Agent-agnostic | AGENTS.md convention, not Claude-specific -- works with any agent runtime |

See [decisions/decided.md](decisions/decided.md) for all 24 decisions.

---

## How Thinking Evolved

```
Original plan (Mar 2026)
  "Build a 4,750-LOC agent harness with 25+ knowledge files,
   OpenShell/OpenClaw/NemoClaw integration, three personas"
        |
        v
Critical review
  "The plan couples to three alpha dependencies released the same week.
   It's a vision document masquerading as an architecture document."
        |
        v
Market + competitive analysis
  "Physical AI workflow orchestration has zero competitors.
   Most of the harness plan duplicates what existing tools already do."
        |
        v
The pivot: OSMO as agentic substrate
  "Don't build an agent. Build the substrate that makes any agent
   effective at Physical AI. Primitives + tools + domain knowledge
   = emergent capabilities."
        |
        v
Stress-testing + refinement
  "The substrate idea is right, but the moat isn't data flywheel --
   it's ecosystem position. The GTM isn't self-healing -- it's scale
   transition. And the biggest proof is dogfooding on OSMO itself."
        |
        v
The 5-layer AI-native framework
  "LLMs are capable enough. The bottleneck is the harness.
   5 layers x DIF/LLM separation. Dogfood on OSMO, then generalize."
```

---

*Last updated: March 2026. See [sources.md](sources.md) for all references.*
