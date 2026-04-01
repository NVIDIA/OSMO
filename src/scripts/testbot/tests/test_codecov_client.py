# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for Codecov API client."""

import unittest

from testbot.codecov_client import _lines_to_ranges, _parse_report


SAMPLE_CODECOV_RESPONSE = {
    "totals": {"files": 3, "lines": 100, "hits": 40, "misses": 60, "coverage": 40.0},
    "files": [
        {
            "name": "src/cli/access_token.py",
            "totals": {"lines": 5, "hits": 2, "misses": 3},
            "line_coverage": [[10, 0], [11, 0], [12, 1], [13, 1], [14, 1]],
        },
        {
            "name": "src/lib/utils/common.py",
            "totals": {"lines": 4, "hits": 3, "misses": 1},
            "line_coverage": [[1, 0], [2, 0], [3, 0], [4, 1]],
        },
        {
            "name": "src/tests/test_something.py",
            "totals": {"lines": 10, "hits": 10, "misses": 0},
            "line_coverage": [[1, 0], [2, 0]],
        },
    ],
}


class TestParseReport(unittest.TestCase):
    """Tests for Codecov JSON → CoverageEntry conversion."""

    def test_parses_files(self):
        entries = _parse_report(SAMPLE_CODECOV_RESPONSE)
        file_paths = [e.file_path for e in entries]
        self.assertIn("src/cli/access_token.py", file_paths)
        self.assertIn("src/lib/utils/common.py", file_paths)

    def test_filters_test_files(self):
        entries = _parse_report(SAMPLE_CODECOV_RESPONSE)
        file_paths = [e.file_path for e in entries]
        self.assertNotIn("src/tests/test_something.py", file_paths)

    def test_coverage_values(self):
        entries = _parse_report(SAMPLE_CODECOV_RESPONSE)
        token_entry = next(e for e in entries if "access_token" in e.file_path)
        self.assertEqual(token_entry.total_lines, 5)
        self.assertEqual(token_entry.covered_lines, 2)
        self.assertAlmostEqual(token_entry.coverage_pct, 40.0)

    def test_uncovered_ranges(self):
        entries = _parse_report(SAMPLE_CODECOV_RESPONSE)
        token_entry = next(e for e in entries if "access_token" in e.file_path)
        self.assertEqual(token_entry.uncovered_ranges, [(12, 14)])

    def test_sorted_by_coverage_ascending(self):
        entries = _parse_report(SAMPLE_CODECOV_RESPONSE)
        coverages = [e.coverage_pct for e in entries]
        self.assertEqual(coverages, sorted(coverages))

    def test_empty_response(self):
        entries = _parse_report({"files": []})
        self.assertEqual(entries, [])

    def test_skips_files_with_no_line_coverage(self):
        data = {"files": [{"name": "empty.py", "totals": {"lines": 0}, "line_coverage": []}]}
        entries = _parse_report(data)
        self.assertEqual(entries, [])


class TestLinesToRanges(unittest.TestCase):
    """Tests for converting line numbers to contiguous ranges."""

    def test_contiguous(self):
        self.assertEqual(_lines_to_ranges([1, 2, 3]), [(1, 3)])

    def test_gaps(self):
        self.assertEqual(_lines_to_ranges([1, 2, 3, 7, 8]), [(1, 3), (7, 8)])

    def test_single_line(self):
        self.assertEqual(_lines_to_ranges([5]), [(5, 5)])

    def test_all_gaps(self):
        self.assertEqual(_lines_to_ranges([1, 3, 5]), [(1, 1), (3, 3), (5, 5)])

    def test_empty(self):
        self.assertEqual(_lines_to_ranges([]), [])


if __name__ == "__main__":
    unittest.main()
