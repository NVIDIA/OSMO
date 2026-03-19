# Six Market Opportunities

## Framing: Emergent Behaviors, Not Separate Products

These six opportunities are what emerges when capable AI agents get access to OSMO's primitives. They share the same substrate (OSMO MCP server + domain knowledge + infrastructure telemetry). Building the substrate enables all six; building any one individually misses the compound value.

**Honest sequencing**: Only 2 of 6 are feasible in 2026. The others require accumulated telemetry or market conditions that don't exist yet. Promise 2, build substrate for all 6.

---

## Phase 0: Dogfood on OSMO Development (NEW PREREQUISITE)

**Before any external opportunity**, prove the 5-layer AI-native framework on OSMO's own development.

**What this delivers**:
- Validated framework (Context, Decision, Quality, Continuity, Meta-cognition)
- DIF scripts that work for real tasks
- Evidence of human intervention reduction (target: <=2 per task)
- Credibility for external positioning

**Timeline**: 5-6 weeks for vertical slice + validation.

**Why this is Phase 0**: If the framework can't improve OSMO's own development, it won't work for Physical AI pipelines. This is the cheapest test of the core thesis.

---

## GTM Wedge: Scale Transition

The GTM entry point is NOT self-healing (too speculative for first engagement). It's **scale transition for existing OSMO users**.

| Trigger | User Experience | What OSMO Provides |
|---------|----------------|-------------------|
| 1 cluster -> 3 clusters | "How do I manage workloads across these?" | Multi-cluster orchestration |
| 8 GPUs -> 64 GPUs | "My training runs keep failing with topology issues" | GPU topology constraint solving |
| 1 team -> 5 teams | "Who's using what? Are we stepping on each other?" | Pool isolation, resource quotas |
| Prototype -> production | "I need compliance documentation and safety validation" | Workflow lineage, audit trails |

**Sequence**: Existing OSMO users first (3 months) -> case studies -> new teams at inflection points

---

## Overview

| # | Opportunity | Market Size (2030) | OSMO Fit | Feasibility |
|---|-----------|-------------------|----------|-------------|
| 1 | Self-Healing Training Infrastructure | $500M-1B | Extends existing operator code | **2026** |
| 2 | Autonomous Experiment Engine | $2.5-10B | OSMO workflows are agent-readable | 2027 |
| 3 | Sim-to-Real Confidence Agent | $400M | Greenfield, strongest data dependency | 2027 |
| 4 | RobotOps Platform | $2-5B | Full lifecycle, "Heroku for Physical AI" | 2027+ |
| 5 | Physical AI Compliance Autopilot | $1-3B | EU regulation deadline creates demand | **2026** |
| 6 | Multi-Team Orchestration Intelligence | $1-5B | Enterprise platform play | 2027+ |

---

## 1. Self-Healing Training Infrastructure (2026 FEASIBLE)

**The problem**: H100 clusters fail. NCCL timeouts, GPU ECC errors, NVLink degradation, OOM from memory leaks, checkpoint corruption. H100/H200 downtime costs $25-40K per GPU-day. Training runs routinely fail at hour 6 of 8 and restart from scratch.

**What exists**: OSMO's operator already monitors GPU health (nvidia-smi, tflops benchmark, stuck pod detection via `operator/utils/node_validation_test/`). Backend listener tracks cluster status in real-time via WebSocket. Clockwork.io does reactive migration. TorchFT enables per-step fault tolerance. FlashRecovery achieves 150-second restoration on 4,800 devices.

**The agent opportunity**: Predictive failure detection + autonomous remediation. The agent:
- Observes GPU telemetry and identifies degradation patterns
- Preemptively migrates workloads during checkpoint windows
- Resumes from checkpoints on healthy nodes
- Excludes failing nodes from scheduling
- Makes economic optimization decisions ("this run costs $12K less on cluster B")

**Why only OSMO**: Requires cross-cluster visibility, GPU topology knowledge for migration, checkpoint management (ctrl/user/rsync model), and pool-level resource awareness.

**Why 2026 feasible**: Extends existing operator code. Mostly intelligence on existing signals. Doesn't require accumulated telemetry -- uses hard-coded failure taxonomy.

