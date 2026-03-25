# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Shared quality rules preamble for test generation prompts."""

QUALITY_RULES_PREAMBLE = """\
## Test Quality Rules (from Google SWE Book Ch.12)
You MUST follow these rules when generating tests:
- Test PUBLIC behavior, not private implementation details. Never call underscore-prefixed methods.
- Each test method tests ONE behavior. Name it: test_[behavior]_[condition]_[expected].
- Use Given-When-Then structure: setup, single action, assertions.
- No logic in tests: no loops, no conditionals, no arithmetic in expected values.
- Tests must be deterministic: no random, no sleep, no datetime.now().
- Every test must have meaningful assertions. Never assert True or assert is not None alone.
- DAMP over DRY: each test should be readable in isolation. Important values visible in the test body.
- Prefer state verification over interaction verification (check results, not mock call counts).
- Include both happy path AND error/edge cases for each behavior.
"""
