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

from src.scripts.testbot.create_pr import (  # noqa: E501
    _build_generator_summary_section,
    SLACK_API_URL,
    TESTBOT_SLACK_CHANNEL_DEFAULT,
    _build_coverage_section,
    _build_rationale_section,
    _build_slack_review_payload,
    _enable_auto_merge,
    _extract_pr_url,
    _get_slack_bot_token,
    _load_targets_meta,
    _post_slack_review_request,
    _resolve_slack_channel,
    _scan_suspected_bugs,
    _test_to_source_path,
    _test_to_source_paths,
    has_unapproved_testbot_pr,
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


class TestHasUnapprovedTestbotPr(unittest.TestCase):
    """Tests for unapproved testbot PR duplicate detection."""

    @patch("src.scripts.testbot.create_pr.run")
    def test_no_open_prs_returns_false(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="0\n")
        self.assertFalse(has_unapproved_testbot_pr())

    @patch("src.scripts.testbot.create_pr.run")
    def test_one_unapproved_pr_returns_true(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="1\n")
        self.assertTrue(has_unapproved_testbot_pr())

    @patch("src.scripts.testbot.create_pr.run")
    def test_multiple_unapproved_prs_returns_true(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="3\n")
        self.assertTrue(has_unapproved_testbot_pr())

    @patch("src.scripts.testbot.create_pr.run")
    def test_gh_command_fails_returns_true_fail_closed(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 1, stdout="", stderr="error")
        self.assertTrue(has_unapproved_testbot_pr())

    @patch("src.scripts.testbot.create_pr.run")
    def test_force_create_pr_bypasses_check_without_running_gh(self, mock_run):
        # The workflow_dispatch `force_create_pr=true` input sets
        # FORCE_CREATE_PR=true. The script must short-circuit BEFORE
        # invoking `gh pr list` so that branch-side verification runs
        # don't get blocked by an already-open ai-generated PR.
        with patch.dict(os.environ, {"FORCE_CREATE_PR": "true"}, clear=False):
            self.assertFalse(has_unapproved_testbot_pr())
        mock_run.assert_not_called()

    @patch("src.scripts.testbot.create_pr.run")
    def test_force_create_pr_case_insensitive(self, mock_run):
        # Tolerate "True" / "TRUE" from YAML boolean coercion.
        for value in ("true", "True", "TRUE"):
            mock_run.reset_mock()
            with patch.dict(os.environ, {"FORCE_CREATE_PR": value}, clear=False):
                self.assertFalse(has_unapproved_testbot_pr())
            mock_run.assert_not_called()

    @patch("src.scripts.testbot.create_pr.run")
    def test_force_create_pr_false_or_unset_falls_through_to_gh(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="2\n")
        for value in ("false", "False", "", "0"):
            mock_run.reset_mock(return_value=False)
            with patch.dict(os.environ, {"FORCE_CREATE_PR": value}, clear=False):
                self.assertTrue(has_unapproved_testbot_pr())
            mock_run.assert_called_once()

    @patch("src.scripts.testbot.create_pr.run")
    def test_non_numeric_output_returns_true_fail_closed(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="unexpected\n")
        self.assertTrue(has_unapproved_testbot_pr())

    @patch("src.scripts.testbot.create_pr.run")
    def test_empty_output_returns_true_fail_closed(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="")
        self.assertTrue(has_unapproved_testbot_pr())

    @patch("src.scripts.testbot.create_pr.run")
    def test_filters_by_author_and_review_decision(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="0\n")
        has_unapproved_testbot_pr()
        cmd = mock_run.call_args[0][0]
        self.assertIn("--author", cmd)
        self.assertIn("svc-osmo-ci", cmd)
        self.assertIn("number,reviewDecision", cmd)
        self.assertTrue(
            any('select(.reviewDecision != "APPROVED")' in arg for arg in cmd),
        )


class TestPrCreationHelpers(unittest.TestCase):
    """Tests for PR creation helper functions."""

    def test_extract_pr_url_prefers_last_url_line(self):
        output = (
            "Creating pull request\n"
            "https://github.com/NVIDIA/OSMO/pull/122\n"
            "https://github.com/NVIDIA/OSMO/pull/123\n"
        )
        self.assertEqual(
            _extract_pr_url(output),
            "https://github.com/NVIDIA/OSMO/pull/123",
        )

    def test_extract_pr_url_returns_empty_without_url(self):
        self.assertEqual(_extract_pr_url("Creating pull request\nno url\n"), "")

    @patch("src.scripts.testbot.create_pr.run")
    def test_enable_auto_merge_runs_gh_pr_merge_auto(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0)

        self.assertTrue(
            _enable_auto_merge("https://github.com/NVIDIA/OSMO/pull/123"),
        )

        self.assertEqual(
            mock_run.call_args[0][0],
            [
                "gh", "pr", "merge", "--auto", "--squash",
                "https://github.com/NVIDIA/OSMO/pull/123",
            ],
        )
        self.assertFalse(mock_run.call_args.kwargs["check"])

    @patch("src.scripts.testbot.create_pr.run")
    def test_enable_auto_merge_skips_empty_url(self, mock_run):
        self.assertFalse(_enable_auto_merge(""))
        mock_run.assert_not_called()

    @patch("src.scripts.testbot.create_pr.run")
    def test_enable_auto_merge_returns_false_on_failure(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 1, stderr="error")

        self.assertFalse(
            _enable_auto_merge("https://github.com/NVIDIA/OSMO/pull/123"),
        )

    def test_main_enables_auto_merge_after_pr_create(self):
        gh_create_result = subprocess.CompletedProcess(
            [],
            0,
            stdout="https://github.com/NVIDIA/OSMO/pull/123\n",
        )

        with patch("src.scripts.testbot.create_pr.has_unapproved_testbot_pr",
                   return_value=False), \
                patch("src.scripts.testbot.create_pr.get_changed_test_files",
                      return_value=["src/lib/tests/test_foo.py"]), \
                patch("src.scripts.testbot.create_pr.run",
                      return_value=subprocess.CompletedProcess([], 0)), \
                patch("src.scripts.testbot.create_pr.subprocess.run") as run_mock, \
                patch("src.scripts.testbot.create_pr._scan_suspected_bugs",
                      return_value=[]), \
                patch("src.scripts.testbot.create_pr._enable_auto_merge") \
                as enable_auto_merge_mock, \
                patch.object(sys, "argv", ["create_pr.py"]):
            run_mock.side_effect = [
                subprocess.CompletedProcess([], 0),
                gh_create_result,
            ]
            enable_auto_merge_mock.return_value = True

            main()

        enable_auto_merge_mock.assert_called_once_with(
            "https://github.com/NVIDIA/OSMO/pull/123",
        )

    def test_main_exits_when_auto_merge_enable_fails(self):
        gh_create_result = subprocess.CompletedProcess(
            [],
            0,
            stdout="https://github.com/NVIDIA/OSMO/pull/123\n",
        )

        with patch("src.scripts.testbot.create_pr.has_unapproved_testbot_pr",
                   return_value=False), \
                patch("src.scripts.testbot.create_pr.get_changed_test_files",
                      return_value=["src/lib/tests/test_foo.py"]), \
                patch("src.scripts.testbot.create_pr.run",
                      return_value=subprocess.CompletedProcess([], 0)), \
                patch("src.scripts.testbot.create_pr.subprocess.run") as run_mock, \
                patch("src.scripts.testbot.create_pr._scan_suspected_bugs",
                      return_value=[]), \
                patch("src.scripts.testbot.create_pr._enable_auto_merge") \
                as enable_auto_merge_mock, \
                patch("src.scripts.testbot.create_pr._post_slack_review_request") \
                as post_slack_mock, \
                patch.object(sys, "argv", ["create_pr.py"]):
            run_mock.side_effect = [
                subprocess.CompletedProcess([], 0),
                gh_create_result,
            ]
            enable_auto_merge_mock.return_value = False

            with self.assertRaises(SystemExit) as exit_ctx:
                main()

        self.assertNotIn(exit_ctx.exception.code, (0, None))
        enable_auto_merge_mock.assert_called_once_with(
            "https://github.com/NVIDIA/OSMO/pull/123",
        )
        post_slack_mock.assert_not_called()


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
    def test_post_slack_review_request_skips_when_channel_empty(
        self,
        mock_urlopen,
    ):
        # Empty channel is the workflow_dispatch "no notification"
        # signal. We must short-circuit BEFORE any HTTP call so an
        # ad-hoc run never accidentally posts.
        self.assertFalse(
            _post_slack_review_request(
                bot_token="token",
                channel="",
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

        with patch("src.scripts.testbot.create_pr.has_unapproved_testbot_pr",
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

    def test_unittest_skip_reason_string_detected(self):
        # PR #1046 regression: Claude wrote the marker as the skip
        # decorator's reason string instead of a sibling comment. The
        # scanner must catch this form so the PR body's "Suspected
        # bugs" section reflects the signal.
        path = self._write_temp(
            "    @unittest.skip(\n"
            "        'Suspected source bug: get_resource_from_spec "
            "assumes cpu/gpu values are dicts'\n"
            "    )\n"
            "    def test_to_pod_resource_spec_drops_zero_gpu(self):\n"
        )
        result = _scan_suspected_bugs([path])
        self.assertEqual(len(result), 1)
        self.assertIn("get_resource_from_spec", result[0])
        # Trailing closing quote on the captured string must be trimmed.
        self.assertFalse(result[0].endswith("'"))
        self.assertFalse(result[0].endswith('"'))

    def test_go_t_skip_reason_string_detected(self):
        # Mirror of the Python case for Go-style integration tests
        # where the bot leaves the marker in the t.Skip(...) argument.
        path = self._write_temp(
            "func TestThing(t *testing.T) {\n"
            "    t.Skip(\"Suspected library bug: pool.Acquire never "
            "returns on closed pool\")\n"
            "}\n"
        )
        result = _scan_suspected_bugs([path])
        self.assertEqual(len(result), 1)
        self.assertIn("pool.Acquire", result[0])
        self.assertFalse(result[0].endswith('"'))

    def test_prose_mention_inside_comment_still_ignored(self):
        # Don't regress the existing safety: free-form prose that
        # happens to contain the words "suspected" and "bug" must not
        # trigger a section. Anchor stays on the comment/quote prefix
        # immediately preceding "Suspected ... bug".
        path = self._write_temp(
            "# We chased a suspected bug here for a week — turned out\n"
            "# to be a flaky test. Leaving the note for posterity.\n"
            "def test_unrelated_thing(self):\n"
            "    self.assertTrue(True)\n"
        )
        self.assertEqual(_scan_suspected_bugs([path]), [])


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

    def test_go_integration_test_returns_two_candidates(self):
        # PR #1058 regression: user_role_sync_integration_test.go must
        # map to user_role_sync.go (the picker's real source target),
        # not user_role_sync_integration.go (the naive _test strip).
        # Both are returned so the caller can prefer whichever exists
        # in the picker meta.
        candidates = _test_to_source_paths(
            "src/utils/roles/user_role_sync_integration_test.go"
        )
        self.assertEqual(candidates, [
            "src/utils/roles/user_role_sync_integration.go",
            "src/utils/roles/user_role_sync.go",
        ])

    def test_plain_go_test_returns_single_candidate(self):
        # No _integration_test suffix → only the naive strip.
        self.assertEqual(
            _test_to_source_paths("src/utils/roles/roles_test.go"),
            ["src/utils/roles/roles.go"],
        )


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

    def test_go_integration_test_attaches_rationale_to_underscore_source(self):
        # PR #1058 regression: the rationale silently dropped because
        # the naive `_test` strip mapped the integration test to
        # `user_role_sync_integration.go` instead of the picker's
        # target `user_role_sync.go`. The fallback candidate must
        # match the picker meta.
        meta = {
            "src/utils/roles/user_role_sync.go": {
                "file_path": "src/utils/roles/user_role_sync.go",
                "coverage_pct": 0.0,
                "uncovered_lines": 97,
                "reason": "Owns IDP-to-OSMO role sync — RBAC blast radius.",
            },
        }
        section = _build_rationale_section(
            ["src/utils/roles/user_role_sync_integration_test.go"],
            meta,
        )
        self.assertIn("`src/utils/roles/user_role_sync.go`", section)
        self.assertIn("Owns IDP-to-OSMO role sync", section)

    def test_prefers_naive_strip_when_both_candidates_match_meta(self):
        # Hypothetical: meta has BOTH `kafka_integration.go` (a real
        # source file) and `kafka.go`. The naive strip wins so we
        # don't accidentally attach the kafka-integration rationale to
        # kafka.go.
        meta = {
            "src/foo/kafka.go": {
                "file_path": "src/foo/kafka.go",
                "coverage_pct": 50.0, "uncovered_lines": 10,
                "reason": "kafka rationale",
            },
            "src/foo/kafka_integration.go": {
                "file_path": "src/foo/kafka_integration.go",
                "coverage_pct": 30.0, "uncovered_lines": 20,
                "reason": "kafka_integration rationale",
            },
        }
        section = _build_rationale_section(
            ["src/foo/kafka_integration_test.go"], meta,
        )
        self.assertIn("kafka_integration rationale", section)
        self.assertNotIn("kafka rationale", section)

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

    def test_multi_sentence_reason_with_roi_clause_preserved(self):
        # Per the picker prompt's 3-clause contract, the reason names
        # (a) behavior owned, (b) regression class caught, (c) why this
        # file beat the rest of the shortlist. All three must reach the
        # PR body unaltered so reviewers can audit the comparative
        # call.
        meta = {
            "src/utils/job/jobs.py": {
                "file_path": "src/utils/job/jobs.py",
                "coverage_pct": 30.0,
                "uncovered_lines": 500,
                "reason": (
                    "Owns the workflow job state machine. A silent "
                    "regression here would corrupt workflow state. "
                    "Highest ROI on today's shortlist: 22 commits in "
                    "6mo plus public resource-validation surface."
                ),
            },
        }
        section = _build_rationale_section(
            ["src/utils/job/tests/test_jobs.py"], meta,
        )
        self.assertIn("workflow job state machine", section)
        self.assertIn("would corrupt workflow state", section)
        self.assertIn("Highest ROI on today's shortlist", section)
        self.assertIn("22 commits in", section)

    def test_reason_with_embedded_newlines_renders_each_line_quoted(self):
        # If the LLM hand-wraps the reason for readability, every
        # rendered line must carry the blockquote `>` prefix so the
        # PR body still reads as one logical quote on GitHub.
        meta = {
            "src/lib/foo.py": {
                "file_path": "src/lib/foo.py",
                "coverage_pct": 25.0,
                "uncovered_lines": 100,
                "reason": (
                    "Owns the foo contract.\n"
                    "Regression class: silent serializer drift.\n"
                    "ROI: highest fan-in (47) on the list."
                ),
            },
        }
        section = _build_rationale_section(
            ["src/lib/tests/test_foo.py"], meta,
        )
        self.assertIn("> Owns the foo contract.", section)
        self.assertIn("> Regression class: silent serializer drift.", section)
        self.assertIn("> ROI: highest fan-in (47) on the list.", section)

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


class TestBuildGeneratorSummarySection(unittest.TestCase):
    """Tests for the Generator-summary section renderer."""

    def _write_temp(self, content: str) -> str:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False, encoding="utf-8",
        ) as fh:
            fh.write(content)
            return fh.name

    def test_empty_path_returns_empty(self):
        self.assertEqual(_build_generator_summary_section(""), "")

    def test_missing_file_returns_empty_without_raising(self):
        # Fail-soft: a missing summary file just omits the section
        # rather than crashing PR creation (it's optional context).
        self.assertEqual(
            _build_generator_summary_section("/nonexistent/summary.md"), "",
        )

    def test_renders_section_with_llm_body(self):
        body = (
            "## Coverage Report\n\n"
            "**Target: `src/utils/roles/user_role_sync.go`**\n\n"
            "- Lines now hit: **93 / 97 (96%)**\n"
            "- Lines still uncovered: **4**\n"
        )
        path = self._write_temp(body)
        try:
            section = _build_generator_summary_section(path)
        finally:
            os.unlink(path)
        self.assertTrue(section.startswith("## Generator summary"))
        self.assertIn("93 / 97 (96%)", section)
        self.assertIn("user_role_sync.go", section)
        # No spurious double-newlines around the heading.
        self.assertNotIn("\n\n\n\n", section)

    def test_strips_leading_and_trailing_whitespace_from_body(self):
        path = self._write_temp("\n\n\nactual content\n\n\n")
        try:
            section = _build_generator_summary_section(path)
        finally:
            os.unlink(path)
        self.assertIn("actual content", section)
        # Section ends with a single trailing newline (delimiter for
        # the next section), no extra blanks.
        self.assertTrue(section.endswith("actual content\n"))

    def test_blank_summary_file_returns_empty(self):
        # If the LLM produced no final text, drop the section entirely
        # rather than emitting an empty heading.
        path = self._write_temp("   \n\n\t\n")
        try:
            self.assertEqual(_build_generator_summary_section(path), "")
        finally:
            os.unlink(path)


class TestBuildCoverageSection(unittest.TestCase):
    """Tests for the verify_coverage.py JSON → PR body renderer."""

    def _write_report(self, payload: list) -> str:
        """Helper: dump ``payload`` to a tempfile and return its path."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8",
        ) as fh:
            json.dump(payload, fh)
            return fh.name

    def test_empty_path_returns_empty(self):
        self.assertEqual(_build_coverage_section(""), "")

    def test_missing_file_returns_empty(self):
        # A non-existent path is treated as "no report yet" — the PR
        # still opens; only the section is omitted.
        self.assertEqual(_build_coverage_section("/nonexistent.json"), "")

    def test_malformed_json_returns_empty(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8",
        ) as fh:
            fh.write("not json")
            path = fh.name
        try:
            self.assertEqual(_build_coverage_section(path), "")
        finally:
            os.unlink(path)

    def test_renders_pass_target_with_check_marker(self):
        path = self._write_report([
            {
                "file_path": "src/utils/roles/roles.go",
                "listed_lines": 10,
                "hit_lines": 8,
                "hit_fraction": 0.80,
                "passed": True,
                "lcov_seen": True,
                "ranges": [
                    {"start": 90, "end": 99,
                     "hit_lines": 8, "total_lines": 10, "covered": True},
                ],
                "still_uncovered_ranges": [],
            },
        ])
        try:
            section = _build_coverage_section(path)
        finally:
            os.unlink(path)
        self.assertIn("## Coverage gain on listed uncovered ranges", section)
        self.assertIn("src/utils/roles/roles.go", section)
        self.assertIn("8/10", section)
        self.assertIn("80%", section)
        self.assertIn("✅", section)
        # Per-range detail should be in the body so reviewers can scan
        # which blocks were missed without leaving the PR.
        self.assertIn("lines 90-99", section)

    def test_below_threshold_target_gets_warning_marker(self):
        path = self._write_report([
            {
                "file_path": "src/utils/roles/roles.go",
                "listed_lines": 121,
                "hit_lines": 3,
                "hit_fraction": 0.025,
                "passed": False,
                "lcov_seen": True,
                "ranges": [],
                "still_uncovered_ranges": [],
            },
        ])
        try:
            section = _build_coverage_section(path)
        finally:
            os.unlink(path)
        # The PR #1033 failure mode (3/121 = 2%) should be loud and
        # scannable, so the reviewer doesn't need to compute it.
        self.assertIn("⚠️", section)
        self.assertIn("3/121", section)
        self.assertIn("2%", section)

    def test_lcov_miss_target_gets_question_marker(self):
        path = self._write_report([
            {
                "file_path": "src/lib/foo.py",
                "listed_lines": 5,
                "hit_lines": 0,
                "hit_fraction": 0.0,
                "passed": False,
                "lcov_seen": False,
                "ranges": [],
                "still_uncovered_ranges": [[1, 5]],
            },
        ])
        try:
            section = _build_coverage_section(path)
        finally:
            os.unlink(path)
        self.assertIn("❔", section)
        self.assertIn("file not found in LCOV", section)

    def test_renders_with_malformed_numeric_fields(self):
        # A stray non-numeric value (e.g., upstream tool wrote a string)
        # must not abort PR creation. Defaults to 0 so the row still shows.
        path = self._write_report([
            {
                "file_path": "src/lib/foo.py",
                "listed_lines": "not-a-number",
                "hit_lines": None,
                "hit_fraction": "bogus",
                "passed": False,
                "lcov_seen": True,
                "ranges": [],
                "still_uncovered_ranges": [],
            },
        ])
        try:
            section = _build_coverage_section(path)
        finally:
            os.unlink(path)
        self.assertIn("src/lib/foo.py", section)
        self.assertIn("0/0", section)
        self.assertIn("0%", section)

    def test_single_line_range_renders_singular_form(self):
        # Reviewers find "lines 5-5" jarring; verify we say "line 5"
        # when start == end.
        path = self._write_report([
            {
                "file_path": "src/lib/foo.py",
                "listed_lines": 1,
                "hit_lines": 1,
                "hit_fraction": 1.0,
                "passed": True,
                "lcov_seen": True,
                "ranges": [
                    {"start": 5, "end": 5,
                     "hit_lines": 1, "total_lines": 1, "covered": True},
                ],
                "still_uncovered_ranges": [],
            },
        ])
        try:
            section = _build_coverage_section(path)
        finally:
            os.unlink(path)
        self.assertIn("line 5", section)
        self.assertNotIn("lines 5-5", section)


if __name__ == "__main__":
    unittest.main()
