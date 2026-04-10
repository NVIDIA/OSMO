# Testbot Instructions

You are generating tests for the OSMO codebase to improve code coverage.
Read `AGENTS.md` at the repo root for project coding standards (import rules,
naming conventions, type annotations, assertion style).

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
7. Run the test:
   - Python/Go: `bazel test <target>` (derive the target from the BUILD file)
   - TypeScript: `pnpm --dir src/ui test -- --run <test_file_path>`
8. If the test fails, read the error output and fix. Retry up to 3 times.
   - **Setup errors** (import, mock, syntax): fix the test.
   - **Assertion failures**: re-read the source to understand WHY the actual
     output differs. If your expectation was wrong, update the assertion.
     If the output contradicts the function's docstring/name/comments,
     do NOT change the assertion to match — this is likely a source bug.
     Skip the test with a reason (`@unittest.skip`, `t.Skip`, `it.skip`)
     and add a comment above the skipped test using the language's comment
     syntax: `# SUSPECTED BUG: <file>:<function> — <description>` (Python)
     or `// SUSPECTED BUG: <file>:<function> — <description>` (Go/TypeScript).
     Never blindly match assertions to actual output.
9. Verify code style (same checks as PR CI). Fix and re-verify until clean:
   - Python: `bazel test <target>-pylint` (append `-pylint` to the test target
     name). If pylint reports errors, fix the test code and re-run.
   - TypeScript: `pnpm --dir src/ui validate` (runs type-check, lint,
     format:check, tests, and build). If formatting fails, run
     `pnpm --dir src/ui format` to auto-fix. If lint or type-check
     fails, fix the code manually. Re-run validate until it passes.
   - Go: no additional checks beyond step 7.
10. Move to the next target.

## Guardrails

- **Test files only (generate workflow)**: When generating tests from coverage
  targets, you may ONLY create or modify test files (`test_*.py`, `*_test.go`,
  `*.test.ts`, `*.test.tsx`) and `BUILD` files (for `py_test` entries).
  Do NOT modify source code, configuration, or other non-test files.
  (The respond workflow may override this when explicitly asked to fix source bugs.)
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
