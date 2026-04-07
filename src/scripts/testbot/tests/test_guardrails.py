# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for guardrails.py."""

import subprocess
import unittest
from unittest.mock import patch

from src.scripts.testbot.guardrails import get_changed_files, get_changed_test_files, is_test_file


class TestIsTestFile(unittest.TestCase):
    """Tests for is_test_file pattern matching."""

    def test_matches_python_test(self):
        self.assertTrue(is_test_file("src/utils/tests/test_task.py"))

    def test_matches_go_test(self):
        self.assertTrue(is_test_file("src/utils/roles/roles_test.go"))

    def test_matches_vitest_ts(self):
        self.assertTrue(is_test_file("src/ui/src/lib/foo.test.ts"))

    def test_matches_vitest_tsx(self):
        self.assertTrue(is_test_file("src/ui/src/components/bar.test.tsx"))

    def test_matches_build_file(self):
        self.assertTrue(is_test_file("src/utils/job/tests/BUILD"))

    def test_rejects_build_outside_tests_dir(self):
        self.assertFalse(is_test_file("src/service/core/auth/BUILD"))

    def test_rejects_root_build(self):
        self.assertFalse(is_test_file("BUILD"))

    def test_rejects_source_python(self):
        self.assertFalse(is_test_file("src/service/core/auth/auth_service.py"))

    def test_rejects_source_go(self):
        self.assertFalse(is_test_file("src/runtime/cmd/ctrl/main.go"))

    def test_rejects_source_ts(self):
        self.assertFalse(is_test_file("src/ui/src/lib/date-range-utils.ts"))

    def test_rejects_yaml(self):
        self.assertFalse(is_test_file(".github/workflows/testbot.yaml"))

    def test_rejects_markdown(self):
        self.assertFalse(is_test_file("src/scripts/testbot/README.md"))

    def test_case_sensitive_no_match(self):
        self.assertFalse(is_test_file("src/foo/test_bar.PY"))


class TestGetChangedTestFiles(unittest.TestCase):
    """Tests for get_changed_test_files with mocked git commands."""

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_returns_only_test_files(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout="src/utils/tests/test_task.py\nsrc/service/core/auth_service.py\n"),
            subprocess.CompletedProcess([], 0, stdout=""),
            subprocess.CompletedProcess([], 0, stdout=""),  # git checkout for non-test
        ]
        result = get_changed_test_files()
        self.assertEqual(result, ["src/utils/tests/test_task.py"])

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_includes_untracked_test_files(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout=""),
            subprocess.CompletedProcess([], 0, stdout="src/ui/src/lib/foo.test.ts\n"),
        ]
        result = get_changed_test_files()
        self.assertEqual(result, ["src/ui/src/lib/foo.test.ts"])

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_filters_claude_artifacts(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout=".claude/tmp/foo.py\nsrc/utils/tests/test_task.py\n"),
            subprocess.CompletedProcess([], 0, stdout=""),
        ]
        result = get_changed_test_files()
        self.assertEqual(result, ["src/utils/tests/test_task.py"])

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_empty_diff_returns_empty(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout=""),
            subprocess.CompletedProcess([], 0, stdout=""),
        ]
        result = get_changed_test_files()
        self.assertEqual(result, [])

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_discards_non_test_files_via_checkout(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout="src/service/core/service.py\n"),
            subprocess.CompletedProcess([], 0, stdout=""),
            subprocess.CompletedProcess([], 0, stdout=""),  # git checkout
        ]
        get_changed_test_files()
        checkout_call = mock_run.call_args_list[2]
        self.assertEqual(
            checkout_call[0][0],
            ["git", "checkout", "--", "src/service/core/service.py"],
        )

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_git_diff_failure_logs_and_continues(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 1, stdout="", stderr="fatal: error"),
            subprocess.CompletedProcess([], 0, stdout="src/ui/src/lib/foo.test.ts\n"),
        ]
        result = get_changed_test_files()
        self.assertEqual(result, ["src/ui/src/lib/foo.test.ts"])

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_returns_sorted(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout="z_test.go\na_test.go\n"),
            subprocess.CompletedProcess([], 0, stdout=""),
        ]
        result = get_changed_test_files()
        self.assertEqual(result, ["a_test.go", "z_test.go"])

    @patch("src.scripts.testbot.guardrails.os.remove")
    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_deletes_untracked_non_test_files(self, mock_run, mock_remove):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout=""),
            subprocess.CompletedProcess([], 0, stdout="src/malicious.py\nsrc/utils/tests/test_new.py\n"),
        ]
        result = get_changed_test_files()
        self.assertEqual(result, ["src/utils/tests/test_new.py"])
        mock_remove.assert_called_once_with("src/malicious.py")

    @patch("src.scripts.testbot.guardrails.os.remove")
    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_tracked_reverted_untracked_deleted(self, mock_run, mock_remove):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout="src/tracked_source.py\n"),
            subprocess.CompletedProcess([], 0, stdout="src/new_malicious.py\n"),
            subprocess.CompletedProcess([], 0, stdout=""),  # git checkout for tracked
        ]
        get_changed_test_files()
        checkout_call = mock_run.call_args_list[2]
        self.assertEqual(
            checkout_call[0][0],
            ["git", "checkout", "--", "src/tracked_source.py"],
        )
        mock_remove.assert_called_once_with("src/new_malicious.py")


class TestGetChangedFiles(unittest.TestCase):
    """Tests for get_changed_files (no filtering, used by respond workflow)."""

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_returns_all_files_including_non_test(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout="src/service/core/service.py\nsrc/utils/tests/test_task.py\n"),
            subprocess.CompletedProcess([], 0, stdout=""),
        ]
        result = get_changed_files()
        self.assertEqual(result, ["src/service/core/service.py", "src/utils/tests/test_task.py"])

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_includes_untracked_files(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout=""),
            subprocess.CompletedProcess([], 0, stdout="src/new_file.py\n"),
        ]
        result = get_changed_files()
        self.assertEqual(result, ["src/new_file.py"])

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_filters_claude_artifacts(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout=".claude/tmp/foo.py\nsrc/fix.py\n"),
            subprocess.CompletedProcess([], 0, stdout=""),
        ]
        result = get_changed_files()
        self.assertEqual(result, ["src/fix.py"])

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_empty_diff_returns_empty(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout=""),
            subprocess.CompletedProcess([], 0, stdout=""),
        ]
        result = get_changed_files()
        self.assertEqual(result, [])

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_does_not_revert_or_delete(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout="src/source.py\n"),
            subprocess.CompletedProcess([], 0, stdout="src/new.py\n"),
        ]
        result = get_changed_files()
        self.assertEqual(result, ["src/new.py", "src/source.py"])
        self.assertEqual(mock_run.call_count, 2)

    @patch("src.scripts.testbot.guardrails.subprocess.run")
    def test_returns_sorted(self, mock_run):
        mock_run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout="z.py\na.py\n"),
            subprocess.CompletedProcess([], 0, stdout="m.py\n"),
        ]
        result = get_changed_files()
        self.assertEqual(result, ["a.py", "m.py", "z.py"])


if __name__ == "__main__":
    unittest.main()
