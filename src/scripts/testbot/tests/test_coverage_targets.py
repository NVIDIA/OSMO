# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for coverage_targets.py."""

import unittest
from typing import Any

from src.scripts.testbot.coverage_targets import (
    _cap_ranges,
    _is_ignored,
    _lines_to_ranges,
    format_targets,
    select_targets,
)


class TestIsIgnored(unittest.TestCase):
    """Tests for _is_ignored file path filtering."""

    def test_ignores_top_level_tests_dir(self):
        self.assertTrue(_is_ignored("src/tests/conftest.py"))

    def test_ignores_nested_tests_dir(self):
        self.assertTrue(_is_ignored("src/service/core/workflow/tests/fixture.py"))

    def test_ignores_deeply_nested_tests_dir(self):
        self.assertTrue(_is_ignored("src/lib/data/storage/backends/tests/smoke.py"))

    def test_ignores_scripts_directory(self):
        self.assertTrue(_is_ignored("src/scripts/testbot/main.py"))

    def test_ignores_bzl_directory(self):
        self.assertTrue(_is_ignored("bzl/linting/rules.py"))

    def test_ignores_run_directory(self):
        self.assertTrue(_is_ignored("run/start.sh"))

    def test_ignores_deployments_directory(self):
        self.assertTrue(_is_ignored("deployments/charts/values.yaml"))

    def test_ignores_generated_typescript(self):
        self.assertTrue(_is_ignored("src/ui/src/lib/api/generated.ts"))

    def test_ignores_protobuf_generated(self):
        self.assertTrue(_is_ignored("src/service/core/proto_pb2.py"))

    def test_ignores_grpc_generated(self):
        self.assertTrue(_is_ignored("src/service/core/proto_pb2_grpc.py"))

    def test_ignores_python_test_file(self):
        self.assertTrue(_is_ignored("src/utils/tests/test_task.py"))

    def test_ignores_go_test_file(self):
        self.assertTrue(_is_ignored("src/runtime/pkg/data/data_test.go"))

    def test_ignores_vitest_file(self):
        self.assertTrue(_is_ignored("src/ui/src/lib/foo.test.ts"))

    def test_ignores_init_py(self):
        self.assertTrue(_is_ignored("src/service/core/__init__.py"))

    def test_ignores_build_file(self):
        self.assertTrue(_is_ignored("src/service/core/BUILD"))

    def test_allows_source_file(self):
        self.assertFalse(_is_ignored("src/service/core/auth/auth_service.py"))

    def test_allows_ui_source(self):
        self.assertFalse(_is_ignored("src/ui/src/lib/date-range-utils.ts"))

    def test_allows_runtime_go(self):
        self.assertFalse(_is_ignored("src/runtime/cmd/ctrl/main.go"))


class TestLinesToRanges(unittest.TestCase):
    """Tests for _lines_to_ranges conversion."""

    def test_empty_list_returns_empty(self):
        self.assertEqual(_lines_to_ranges([]), [])

    def test_single_line(self):
        self.assertEqual(_lines_to_ranges([5]), [(5, 5)])

    def test_contiguous_range(self):
        self.assertEqual(_lines_to_ranges([1, 2, 3, 4]), [(1, 4)])

    def test_multiple_ranges(self):
        self.assertEqual(
            _lines_to_ranges([1, 2, 3, 7, 8, 15]),
            [(1, 3), (7, 8), (15, 15)],
        )

    def test_gap_of_one(self):
        self.assertEqual(_lines_to_ranges([1, 3]), [(1, 1), (3, 3)])

    def test_two_adjacent_ranges(self):
        self.assertEqual(
            _lines_to_ranges([10, 11, 12, 20, 21]),
            [(10, 12), (20, 21)],
        )


class TestCapRanges(unittest.TestCase):
    """Tests for _cap_ranges uncovered line limiting."""

    def test_single_range_within_limit(self):
        self.assertEqual(_cap_ranges([(1, 5)], 10), [(1, 5)])

    def test_single_range_exceeds_limit(self):
        self.assertEqual(_cap_ranges([(1, 100)], 10), [(1, 10)])

    def test_multiple_ranges_first_fits_second_partial(self):
        self.assertEqual(
            _cap_ranges([(1, 3), (10, 20)], 7),
            [(1, 3), (10, 13)],
        )

    def test_multiple_ranges_only_first_fits(self):
        self.assertEqual(
            _cap_ranges([(1, 5), (10, 20)], 5),
            [(1, 5)],
        )

    def test_cap_of_one(self):
        self.assertEqual(_cap_ranges([(1, 100)], 1), [(1, 1)])

    def test_empty_ranges(self):
        self.assertEqual(_cap_ranges([], 10), [])

    def test_remaining_becomes_zero_between_ranges(self):
        self.assertEqual(
            _cap_ranges([(1, 3), (10, 20)], 3),
            [(1, 3)],
        )


