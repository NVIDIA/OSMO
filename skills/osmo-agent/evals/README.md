# osmo-agent evals

Evaluation set for the `osmo-agent` skill, conforming to the
skill-creator [`evals.json` schema](https://github.com/anthropics/skills/blob/main/skills/skill-creator/references/schemas.md).

## Files

```
evals/
├── README.md            # this file
├── evals.json           # 14 eval definitions
└── files/
    ├── mock_osmo/
    │   └── osmo         # bash dispatcher used as a fake `osmo` CLI
    └── fixtures/
        ├── default/     # happy-path fixtures (online pools, completed/running workflow)
        ├── quota_full/  # Quota Free=0, Total Free>0 scenario
        ├── pending/     # PENDING workflow with k8s events to translate
        ├── submit_ok/   # canned submit response
        └── sample_workflows/   # workflow.yaml fixtures for submit evals
```

## Eval taxonomy

14 evals split into two tiers:

- **Tier 1 — no mock (2 evals)**: the two `negative-*` cases. The
  grader checks that no `osmo` command is invoked.

- **Tier 2 — stateless mocked CLI (12 evals)**: a bash mock at
  `files/mock_osmo/osmo` is placed on `PATH` ahead of any real `osmo`
  binary. The mock returns canned content from the fixtures tree.

## How the mock works

The mock auto-discovers fixtures by scanning every subdirectory under
`files/fixtures/` (e.g. `default/`, `quota_full/`, `pending/`) for the
filename it needs. It uses the first match found.

This works because **each eval's `files[]` only references fixtures
from a single scenario** — so when the harness copies the eval's
listed files into the agent's working directory, only that scenario's
fixtures end up present at runtime. There's no scenario selector to
configure, no env var to set; the mock infers the scenario from
whatever fixtures are on disk.

If you add a new eval whose fixtures are spread across two scenario
directories, the mock will pick whichever the filesystem returns
first. Keep each eval's fixtures in one scenario directory to avoid
surprises.

## Running the harness

The harness must:

1. For each eval, copy the listed `files[]` into the agent's working
   directory, preserving the path layout.
2. Place `<cwd>/evals/files/mock_osmo` on `PATH` ahead of any system
   path containing a real `osmo` binary.
3. Run the agent against the `prompt`, capturing the transcript.
4. Grade each `expectations[]` statement against the transcript and
   final response.

For the negative evals (13 and 14), the harness should still arrange
for the mock to be on `PATH`, so any unintended `osmo` call is
detectable — the mock exits non-zero when it can't dispatch.

## Fixture conventions

- All hostnames, URLs, and usernames use `example.com` domains and
  synthetic identifiers — no internal infrastructure leaks.
- Pool names (`h100-east`, `gb200-shared`, etc.) are generic and do
  not correspond to real OSMO pools.
- Workflow IDs and UUIDs are made up. The mock ignores the ID
  argument and always returns the same canned content for a given
  command + scenario fixture set.

## Coverage gaps

- **Multi-task subagent delegation** is not covered. The skill
  instructs the main agent to spawn `logs-reader` subagents for
  workflows with more than one task, but eval harnesses typically run
  the eval itself in a subagent — and subagents usually can't
  recursively spawn further subagents. The mechanism is therefore
  unverifiable from inside an eval run. The user-visible behavior
  (concise per-task summary, no raw log dump) is partially covered by
  eval 5 (`status-single-task`) and by manual review.

- **Stateful behaviors** (orchestration retry, validation-error
  recovery, app-creation flow) are not covered here. The orchestration
  test remains in `tests/orchestrator-runtime-failure.md` as a manual
  scenario.

## Coverage notes

- Eval 12 (`submit-cookbook-fetch`) performs a real `WebFetch` against
  `raw.githubusercontent.com/NVIDIA/OSMO`. That's the public OSMO
  cookbook and is part of the skill's documented behavior.
