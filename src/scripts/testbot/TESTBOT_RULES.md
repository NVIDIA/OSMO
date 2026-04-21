# Testbot Shared Rules

Shared test quality rules, language conventions, and verification steps
used by both the generate and respond workflows.

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

## Bug Detection

When a test fails:
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

## Verification

1. **Run the test**:
   - Python/Go: `bazel test <target>` (derive the Bazel target from the BUILD file)
   - TypeScript: `pnpm --dir src/ui test -- --run <test_file_path>`
2. If the test fails, read the error and fix. Retry up to 3 times.
3. **Verify code style** (same checks as PR CI). Fix and re-verify until clean:
   - Python: `bazel test <target>-pylint` (append `-pylint` to the test target name)
   - TypeScript: `pnpm --dir src/ui validate` (runs type-check, lint,
     format:check, tests, and build). If formatting fails, run
     `pnpm --dir src/ui format` to auto-fix.
   - Go: no additional checks beyond step 1.

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
