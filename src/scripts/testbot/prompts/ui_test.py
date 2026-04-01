# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Vitest/TypeScript test generation prompt templates."""

from testbot.prompts import escape_fenced_content
from testbot.prompts.quality_rules import QUALITY_RULES_PREAMBLE

UI_TEST_SYSTEM_PROMPT = QUALITY_RULES_PREAMBLE + """\

## OSMO Vitest/TypeScript Test Conventions
You are a test engineer for the OSMO project. Generate Vitest tests for TypeScript code.

### Conventions:
- Import from `vitest`: `describe`, `it`, `expect`, `beforeEach`, `vi`
- Use absolute imports: `@/lib/...` (not relative)
- Organize with `describe()` blocks by functionality
- Use `vi.fn().mockResolvedValue()` for async mocking
- SPDX header at the top
- File name: `{module}.test.ts` adjacent to source

### Output format:
Return the complete `.test.ts` file content. No BUILD entry needed for Vitest tests.
"""


def build_ui_prompt(
    source_content: str,
    source_path: str,
    uncovered_ranges: list[tuple[int, int]],
    existing_test_content: str | None = None,
    reference_test_content: str | None = None,
) -> str:
    """Build the user prompt for Vitest/TypeScript test generation from source and coverage data."""
    prompt = "Generate Vitest tests for the following TypeScript source file.\n\n"
    prompt += f"### Source file: `{source_path}`\n```typescript\n{escape_fenced_content(source_content)}\n```\n\n"
    prompt += f"### Uncovered line ranges to target: {uncovered_ranges}\n\n"

    if existing_test_content:
        prompt += (
            f"### Existing tests (extend, don't duplicate):\n"
            f"```typescript\n{escape_fenced_content(existing_test_content)}\n```\n\n"
        )

    if reference_test_content:
        prompt += (
            f"### Reference test pattern (follow this style):\n"
            f"```typescript\n{escape_fenced_content(reference_test_content)}\n```\n\n"
        )

    prompt += "Generate tests that cover the uncovered lines listed above."
    return prompt
