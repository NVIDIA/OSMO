# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for create_pr.py."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from src.scripts.testbot.create_pr import (
    SLACK_API_URL,
    TESTBOT_SLACK_CHANNEL_DEFAULT,
    _build_slack_review_payload,
    _extract_pr_url,
    _get_slack_bot_token,
    _post_slack_review_request,
    _resolve_slack_channel,
    _scan_suspected_bugs,
    has_open_testbot_pr,
    main,
)


class _FakeSlackResponse:
    """Context-manager response object for urllib.urlopen mocks."""

    def __init__(self, body: str):
        self._body = body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self) -> bytes:
        return self._body


class TestHasOpenTestbotPr(unittest.TestCase):
    """Tests for has_open_testbot_pr duplicate detection."""

    @patch("src.scripts.testbot.create_pr.run")
    def test_no_open_prs_returns_false(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="0\n")
        self.assertFalse(has_open_testbot_pr())

    @patch("src.scripts.testbot.create_pr.run")
    def test_one_open_pr_returns_true(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="1\n")
        self.assertTrue(has_open_testbot_pr())

    @patch("src.scripts.testbot.create_pr.run")
    def test_multiple_open_prs_returns_true(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="3\n")
        self.assertTrue(has_open_testbot_pr())

    @patch("src.scripts.testbot.create_pr.run")
    def test_gh_command_fails_returns_true_fail_closed(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 1, stdout="", stderr="error")
        self.assertTrue(has_open_testbot_pr())

    @patch("src.scripts.testbot.create_pr.run")
    def test_non_numeric_output_returns_true_fail_closed(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="unexpected\n")
        self.assertTrue(has_open_testbot_pr())

    @patch("src.scripts.testbot.create_pr.run")
    def test_empty_output_returns_true_fail_closed(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="")
        self.assertTrue(has_open_testbot_pr())

    @patch("src.scripts.testbot.create_pr.run")
    def test_filters_by_author(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="0\n")
        has_open_testbot_pr()
        cmd = mock_run.call_args[0][0]
        self.assertIn("--author", cmd)
        self.assertIn("svc-osmo-ci", cmd)


class TestSlackReviewRequest(unittest.TestCase):
    """Tests for Slack review request helpers."""

    def test_resolve_default_slack_channel_to_id(self):
        self.assertEqual(
            _resolve_slack_channel(TESTBOT_SLACK_CHANNEL_DEFAULT),
            "C0A8RJ738KZ",
        )

    def test_resolve_unknown_slack_channel_passthrough(self):
        self.assertEqual(_resolve_slack_channel("C123"), "C123")

    def test_get_slack_bot_token_prefers_testbot_token(self):
        env = {
            "TESTBOT_SLACK_BOT_TOKEN": "testbot-token",
            "SLACK_RELEASE_BOT_TOKEN": "release-token",
        }
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(_get_slack_bot_token(), "testbot-token")

    def test_get_slack_bot_token_falls_back_to_release_token(self):
        with patch.dict(
            os.environ,
            {"SLACK_RELEASE_BOT_TOKEN": "release-token"},
            clear=True,
        ):
            self.assertEqual(_get_slack_bot_token(), "release-token")

    def test_extract_pr_url_prefers_last_url_line(self):
        output = "Creating pull request\nhttps://github.com/NVIDIA/OSMO/pull/123\n"
        self.assertEqual(
            _extract_pr_url(output),
            "https://github.com/NVIDIA/OSMO/pull/123",
        )

    def test_build_slack_review_payload(self):
        payload = _build_slack_review_payload(
            channel="#osmo-slack-test",
            pr_url="https://github.com/NVIDIA/OSMO/pull/123",
            pr_title="[testbot] Add tests for foo.py",
        )

        expected = (
            "Please review https://github.com/NVIDIA/OSMO/pull/123 "
            "to add test for foo.py."
        )
        self.assertEqual(payload["channel"], "C0A8RJ738KZ")
        self.assertEqual(payload["text"], expected)
        self.assertEqual(payload["blocks"][0]["text"]["text"], expected)

    @patch("src.scripts.testbot.create_pr.urllib.request.urlopen")
    def test_post_slack_review_request_posts_payload(self, mock_urlopen):
        mock_urlopen.return_value = _FakeSlackResponse('{"ok": true, "ts": "1"}')

        with self.assertLogs("src.scripts.testbot.create_pr", level="INFO") as logs:
            self.assertTrue(
                _post_slack_review_request(
                    bot_token="token",
                    channel="#osmo-slack-test",
                    pr_url="https://github.com/NVIDIA/OSMO/pull/123",
                    pr_title="[testbot] Add tests for foo.py",
                ),
            )

        request = mock_urlopen.call_args[0][0]
        self.assertEqual(request.full_url, SLACK_API_URL)
        self.assertEqual(request.get_method(), "POST")
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["channel"], "C0A8RJ738KZ")
        self.assertEqual(
            payload["text"],
            "Please review https://github.com/NVIDIA/OSMO/pull/123 "
            "to add test for foo.py.",
        )
        self.assertTrue(
            any("Slack review request posted" in entry and "ts=1" in entry
                for entry in logs.output),
        )

    @patch("src.scripts.testbot.create_pr.urllib.request.urlopen")
    def test_post_slack_review_request_skips_without_token(self, mock_urlopen):
        self.assertFalse(
            _post_slack_review_request(
                bot_token="",
                channel="#osmo-slack-test",
                pr_url="https://github.com/NVIDIA/OSMO/pull/123",
                pr_title="[testbot] Add tests for foo.py",
            ),
        )
        mock_urlopen.assert_not_called()

    @patch("src.scripts.testbot.create_pr.urllib.request.urlopen")
    def test_post_slack_review_request_returns_false_on_api_error(
        self,
        mock_urlopen,
    ):
        mock_urlopen.return_value = _FakeSlackResponse(
            '{"ok": false, "error": "not_in_channel"}',
        )

        self.assertFalse(
            _post_slack_review_request(
                bot_token="token",
                channel="#osmo-slack-test",
                pr_url="https://github.com/NVIDIA/OSMO/pull/123",
                pr_title="[testbot] Add tests for foo.py",
            ),
        )

    def test_main_posts_slack_review_request_after_pr_create(self):
        gh_create_result = subprocess.CompletedProcess(
            [],
            0,
            stdout="https://github.com/NVIDIA/OSMO/pull/123\n",
        )
        env = {
            "TESTBOT_SLACK_BOT_TOKEN": "token",
            "TESTBOT_SLACK_CHANNEL": "#osmo-slack-test",
        }

        with patch("src.scripts.testbot.create_pr.has_open_testbot_pr",
                   return_value=False), \
                patch("src.scripts.testbot.create_pr.get_changed_test_files",
                      return_value=["src/lib/tests/test_foo.py"]), \
                patch("src.scripts.testbot.create_pr.run",
                      return_value=subprocess.CompletedProcess([], 0)), \
                patch("src.scripts.testbot.create_pr.subprocess.run") as run_mock, \
                patch("src.scripts.testbot.create_pr._scan_suspected_bugs",
                      return_value=[]), \
                patch("src.scripts.testbot.create_pr._post_slack_review_request") \
                as post_mock, \
                patch.object(sys, "argv", ["create_pr.py"]), \
                patch.dict(os.environ, env, clear=True):
            run_mock.side_effect = [
                subprocess.CompletedProcess([], 0),
                gh_create_result,
            ]

            main()

        post_mock.assert_called_once()
        self.assertEqual(
            post_mock.call_args.kwargs["pr_url"],
            "https://github.com/NVIDIA/OSMO/pull/123",
        )
        self.assertEqual(post_mock.call_args.kwargs["bot_token"], "token")
        self.assertEqual(post_mock.call_args.kwargs["channel"], "#osmo-slack-test")


