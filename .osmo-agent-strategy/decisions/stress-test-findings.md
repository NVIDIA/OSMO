# Stress-Test Findings

Eight challenges were posed to stress-test the strategy. Each reshaped the thinking. This document records the challenges, the findings, and how they changed the plan.

---

## Challenge 1: "No Competitors" Is Suspicious

**Challenge**: Zero competitors in Physical AI workflow orchestration sounds like zero market, not zero competition.

**Finding**: Under the NVIDIA market-maker model, this is actually safe. OSMO doesn't need to prove a market exists through competitor validation -- it needs to prove GPU demand exists. Physical AI is industrializing (GTC 2026 evidence), teams are building pipelines, and those pipelines need orchestration. The risk of "no market" is mitigated because OSMO's success metric is GPU-hours orchestrated, not software revenue.

**Impact**: Reframed competitive analysis from "defensibility against competitors" to "adoption velocity as market-maker."

## Challenge 2: Pain Is Latent, Not Acute

**Challenge**: Physical AI teams don't know they need workflow orchestration until they hit scale. How do you sell to latent pain?

**Finding**: The GTM wedge is scale transition, not self-healing. Teams already using OSMO at small scale are the entry point. When they go from 1 cluster to 3, from 8 GPUs to 64, from 1 team to 5 -- that's when orchestration pain becomes acute. The wedge is helping existing users through that transition, not finding new users with acute pain.

**Impact**: Changed GTM from "start with self-healing" to "start with scale transition for existing users." Self-healing is a capability within the wedge, not the wedge itself.

## Challenge 3: "All Triggers" Is a Positioning Weakness

**Challenge**: If OSMO triggers on everything (scale, compliance, multi-team, self-healing), it triggers on nothing. What's the specific positioning?

**Finding**: The positioning is: "How Physical AI goes from research to production fleets." This is specific enough to be meaningful and broad enough to be true. Within that, the differentiator within the NVIDIA stack is multi-cluster heterogeneous orchestration -- no other NVIDIA tool does this.

**Impact**: Added specific positioning statement and NVIDIA stack differentiator to strategy.

## Challenge 4: Only 2 of 6 Opportunities Feasible in 2026

**Challenge**: The original plan implied all six opportunities were near-term. Reality check: what's actually buildable?

**Finding**: Only self-healing (Opportunity 1) and compliance (Opportunity 5) are feasible in 2026, because they depend primarily on existing OSMO primitives plus domain knowledge. The others (autonomous experiments, sim-to-real confidence, RobotOps, multi-team) require accumulated telemetry or market conditions that don't exist yet.

**Impact**: Revised sequencing to be honest about timelines. Added Phase 0 (dogfood) as prerequisite. Changed from "start with self-healing" to "promise 2 of 6 in 2026, build substrate for all 6."

## Challenge 5: Data Flywheel Is Not a Moat

**Challenge**: The "data flywheel" framing assumes proprietary data creates defensibility. Under the market-maker model (fully open), there's no proprietary data.

**Finding**: Reframe from "data moat" to "ecosystem gravity." The flywheel still exists (every pipeline run makes tools smarter) but the data is fully open. The defensibility comes from ecosystem position, not data lock-in. Like Kubernetes -- the project is fully open, but the company with deepest integration (Google -> GKE, then others) benefits most.

**Impact**: Replaced all "data moat" language with "ecosystem gravity." Changed flywheel from competitive moat to community asset.

## Challenge 6: MCP Alone Is Insufficient

**Challenge**: MCP tools are agent-initiated (pull model). What about events the agent needs to know about but didn't ask for?

**Finding**: Need a hybrid MCP + event hooks architecture. MCP for agent-initiated queries ("what's the cluster health?"). Event hooks for push notifications ("cluster health just changed," "training run just failed"). Both are needed for a complete interaction model.

**Impact**: Added hybrid architecture decision (D21). Updated substrate-design.md to include event hooks alongside MCP tools.

## Challenge 7: Phase 1 Timeline Is 5-6 Weeks, Not 3

**Challenge**: The original "3-week Phase 1" was optimistic. Realistic estimate?

**Finding**: With the vertical slice approach (thin through all 5 layers), realistic timeline is 5-6 weeks. Week 1-2: strategy restructure + foundation scripts. Week 3-4: service AGENTS.md files + decision enforcement. Week 5-6: meta-cognition + validation on real tasks.

**Impact**: Updated implementation plan to reflect honest timeline.

## Challenge 8: Multi-Cluster Heterogeneous Is THE Differentiator

**Challenge**: Within the NVIDIA stack (Isaac Sim, Omniverse, NIM, Data Factory), what specifically does OSMO do that nothing else does?

**Finding**: Multi-cluster heterogeneous orchestration. Isaac Sim manages simulation on one cluster. Omniverse manages digital twins. NIM manages inference. Data Factory manages data generation. OSMO is the connective tissue that orchestrates workflows ACROSS these tools, across multiple clusters with different GPU types and configurations. No other NVIDIA tool does this.

**Impact**: Added explicit NVIDIA stack positioning (D17). OSMO = connective tissue underneath Isaac/Omniverse/NIM/Data Factory.

---

## Deep-Dive Findings

### NVIDIA Stack Positioning

OSMO sits underneath the domain-specific tools:

| NVIDIA Tool | What It Does | OSMO's Relationship |
|-------------|-------------|---------------------|
| Isaac Sim | Simulation | OSMO orchestrates sim jobs across clusters |
| Omniverse | Digital twins, collaboration | OSMO manages compute for Omniverse workloads |
| NIM | Model inference | OSMO schedules inference alongside training |
| Data Factory | SDG pipelines | OSMO orchestrates the Data Factory pipeline execution |
| Isaac ROS | Robot middleware | OSMO manages edge deployment targets |
| CUDA | GPU programming | OSMO ensures correct GPU allocation for CUDA workloads |

**Positioning**: Each tool creates GPU-hours on one cluster. OSMO creates GPU-hours across clusters.

### Flywheel Mechanics Under Market-Maker Model

Three data layers, all fully open:

1. **Execution telemetry**: GPU utilization, failure rates, scheduling decisions. Generated automatically.
2. **Agent interactions**: Which tools are called, in what sequences, for what outcomes. Generated by agent usage.
3. **Pipeline intelligence**: Which configurations produce good results. Accumulated over months.

**Cold-start reality**: Layers 1-2 are immediate. Layer 3 requires 12-18 months of production data. Phase 1 tools must be valuable WITHOUT Layer 3 (hard-coded domain knowledge, not data-driven recommendations).

### DIF Integration Into Framework

The DIF/LLM separation emerged from stress-testing the framework layers:

- **Initial assumption**: Each layer needs LLM reasoning
- **Finding**: Most layer work is deterministic. File routing is grep. Constraint checking is scripting. Verification is running tests. Progress tracking is reading/writing files.
- **Conclusion**: Default to DIF, escalate to LLM. This makes the framework cheaper, faster, and more reliable. LLM tokens should be spent on actual reasoning (writing code, making design decisions), not on infrastructure tasks that a shell script handles better.

See [ai-native-framework.md](../architecture/ai-native-framework.md) for the full DIF/LLM table.
