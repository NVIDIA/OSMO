# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for create_pr.py."""

import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from src.scripts.testbot.create_pr import (
    _build_rationale_section,
    _load_targets_meta,
    _scan_suspected_bugs,
    _test_to_source_path,
    has_open_testbot_pr,
)


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
