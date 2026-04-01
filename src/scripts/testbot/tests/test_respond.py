# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for the PR review comment response handler."""

import unittest

from testbot.respond import (
    MAX_AUTO_RESPONSES,
    _parse_llm_response,
    parse_review_comment,
    should_skip_comment,
)


CODERABBIT_REVIEW = {
    "id": 12345,
    "body": "Fragile error detection via string prefix check.",
    "path": "src/lib/utils/tests/test_common.py",
    "line": 42,
    "start_line": 40,
    "user": {"login": "coderabbitai[bot]"},
    "in_reply_to_id": None,
}

CODERABBIT_AUTO_REPLY = {
    "id": 12346,
    "body": "Skipped: comment is from another GitHub bot.",
    "path": "src/lib/utils/tests/test_common.py",
    "line": 42,
    "start_line": None,
    "user": {"login": "coderabbitai[bot]"},
    "in_reply_to_id": 12345,
}

BOT_OWN_REPLY = {
    "id": 12347,
    "body": "Applied fix.",
    "path": "src/lib/utils/tests/test_common.py",
    "line": 42,
    "start_line": None,
    "user": {"login": "github-actions[bot]"},
    "in_reply_to_id": 12345,
}

HUMAN_COMMENT = {
    "id": 12348,
    "body": "This test doesn't cover the edge case where input is None.",
    "path": "src/lib/utils/tests/test_common.py",
    "line": 55,
    "start_line": None,
    "user": {"login": "jiaenr"},
}

TESTBOT_SOURCE_COMMENT = {
    "id": 12349,
    "body": "Refactor this function.",
    "path": "src/scripts/testbot/respond.py",
    "line": 10,
    "start_line": None,
    "user": {"login": "coderabbitai[bot]"},
    "in_reply_to_id": None,
}


class TestShouldSkipComment(unittest.TestCase):
    """Tests for comment skip logic — prevents loops and handles edge cases."""

    def test_respond_to_original_coderabbit_review(self):
        """Original CodeRabbit reviews (in_reply_to_id=None) should NOT be skipped."""
        self.assertIsNone(should_skip_comment(CODERABBIT_REVIEW))

    def test_skip_coderabbit_auto_reply(self):
        """CodeRabbit auto-replies (in_reply_to_id set, bot author) should be skipped."""
        reason = should_skip_comment(CODERABBIT_AUTO_REPLY)
        self.assertIsNotNone(reason)
        self.assertIn("reply to another bot", reason)

    def test_silent_skip_own_reply(self):
        """Own replies (github-actions[bot]) should return None (silent skip handled upstream)."""
        # should_skip_comment returns None for own authors — caller handles silently
        self.assertIsNone(should_skip_comment(BOT_OWN_REPLY))

    def test_respond_to_human_comment(self):
        """Human comments should NOT be skipped."""
        self.assertIsNone(should_skip_comment(HUMAN_COMMENT))

    def test_skip_testbot_source_comment(self):
        """Comments on testbot source files should be skipped."""
        reason = should_skip_comment(TESTBOT_SOURCE_COMMENT)
        self.assertIsNotNone(reason)
        self.assertIn("testbot source code", reason)

    def test_skip_max_responses(self):
        """Should skip when max responses reached."""
        reason = should_skip_comment(HUMAN_COMMENT, current_response_count=MAX_AUTO_RESPONSES)
        self.assertIsNotNone(reason)
        self.assertIn("max auto-responses", reason)

    def test_respond_under_max(self):
        """Should NOT skip when under max responses."""
        self.assertIsNone(should_skip_comment(HUMAN_COMMENT, current_response_count=2))

    def test_skip_agent_prefix(self):
        """Comments starting with [skip-agent] should be silently skipped."""
        comment = {**HUMAN_COMMENT, "body": "[skip-agent] This is fine"}
        self.assertIsNone(should_skip_comment(comment))


class TestParseReviewComment(unittest.TestCase):
    """Tests for parsing GitHub API review comment data."""

    def test_parse_with_reply_to(self):
        comment = parse_review_comment(CODERABBIT_AUTO_REPLY)
        self.assertEqual(comment.in_reply_to_id, 12345)

    def test_parse_original_review(self):
        comment = parse_review_comment(CODERABBIT_REVIEW)
        self.assertIsNone(comment.in_reply_to_id)
        self.assertEqual(comment.author, "coderabbitai[bot]")

    def test_parse_human_comment(self):
        comment = parse_review_comment(HUMAN_COMMENT)
        self.assertEqual(comment.author, "jiaenr")
        self.assertIsNone(comment.start_line)


class TestParseLlmResponse(unittest.TestCase):
    """Tests for parsing LLM REPLY/FIX responses."""

    def test_reply_only(self):
        reply, fix = _parse_llm_response("REPLY: This test verifies the date formatting logic.")
        self.assertEqual(reply, "This test verifies the date formatting logic.")
        self.assertIsNone(fix)

    def test_fix_with_reply(self):
        response = (
            "FIX:\n"
            "```python\n"
            "import unittest\n"
            "\n"
            "class TestFoo(unittest.TestCase):\n"
            "    pass\n"
            "```\n"
            "REPLY: Added the missing test class."
        )
        reply, fix = _parse_llm_response(response)
        self.assertEqual(reply, "Added the missing test class.")
        self.assertIn("import unittest", fix)

    def test_fix_without_reply(self):
        response = "FIX:\n```\nsome code\n```"
        reply, fix = _parse_llm_response(response)
        self.assertEqual(reply, "Applied fix.")
        self.assertIn("some code", fix)

    def test_fallback_plain_text(self):
        reply, fix = _parse_llm_response("Just a plain response without prefix.")
        self.assertEqual(reply, "Just a plain response without prefix.")
        self.assertIsNone(fix)


if __name__ == "__main__":
    unittest.main()
