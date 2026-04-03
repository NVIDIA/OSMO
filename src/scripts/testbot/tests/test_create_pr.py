# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for create_pr.py."""

import subprocess
import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
