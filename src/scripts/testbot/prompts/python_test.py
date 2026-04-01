# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Python test generation prompt templates."""

from testbot.prompts import escape_fenced_content
from testbot.prompts.quality_rules import QUALITY_RULES_PREAMBLE

PYTHON_TEST_SYSTEM_PROMPT = QUALITY_RULES_PREAMBLE + """\

## OSMO Python Test Conventions
You are a test engineer for the OSMO project. Generate tests using unittest.TestCase.

### Conventions:
- All imports at the top of the file (no inline imports)
- SPDX-FileCopyrightText header on line 1
- Use `self.assertEqual`, `self.assertIn`, `self.assertRaises` — NOT bare `assert`
- Use descriptive variable names (no abbreviations)

### Output format:
Return ONLY the test file content in a single ```python code block.
Do NOT include BUILD file entries — those are handled automatically.

IMPORTANT: Always wrap code in a fenced code block (```python ... ```).
Never return raw code without fences. The parser uses fences to extract code.
"""


def build_python_prompt(
    source_content: str,
    source_path: str,
    uncovered_ranges: list[tuple[int, int]],
    existing_test_content: str | None = None,
    reference_test_content: str | None = None,
) -> str:
    """Build the user prompt for Python test generation from source and coverage data."""
    prompt = "Generate unit tests for the following Python source file.\n\n"
    prompt += f"### Source file: `{source_path}`\n```python\n{escape_fenced_content(source_content)}\n```\n\n"
    prompt += f"### Uncovered line ranges to target: {uncovered_ranges}\n\n"

    if existing_test_content:
        prompt += (
            f"### Existing tests (extend, don't duplicate):\n"
            f"```python\n{escape_fenced_content(existing_test_content)}\n```\n\n"
        )

    if reference_test_content:
        prompt += (
            f"### Reference test pattern (follow this style):\n"
            f"```python\n{escape_fenced_content(reference_test_content)}\n```\n\n"
        )

    prompt += "Generate tests that cover the uncovered lines listed above."
    return prompt
