# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for create_pr.py."""

import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from src.scripts.testbot.create_pr import _scan_suspected_bugs
from src.scripts.testbot.create_pr import has_open_testbot_pr


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