class TestScanSuspectedBugs(unittest.TestCase):
    """Tests for _scan_suspected_bugs marker extraction."""

    def _write_temp(self, content: str) -> str:
        fd, path = tempfile.mkstemp(suffix=".py")
        os.write(fd, content.encode())
        os.close(fd)
        self.addCleanup(os.unlink, path)
        return path

    def test_no_markers_returns_empty(self):
        path = self._write_temp("# normal test\ndef test_foo(): pass\n")
        self.assertEqual(_scan_suspected_bugs([path]), [])

    def test_single_marker_extracted(self):
        path = self._write_temp(
            "# SUSPECTED BUG: utils.py:parse_date — off-by-one in month calc\n"
            "@unittest.skip('source bug')\n"
            "def test_parse_date(): pass\n"
        )
        result = _scan_suspected_bugs([path])
        self.assertEqual(len(result), 1)
        self.assertIn("parse_date", result[0])
        self.assertIn("off-by-one", result[0])

    def test_multiple_markers_across_files(self):
        path1 = self._write_temp(
            "# SUSPECTED BUG: a.py:foo — returns None\n"
        )
        path2 = self._write_temp(
            "# SUSPECTED BUG: b.py:bar — wrong status code\n"
        )
        result = _scan_suspected_bugs([path1, path2])
        self.assertEqual(len(result), 2)

    def test_multiple_markers_in_same_file(self):
        path = self._write_temp(
            "# SUSPECTED BUG: a.py:foo — bug one\n"
            "def test_a(): pass\n"
            "# SUSPECTED BUG: a.py:bar — bug two\n"
            "def test_b(): pass\n"
        )
        result = _scan_suspected_bugs([path])
        self.assertEqual(len(result), 2)

    def test_missing_file_skipped(self):
        result = _scan_suspected_bugs(["/nonexistent/file.py"])
        self.assertEqual(result, [])

    def test_marker_with_extra_whitespace(self):
        path = self._write_temp(
            "#   SUSPECTED BUG:   utils.py:fn — description  \n"
        )
        result = _scan_suspected_bugs([path])
        self.assertEqual(len(result), 1)
        self.assertIn("description", result[0])

    def test_duplicate_markers_deduplicated(self):
        path = self._write_temp(
            "# SUSPECTED BUG: a.py:foo — same bug\n"
            "def test_a(): pass\n"
            "# SUSPECTED BUG: a.py:foo — same bug\n"
            "def test_b(): pass\n"
        )
        result = _scan_suspected_bugs([path])
        self.assertEqual(len(result), 1)

    def test_non_marker_comments_ignored(self):
        path = self._write_temp(
            "# This is a suspected bug in the code\n"
            "# BUG: something else\n"
            "# SUSPECTED BUG: real.py:fn — actual marker\n"
        )
        result = _scan_suspected_bugs([path])
        self.assertEqual(len(result), 1)

    def test_go_comment_style_detected(self):
        path = self._write_temp(
            "// SUSPECTED BUG: handler.go:ServeHTTP — wrong status code\n"
            "func TestServeHTTP(t *testing.T) {\n"
        )
        result = _scan_suspected_bugs([path])
        self.assertEqual(len(result), 1)
        self.assertIn("wrong status code", result[0])

    def test_typescript_comment_style_detected(self):
        path = self._write_temp(
            "// SUSPECTED BUG: utils.ts:formatDate — off-by-one month\n"
            "it.skip('source bug', () => {\n"
        )
        result = _scan_suspected_bugs([path])
        self.assertEqual(len(result), 1)
        self.assertIn("off-by-one month", result[0])


if __name__ == "__main__":
    unittest.main()
