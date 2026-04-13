# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for respond.py."""

import json
import subprocess
import unittest
from typing import Any
from unittest.mock import patch

from src.scripts.testbot.respond import (
    _has_trigger,
    build_prompt,
    filter_actionable,
    parse_replies,
    run_claude,
    sanitize_commit_message,
)


class TestHasTrigger(unittest.TestCase):
    """Tests for _has_trigger phrase matching."""

    def test_trigger_at_start_with_space(self):
        self.assertTrue(_has_trigger("/testbot fix this", "/testbot"))

    def test_trigger_at_start_with_newline(self):
        self.assertTrue(_has_trigger("/testbot\nadd more tests", "/testbot"))

    def test_trigger_at_start_end_of_string(self):
        self.assertTrue(_has_trigger("/testbot", "/testbot"))

    def test_trigger_with_leading_whitespace(self):
        self.assertTrue(_has_trigger("  /testbot fix this", "/testbot"))

    def test_trigger_with_tab_after(self):
        self.assertTrue(_has_trigger("/testbot\tfix this", "/testbot"))

    def test_no_match_mid_sentence(self):
        self.assertFalse(_has_trigger("please /testbot fix this", "/testbot"))

    def test_no_match_filename(self):
        self.assertFalse(_has_trigger("/testbot.yaml has issues", "/testbot"))

    def test_no_match_suffix(self):
        self.assertFalse(_has_trigger("/testbot-config update", "/testbot"))

    def test_no_match_case_sensitive(self):
        self.assertFalse(_has_trigger("/TESTBOT fix this", "/testbot"))

    def test_no_match_partial(self):
        self.assertFalse(_has_trigger("/test fix this", "/testbot"))

    def test_no_match_empty_body(self):
        self.assertFalse(_has_trigger("", "/testbot"))


