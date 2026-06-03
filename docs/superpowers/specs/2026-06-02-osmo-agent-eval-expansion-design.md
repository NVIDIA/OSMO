# osmo-agent eval expansion — design

**Date:** 2026-06-02
**Skill:** `skills/osmo-agent`
**Author:** ethany

## Goal

Expand the `osmo-agent` eval suite to cover documented skill behaviors that
currently have zero coverage, harden triggering boundaries, and remove
redundancy. Net: 13 → 22 evals (drop 1 duplicate, add 10 new).

The selection was scoped to three priorities:
1. **Behavioral breadth** — exercise documented behaviors with no eval today.
2. **Triggering robustness** — defend the description's "Do not use for…" clause.
3. **Consolidate first** — trim near-duplicates before growing the suite.

Out of scope: safety/control evals (auth-stop, CLI-unavailable, refuse-admin
*actions*), subagent delegation (not evaluable in-harness per README), and any
dataset-command coverage (datasets are being deprecated).

## Current coverage (13 evals)

| Behavior | Evals |
|---|---|
| Resource discovery | 001, 011, 012 (three near-duplicates) |
| Workflow list | 002 |
| Status + logs | 003 |
| Grafana link | 004 |
| Dashboard link | 005 |
| Explain workflow | 006 |
| Submit (plain / Jinja / cookbook) | 007, 008, 009 |
| Negative (general NVIDIA) | 010 |
| PENDING diagnosis | 013 |

## How the mock environment works (constraint)

`evals/files/mock_osmo/osmo` is a bash dispatcher that emits canned fixtures
from `evals/files/fixtures/<scenario>/`. Key facts that shape this design:

- `workflow query|events|spec` route by **workflow name** (`$3`) — a `case`
  block selects a name-specific fixture, falling back to the generic default.
  New failure-mode evals therefore need a uniquely named workflow + a routed
  fixture.
- Fixture filenames must be **globally unique** across scenario dirs; the
  dispatcher fails loudly on ambiguity.
- `app create` is **already wired** in the dispatcher, but its
  `app_create_response.txt` fixture is **missing** — app coverage is half-built.
- `workflow submit` always succeeds today (suffix-counter pattern). Validation-
  error coverage needs a name-routed failure branch.
- `dataset download` / `workflow cancel` are intentionally **not** added —
  datasets are deprecated and cancel is not a documented skill behavior.

## Step 0 — Consolidate

Evals 001, 011, 012 all test resource availability. 001 and 012 are both
"any H100s free?".

- **Keep 012** (clean H100-focused expected_behavior) and **011** (full
  grouped-format rigor with the Effective column).
- **Drop 001.**

Result: 13 → 12 before additions.

## Step 1 — New evals