**User story**: "My 64-GPU training run was going to crash at hour 14 because of an ECC error trend on node-7. OSMO migrated to node-12 during a checkpoint window. I didn't even notice."

---

## 2. Autonomous Experiment Engine (2027)

**The problem**: Physical AI research requires running hundreds of experiments -- varying SDG parameters, training hyperparameters, evaluation scenarios. Each is manually configured, launched, monitored, analyzed, and iterated.

**Why 2027, not 2026**: Requires accumulated telemetry (pipeline patterns, optimal configurations) to make intelligent experiment design decisions. Without historical data, the agent is just a YAML generator -- not enough value. Sequence: by agent capability maturity + telemetry accumulation.

**User story**: "I described my research question. The agent ran 47 experiments over the weekend, found that domain randomization of lighting matters 3x more than texture variation for my task, and presented the top 3 configurations with evidence."

---

## 3. Sim-to-Real Confidence Agent (2027)

**The problem**: Teams train policies in simulation, then discover they don't transfer to reality. A training run costs $50-200K in GPU-hours. Sim-to-real: NVIDIA's own data shows 64% success in training scene, 0% in novel scenes.

**Why 2027, not 2026**: Requires the strongest data dependency -- historical pipeline outcomes correlated with dataset characteristics. This is the flywheel opportunity but needs 12-18 months of telemetry accumulation.

**User story**: "The agent told me my synthetic data had a lighting distribution gap that would cause 40% drop in real-world performance. It recommended 2K additional scenes with adjusted lighting. Saved me 3 days of training and a week of debugging."

---

## 4. RobotOps Platform (2027+)

**The problem**: Software has CI/CD, staging, canary deploys, automated rollback. Physical AI has none. a16z: "the robotics equivalent of DevOps practices doesn't exist yet."

**Why 2027+**: Requires the full lifecycle to be instrumented. Edge deployment targets (Jetson, robot fleets) need OSMO integration that doesn't exist yet. Market needs to mature.

**User story**: "I pushed a new grasping policy. OSMO ran it through 500 sim scenarios, canary-deployed to 2 robots, detected a 15% regression in pick success rate, and auto-rolled back. All while I slept."

---

## 5. Physical AI Compliance Autopilot (2026 FEASIBLE)

**The problem**: EU Regulation 2023/1230 (effective January 2027) requires enhanced conformity assessments for robots with "self-evolving behaviour." No automated tooling exists. Current alternative: consultants and manual documentation, $500K-2M per product compliance engagement.

**Why 2026 feasible**: OSMO already tracks full workflow lineage. RBAC, audit logging, and versioned configurations provide the traceability foundation. The gap is mapping workflow data to regulatory requirements -- domain knowledge, not new infrastructure.

**Timing**: EU regulation effective Jan 2027 creates hard demand deadline. Teams will need compliance tooling by Q3-Q4 2026.

**User story**: "When the auditor asked for evidence that our manipulation policy was tested against all ISO 13482 scenarios, I showed them the OSMO compliance dashboard. Audit took 2 hours instead of 2 weeks."

---

## 6. Multi-Team Orchestration Intelligence (2027+)

**The problem**: Large Physical AI orgs have separate teams for perception, planning, control, simulation, data. Nobody tracks cross-team dependencies.

**Why 2027+**: Requires deep organizational adoption -- multiple teams on OSMO with enough history for pattern detection. Enterprise sales cycle + adoption depth makes this 2027+ at earliest.

**User story**: "Instead of discovering the integration failure weeks later, the agent notified us the day the perception model changed and automatically queued retraining of the downstream planning pipeline."

---

## Revised Sequencing

```
Phase 0 (Now):        Dogfood 5-layer framework on OSMO development
                      |
Phase 1 (Q2-Q3 2026): Self-Healing Training Infra + Compliance Autopilot
                      + OSMO MCP Server (the integration layer for everything)
                      |
Phase 2 (2027):       Autonomous Experiment Engine + Sim-to-Real Confidence
                      (requires accumulated telemetry)
                      |
Phase 3 (2027+):      RobotOps + Multi-Team Orchestration
                      (requires market maturity + organizational adoption)
```

**Why this sequence**: Phase 0 proves the framework. Phase 1 uses what exists (operator code + workflow lineage). Phase 2 builds on Phase 1 telemetry. Phase 3 requires market and adoption maturity.
