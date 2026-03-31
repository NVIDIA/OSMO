# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Python test generation prompt templates."""

from coverage_agent.prompts import escape_fenced_content
from coverage_agent.prompts.quality_rules import QUALITY_RULES_PREAMBLE

PYTHON_TEST_SYSTEM_PROMPT = QUALITY_RULES_PREAMBLE + """\

## OSMO Python Test Conventions
You are a test engineer for the OSMO project. Generate tests using unittest.TestCase.

### Conventions:
- All imports at the top of the file (no inline imports)
- SPDX-FileCopyrightText header on line 1
- Use `self.assertEqual`, `self.assertIn`, `self.assertRaises` — NOT bare `assert`
- Use descriptive variable names (no abbreviations)
- For Bazel BUILD entry, use `osmo_py_test()` macro from `//bzl:py.bzl`

### BUILD pattern:
```starlark
load("//bzl:py.bzl", "osmo_py_test")

osmo_py_test(
    name = "test_{module_name}",
    srcs = ["test_{module_name}.py"],
    deps = [
        "//src/path/to:module",
    ],
)
```

### Output format:
Return two sections clearly separated. Each MUST be in a fenced code block:
1. TEST FILE in a ```python code block: The complete test file content
2. BUILD ENTRY in a ```starlark code block: The py_test() stanza to add to the BUILD file

IMPORTANT: Always wrap code in fenced code blocks (```python ... ``` and ```starlark ... ```).
Never return raw code without fences. The parser uses these fences to extract code.
"""


def build_python_prompt(
    source_content: str,
    source_path: str,
    uncovered_ranges: list[tuple[int, int]],
    existing_test_content: str | None = None,
    reference_test_content: str | None = None,
) -> str:
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
