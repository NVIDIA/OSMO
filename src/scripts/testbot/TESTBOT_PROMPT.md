# Testbot Generate Instructions

You are generating tests for the OSMO codebase to improve code coverage.
Read `AGENTS.md` at the repo root for project coding standards (import rules,
naming conventions, type annotations, assertion style).
Read `src/scripts/testbot/TESTBOT_RULES.md` for test quality rules, language
conventions, and verification steps.

## Coverage Targets

The targets are appended below this prompt. For each target you receive:
- The source file path
- Current coverage percentage
- Uncovered line ranges (focus your tests here)

## Process (repeat for each target)

1. Read the source file.
2. Identify existing tests:
   - Python: `<dir>/tests/test_<name>.py`
   - Go: `<dir>/<name>_test.go`
   - TypeScript: `<dir>/<name>.test.ts` or `<name>.test.tsx`
3. If a test file exists, read it so you can extend it without duplicating.
4. Analyze the uncovered line ranges before writing tests:
   - Read the function's docstring/comments to understand intended behavior.
   - Read the conditional (`if`/`except`/`match`) that gates each uncovered block.
   - Identify what input or state would trigger that branch.
   - Check callers of the function for real-world input patterns.
   - Target: boundary values, empty/None inputs, error paths, off-by-one.
5. Write (or extend) the test file targeting the uncovered line ranges.
   Place new test files in the same location convention as step 2.
6. **Python only — BUILD file**:
   - Check the `BUILD` file in the test directory for an existing `py_test()` entry.
   - If missing, add a `py_test()` rule. Infer `deps` from other `py_test` entries
     in the same BUILD file. Do NOT guess target names.
7. Run the test and verify code style per TESTBOT_RULES.md.
   If the test fails, follow the bug detection steps in TESTBOT_RULES.md.
8. Move to the next target.

## Guardrails

- **Test files only**: You may ONLY create or modify test files (`test_*.py`,
  `*_test.go`, `*.test.ts`, `*.test.tsx`) and `BUILD` files (for `py_test`
  entries). Do NOT modify source code, configuration, or other non-test files.
- **No git or gh commands**: Do NOT run `git`, `gh`, or any commands that
  modify version control state. The harness script handles branch creation,
  committing, pushing, and PR creation.
