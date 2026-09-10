# Evaluating osmo-user

The evals dataset uses SkillEvaluator's `skill_name` / `evals` format. Cases 002–035
preserve earlier prompts and grading criteria. Cases 036–044 cover workflow
filters, task date boundaries and requested-GPU aggregation, per-run app
labels/local inputs, data-list output modes, and validation labels.

Each case explicitly selects inputs staged at `/workspace/input`.
`config.yml` puts the mock first on PATH. Use an isolated evaluator sandbox
without real OSMO credentials. Never stage `evals.json`, this guide, tests, or
grading criteria into the agent workspace. Use the same prompts, fixtures,
runtime, and grading policy with and without the skill.

New cases select `fixtures/cli_options/state.json`, activating an argument-sensitive
offline Python CLI subset. It contains synthetic world state, not grading
instructions. Older cases retain canned responses and do not establish full
parser or service fidelity. State counters live in each case's staged directory;
do not reuse that directory across trials.

## Local harness checks

From the repository root:

```bash
bazel test //skills/tests:osmo_user_eval_test
skillevaluator tier3 validate skills/osmo-user --json --strict
```

These are fixture/parser regression checks, not agent benchmarks.
Harness assertions and the manual runtime-failure test live in `skills/tests/`,
outside the runtime skill package, so the evaluated agent cannot read their
answers from its installed skill. Evaluator guidance stays in `evals/EVAL.md`,
which SkillEvaluator excludes with the rest of `evals/` from runtime skills.

## Release evaluation

Pin SkillEvaluator and record its version, source commit, commands, selected
cases, model, attempts, sandbox, findings, and skipped checks. Keep generated
reports outside the skill directory until packaging guidance explicitly calls
for a reviewed release artifact.

```bash
skillevaluator doctor --agents codex --env-mode docker
skillevaluator validate skills/osmo-user --no-dedup --report json,markdown --output-dir /tmp/osmo-skill-static-reports
skillevaluator validate skills/osmo-user --tiers 1,3 --agents codex --env-mode docker --block-on-agent-eval --harbor-keep-jobs --output-dir /tmp/osmo-skill-release-reports
```

The second command is static-only: disabling dedup does not certify Tier 2.
The third requires provider authentication for grading as well as the agent.
Do not use `--skip-baseline` for release uplift claims. Label subset runs as
subsets; mock unit-test results must never be called agent uplift.

Review critical/high findings and every medium finding. SkillEvaluator's Tier 1
SkillSpector integration excludes eval trees; a full-directory scan may flag
intentional negative prompts and synthetic logs/specs. Record the scope
difference rather than removing fixtures or silently suppressing findings.
Missing scanners or providers mean incomplete coverage, not a clean result.

Confirm release ownership and readiness through the authorized project workflow.
Sign only the final reviewed directory with the approved NVIDIA signer, then
verify against the NVIDIA trust chain. Do not substitute a local self-signed
certificate or hand-author benchmark results.
