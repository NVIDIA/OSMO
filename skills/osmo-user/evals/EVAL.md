# Evaluation

Run from the repository root:

```bash
bazel test //skills/tests:osmo_user_eval_test
skillevaluator tier3 validate skills/osmo-user --json --strict
```

Each case stages its declared fixtures in a fresh workspace with the mock CLI
first on PATH. Keep grading answers in `skills/tests/`, outside the runtime skill.
These offline checks are not live-service tests or agent benchmarks.
