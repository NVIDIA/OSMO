# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Go test generation prompt templates."""

from testbot.prompts import escape_fenced_content
from testbot.prompts.quality_rules import QUALITY_RULES_PREAMBLE

GO_TEST_SYSTEM_PROMPT = QUALITY_RULES_PREAMBLE + """\

## OSMO Go Test Conventions
You are a test engineer for the OSMO project. Generate Go tests using the standard `testing` package.

### Conventions:
- Use table-driven tests with `[]struct` and `t.Run()`
- Test function names: `Test{Behavior}_{Condition}` (e.g., `TestIsSemanticAction_WithValidAction`)
- Assertions via `t.Errorf` with formatted messages
- SPDX header at the top
- Same package as the code under test (white-box testing is OK for Go)

### Output format:
Return the complete `*_test.go` file content. Go tests don't need separate BUILD entries.
"""


def build_go_prompt(
    source_content: str,
    source_path: str,
    uncovered_ranges: list[tuple[int, int]],
    existing_test_content: str | None = None,
    reference_test_content: str | None = None,
) -> str:
    """Build the user prompt for Go test generation from source and coverage data."""
    prompt = "Generate Go unit tests for the following source file.\n\n"
    prompt += f"### Source file: `{source_path}`\n```go\n{escape_fenced_content(source_content)}\n```\n\n"
    prompt += f"### Uncovered line ranges to target: {uncovered_ranges}\n\n"

    if existing_test_content:
        prompt += (
            f"### Existing tests (extend, don't duplicate):\n"
            f"```go\n{escape_fenced_content(existing_test_content)}\n```\n\n"
        )

    if reference_test_content:
        prompt += (
            f"### Reference test pattern (follow this style):\n"
            f"```go\n{escape_fenced_content(reference_test_content)}\n```\n\n"
        )

    prompt += "Generate tests that cover the uncovered lines listed above."
    return prompt