class TestFilterActionable(unittest.TestCase):
    """Tests for filter_actionable thread filtering."""

    def _make_thread(
        self,
        is_resolved=False,
        path="src/ui/src/lib/foo.test.ts",
        comments=None,
    ):
        if comments is None:
            comments = [{
                "id": 123, "body": "/testbot fix this",
                "author": "jiaenren", "association": "MEMBER",
            }]
        return {
            "thread_id": "T_abc",
            "is_resolved": is_resolved,
            "path": path,
            "line": 10,
            "comments": comments,
        }

    def test_actionable_thread_with_trigger(self):
        threads = [self._make_thread()]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["reply_comment_id"], 123)

    def test_skips_resolved_thread(self):
        threads = [self._make_thread(is_resolved=True)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_skips_thread_with_no_comments(self):
        threads = [self._make_thread(comments=[])]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_skips_testbot_source_path(self):
        threads = [self._make_thread(path="src/scripts/testbot/respond.py")]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_skips_thread_where_bot_already_replied(self):
        comments = [
            {"id": 100, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "Fix applied.", "author": "svc-osmo-ci", "association": "NONE"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_skips_thread_without_trigger(self):
        comments = [{"id": 100, "body": "please fix this", "author": "jiaenren", "association": "MEMBER"}]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_skips_filename_false_positive(self):
        comments = [{"id": 100, "body": "/testbot.yaml has issues", "author": "jiaenren", "association": "MEMBER"}]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_finds_trigger_in_nested_reply(self):
        comments = [
            {"id": 100, "body": "Add more tests", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "No changes needed", "author": "coderabbitai[bot]", "association": "NONE"},
            {"id": 300, "body": "/testbot remove the redundant tests", "author": "jiaenren", "association": "MEMBER"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["reply_comment_id"], 300)

    def test_uses_last_human_trigger_comment(self):
        comments = [
            {"id": 100, "body": "/testbot add tests", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "/testbot actually remove them", "author": "jiaenren", "association": "MEMBER"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result[0]["reply_comment_id"], 200)

    def test_skips_old_trigger_followed_by_non_trigger_human(self):
        comments = [
            {"id": 100, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "Done.", "author": "svc-osmo-ci", "association": "NONE"},
            {"id": 300, "body": "still failing", "author": "jiaenren", "association": "MEMBER"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_skips_non_member_trigger(self):
        comments = [{"id": 100, "body": "/testbot fix this", "author": "random-user", "association": "NONE"}]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_allows_owner_trigger(self):
        comments = [{"id": 100, "body": "/testbot fix this", "author": "org-owner", "association": "OWNER"}]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)

    def test_allows_collaborator_trigger(self):
        comments = [{"id": 100, "body": "/testbot fix this", "author": "collab", "association": "COLLABORATOR"}]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)

    def test_includes_full_thread_history(self):
        comments = [
            {"id": 100, "body": "Original comment", "author": "reviewer", "association": "MEMBER"},
            {"id": 200, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertIn("[reviewer]: Original comment", result[0]["thread_history"])
        self.assertIn("[jiaenren]: /testbot fix this", result[0]["thread_history"])

    def test_caps_at_max_responses(self):
        threads = [
            self._make_thread(comments=[{
                "id": i, "body": "/testbot fix", "author": "jiaenren", "association": "MEMBER",
            }])
            for i in range(5)
        ]
        result = filter_actionable(threads, "/testbot", max_responses=2)
        self.assertEqual(len(result), 2)


class TestParseReplies(unittest.TestCase):
    """Tests for parse_replies 3-tier fallback."""

    def _make_comments(self):
        return [{"reply_comment_id": 123, "path": "foo.py", "line": 10}]

    def test_tier1_structured_output(self):
        claude_output = {
            "structured_output": {
                "replies": [
                    {"comment_id": 123, "reply": "Fixed.", "resolve": True},
                ],
            },
        }
        result = parse_replies(claude_output, self._make_comments())
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["comment_id"], 123)
        self.assertEqual(result[0]["reply"], "Fixed.")
        self.assertTrue(result[0]["resolve"])

    def test_tier1_empty_replies_falls_through(self):
        claude_output: dict[str, Any] = {"structured_output": {"replies": []}}
        result = parse_replies(claude_output, self._make_comments())
        self.assertEqual(result, [])

    def test_tier1_structured_output_not_dict_falls_through(self):
        claude_output = {"structured_output": "not a dict", "result": ""}
        result = parse_replies(claude_output, self._make_comments())
        self.assertEqual(result, [])

    def test_tier2_json_in_result_text(self):
        replies_json = json.dumps({
            "replies": [{"comment_id": 456, "reply": "Done.", "resolve": True}],
        })
        claude_output = {"result": f"Here is the output: {replies_json}"}
        result = parse_replies(claude_output, self._make_comments())
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["comment_id"], 456)

    def test_tier2_no_replies_key_falls_through(self):
        claude_output = {"result": '{"other_key": "value"}'}
        comments = self._make_comments()
        result = parse_replies(claude_output, comments)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["comment_id"], 123)
        self.assertFalse(result[0]["resolve"])

    def test_tier2_malformed_json_falls_through(self):
        claude_output = {"result": "this is {not valid json"}
        comments = self._make_comments()
        result = parse_replies(claude_output, comments)
        self.assertEqual(len(result), 1)
        self.assertFalse(result[0]["resolve"])

    def test_tier3_raw_text_fallback(self):
        claude_output = {"result": "I made some changes to the test file."}
        comments = self._make_comments()
        result = parse_replies(claude_output, comments)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["comment_id"], 123)
        self.assertIn("I made some changes", result[0]["reply"])
        self.assertFalse(result[0]["resolve"])

    def test_tier3_truncates_long_text(self):
        claude_output = {"result": "x" * 3000}
        comments = self._make_comments()
        result = parse_replies(claude_output, comments)
        self.assertEqual(len(result[0]["reply"]), 2000)

    def test_all_tiers_fail_returns_empty(self):
        claude_output = {"result": ""}
        result = parse_replies(claude_output, self._make_comments())
        self.assertEqual(result, [])

    def test_no_result_no_structured_returns_empty(self):
        claude_output: dict[str, Any] = {}
        result = parse_replies(claude_output, self._make_comments())
        self.assertEqual(result, [])


class TestBuildPrompt(unittest.TestCase):
    """Tests for build_prompt formatting."""

    def test_single_thread_includes_location(self):
        threads = [{
            "reply_comment_id": 123,
            "path": "src/ui/src/lib/foo.test.ts",
            "line": 42,
            "thread_history": "  [reviewer]: /testbot add edge cases",
        }]
        prompt = build_prompt(threads)
        self.assertIn("`src/ui/src/lib/foo.test.ts` line 42", prompt)
        self.assertIn("### Thread 123", prompt)
        self.assertIn("[reviewer]: /testbot add edge cases", prompt)

    def test_includes_test_run_instructions(self):
        threads = [{
            "reply_comment_id": 1,
            "path": "foo.test.ts",
            "line": 1,
            "thread_history": "  [user]: /testbot fix",
        }]
        prompt = build_prompt(threads)
        self.assertIn("TESTBOT_PROMPT.md", prompt)
        self.assertIn("SUSPECTED BUG", prompt)

    def test_includes_no_git_instruction(self):
        threads = [{
            "reply_comment_id": 1,
            "path": "foo.py",
            "line": 1,
            "thread_history": "  [user]: /testbot fix",
        }]
        prompt = build_prompt(threads)
        self.assertIn("Do NOT create git commits", prompt)


class TestRunClaude(unittest.TestCase):
    """Tests for run_claude subprocess invocation."""

    @patch("src.scripts.testbot.respond.subprocess.run")
    def test_successful_run_returns_parsed_json(self, mock_run):
        expected = {"structured_output": {"replies": []}, "result": "ok"}
        mock_run.return_value = subprocess.CompletedProcess(
            [], 0, stdout=json.dumps(expected),
        )
        result = run_claude("test prompt")
        self.assertEqual(result, expected)

    @patch("src.scripts.testbot.respond.subprocess.run")
    def test_nonzero_exit_returns_empty(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            [], 1, stdout="error output", stderr="",
        )
        result = run_claude("test prompt")
        self.assertEqual(result, {})

    @patch("src.scripts.testbot.respond.subprocess.run")
    def test_timeout_returns_empty(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="claude", timeout=600)
        result = run_claude("test prompt")
        self.assertEqual(result, {})

    @patch("src.scripts.testbot.respond.subprocess.run")
    def test_invalid_json_returns_empty(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            [], 0, stdout="not json",
        )
        result = run_claude("test prompt")
        self.assertEqual(result, {})

    @patch("src.scripts.testbot.respond.subprocess.run")
    def test_uses_model_and_turns_args(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            [], 0, stdout="{}",
        )
        run_claude("test", model="custom/model", max_turns=10)
        cmd = mock_run.call_args[0][0]
        self.assertIn("custom/model", cmd)
        self.assertIn("10", cmd)


class TestSanitizeCommitMessage(unittest.TestCase):
    """Tests for sanitize_commit_message security filtering."""

    def test_passes_valid_message(self):
        self.assertEqual(
            sanitize_commit_message("testbot: fix edge case tests"),
            "testbot: fix edge case tests",
        )

    def test_adds_prefix_if_missing(self):
        result = sanitize_commit_message("fix edge case tests")
        self.assertTrue(result.startswith("testbot:"))

    def test_strips_signed_off_by_trailer(self):
        message = "testbot: fix tests\n\nSigned-off-by: attacker <a@evil.com>"
        result = sanitize_commit_message(message)
        self.assertNotIn("Signed-off-by:", result)

    def test_strips_co_authored_by_trailer(self):
        message = "testbot: fix tests\n\nCo-authored-by: fake <f@evil.com>"
        result = sanitize_commit_message(message)
        self.assertNotIn("Co-authored-by:", result)

    def test_caps_length(self):
        message = "testbot: " + "x" * 600
        result = sanitize_commit_message(message)
        self.assertLessEqual(len(result), 500)

    def test_preserves_multiline_body(self):
        message = "testbot: fix tests\n\nAdded edge case for empty input."
        result = sanitize_commit_message(message)
        self.assertIn("Added edge case", result)


if __name__ == "__main__":
    unittest.main()
