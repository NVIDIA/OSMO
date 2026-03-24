# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import unittest

from coverage_agent.respond import (
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
    "user": {"login": "coverage-agent[bot]"},
}


class TestParseReviewComment(unittest.TestCase):
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
    def test_skip_agent_prefix(self):
        self.assertTrue(should_skip_comment(SKIP_AGENT_COMMENT))

    def test_skip_self_reply(self):
        self.assertTrue(should_skip_comment(SELF_COMMENT, bot_login="coverage-agent[bot]"))

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


if __name__ == "__main__":
    unittest.main()
