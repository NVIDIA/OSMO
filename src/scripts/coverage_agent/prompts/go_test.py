# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from coverage_agent.prompts.quality_rules import QUALITY_RULES_PREAMBLE

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
    prompt = f"Generate Go unit tests for the following source file.\n\n"
    prompt += f"### Source file: `{source_path}`\n```go\n{source_content}\n```\n\n"
    prompt += f"### Uncovered line ranges to target: {uncovered_ranges}\n\n"

    if existing_test_content:
        prompt += f"### Existing tests (extend, don't duplicate):\n```go\n{existing_test_content}\n```\n\n"

    if reference_test_content:
        prompt += f"### Reference test pattern (follow this style):\n```go\n{reference_test_content}\n```\n\n"

    prompt += "Generate tests that cover the uncovered lines listed above."
    return prompt
