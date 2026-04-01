# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for the PR review comment response handler."""

import unittest

from testbot.plugins.base import detect_test_type
from testbot.respond import (
    MAX_AUTO_RESPONSES,
    parse_review_comment,
    should_skip_comment,
)


SAMPLE_COMMENT = {
    "id": 12345,
    "body": "Consider using assertEqual instead of assertTrue for better error messages.",
    "path": "src/lib/utils/tests/test_common.py",
    "line": 42,
    "start_line": 40,
    "user": {"login": "coderabbitai[bot]"},
}

HUMAN_COMMENT = {
    "id": 12346,
    "body": "This test doesn't cover the edge case where input is None.",
    "path": "src/lib/utils/tests/test_common.py",
    "line": 55,
    "start_line": None,
    "user": {"login": "jiaenr"},
}

GO_COMMENT = {
    "id": 12349,
    "body": "Use table-driven tests here.",
    "path": "src/utils/roles/roles_test.go",
    "line": 20,
    "start_line": None,
    "user": {"login": "coderabbitai[bot]"},
}

UI_COMMENT = {
    "id": 12350,
    "body": "Add a test for the error case.",
    "path": "src/ui/src/lib/utils.test.ts",
    "line": 30,
    "start_line": None,
    "user": {"login": "jiaenr"},
}

SKIP_AGENT_COMMENT = {
    "id": 12347,
    "body": "[skip-agent] I'll handle this manually, the logic is tricky.",
    "path": "src/lib/utils/tests/test_common.py",
    "line": 10,
    "start_line": None,
    "user": {"login": "jiaenr"},
}

SELF_COMMENT = {
    "id": 12348,
    "body": "Applied fix. Tests pass.",
    "path": "src/lib/utils/tests/test_common.py",
    "line": 10,
    "start_line": None,
    "user": {"login": "testbot[bot]"},
}


class TestParseReviewComment(unittest.TestCase):
    """Tests for parsing GitHub review comment API responses."""

    def test_parse_bot_comment(self):
        result = parse_review_comment(SAMPLE_COMMENT)
        self.assertEqual(result.file_path, "src/lib/utils/tests/test_common.py")
        self.assertEqual(result.line, 42)
        self.assertEqual(result.start_line, 40)
        self.assertIn("assertEqual", result.body)
        self.assertEqual(result.author, "coderabbitai[bot]")

    def test_parse_human_comment(self):
        result = parse_review_comment(HUMAN_COMMENT)
        self.assertEqual(result.author, "jiaenr")
        self.assertIn("edge case", result.body)

    def test_parse_null_start_line(self):
        result = parse_review_comment(HUMAN_COMMENT)
        self.assertIsNone(result.start_line)


class TestShouldSkipComment(unittest.TestCase):
    """Tests for comment-skip logic including bot replies and rate limits."""

    def test_skip_agent_prefix(self):
        self.assertTrue(should_skip_comment(SKIP_AGENT_COMMENT))

    def test_skip_self_reply(self):
        self.assertTrue(should_skip_comment(SELF_COMMENT, bot_login="testbot[bot]"))

    def test_do_not_skip_bot_comment(self):
        self.assertFalse(should_skip_comment(SAMPLE_COMMENT))

    def test_do_not_skip_human_comment(self):
        self.assertFalse(should_skip_comment(HUMAN_COMMENT))

    def test_max_responses_exceeded(self):
        self.assertTrue(
            should_skip_comment(SAMPLE_COMMENT, current_response_count=MAX_AUTO_RESPONSES)
        )

    def test_max_responses_not_exceeded(self):
        self.assertFalse(
            should_skip_comment(SAMPLE_COMMENT, current_response_count=MAX_AUTO_RESPONSES - 1)
        )


class TestRespondTestTypeDetection(unittest.TestCase):
    """Would have caught: respond.py hardcoding 'python' for quality gate check on all files."""

    def test_go_comment_detects_go_type(self):
        comment = parse_review_comment(GO_COMMENT)
        test_type = detect_test_type(comment.file_path)
        self.assertIsNotNone(test_type)
        self.assertEqual(test_type.value, "go")

    def test_ui_comment_detects_ui_type(self):
        comment = parse_review_comment(UI_COMMENT)
        test_type = detect_test_type(comment.file_path)
        self.assertIsNotNone(test_type)
        self.assertEqual(test_type.value, "ui")

    def test_python_comment_detects_python_type(self):
        comment = parse_review_comment(SAMPLE_COMMENT)
        test_type = detect_test_type(comment.file_path)
        self.assertIsNotNone(test_type)
        self.assertEqual(test_type.value, "python")


if __name__ == "__main__":
    unittest.main()
