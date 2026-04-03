# Testbot Instructions

You are generating tests for the OSMO codebase to improve code coverage.
Read `AGENTS.md` at the repo root for full project coding standards.

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
4. Write (or extend) the test file targeting the uncovered line ranges.
5. **Python only — BUILD file**:
   - Check the `BUILD` file in the test directory for an existing `py_test()` entry.
   - If missing, add a `py_test()` rule. Infer `deps` from other `py_test` entries
     in the same BUILD file. Do NOT guess target names.
6. Run the test:
   - Python/Go: `bazel test <target>` (derive the target from the BUILD file)
   - TypeScript: `pnpm --dir src/ui test -- --run <test_file_path>`
7. If the test fails, read the error output and fix the test. Retry up to 3 times.
8. Move to the next target.

## Guardrails

- **Test files only**: You may ONLY create or modify test files (`test_*.py`,
  `*_test.go`, `*.test.ts`, `*.test.tsx`) and `BUILD` files (for `py_test` entries).
  Do NOT modify any source code, configuration, or other non-test files.
- **No git or gh commands**: Do NOT run `git`, `gh`, or any commands that
  modify version control state. The harness script handles branch creation,
  committing, pushing, and PR creation.

## Test Quality Rules

Follow these rules strictly (from Google SWE Book Ch.12):

- Test PUBLIC behavior only. Never call underscore-prefixed methods.
- One behavior per test method. Name: `test_<behavior>_<condition>_<expected>`.
- Given-When-Then structure: setup, single action, assertions.
- **NO `for`/`while` loops or `if`/`elif` in test methods.**
  Write separate test methods for each input case instead.
- Deterministic: no `random`, no `sleep`, no `datetime.now()`.
  Use fixed dates or mock `datetime` when the source uses it.
- Every test method MUST have at least one assertion
  (`self.assertEqual`, `t.Errorf`, `expect(...)`).
- DAMP over DRY: each test readable in isolation, important values visible.
- Prefer state verification over interaction verification.
- Include both happy-path AND error/edge cases.

### CLI output testing (Python)

When testing functions that print formatted output:
- Mock `builtins.print`, join all positional args into one string:
  `output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)`
- Assert with `self.assertIn("expected", output)`.

## Language Conventions

### Python
- `unittest.TestCase` (not pytest)
- SPDX copyright header on line 1
- All imports at top of file (no inline imports)
- `self.assertEqual`, `self.assertIn`, `self.assertRaises` (not bare `assert`)
- Descriptive variable names (no abbreviations)

### Go
- Standard `testing` package
- Table-driven tests with `[]struct` and `t.Run()`
- Names: `Test<Behavior>_<Condition>`
- Same package as source (white-box OK)
- SPDX header

### TypeScript (Vitest)
- Import `describe`, `it`, `expect`, `vi` from `vitest`
- Absolute imports: `@/lib/...`
- `vi.fn().mockResolvedValue()` for async mocking
- SPDX header
