# Open Questions

Refined through stress-testing. Many original questions are now answered (see bottom). These remain unresolved.

---

## Strategic

### Q1: Which existing OSMO users are best candidates for scale-transition proof?

The GTM wedge is scale transition for existing users. Which specific teams are at inflection points (moving to multi-cluster, scaling GPU count, adding teams)?

**Depends on**: Current user base analysis, customer conversations.

### Q2: What DIF mechanisms exist in current agent harnesses we can reuse?

Claude Code, Codex, and kagent all have deterministic infrastructure. What pre/post-hooks, file routing, and verification patterns already exist that we should integrate with rather than replace?

**Depends on**: Detailed analysis of each agent runtime's extension points.

### Q3: How to measure DIF-to-LLM escalation ratio per layer?

The framework claims ~85% DIF / ~15% LLM overall. How do we instrument this to verify the ratio and optimize it?

**Depends on**: Instrumentation design, telemetry collection from agent sessions.

---

## Technical

### Q4: MCP server deployment model (separate process, sidecar, embedded)?

Options:
- **Separate process**: stdio MCP server that wraps OSMO's HTTP API. Simplest. Decoupled.
- **Sidecar**: Runs alongside core service, shares database connection. Lower latency.
- **Embedded**: MCP endpoints in core service alongside REST. Most integrated.

**Depends on**: Deployment model, latency requirements, operational complexity tolerance.

### Q5: What OSMO state changes trigger event hooks?

The hybrid MCP + event hooks architecture (D21) needs specific triggers. Candidates:
- Cluster health degraded (GPU ECC errors)
- Training run failed (non-zero exit)
- Resource availability changed (pool freed GPUs)
- Checkpoint completed
- Cost threshold exceeded

What is the minimal set of triggers for Phase 1?

**Depends on**: Analysis of which events are most actionable for agents.

### Q6: How to detect agent spinning reliably?

Meta-cognition layer needs to detect when agents are stuck. Options:
- **Iteration count**: More than N attempts at same approach
- **Time budget**: More than N minutes without progress
- **Repetition patterns**: Same tool call with same args 3x
- **Output similarity**: Agent producing similar outputs across iterations

Which signals are most reliable? How to avoid false positives?

**Depends on**: Empirical data from running the framework on real tasks.

---

## Product

### Q7: Community strategy for Physical AI (small, secretive teams)?

Physical AI teams tend to be small and secretive about their approaches. Open-source community strategy needs to account for this -- teams may use OSMO without contributing back.

**Depends on**: Understanding of community dynamics in robotics/Physical AI space.

### Q8: Concrete Isaac/Omniverse integration surface in MCP tools?

OSMO orchestrates workflows that use Isaac Sim, Omniverse, etc. What specific MCP tool interactions enable this? Example: `osmo_submit_workflow` with an Isaac Sim training job -- does the tool need Isaac-specific validation?

**Depends on**: Technical analysis of Isaac Sim / Omniverse job submission APIs.

### Q9: Success metrics: GPU-hours orchestrated, time-to-production, human-interventions-per-task?

Three candidate metrics. Which is primary?
- **GPU-hours orchestrated**: Best proxy for NVIDIA value, hardest to measure externally
- **Time-to-production**: Best user value metric, harder to attribute to OSMO
- **Human-interventions-per-task**: Best framework effectiveness metric, easiest to measure

**Depends on**: Which stakeholder audience the metrics serve (NVIDIA leadership, users, framework team).

---

## Answered (From Original List)

| Original Question | Answer | Decision |
|---|---|---|
| "Which of the six opportunities resonates most?" | Scale transition is the wedge. Self-healing + compliance in 2026. | D15, D20 |
| "Pure substrate vs. embedded intelligence?" | 5-layer framework -- neither pure substrate nor embedded. DIF infrastructure + LLM escalation. | D12, D13 |
| "MCP server, not plugin?" | Yes, MCP server. Agent-agnostic. | D3, D24 |
| "Start with self-healing?" | No, start with dogfood (Phase 0). Self-healing is Phase 1. | D11, D15 |
| "Open-source model?" | Fully open, market-maker. Ecosystem gravity, not data moat. | D14, D19 |
| "Multi-tenant telemetry?" | Fully open data. No proprietary telemetry. | D19 |
| "How should failure taxonomy be bootstrapped?" | Hard-coded domain knowledge for Phase 1 (D22). Data-driven after telemetry accumulates. | D22 |
| "Long-running agent sessions?" | Hybrid MCP + event hooks (D21). Agent doesn't maintain single session. | D21 |
| "Approval workflow for destructive actions?" | "AI recommends, humans approve, systems execute, every step logged." | Consensus for 2026 |
| "When to reconsider OpenShell?" | When it reaches beta with stable API guarantees (est. 6-12 months from March 2026). | D5 |
