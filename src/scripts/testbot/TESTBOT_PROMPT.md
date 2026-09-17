# Testbot Generate Instructions

You are generating tests for the OSMO codebase to improve code coverage.
Read `AGENTS.md` at the repo root for project coding standards (import rules,
naming conventions, type annotations, assertion style).
Test quality rules, language conventions, and verification steps are appended
below from `src/scripts/testbot/TESTBOT_RULES.md`.

## Primary Objective

Cover the specific `Uncovered ranges:` listed for each target. Every added
test must execute a listed range; prove this with coverage before declaring
done. Passing tests alone do not establish coverage gain.

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

8. Run tests and style checks per TESTBOT_RULES.md; follow its bug-detection
   steps for failures. Before UI checks, install dependencies with
   `pnpm --dir src/ui install --frozen-lockfile`.

### 4. Coverage self-check loop (MANDATORY — do not skip)

9. Run `bazel coverage` for the test target(s) you touched. Use a
   package-level roll-up so multiple test targets on the same package
   are aggregated:
   ```bash
   bazel coverage //src/<package>:all
   ```
   The combined LCOV report lands at
   `bazel-out/_coverage/_coverage_report.dat`. Whichever target you ran,
   confirm the file exists (`Read` it) before moving on — a missing file
   usually means `bazel coverage` reported no test targets. For UI targets,
   run `pnpm --dir src/ui validate:coverage`; use a copy of
   `src/ui/coverage/lcov.info` with `SF:` paths normalized relative to the repo.

10. Compute coverage gain using the absolute path supplied as **Original target
    metadata** in the harness context. Replace the placeholder below with that
    path (and use the normalized UI LCOV copy for UI targets):
    ```bash
    python src/scripts/testbot/verify_coverage.py \
      --targets-meta "<original-target-metadata-path>" \
      --lcov bazel-out/_coverage/_coverage_report.dat \
      --json-output "$RUNNER_TEMP/coverage_self_check.json" \
      --markdown-output "$RUNNER_TEMP/coverage_self_check.md"
    ```
    Run the verifier directly; Python can read the supplied metadata path.
    Read the output JSON using its resolved absolute path (`Read` does not
    expand environment variables). Inspect each target's `hit_fraction` and
    `still_uncovered_ranges`.

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
- **Preserve target metadata**: do not alter the supplied metadata or its
  `uncovered_ranges`. The harness verifies against the original targets.

## Recovery checkpoints

The harness may restart you with a fresh conversation after a context limit,
compaction failure, timeout, or transient process/API failure. Working-tree
edits survive. Use the checkpoint path supplied by the harness: update it after
substantive progress with changed files, completed behaviors, test commands and
outcomes, suspected bugs, and the next action. Keep it under 2000 words and use
file paths/function names instead of copying source. Writing this checkpoint
outside the repository is an explicit exception to the test-files-only rule.

On recovery, validate the checkpoint against the files and continue unfinished
work. Complete useful behaviors before exploring additional source. Use scoped
reads and avoid rereading large files wholesale. The original coverage targets
remain the work queue; no fixed file or range batches are imposed.

An independent reviewer will inspect your changes and may fix suspected source
bugs. Preserve failing regression expectations and clear SUSPECTED BUG markers
so the reviewer can reproduce and repair them.
