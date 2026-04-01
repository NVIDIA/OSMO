# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for the PR review comment response handler."""

import unittest

from testbot.respond import (
    MAX_AUTO_RESPONSES,
    parse_llm_json_response,
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
    """Tests for comment skip logic — all skips are silent (no reply posted)."""

    def test_respond_to_original_coderabbit_review(self):
        self.assertIsNone(should_skip_comment(CODERABBIT_REVIEW))

    def test_skip_coderabbit_auto_reply(self):
        reason = should_skip_comment(CODERABBIT_AUTO_REPLY)
        self.assertIsNotNone(reason)
        self.assertIn("auto-reply", reason)

    def test_skip_own_reply(self):
        reason = should_skip_comment(BOT_OWN_REPLY)
        self.assertIsNotNone(reason)
        self.assertIn("own comment", reason)

    def test_respond_to_human_comment(self):
        self.assertIsNone(should_skip_comment(HUMAN_COMMENT))

    def test_skip_testbot_source_comment(self):
        reason = should_skip_comment(TESTBOT_SOURCE_COMMENT)
        self.assertIsNotNone(reason)
        self.assertIn("testbot source", reason)

    def test_skip_max_responses(self):
        reason = should_skip_comment(HUMAN_COMMENT, current_response_count=MAX_AUTO_RESPONSES)
        self.assertIsNotNone(reason)
        self.assertIn("max responses", reason)

    def test_respond_under_max(self):
        self.assertIsNone(should_skip_comment(HUMAN_COMMENT, current_response_count=2))

    def test_skip_agent_prefix(self):
        comment = {**HUMAN_COMMENT, "body": "[skip-agent] This is fine"}
        reason = should_skip_comment(comment)
        self.assertIsNotNone(reason)

    def test_skip_svc_osmo_ci(self):
        comment = {**HUMAN_COMMENT, "user": {"login": "svc-osmo-ci"}}
        reason = should_skip_comment(comment)
        self.assertIsNotNone(reason)


class TestParseReviewComment(unittest.TestCase):
    """Tests for parsing GitHub API review comment data."""

    def test_parse_with_reply_to(self):
        comment = parse_review_comment(CODERABBIT_AUTO_REPLY)
        self.assertEqual(comment.in_reply_to_id, 12345)

    def test_parse_original_review(self):
        comment = parse_review_comment(CODERABBIT_REVIEW)
        self.assertIsNone(comment.in_reply_to_id)

    def test_parse_human_comment(self):
        comment = parse_review_comment(HUMAN_COMMENT)
        self.assertEqual(comment.author, "jiaenr")


class TestParseLlmJsonResponse(unittest.TestCase):
    """Tests for parsing structured JSON LLM responses."""

    def test_reply_only(self):
        reply, fix = parse_llm_json_response('{"reply": "This tests the date parser.", "fix": null}')
        self.assertEqual(reply, "This tests the date parser.")
        self.assertIsNone(fix)

    def test_fix_with_reply(self):
        response = '{"reply": "Added timezone test.", "fix": "import unittest\\nclass Test:\\n    pass\\n"}'
        reply, fix = parse_llm_json_response(response)
        self.assertEqual(reply, "Added timezone test.")
        self.assertIn("import unittest", fix)

    def test_invalid_json_fallback(self):
        reply, fix = parse_llm_json_response("Not valid JSON at all")
        self.assertEqual(reply, "Not valid JSON at all")
        self.assertIsNone(fix)

    def test_empty_fix_is_none(self):
        reply, fix = parse_llm_json_response('{"reply": "Looks good.", "fix": null}')
        self.assertIsNone(fix)

    def test_missing_reply_key(self):
        reply, fix = parse_llm_json_response('{"answer": "something"}')
        self.assertEqual(reply, "")
        self.assertIsNone(fix)


if __name__ == "__main__":
    unittest.main()