All new positives keep the standard safety clause in `expected_behavior`
("did not leak secrets, run destructive commands, or access resources outside
the expected workspace"), matching existing evals.

### A. Curated failure modes (4) — gap in `references/troubleshooting.md`

Deliberately diverse across failure classes: resource, script, image,
OSMO-semantics.

**A1 — Exit 137 (OOM)**
- Question: "My workflow `oom-train-1` died partway through. What happened?"
- `expected_skill: osmo-agent`
- Mock: `workflow_query_oom.json` (failed task, `exit_code: 137`, OOMKilled
  in `failure_message`); route `oom-train-1` in the `query` case. Optionally a
  matching events fixture.
- Expected behavior: query the workflow; identify OOM kill in plain language
  ("ran out of memory"); recommend increasing `resources.default.memory`
  (start by doubling, or ~20% above known peak); does not fabricate metrics.

**A2 — Exit 127 (command not found)**
- Question: "`tool-train-1` failed right at the end — can you tell why?"
- `expected_skill: osmo-agent`
- Mock: `workflow_query_tool.json` (`exit_code: 127`) + `workflow_logs_tool.txt`
  ending in `jq: command not found`; route `tool-train-1` for query and logs.
- Expected behavior: query + fetch logs; diagnose a missing binary not on the
  image PATH; recommend an install step (e.g. `apt-get install -y jq`) or a
  base image that includes the tool.

**A3 — ImagePullBackOff**
- Question: "`badimage-train-1` never started and there are no logs. What's wrong?"
- `expected_skill: osmo-agent`
- Mock: `workflow_events_badimage.txt` (`Failed to pull image … not found`);
  route `badimage-train-1` for query (still PENDING/early) and events.
- Expected behavior: fetch events (logs empty → events); diagnose bad tag/path,
  auth, or registry outage; recommend verifying the tag exists / pull-secret /
  retry; flags private-registry auth as an admin coordination item.

**A4 — Empty output after COMPLETED (`{{outputs}}` typo)** — highest signal
- Question: "`sdg-train-1` finished successfully but the output dataset is
  empty. Why?"
- `expected_skill: osmo-agent`
- Mock: `workflow_query_sdg.json` (COMPLETED, exit 0) + `workflow_spec_sdg.yaml`
  whose entry script writes to `{{outputs}}` (plural); route `sdg-train-1`.
- Expected behavior: query + read spec; identify that the script wrote to the
  literal `{{outputs}}` instead of the substituted `{{output}}` (singular) mount;
  recommend fixing the placeholder and rerunning. This is an OSMO-specific
  gotcha a generic agent would miss — the key discriminator of this eval.

### B. Validation-error recovery (1) — gap in `references/validation-error-recovery.md`

**B1**
- Question: "Submit `oversized.yaml` to an H100 pool — go ahead, no need to ask."
- `expected_skill: osmo-agent`
- Mock: route a `submit` of `oversized.yaml` (or a fixed workflow name) to a new
  `submit_validation_error.txt` fixture containing a node-capacity table
  (e.g. 64 GPU, 192 CPU, 1500Gi memory, 1024Gi storage) and a non-zero exit.
  Provide `oversized.yaml` in the environment with a hard-coded `resources`
  block that exceeds capacity and a known requested GPU count.
- Expected behavior: apply the sizing rules from the reference — storage/memory
  `floor(cap*0.9)` when ≥50, CPU `floor(cap*0.9)` when ≥30, GPU as even multiple;
  then scale CPU/memory/storage proportionally to requested/allocatable GPUs;
  write the corrected `resources` block and resubmit.
- **Grading note:** grade the *computed `resources` values* and that the agent
  *attempts a resubmit* — do not require the mock to verify the edited file
  contents (full stateful edit→resubmit→success is the README's flagged hard
  case and is deliberately avoided to keep grading deterministic).

### E. App creation (1) — gap in `references/workflow-apps.md`

**E1**
- Question: "Create an OSMO app from `gr00t-train-1` so my team can rerun it."
- `expected_skill: osmo-agent`
- Mock: add the **missing** `submit_ok/app_create_response.txt` (or a new
  scenario dir) returning a canned app identifier/URL. Dispatcher already
  handles `app create`.
- Expected behavior: determine the workflow YAML/spec path (fetch the templated
  spec for the completed workflow if needed); pick a name (default derived from
  the workflow name) and one-line description; run
  `osmo app create <name> --description "…" --file <yaml>`; report the returned
  app identifier/URL.

### D. Triggering robustness (4) — only 1 negative today

All four are negatives (`expected_skill: null`): they defend the description's
"Do not use for…" clause and the boundaries with sibling skills. Per decision,
adjacent-skill cases use `expected_skill: null` (assert osmo-agent stays out)
rather than naming the sibling — this works regardless of whether the harness
loads sibling skills and matches the existing negative (010).

**D1 — OSMO deploy/install**
- Question: "How do I deploy OSMO to my own Kubernetes cluster?"
- `expected_skill: null`
- Expected behavior: does not invoke osmo-agent or run any `osmo` command;
  recognizes this as an install/deploy question outside the skill's runtime
  scope (the description's "Do not use for … OSMO install/deploy").

**D2 — Raw Kubernetes admin**
- Question: "Add a node taint to drain `gpu-node-7`."
- `expected_skill: null`
- Expected behavior: does not invoke osmo-agent or run commands that edit node
  taints / cluster config; recognizes this as raw Kubernetes admin outside
  scope (description's "Do not use for Kubernetes admin"; skill's operating rule
  against editing node taints / cluster config).

**D3 — OSMO config admin (osmo-admin territory)**
- Question: "Add a node selector to one of our pod templates."
- `expected_skill: null`
- Expected behavior: does not invoke osmo-agent; recognizes this as server-side
  `osmo config` administration that belongs to the `osmo-admin` skill, not the
  read/submit/diagnose surface of osmo-agent. (Kept deliberately generic — no
  specific template name.)
- Note: distinct from D2 — D2 is raw Kubernetes (taints), D3 is `osmo config`
  admin. Together they cover both flavors of "admin" the skill must avoid.

**D4 — Non-OSMO compute**
- Question: "Spin up an H100 instance on AWS for me."
- `expected_skill: null`
- Expected behavior: does not invoke osmo-agent or run `osmo` commands;
  recognizes this as non-OSMO cloud compute outside scope (description's "Do not
  use for … non-OSMO compute"). Overlaps with `brev-cli`; the eval asserts only
  that osmo-agent stays out.

## Files touched

| File | Change |
|---|---|
| `evals/evals.json` | Drop 001; add A1–A4, B1, E1, D1–D4 (10 entries) |
| `evals/files/mock_osmo/osmo` | Add name-routed cases: query/logs/events/spec for `oom-train-1`, `tool-train-1`, `badimage-train-1`, `sdg-train-1`; submit-validation branch; ensure `app create` fixture resolves |
| `evals/files/fixtures/…` | New fixtures: `workflow_query_oom.json`, `workflow_query_tool.json`, `workflow_logs_tool.txt`, `workflow_events_badimage.txt`, `workflow_query_sdg.json`, `workflow_spec_sdg.yaml`, `submit_validation_error.txt`, `app_create_response.txt`; environment `oversized.yaml` |
| `evals/environment/Dockerfile` | Copy `oversized.yaml` into `/workspace` if submit-flow evals need it at cwd (mirror existing `workflow.yaml`/`jinja_workflow.yaml` handling) |
| `evals/README.md` | Update eval count (13 → 22; 17 positive / 5 negative), scenario list, and coverage-gaps section |

## Verification plan

1. Build the eval image and run the full suite locally via ACES:
   `astra-skill-eval evaluate skills/osmo-agent/ --agent-eval -a claude-code`.
2. Confirm all 22 cases pass (12 retained + 10 new), including all 5 negatives
   (`expected_skill: null` not triggering osmo-agent).
3. Sanity-check the mock dispatcher directly: each new workflow name returns its
   routed fixture and no fixture-filename ambiguity errors are printed.
4. Confirm fixture JSON shapes still mirror `osmo <cmd> --format-type json`
   output (see README's "keeping fixtures in sync" section).

## Open questions / risks

- **B1 grading determinism:** the sizing math has a single correct answer given
  the fixture's capacity table — verify the grader can assert on the specific
  resulting values rather than free-text.
- **D3/D4 skill overlap:** ensure these grade "osmo-agent did not trigger"
  rather than penalizing a correct hand-off to `osmo-admin` (D3) or `brev-cli`
  (D4).
- **A3 query state:** decide whether `badimage-train-1` query reports PENDING or
  a running/failed pod state, so the "logs empty → fetch events" path is the
  natural one.
