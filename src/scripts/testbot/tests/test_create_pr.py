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
    _build_rationale_section,
    _extract_pr_url,
    _get_slack_bot_token,
    _load_targets_meta,
    _post_slack_review_request,
    _resolve_slack_channel,
    _scan_suspected_bugs,
    _test_to_source_path,
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

    def test_get_slack_bot_token_reads_testbot_token(self):
        with patch.dict(
            os.environ,
            {"TESTBOT_SLACK_BOT_TOKEN": "testbot-token"},
            clear=True,
        ):
            self.assertEqual(_get_slack_bot_token(), "testbot-token")

    def test_get_slack_bot_token_returns_empty_when_unset(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(_get_slack_bot_token(), "")

    def test_extract_pr_url_prefers_last_url_line(self):
        output = "Creating pull request\nhttps://github.com/NVIDIA/OSMO/pull/123\n"
        self.assertEqual(
            _extract_pr_url(output),
            "https://github.com/NVIDIA/OSMO/pull/123",
        )

    def test_extract_pr_url_returns_empty_without_url(self):
        self.assertEqual(_extract_pr_url("Creating pull request\nno url\n"), "")

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


class TestTestToSourcePath(unittest.TestCase):
    """Tests for mapping a generated test file back to its source path."""

    def test_python_test_in_tests_dir(self):
        self.assertEqual(
            _test_to_source_path("src/lib/utils/tests/test_common.py"),
            "src/lib/utils/common.py",
        )

    def test_python_nested_tests_dir(self):
        self.assertEqual(
            _test_to_source_path("src/service/core/data/tests/test_data_service.py"),
            "src/service/core/data/data_service.py",
        )

    def test_go_test_strips_test_suffix(self):
        self.assertEqual(
            _test_to_source_path("src/runtime/pkg/common/common_test.go"),
            "src/runtime/pkg/common/common.go",
        )

    def test_typescript_test_strips_dot_test(self):
        self.assertEqual(
            _test_to_source_path("src/ui/src/lib/foo.test.ts"),
            "src/ui/src/lib/foo.ts",
        )

    def test_typescript_tsx_test(self):
        self.assertEqual(
            _test_to_source_path("src/ui/src/components/Bar.test.tsx"),
            "src/ui/src/components/Bar.tsx",
        )

    def test_unrecognized_pattern_returns_none(self):
        self.assertIsNone(_test_to_source_path("README.md"))


class TestLoadTargetsMeta(unittest.TestCase):
    """Tests for picker-sidecar JSON loading."""

    def test_loads_valid_meta(self):
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8",
        ) as fh:
            fh.write('[{"file_path": "src/lib/foo.py", "reason": "ok"}]')
            path = fh.name
        try:
            meta = _load_targets_meta(path)
            self.assertEqual(meta["src/lib/foo.py"]["reason"], "ok")
        finally:
            os.unlink(path)

    def test_missing_path_returns_empty(self):
        self.assertEqual(_load_targets_meta(""), {})

    def test_nonexistent_file_returns_empty(self):
        self.assertEqual(_load_targets_meta("/no/such/file.json"), {})

    def test_malformed_json_returns_empty(self):
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8",
        ) as fh:
            fh.write("not json {{{")
            path = fh.name
        try:
            self.assertEqual(_load_targets_meta(path), {})
        finally:
            os.unlink(path)

    def test_non_list_payload_returns_empty(self):
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8",
        ) as fh:
            fh.write('{"file_path": "x.py"}')
            path = fh.name
        try:
            self.assertEqual(_load_targets_meta(path), {})
        finally:
            os.unlink(path)


class TestBuildRationaleSection(unittest.TestCase):
    """Tests for the 'Why this file was targeted' PR-body section."""

    def test_empty_when_no_meta(self):
        self.assertEqual(_build_rationale_section(["src/x/tests/test_y.py"], {}), "")

    def test_singular_heading_for_one_target(self):
        meta = {
            "src/lib/utils/common.py": {
                "file_path": "src/lib/utils/common.py",
                "coverage_pct": 45.3,
                "uncovered_lines": 332,
                "reason": "Highest fan-in file packed with pure utilities.",
            },
        }
        section = _build_rationale_section(
            ["src/lib/utils/tests/test_common.py"], meta,
        )
        self.assertIn("## Why this file was targeted", section)
        self.assertIn("**`src/lib/utils/common.py`**", section)
        self.assertIn("45.3% coverage", section)
        self.assertIn("332 uncovered lines", section)
        self.assertIn("> Highest fan-in", section)

    def test_plural_heading_for_multiple_targets(self):
        meta = {
            "src/a/foo.py": {
                "file_path": "src/a/foo.py",
                "coverage_pct": 10.0, "uncovered_lines": 50,
                "reason": "first",
            },
            "src/b/bar.py": {
                "file_path": "src/b/bar.py",
                "coverage_pct": 20.0, "uncovered_lines": 80,
                "reason": "second",
            },
        }
        section = _build_rationale_section(
            ["src/a/tests/test_foo.py", "src/b/tests/test_bar.py"],
            meta,
        )
        self.assertIn("## Why these files were targeted", section)
        self.assertIn("**`src/a/foo.py`**", section)
        self.assertIn("**`src/b/bar.py`**", section)

    def test_skips_test_with_no_meta(self):
        meta = {
            "src/lib/foo.py": {
                "file_path": "src/lib/foo.py",
                "coverage_pct": 10.0, "uncovered_lines": 5,
                "reason": "covered",
            },
        }
        section = _build_rationale_section(
            ["src/lib/tests/test_foo.py", "src/lib/tests/test_unrelated.py"],
            meta,
        )
        self.assertIn("**`src/lib/foo.py`**", section)
        self.assertNotIn("test_unrelated", section)
        self.assertNotIn("unrelated.py", section)

    def test_dedupes_when_two_tests_map_to_same_source(self):
        meta = {
            "src/lib/foo.py": {
                "file_path": "src/lib/foo.py",
                "coverage_pct": 10.0, "uncovered_lines": 5,
                "reason": "covered",
            },
        }
        section = _build_rationale_section(
            ["src/lib/tests/test_foo.py", "src/lib/tests/test_foo.py"],
            meta,
        )
        self.assertEqual(section.count("**`src/lib/foo.py`**"), 1)

    def test_coerces_unexpected_field_types(self):
        # Defensive: a malformed sidecar (string coverage, list uncovered,
        # numeric reason) must not crash the rendering. Numbers fall back
        # to 0 / 0.0 and reason becomes empty (no blockquote).
        meta = {
            "src/lib/foo.py": {
                "file_path": "src/lib/foo.py",
                "coverage_pct": "not a number",
                "uncovered_lines": ["wrong", "type"],
                "reason": 42,
            },
        }
        section = _build_rationale_section(
            ["src/lib/tests/test_foo.py"], meta,
        )
        self.assertIn("**`src/lib/foo.py`**", section)
        self.assertIn("0.0% coverage", section)
        self.assertIn("0 uncovered lines", section)
        self.assertNotIn("> ", section)

    def test_omits_blockquote_when_reason_empty(self):
        meta = {
            "src/lib/foo.py": {
                "file_path": "src/lib/foo.py",
                "coverage_pct": 10.0, "uncovered_lines": 5,
                "reason": "",
            },
        }
        section = _build_rationale_section(
            ["src/lib/tests/test_foo.py"], meta,
        )
        self.assertIn("**`src/lib/foo.py`**", section)
        self.assertNotIn("> ", section)


if __name__ == "__main__":
    unittest.main()
