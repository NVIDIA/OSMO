# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for LLM client response parsing."""

import unittest

from coverage_agent.plugins.llm_client import _parse_response, _strip_markdown_markers


class TestParseResponse(unittest.TestCase):
    """Tests for _parse_response extraction of code blocks."""

    def test_extracts_python_code_block(self):
        response = "Here is the test:\n```python\nimport unittest\n\nclass TestFoo(unittest.TestCase):\n    pass\n```\n"
        content, build_entry = _parse_response(response, "python")
        self.assertIn("import unittest", content)
        self.assertNotIn("```", content)
        self.assertIsNone(build_entry)

    def test_extracts_build_entry(self):
        response = (
            "```python\nimport unittest\n```\n\n"
            "```starlark\npy_test(name = \"test_foo\", srcs = [\"test_foo.py\"])\n```\n"
        )
        content, build_entry = _parse_response(response, "python")
        self.assertIn("import unittest", content)
        self.assertIsNotNone(build_entry)
        self.assertIn("py_test", build_entry)

    def test_strips_markdown_from_raw_response(self):
        response = "```python\nimport unittest\n\nclass TestFoo(unittest.TestCase):\n    pass\n"
        content, _ = _parse_response(response, "python")
        self.assertNotIn("```python", content)
        self.assertIn("import unittest", content)

    def test_raw_response_without_fences(self):
        response = "import unittest\n\nclass TestFoo(unittest.TestCase):\n    pass\n"
        content, _ = _parse_response(response, "python")
        self.assertIn("import unittest", content)


class TestStripMarkdownMarkers(unittest.TestCase):
    """Tests for _strip_markdown_markers."""

    def test_strips_leading_fence(self):
        content = "```python\nimport unittest\npass\n```"
        result = _strip_markdown_markers(content)
        self.assertEqual(result, "import unittest\npass")

    def test_strips_only_leading_fence(self):
        content = "```python\nimport unittest\npass\n"
        result = _strip_markdown_markers(content)
        self.assertEqual(result, "import unittest\npass")

    def test_no_fences_unchanged(self):
        content = "import unittest\npass"
        result = _strip_markdown_markers(content)
        self.assertEqual(result, "import unittest\npass")

    def test_strips_bare_fence(self):
        content = "```\nimport unittest\npass\n```"
        result = _strip_markdown_markers(content)
        self.assertEqual(result, "import unittest\npass")


if __name__ == "__main__":
    unittest.main()
