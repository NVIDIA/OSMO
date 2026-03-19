# Three Personas -- Sequenced

## Sequencing

The original architecture proposed building all three personas simultaneously. Through stress-testing, the correct sequence emerged:

```
Phase 0 (Now):    Developer persona -- DOGFOOD
                  Prove the 5-layer framework on OSMO's own development
                       |
Phase 1 (After proof): Pipeline persona -- PRODUCT
                       Generalize framework to Physical AI pipelines
                       |
Phase 2 (Integrate):   Operator persona -- INTEGRATE
                       Integrate with kagent/Komodor/PagerDuty
```

**Why this sequence**: Developer is the proof (we control the test environment, fast iteration cycles). Pipeline is the product (the unique market opportunity). Operator is integration (strong incumbents exist -- don't compete, integrate).

---

## Persona A: The OSMO Developer (THE PROOF)

**Goal**: Ship features faster across Python + Go + TypeScript + Bazel + K8s

**Current pain**:
- Cross-stack changes require context-switching between languages and build systems
- Context is lost between sessions
- Verification is manual and slow
- 121 API routes across 7 service files to understand

**What the 5-layer framework provides**:

| Layer | What Developer Gets |
|-------|-------------------|
| **Context** | AGENTS.md hierarchy routes agent to relevant code. Decision tree maps task types to modules. Route-context script returns relevant files for any file path. |
| **Decision** | Coding standards enforced mechanically. Architecture boundaries checked by script. Agent hits a wall BEFORE making a mistake. |
| **Quality** | Quality-gate script: lint -> build -> test -> report. Agent proves correctness, doesn't assert it. |
| **Continuity** | Progress saved at end of session. Next session bootstraps from saved state. Zero human re-explanation needed. |
| **Meta-cognition** | Agent detects when it's stuck (iteration count, repetition). Changes strategy instead of spinning. |

**Why this persona is THE PROOF**: If the framework can't improve AI-assisted development of OSMO itself -- a complex multi-language, multi-service platform -- it won't work for Physical AI pipelines either. OSMO's own development is the hardest test case we control.

**Recommendation**: **Build the vertical slice.** This is NOT "do nothing" (the original recommendation). Claude Code + AGENTS.md is the starting point, not the end state. The 5-layer framework adds deterministic infrastructure (DIF scripts, decision trees, quality gates) that makes any agent runtime more effective.

**Success metric**: Human interventions per task. Target: <=2 (from current ~10+).

---

## Persona B: The OSMO Operator (INTEGRATE)

**Goal**: Keep OSMO healthy, respond to incidents fast, deploy safely

**Current pain**:
- Manual runbook execution (existing runbooks: `runbooks/osmo-services.md`, `runbooks/osmo-backends.md`, `runbooks/osmo-database.md`)
- Correlating alerts with recent changes across distributed services
- Slow root-cause analysis
- Destructive production operations require expertise

**What an agent solves**:
- Alert fires -> agent triages: gathers context (logs, metrics, recent deploys, K8s state)
- Correlates events -> proposes remediation
- Executes approved actions with audit trail

**Recommendation**: **Integrate, don't build.** Use kagent, Komodor, or PagerDuty AI -- they have production-hardened K8s knowledge from thousands of clusters. OSMO should:
1. Expose backend status and health data via standard interfaces (Prometheus metrics, K8s events)
2. Structure existing runbooks for agent consumption
3. Add PagerDuty MCP integration (production-ready)
4. Add Grafana MCP integration (more mature than Prometheus MCP)

**Why not build more**: Komodor achieves 95% accuracy on real-world K8s incident resolution. Building a custom operations agent would be competing with specialists who have years of production telemetry.

**Trust boundary note**: An operator agent that runs the wrong remediation crashes production. This requires careful destructive-action taxonomy and approval workflows. Consensus for 2026: "AI recommends, humans approve, systems execute, every step logged and explainable."

**Timing**: After pipeline persona is proven. Operator integration benefits from the framework but doesn't drive it.

---

## Persona C: The Physical AI Pipeline User (THE PRODUCT)

**Goal**: Run training, simulation, and data generation workflows and iterate fast

**Current pain**:
- Manual workflow design (YAML from scratch)
- No autonomous retry on failure
- No pipeline chaining (SDG -> train -> eval) with intelligent resource selection
- No prediction of whether synthetic data will transfer to reality
- No CI/CD for robot policies
- No closed-loop feedback from deployment back to training

**What the 5-layer framework provides**:

| Layer | What Pipeline User Gets |
|-------|----------------------|
| **Context** | MCP tools with rich responses teach pipeline semantics. Templates for common patterns. |
| **Decision** | Safety guardrails: cost caps, resource limits, topology constraints. Agent can't submit a job that exceeds budget. |
| **Quality** | Pipeline validation: verify stage outputs before next stage. Checkpoint integrity checks. |
| **Continuity** | Multi-hour pipeline state. Resume from checkpoint on failure. Cross-stage handoff. |
| **Meta-cognition** | Training not converging? Agent detects divergence and suggests strategy change. |

**Recommendation**: **BUILD THIS** -- after proving the framework on OSMO development (Persona A).

This is the only persona where OSMO has unique data, unique domain knowledge, and a defensible position. No combination of Manus + Argo + Prometheus can replicate an agent that understands GPU topology constraints, multi-stage Physical AI pipelines, heterogeneous backend orchestration, and dataset lifecycle management across 6 storage backends.

**User stories**:

> "I described my research question. The agent ran 47 experiments over the weekend, found that domain randomization of lighting matters 3x more than texture variation for my task, and presented the top 3 configurations with evidence."

> "My 64-GPU training run was going to crash at hour 14 because of an ECC error trend on node-7. OSMO migrated to node-12 during a checkpoint window. I didn't even notice."

> "The agent told me my synthetic data had a lighting distribution gap that would cause 40% drop in real-world performance. It recommended 2K additional scenes with adjusted lighting. Saved me 3 days of training and a week of debugging."

> "I pushed a new grasping policy. OSMO ran it through 500 sim scenarios, canary-deployed to 2 robots, detected a 15% regression in pick success rate, and auto-rolled back. All while I slept."

**Timing**: After Persona A proves the framework. Estimated: 3-6 months after vertical slice validation.
