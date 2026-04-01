# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Shared quality rules preamble for test generation prompts."""

QUALITY_RULES_PREAMBLE = """\
## Test Quality Rules (from Google SWE Book Ch.12)
You MUST follow these rules when generating tests:
- Test PUBLIC behavior, not private implementation details. Never call underscore-prefixed methods.
- Each test method tests ONE behavior. Name it: test_[behavior]_[condition]_[expected].
- Use Given-When-Then structure: setup, single action, assertions.
- **NO for/while loop STATEMENTS or if/elif STATEMENTS in test methods.**
  (List comprehensions and ternary expressions are OK.)
  If you need to test multiple inputs, write separate test methods for each case.
- Tests must be deterministic: no random, no sleep, no datetime.now(), no datetime.utcnow().
  Use fixed date strings or mock datetime when the source code uses datetime.
- **Every test method MUST contain at least one `self.assert*()` call** (e.g., assertEqual,
  assertTrue, assertIn, assertRaises). Mock verification methods like `mock.assert_called_with()`
  are also accepted, but prefer `self.assert*()` for clarity.
- DAMP over DRY: each test should be readable in isolation. Important values visible in the test body.
- Prefer state verification over interaction verification (check results, not mock call counts).
- Include both happy path AND error/edge cases for each behavior.

## Testing CLI output functions (print-based)
When testing functions that print formatted output (tables, lists):
- Mock `builtins.print` and join all output into one string for assertions:
  `output = " ".join(str(c) for c in mock_print.call_args_list)`
  `self.assertIn("expected_value", output)`
- Do NOT iterate over `call_args_list` with a for loop — use `assertIn` on joined output.
- For testing functions that take `service_client` and `args`: mock both, set return values,
  call the function, then assert on print output or mock calls.
"""
