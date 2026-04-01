# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for the PR review comment response handler."""

import json
import unittest

from testbot.respond import (
    ReviewThread,
    _filter_actionable_threads,
    parse_llm_json_response,
)


def _thread(thread_id="T1", path="src/test.ts", line=10, is_resolved=False, comments=None):
    """Helper to create a ReviewThread."""
    if comments is None:
        comments = [{"databaseId": 1, "body": "Fix this", "author": "jiaenr"}]
    return ReviewThread(thread_id=thread_id, path=path, line=line, is_resolved=is_resolved, comments=comments)


class TestFilterActionableThreads(unittest.TestCase):
    """Tests for thread-based filtering logic."""

    def test_skip_resolved(self):
        threads = [_thread(is_resolved=True)]
        self.assertEqual(len(_filter_actionable_threads(threads)), 0)

    def test_skip_testbot_source(self):
        threads = [_thread(path="src/scripts/testbot/respond.py")]
        self.assertEqual(len(_filter_actionable_threads(threads)), 0)

    def test_skip_empty_comments(self):
        threads = [_thread(comments=[])]
        self.assertEqual(len(_filter_actionable_threads(threads)), 0)

    def test_skip_last_comment_is_self(self):
        threads = [_thread(comments=[
            {"databaseId": 1, "body": "Fix this", "author": "jiaenr"},
            {"databaseId": 2, "body": "Fixed.", "author": "svc-osmo-ci"},
        ])]
        self.assertEqual(len(_filter_actionable_threads(threads)), 0)

    def test_keep_unresolved_human_comment(self):
        threads = [_thread()]
        self.assertEqual(len(_filter_actionable_threads(threads)), 1)

    def test_keep_unresolved_coderabbit_review(self):
        threads = [_thread(comments=[
            {"databaseId": 1, "body": "Fragile error detection.", "author": "coderabbitai"},
        ])]
        self.assertEqual(len(_filter_actionable_threads(threads)), 1)

    def test_keep_thread_with_new_response_after_bot_reply(self):
        threads = [_thread(comments=[
            {"databaseId": 1, "body": "Fix this", "author": "coderabbitai"},
            {"databaseId": 2, "body": "Applied fix.", "author": "svc-osmo-ci"},
            {"databaseId": 3, "body": "Still wrong, see line 42.", "author": "coderabbitai"},
        ])]
        self.assertEqual(len(_filter_actionable_threads(threads)), 1)


class TestParseLlmJsonResponse(unittest.TestCase):
    """Tests for parsing batch JSON LLM responses with resolve field."""

    def test_replies_with_resolve(self):
        response = json.dumps({
            "fix": None,
            "replies": [
                {"comment_id": 1, "reply": "Fixed.", "resolve": True},
                {"comment_id": 2, "reply": "Needs human review.", "resolve": False},
            ],
        })
        data = parse_llm_json_response(response)
        self.assertTrue(data["replies"][0]["resolve"])
        self.assertFalse(data["replies"][1]["resolve"])

    def test_fix_with_replies(self):
        response = json.dumps({
            "fix": "import unittest\n",
            "replies": [{"comment_id": 1, "reply": "Added test.", "resolve": True}],
        })
        data = parse_llm_json_response(response)
        self.assertIn("import unittest", data["fix"])

    def test_invalid_json_returns_empty(self):
        data = parse_llm_json_response("Not valid JSON")
        self.assertEqual(data, {})

    def test_json_embedded_in_text(self):
        response = 'Here:\n{"fix": null, "replies": [{"comment_id": 1, "reply": "ok", "resolve": true}]}\n'
        data = parse_llm_json_response(response)
        self.assertEqual(len(data["replies"]), 1)


if __name__ == "__main__":
    unittest.main()
