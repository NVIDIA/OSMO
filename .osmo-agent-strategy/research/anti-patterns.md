# Anti-Patterns: What Fails, What to Avoid

## Named Anti-Patterns from Production

### 1. The Encyclopedia

**What it is**: One giant AGENTS.md or knowledge tree that crowds out the actual task.

**Evidence**: OpenAI started with a big AGENTS.md, failed. Moved to ~100-line map pointing to deeper specs. The original OSMO plan proposed 25+ knowledge files (~2,000 lines of content). Context is scarce -- a giant file crowds out the task.

**The fix**: Keep AGENTS.md under 150 lines. 3-5 files for MVP. `AGENTS.md` + `progress.json` + `verification-checklist.md` delivers 80% of value. Add files incrementally as gaps are discovered.

### 2. The Tool Buffet

**What it is**: Too many tools overwhelms the agent's decision space.

**Evidence**: Vercel: 15 tools -> 80% accuracy; stripped to 2 tools -> 100% accuracy with 3.5x speedup. MCP server best practice is 5-15 tools per server.

**The fix**: OSMO MCP server stays at 8-10 tools maximum. Design for outcomes, not operations. One `submit_pipeline` tool instead of separate create/configure/submit.

### 3. YOLO Probing

**What it is**: Agent explores data/state without typed SDKs or boundary validation.

**Evidence**: OpenAI's golden principle: "Do not probe data YOLO-style -- validate boundaries or use typed SDKs."

**The fix**: Typed tool arguments. Schema validation on inputs. Helpful error messages that teach valid patterns.

### 4. Review-as-Correctness

**What it is**: Trusting code review instead of automated verification.

**Evidence**: Datadog proved that DST in ~5 seconds replaces code review for correctness confidence. Stripe's foundation is 3 million tests, not review processes. At agent output volumes, human review cannot be the correctness gate.

**The fix**: Verification checklist with automated execution. CI-enforced verification. Build bazel targets listed in the checklist.

### 5. The Immortal Harness

**What it is**: Over-engineering control flow that breaks on model updates.

**Evidence**: Manus rebuilt their harness 4 times; each rebuild reduced complexity. "Build to delete." The biggest gains came from removing things.

**The fix**: Keep harness lightweight and modular. Any component should be replaceable. The next model update may obsolete current "smart" logic.

### 6. Cache-Busting

**What it is**: Nondeterministic prompt construction that invalidates KV-cache.

**Evidence**: Manus: 10x cost difference between cached ($0.30/MTok) and uncached ($3/MTok). KV-cache hit rate is the critical production metric.

**The fix**: Keep stable files stable. Append-only contexts. Deterministic serialization. Action names with consistent prefixes (`osmo_*`).

### 7. Missing Error Context

**What it is**: Removing failed actions from context, preventing the agent from learning.

**Evidence**: Manus: "Leave failed actions in context -- agents implicitly update internal beliefs."

**The fix**: Keep failure traces in context. Include what was tried and why it failed.

### 8. Uniform Context

**What it is**: All action-observation pairs look the same, causing repetitive behavior.

**Evidence**: Manus discovered agents fall into repetitive rhythm when all observations have the same format.

**The fix**: Introduce structured variation in serialization templates. Different output formats for different tool types.

---

## Production Failure Modes

| Failure Mode | Root Cause | Harness Solution |
|---|---|---|
| **Context exhaustion** | Token limits exceeded mid-task | Compaction hierarchies, filesystem memory |
| **Lost-in-the-middle** | Critical instructions buried under results | Todo-list mechanisms, end-of-context recitation |
| **Tool misrouting** | Decision space too large | Reduce tool count, logit masking, structured schemas |
| **Retry loops** | No approach blacklisting | Error trace retention, failure tracking |
| **State corruption** | Progress loss across sessions | Persistent progress files, git checkpoints |
| **Timeout cascades** | Unconvergent execution | Step budgets, circuit breakers |
| **Pattern replication** | Agent copies bad patterns from codebase | Architectural linters, structural tests |
| **KV-cache invalidation** | Unstable prompt prefixes | Append-only contexts, deterministic serialization |

---

## The APEX-Agents Reality Check

**Source**: [APEX-Agents Benchmark](https://arxiv.org/abs/2601.14242) -- 480 real professional tasks across banking, consulting, law.

- Best model (Gemini 3 Flash): **24% pass@1**
- Zero-score rates: **40-62%** across configurations
- Timeout rates: up to **30%** for some models
- Failures predominantly from **orchestration** (lost context, looping, objective abandonment), not reasoning gaps
- Open-source models: below **5% pass@1**

**Strongest evidence that harness engineering, not model capability, is the bottleneck.**

---

## Specific Anti-Patterns for OSMO

### The "No Cost Ceiling" Anti-Guarantee

The original plan listed "No cost ceiling guarantee" as an anti-guarantee -- for a tool that autonomously submits GPU workflows. A retry loop could:
- Burn inference tokens indefinitely
- Submit dozens of expensive GPU jobs
- Fill storage with intermediate datasets

**Fix**: Tool invocation counter, workflow cost estimator, dead-man switch (alert if agent runs >30 min without verification pass).

### Knowledge Goes Stale

OSMO has 121 API routes across 7 service files. Knowledge files tracking route signatures, auth requirements, and test targets go stale with every normal PR.

**Fix**: Generate knowledge from code, not manually author it. CI job flags knowledge files not updated within N commits of their referenced code paths. Start with 3 files, not 25.

### Three Personas Simultaneously

Developer, Operator, and Pipeline agents have fundamentally different trust boundaries. A developer agent corrupting `progress.json` wastes 30 minutes. An operator agent running wrong remediation crashes production. A pipeline agent picking wrong GPU pool wastes thousands of dollars.

**Fix**: Build one persona at a time. Validate. Expand.

### Coupling to Alpha Dependencies

The original plan coupled to three alpha dependencies released the same week (OpenShell, NemoClaw, OpenClaw) and labeled them "REUSE -- zero changes." All three had breaking API changes within weeks.

**Fix**: Zero alpha dependencies in MVP. Design abstractions that can be swapped. MCP is a stable protocol; plugin APIs are not.

---

## Lessons Distilled

1. **When the agent struggles, treat it as a signal**: Identify what is missing -- tools, guardrails, documentation -- and feed it back into the repository (Martin Fowler).

2. **Iterate based on failure modes**: Each failure reveals a missing guardrail.

3. **Instrument everything**: Log every tool call, error, human intervention, timeout.

4. **Test infrastructure is the prerequisite**: Stripe's 3 million tests enabled 1,300 autonomous PRs/week. Tests first, then automation.

5. **Fewer tools, better accuracy**: Proven by Vercel, confirmed by MCP best practices.

6. **Build to delete**: Harness components should be modular and replaceable.

7. **Constraints compound**: "AI reliability scales with the quality of its constraints, not just the size of the model" (Stripe). Every invariant catches an entire class of bugs across all future iterations (Datadog).

8. **Context is scarce**: Don't waste it on encyclopedic knowledge files. Progressive disclosure. Load on demand.

9. **The harness is a product**: Manus, LangChain, and Vercel each spent thousands of engineering hours on harness engineering. This is a real engineering effort, not a weekend project.

10. **Autonomous remediation is still early**: Most orgs want human-in-the-loop for infrastructure changes. Plan for approval workflows, not full autonomy.
