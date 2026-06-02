# Testbot Generate Instructions

You are generating tests for the OSMO codebase to improve code coverage.
Read `AGENTS.md` at the repo root for project coding standards (import rules,
naming conventions, type annotations, assertion style).
Read `src/scripts/testbot/TESTBOT_RULES.md` for test quality rules, language
conventions, and verification steps.

## Primary Objective

Cover the specific uncovered source lines listed for each target. A run that
adds passing tests which fail to move the *listed* uncovered lines is a
**failed run**, even when every test passes — past runs have written 20
tests and moved Codecov by 3 lines because the tests landed on already-
covered behavior.

Treat `Uncovered ranges:` as the work queue. Every test you add must
actually execute lines in one of the listed ranges, and you must prove it
with `bazel coverage` before declaring done.

## Coverage Targets

The targets are appended below this prompt. For each target you receive:

- The source file path
- Current coverage percentage
- Uncovered line ranges (your work queue)

## Process (per target)

### 1. Plan

1. Read the source file.
2. Identify existing tests:
   - Python: `<dir>/tests/test_<name>.py`
   - Go: `<dir>/<name>_test.go`
   - TypeScript: `<dir>/<name>.test.ts` or `<name>.test.tsx`
3. If a test file exists, read it so you can extend rather than duplicate.
4. For every listed uncovered range, locate the exact branch/function
   containing it. Note:
   - The conditional (`if`/`except`/`match`/`switch`) or return path that
     gates the block.
   - The input or state required to execute it.
   - Whether existing tests cover nearby lines but miss the listed range.
5. Group the ranges by the public function/contract that reaches them so
   you can cover multiple ranges with a single well-chosen test.

### 2. Write tests

6. Place new test files in the same location convention as step 2. Each
   new test method must be traceable to at least one listed uncovered
   range. Do not add round-trip / constant / constructor / happy-path
   tests unless they execute one of the listed branches.
7. **BUILD wiring** (Python and Go — TypeScript uses Vitest discovery, no
   BUILD edit):
   - **Python**: check the `BUILD` file in the test directory for an
     existing `py_test()` entry. If missing, add a `py_test()` rule.
     Infer `deps` from other `py_test` entries in the same BUILD file.
     Do NOT guess target names.
   - **Go**: the test file lives next to the source (`<name>_test.go`),
     so check the source package's `BUILD` for an existing `go_test()`
     entry. If the BUILD only has `go_library` and you added a
     `_test.go`, you MUST also add a `go_test` rule referencing it. A
     `go_library`-only BUILD silently drops adjacent `_test.go` files on
     the floor and `bazel coverage` will report zero gain.
     Pattern (verified against `src/runtime/pkg/data/BUILD`):
     ```bzl
     load("@io_bazel_rules_go//go:def.bzl", "go_library", "go_test")
     go_test(
         name = "<pkg>_test",
         srcs = ["<name>_test.go"],
         embed = [":<pkg>"],   # the existing go_library target name
     )
     ```
     Confirm the rule is loaded by running `bazel test <target>`; if you
     get `ERROR: No test targets were found, yet testing was requested`,
     the `go_test` rule is missing or misnamed.

### 3. Verify locally

8. Run the test and verify code style per TESTBOT_RULES.md. If the test
   fails, follow the bug-detection steps in TESTBOT_RULES.md.

### 4. Coverage self-check loop (MANDATORY — do not skip)

This is the step previous runs have routinely skipped. The harness will
run the same check independently after you finish, and the PR description
will show whichever number is real. Don't ship work the harness will
shame you for.

9. Run `bazel coverage` for the test target(s) you touched. Use a
   package-level roll-up so multiple test targets on the same package
   are aggregated:
   ```bash
   bazel coverage //src/<package>:all
   ```
   The combined LCOV report lands at
   `bazel-out/_coverage/_coverage_report.dat`. Whichever target you ran,
   confirm the file exists (`Read` it) before moving on — a missing file
   usually means `bazel coverage` reported no test targets.

