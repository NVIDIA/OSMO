# OETF — Agent Notes

User-facing docs live in `README.md`. This file captures only what isn't obvious from it.

## Where things go

- New smoke test → `staging/smoke/<file>.py` + entry in `staging/smoke/BUILD`
- New scenario referencing an existing yaml → `staging/scenarios/<file>.py` (split into per-method targets via `test_filter=` if combined runtime > ~120s; slug = `test_foo_bar` → `foo-bar`)
- New scenario with in-container code → `staging/scenarios/<dir>/{spec.yaml, task.py, test_runner.py}` + BUILD entry with `test_dir=`
- New CLI flag on any of `oetf:{run,deploy,deploy_and_run}` → add it in `cli_args.py` (NOT in the per-binary `main.py`); add to `_RUN_ARG_TABLE`/`_ENV_ARG_TABLE` if it must forward from `deploy_and_run` to its `oetf:run` subprocess
- New env preset field → `models.EnvironmentConfig` + `environments.py` loader + `data/oetf.default.yaml`

## Invariants (don't break)

- **`task.py` and `task_fixture.py` are stdlib-only** — they run inside workflow containers that may have no pip deps. No `requests`/`yaml`/etc. Violations only fail at workflow runtime.
- **OETF targets are `manual`-tagged** — `bazel test //test/oetf/...` matches nothing. Use `oetf:run` or `bazel query 'attr(tags, "oetf-smoke", tests(...))'`.
- **Use server-side log filters** (`task_name=`, `regexes=[...]` in `_fetch_logs`) for polling, not client-side grep — bandwidth scales with matches, not log volume.

## Defaults agents commonly get wrong

- **Default to the cheapest shape.** Smoke first; plain scenario only when smoke can't observe the bug; 3-file *only* when you must assert on in-container state or drive a live task with a checkpoint gate. Cancel + `expect_outcome` works on plain scenarios — no `task.py` required.
- **`expect_outcome("failed")` and `.expect_failed()` are UNIONS** of `FAILED + FAILED_CANCELED`. For tests that specifically validate cancellation, assert `WorkflowServerStatus.FAILED_CANCELED` directly. Same for `expect_failed_submission()` — it accepts any `OSMOError`; if you need 4xx-vs-5xx discrimination, drop to `OSMOError.status_code`.
- **Convince yourself the test can fail.** Before declaring done, name the vacuous-pass mode (empty result set satisfies `count <= N`, generic try/except eats the bug, precondition the env doesn't satisfy) and guard against it. If you can't make the test fail by reverting the fix or mutating the assertion, the assertion isn't load-bearing.
- **Assert every facet the user named.** "4xx with a clear error" → both status class and body content. Single-facet asserts let the other half regress silently.

## Verifying a change

```bash
bazel test //test/oetf/tests/...                              # framework unit tests
bazel run //test/oetf:run -- --env staging --name test_foo    # one method against staging
bazel run //test/oetf:deploy_and_run -- --env kind --tags kind  # end-to-end on local KIND
```

If you touched BUILD or `bzl/oetf.bzl`: `bazel query //test/...` must succeed.
If you touched `cli_args.py`: `--help` on all three binaries.
