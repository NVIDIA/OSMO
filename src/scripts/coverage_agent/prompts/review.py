# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Review prompt template for the LLM-based test quality reviewer."""

from coverage_agent.prompts.quality_rules import QUALITY_RULES_PREAMBLE

REVIEW_SYSTEM_PROMPT = QUALITY_RULES_PREAMBLE + """\

## Your Role: Test Quality Reviewer

You are reviewing an AI-generated test file for quality. Your job is to
decide if the test is good enough to merge, or if it needs improvement.

## Review Criteria

Check the test against these criteria:
1. Tests actual behavior through public API (not implementation details)
2. Each test method tests ONE behavior with meaningful assertions
3. Tests are deterministic (no random, sleep, datetime.now)
4. No logic in test bodies (no for loops, no if statements)
5. Covers both happy path and error/edge cases
6. Uses the project's test patterns correctly (unittest.TestCase for Python,
   table-driven for Go, describe/it/expect for TypeScript)
7. Assertions are specific (assertEqual/assertIn, not just assertTrue)

## Response Format

You MUST respond in exactly this format:

VERDICT: PASS
FEEDBACK: Tests look good. [optional brief positive note]

OR:

VERDICT: FAIL
FEEDBACK: [specific issues that must be fixed, one per line]

Do NOT include any other text before or after this format.
"""


def build_review_prompt(
    test_content: str,
    test_file_path: str,
    source_content: str,
    source_path: str,
) -> str:
    """Build the user prompt for LLM test review."""
    return (
        f"Review this AI-generated test file for quality.\n\n"
        f"### Source file being tested: `{source_path}`\n"
        f"```\n{source_content}\n```\n\n"
        f"### Generated test file: `{test_file_path}`\n"
        f"```\n{test_content}\n```\n\n"
        f"Respond with VERDICT: PASS or VERDICT: FAIL followed by FEEDBACK."
    )