10. Compute coverage gain against the listed uncovered ranges. The picker
    persists its per-target metadata for this exact purpose:
    ```bash
    python src/scripts/testbot/verify_coverage.py \
      --targets-meta "$RUNNER_TEMP/targets_meta.json" \
      --lcov bazel-out/_coverage/_coverage_report.dat \
      --json-output "$RUNNER_TEMP/coverage_self_check.json" \
      --markdown-output "$RUNNER_TEMP/coverage_self_check.md"
    ```
    Run this command **directly** — do not `ls`/`find` against
    `$RUNNER_TEMP` to verify the meta file first. The path is outside
    Claude Code's `ls` sandbox and the workflow already staged the file
    before this prompt ran. (runs/26791499822 lost 4 turns groping in
    `/tmp`, got blocked, and dropped the verifier as a result.) Your
    `Bash(python *)` permission passes the path straight through to the
    Python subprocess, which can read `$RUNNER_TEMP` just fine.

    To inspect the resulting JSON, first resolve the env var (the
    `Read` tool doesn't shell-expand):
    ```bash
    echo $RUNNER_TEMP
    ```
    then `Read <resolved>/coverage_self_check.json` with the absolute
    path. Each target has a `hit_fraction` (0.0–1.0) and a
    `still_uncovered_ranges` list.

11. **Iterate until the gap closes.** A target passes when
    `hit_fraction >= 0.70`. If you're below, return to step 5 and add
    tests for the ranges in `still_uncovered_ranges`. For each range you
    leave uncovered, you must either:
    - Add a test that exercises it, or
    - Document in your final summary that it is genuinely unreachable
      (defensive branches around stdlib calls that cannot fail, dead
      code behind a build tag) — name the range and the reason.

12. Repeat 9–11 until every target's `hit_fraction >= 0.70` or every
    still-uncovered range is explained as unreachable. Don't churn
    forever — if you've iterated twice and the gap won't close, write up
    *why* in your summary so the human can decide.

    **Coverage-tooling escape hatch.** If `verify_coverage.py` reports
    `lcov_seen: false` for the target *or* every `DA:` line for the
    target source file in `bazel-out/_coverage/_coverage_report.dat`
    has `hits == 0` even after `bazel test` showed the new tests
    exercising the code, the local coverage instrumentation is broken
    (e.g., Python interpreter mismatch with the pinned coverage wheel).
    Stop debugging it after one diagnostic attempt — note "coverage
    tooling unavailable, see harness verification" in your final
    summary and finish. The independent harness step will measure
    against the production environment and the truth will land in
    the PR body either way.

### 5. Final summary

13. Emit a summary block that lists each target and the final
    `hit_fraction`, mirroring the JSON report:
    ```text
    COVERAGE REPORT
    - src/utils/roles/roles.go: 87/121 listed lines hit (72%) — pass
      still uncovered: lines 88-89 (defensive — `_ = err` after constant
      string compile)
    ```
    This is what the human will read first when the PR opens.

14. Move to the next target.

## Guardrails

- **Test files only**: You may ONLY create or modify test files
  (`test_*.py`, `*_test.go`, `*.test.ts`, `*.test.tsx`) and `BUILD` files
  (for `py_test` and `go_test` entries). Do NOT modify source code,
  configuration, or other non-test files. The harness `guardrails.py`
  filters anything else before commit.
- **No git or gh commands**: Do NOT run `git`, `gh`, or any commands that
  modify version control state. The harness script handles branch
  creation, committing, pushing, and PR creation.
- **No gaming the verifier**: don't change the picker's
  `uncovered_ranges` list to shrink the gap, and don't paste a fake
  `$RUNNER_TEMP/targets_meta.json`. The harness re-runs the verifier
  against the unmodified meta and posts the truth to the PR.
