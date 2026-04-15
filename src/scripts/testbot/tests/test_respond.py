# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for respond.py."""

import json
import subprocess
import unittest
from typing import Any
from unittest.mock import patch

from src.scripts.testbot.respond import (
    _extract_replies,
    _has_trigger,
    build_prompt,
    filter_actionable,
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

    def test_trigger_with_coderabbit_followup(self):
        """CodeRabbit posting after /testbot should not cause skip."""
        comments = [
            {"id": 100, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "I suggest refactoring...", "author": "coderabbitai[bot]", "association": "NONE"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["reply_comment_id"], 100)

    def test_trigger_handled_then_coderabbit_followup(self):
        """After bot replied, CodeRabbit followup should not re-trigger."""
        comments = [
            {"id": 100, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "Fix applied.", "author": "svc-osmo-ci", "association": "NONE"},
            {"id": 300, "body": "I suggest refactoring...", "author": "coderabbitai[bot]", "association": "NONE"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_new_trigger_after_bot_reply(self):
        """New /testbot after bot reply should be actionable."""
        comments = [
            {"id": 100, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "Fix applied.", "author": "svc-osmo-ci", "association": "NONE"},
            {"id": 300, "body": "/testbot try again", "author": "jiaenren", "association": "MEMBER"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["reply_comment_id"], 300)


class TestExtractReplies(unittest.TestCase):
    """Tests for _extract_replies tiered fallback."""

    def test_tier1_structured_output(self):
        claude_output = {
            "structured_output": {
                "replies": [
                    {"comment_id": "123", "reply": "Added edge case tests."},
                    {"comment_id": "456", "reply": "Fixed the assertion."},
                ],
            },
        }
        result = _extract_replies(claude_output)
        self.assertEqual(len(result), 2)
        self.assertEqual(result["123"], "Added edge case tests.")
        self.assertEqual(result["456"], "Fixed the assertion.")

    def test_tier1_empty_replies_falls_through(self):
        claude_output: dict[str, Any] = {"structured_output": {"replies": []}}
        self.assertEqual(_extract_replies(claude_output), {})

    def test_tier1_not_dict_falls_through(self):
        claude_output = {"structured_output": "not a dict", "result": ""}
        self.assertEqual(_extract_replies(claude_output), {})

    def test_tier2_json_in_result_text(self):
        data = json.dumps({
            "replies": [{"comment_id": "789", "reply": "Done."}],
        })
        claude_output = {"result": f"Here is the output: {data}"}
        result = _extract_replies(claude_output)
        self.assertEqual(result["789"], "Done.")

    def test_tier2_no_replies_key(self):
        claude_output = {"result": '{"other_key": "value"}'}
        self.assertEqual(_extract_replies(claude_output), {})

    def test_tier2_malformed_json(self):
        claude_output = {"result": "this is {not valid json"}
        self.assertEqual(_extract_replies(claude_output), {})

    def test_skips_entries_without_comment_id(self):
        claude_output = {
            "structured_output": {
                "replies": [{"reply": "no comment id"}],
            },
        }
        self.assertEqual(_extract_replies(claude_output), {})

    def test_skips_entries_without_reply(self):
        claude_output = {
            "structured_output": {
                "replies": [{"comment_id": "123", "reply": ""}],
            },
        }
        self.assertEqual(_extract_replies(claude_output), {})

    def test_empty_output(self):
        self.assertEqual(_extract_replies({}), {})

    def test_no_result_no_structured(self):
        claude_output = {"result": ""}
        self.assertEqual(_extract_replies(claude_output), {})


class TestBuildPrompt(unittest.TestCase):
    """Tests for build_prompt formatting."""

    def test_single_thread_includes_location(self):
        threads = [{
            "reply_comment_id": 123,
            "path": "src/ui/src/lib/foo.test.ts",
            "line": 42,
            "thread_history": "  [reviewer]: /testbot add edge cases",
        }]
        prompt = build_prompt(threads, pr_number=99)
        self.assertIn("`src/ui/src/lib/foo.test.ts` line 42", prompt)
        self.assertIn("### Comment 123", prompt)
        self.assertIn("[reviewer]: /testbot add edge cases", prompt)

    def test_references_respond_prompt(self):
        threads = [{
            "reply_comment_id": 1,
            "path": "foo.test.ts",
            "line": 1,
            "thread_history": "  [user]: /testbot fix",
        }]
        prompt = build_prompt(threads, pr_number=99)
        self.assertIn("TESTBOT_RESPOND_PROMPT.md", prompt)

    def test_includes_pr_number(self):
        threads = [{
            "reply_comment_id": 1,
            "path": "foo.py",
            "line": 1,
            "thread_history": "  [user]: /testbot fix",
        }]
        prompt = build_prompt(threads, pr_number=857)
        self.assertIn("PR #857", prompt)


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
    def test_timeout_returns_timeout_marker(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="claude", timeout=720)
        result = run_claude("test prompt")
        self.assertTrue(result.get("is_error"))
        self.assertEqual(result.get("subtype"), "timeout")

    @patch("src.scripts.testbot.respond.subprocess.run")
    def test_invalid_json_returns_empty(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            [], 0, stdout="not json",
        )
        result = run_claude("test prompt")
        self.assertEqual(result, {})

    @patch("src.scripts.testbot.respond.subprocess.run")
    def test_nonzero_exit_with_valid_json_returns_parsed(self, mock_run):
        expected = {"is_error": True, "subtype": "error_max_turns", "result": "partial"}
        mock_run.return_value = subprocess.CompletedProcess(
            [], 1, stdout=json.dumps(expected), stderr="",
        )
        result = run_claude("test prompt")
        self.assertEqual(result, expected)

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
