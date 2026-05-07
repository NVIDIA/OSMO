# osmo-agent evals

Evaluation set for the `osmo-agent` skill, written against the NVIDIA
internal eval schema (`question` / `expected_skill` / `expected_script` /
`ground_truth` / `expected_behavior`) and run by ACES.

## Files

```
evals/
├── README.md                    # this file
├── evals.json                   # 15 eval definitions (NVIDIA schema)
├── environment/
│   └── Dockerfile               # eval runtime image (mock osmo on PATH)
└── files/
    ├── mock_osmo/
    │   └── osmo                 # bash dispatcher used as a fake `osmo` CLI
    └── fixtures/
        ├── default/             # happy-path fixtures (online pools, RUNNING workflow)
        ├── quota_full/          # Quota Free=0, Total Free>0 scenario
        ├── pending/             # PENDING workflow with k8s events to translate
        ├── submit_ok/           # canned `osmo workflow submit` response
        └── sample_workflows/    # workflow.yaml fixtures for submit evals
```

## Eval set

15 evals total — 14 positives (where `expected_skill` is `osmo-agent`) and
1 negative (where `expected_skill` is `null` because the user's question is
unrelated to OSMO). See `evals.json` for the full set.

## How the eval environment works

ACES builds the runtime image from `environment/Dockerfile`. That Dockerfile
installs a stateless mock `osmo` CLI at `/usr/local/bin/osmo` so the skill's
prescribed commands (`osmo profile list`, `osmo pool list`,
`osmo workflow query …`, etc.) execute end-to-end without needing a live
OSMO backend.

The mock dispatches by subcommand and returns canned content from
`files/fixtures/<scenario>/`. Each eval's fixture set is a single scenario
directory; ACES stages the relevant fixtures into the agent's working
directory at runtime, and the mock auto-discovers them.

You don't need to list fixture files in `evals.json` — ACES stages
everything under `evals/files/` automatically.

## Coverage gaps

- **Multi-task subagent delegation** is not covered. The skill instructs
  the main agent to spawn `logs-reader` subagents for workflows with more
  than one task, but eval harnesses typically run the eval itself in a
  subagent — and subagents usually can't recursively spawn further
  subagents. The mechanism is therefore unverifiable from inside an eval
  run.

- **Stateful behaviors** (orchestration retry, validation-error recovery,
  app-creation flow) are not covered here. The orchestration test remains
  in `tests/orchestrator-runtime-failure.md` as a manual scenario.

## Coverage notes

- The cookbook-fetch eval (`osmo-agent-010`) performs a real `WebFetch`
  against `raw.githubusercontent.com/NVIDIA/OSMO`. That's the public OSMO
  cookbook and is part of the skill's documented behavior.
