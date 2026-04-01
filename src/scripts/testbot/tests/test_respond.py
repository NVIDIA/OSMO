# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for the PR review comment response handler."""

import json
import unittest

from testbot.respond import (
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
    """Tests for comment skip logic — all skips are silent."""

    def test_respond_to_original_coderabbit_review(self):
        self.assertIsNone(should_skip_comment(CODERABBIT_REVIEW))

    def test_skip_coderabbit_auto_reply(self):
        self.assertIsNotNone(should_skip_comment(CODERABBIT_AUTO_REPLY))

    def test_skip_own_reply(self):
        self.assertIsNotNone(should_skip_comment(BOT_OWN_REPLY))

    def test_respond_to_human_comment(self):
        self.assertIsNone(should_skip_comment(HUMAN_COMMENT))

    def test_skip_testbot_source_comment(self):
        self.assertIsNotNone(should_skip_comment(TESTBOT_SOURCE_COMMENT))

    def test_skip_agent_prefix(self):
        comment = {**HUMAN_COMMENT, "body": "[skip-agent] This is fine"}
        self.assertIsNotNone(should_skip_comment(comment))

    def test_skip_svc_osmo_ci(self):
        comment = {**HUMAN_COMMENT, "user": {"login": "svc-osmo-ci"}}
        self.assertIsNotNone(should_skip_comment(comment))


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
    """Tests for parsing batch JSON LLM responses."""

    def test_replies_only(self):
        response = json.dumps({
            "fix": None,
            "replies": [
                {"comment_id": 1, "reply": "This tests the date parser."},
                {"comment_id": 2, "reply": "Good catch, but not needed here."},
            ],
        })
        data = parse_llm_json_response(response)
        self.assertIsNone(data["fix"])
        self.assertEqual(len(data["replies"]), 2)
        self.assertEqual(data["replies"][0]["comment_id"], 1)

    def test_fix_with_replies(self):
        response = json.dumps({
            "fix": "import unittest\nclass Test:\n    pass\n",
            "replies": [{"comment_id": 1, "reply": "Added timezone test."}],
        })
        data = parse_llm_json_response(response)
        self.assertIn("import unittest", data["fix"])
        self.assertEqual(len(data["replies"]), 1)

    def test_invalid_json_returns_empty(self):
        data = parse_llm_json_response("Not valid JSON")
        self.assertEqual(data, {})

    def test_json_embedded_in_text(self):
        response = 'Here is my response:\n{"fix": null, "replies": [{"comment_id": 1, "reply": "ok"}]}\n'
        data = parse_llm_json_response(response)
        self.assertIsNone(data["fix"])
        self.assertEqual(len(data["replies"]), 1)


if __name__ == "__main__":
    unittest.main()