class TestSelectTargets(unittest.TestCase):
    """Tests for select_targets report parsing and filtering."""

    def test_empty_files_returns_empty(self):
        report: dict[str, Any] = {"files": []}
        self.assertEqual(select_targets(report, max_targets=1, max_uncovered=0), [])

    def test_skips_file_with_no_line_coverage(self):
        report = {"files": [{"name": "src/foo.py", "line_coverage": []}]}
        self.assertEqual(select_targets(report, max_targets=1, max_uncovered=0), [])

    def test_skips_file_below_min_lines(self):
        report = {"files": [{"name": "src/foo.py", "line_coverage": [[1, 1]] * 5}]}
        self.assertEqual(select_targets(report, max_targets=1, max_uncovered=0), [])

    def test_skips_ignored_file(self):
        report = {"files": [{"name": "src/tests/foo.py", "line_coverage": [[i, 1] for i in range(20)]}]}
        self.assertEqual(select_targets(report, max_targets=1, max_uncovered=0), [])

    def test_skips_fully_covered_file(self):
        report = {"files": [{"name": "src/foo.py", "line_coverage": [[i, 0] for i in range(20)]}]}
        self.assertEqual(select_targets(report, max_targets=1, max_uncovered=0), [])

    def test_selects_uncovered_file(self):
        report = {"files": [{
            "name": "src/foo.py",
            "line_coverage": [[i, 1] for i in range(20)],
        }]}
        result = select_targets(report, max_targets=1, max_uncovered=0)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["file_path"], "src/foo.py")
        self.assertEqual(result[0]["coverage_pct"], 0.0)
        self.assertEqual(result[0]["uncovered_lines"], 20)

    def test_sorts_by_coverage_ascending(self):
        report = {"files": [
            {"name": "src/high.py", "line_coverage": [[i, 0] for i in range(15)] + [[i, 1] for i in range(15, 20)]},
            {"name": "src/low.py", "line_coverage": [[i, 1] for i in range(20)]},
        ]}
        result = select_targets(report, max_targets=2, max_uncovered=0)
        self.assertEqual(result[0]["file_path"], "src/low.py")
        self.assertEqual(result[1]["file_path"], "src/high.py")

    def test_respects_max_targets(self):
        report = {"files": [
            {"name": f"src/file{i}.py", "line_coverage": [[j, 1] for j in range(20)]}
            for i in range(5)
        ]}
        result = select_targets(report, max_targets=2, max_uncovered=0)
        self.assertEqual(len(result), 2)

    def test_applies_max_uncovered_cap(self):
        report = {"files": [{
            "name": "src/foo.py",
            "line_coverage": [[i, 1] for i in range(50)],
        }]}
        result = select_targets(report, max_targets=1, max_uncovered=10)
        self.assertEqual(result[0]["uncovered_lines"], 10)


class TestFormatTargets(unittest.TestCase):
    """Tests for format_targets output formatting."""

    def test_empty_targets(self):
        self.assertEqual(format_targets([]), "No coverage targets found.")

    def test_single_target_with_range(self):
        targets = [{
            "file_path": "src/foo.py",
            "coverage_pct": 25.0,
            "uncovered_lines": 10,
            "uncovered_ranges": [(5, 14)],
        }]
        output = format_targets(targets)
        self.assertIn("## Target 1: src/foo.py", output)
        self.assertIn("25.0%", output)
        self.assertIn("5-14", output)

    def test_single_line_range_no_dash(self):
        targets = [{
            "file_path": "src/foo.py",
            "coverage_pct": 50.0,
            "uncovered_lines": 1,
            "uncovered_ranges": [(42, 42)],
        }]
        output = format_targets(targets)
        self.assertIn("42", output)
        self.assertNotIn("42-42", output)


if __name__ == "__main__":
    unittest.main()
