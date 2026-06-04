# osmo-user evals

Evaluation set for the `osmo-user` skill, written against the NVIDIA eval
schema (`question` / `expected_skill` / `expected_script` / `ground_truth` /
`expected_behavior`) and run by ACES.

## Files

```text
evals/
├── README.md                    # this file
├── evals.json                   # 22 eval definitions (NVIDIA schema)
├── environment/
│   └── Dockerfile               # eval runtime image (mock osmo on PATH)
└── files/
    ├── mock_osmo/
    │   └── osmo                 # bash dispatcher used as a fake `osmo` CLI
    └── fixtures/
        ├── default/             # canned data for pool/profile/workflow queries
        │                        # (includes workflow_query_oom.json, workflow_events_oom.txt,
        │                        #  workflow_query_tool.json, workflow_logs_tool.txt,
        │                        #  workflow_query_badimage.json, workflow_events_badimage.txt,
        │                        #  workflow_logs_badimage.txt, workflow_query_sdg.json,
        │                        #  workflow_spec_sdg.yaml, and others)
        ├── submit_ok/           # canned `osmo workflow submit` success response
        ├── submit_err/          # canned capacity-validation error response (oversized.yaml eval)
        └── app_ok/              # canned `osmo app create` success response
```

The Dockerfile additionally copies `simple_workflow.yaml` to
`/workspace/workflow.yaml`, `jinja_workflow.yaml` to
`/workspace/jinja_workflow.yaml`, and `oversized.yaml` to
`/workspace/oversized.yaml` at build time so submit-flow evals find
them at the agent's cwd.

## Eval set

22 evals total — 17 positives (`expected_skill` is `osmo-user`) and 5 negatives
(`expected_skill` is `null`). See `evals.json` for the full set.

## How the eval environment works

ACES builds the runtime image from `environment/Dockerfile`. That Dockerfile
installs an `osmo` shim at `/usr/local/bin/osmo` that exec's the bash
dispatcher ACES mounts at `/workspace/input/mock_osmo/osmo` at runtime. The
dispatcher returns canned content from `/workspace/input/fixtures/...`, so
the skill's prescribed commands (`osmo profile list`, `osmo pool list`,
`osmo workflow query …`, etc.) resolve end-to-end without needing a live
OSMO backend.

Fixtures are organized by category (`default/`, `submit_ok/`, `submit_err/`,
`app_ok/`); the dispatcher walks the fixtures tree at lookup time.
Filenames are unique across categories, so there's no ambiguity when ACES
stages all of `evals/files/` into a single runtime tree.

You don't need to list fixture files in `evals.json` — ACES stages
everything under `evals/files/` automatically.

## Coverage gaps

- **Multi-task subagent delegation** is not covered. The skill instructs
  the main agent to spawn `logs-reader` subagents for workflows with more
  than one task, but eval harnesses typically run the eval itself in a
  subagent — and subagents usually can't recursively spawn further
  subagents. The mechanism is therefore unverifiable from inside an eval
  run.

- **Validation-error recovery** is now covered (eval 018) via a non-stateful
  approach: the mock returns a capacity error on the first `oversized.yaml`
  submit and succeeds on resubmit; the sizing math is graded by the eval
  judge, not by the mock inspecting the edited YAML.

- **App creation** is now covered (eval 019).

## Coverage notes

- The cookbook-fetch eval (`osmo-user-009`) performs a real `WebFetch`
  against `raw.githubusercontent.com/NVIDIA/OSMO`. That's the public OSMO
  cookbook and is part of the skill's documented behavior.

## Keeping fixtures in sync with the live OSMO CLI

The fixtures under `files/fixtures/default/` mirror the JSON shapes that
`osmo <cmd> --format-type json` returns today. They will drift as the CLI
evolves. To refresh:

1. Run the relevant `osmo` commands against a live profile, e.g.
   `osmo resource list --pool <pool> --format-type json`,
   `osmo workflow query <name>`, etc.
2. Redact any user-identifiable fields (`submitted_by`, internal hostnames)
   to placeholder values that match the existing fixtures.
3. Replace the fixture file and re-run the eval suite to confirm all 22
   cases still pass.

Longer-term we should validate fixtures in CI against the OSMO OpenAPI
schema (exported via `bazel run //src/scripts:export_openapi`) so structural
drift fails the build instead of silently passing the eval.
