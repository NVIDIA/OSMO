# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for coverage agent state types."""

import unittest

from coverage_agent.state import CoverageState, CoverageTarget


class TestCoverageTarget(unittest.TestCase):
    def test_coverage_target_fields(self):
        target = CoverageTarget(
            file_path="src/lib/utils/common.py",
            uncovered_ranges=[(3, 5), (10, 12)],
            coverage_pct=60.0,
            existing_test_path="src/lib/utils/tests/test_common.py",
            test_type="python",
            build_package="//src/lib/utils",
        )
        self.assertEqual(target.file_path, "src/lib/utils/common.py")
        self.assertEqual(target.uncovered_ranges, [(3, 5), (10, 12)])
        self.assertAlmostEqual(target.coverage_pct, 60.0)
        self.assertEqual(target.existing_test_path, "src/lib/utils/tests/test_common.py")
        self.assertEqual(target.test_type, "python")
        self.assertEqual(target.build_package, "//src/lib/utils")

    def test_coverage_target_no_existing_test(self):
        target = CoverageTarget(
            file_path="src/lib/utils/new_module.py",
            uncovered_ranges=[(1, 50)],
            coverage_pct=0.0,
            existing_test_path=None,
            test_type="python",
            build_package="//src/lib/utils",
        )
        self.assertIsNone(target.existing_test_path)


class TestCoverageState(unittest.TestCase):
    def test_coverage_state_construction(self):
        state: CoverageState = {
            "provider": "nemotron",
            "targets": [],
            "current_index": 0,
            "generated_files": [],
            "last_generated": None,
            "validation_passed": False,
            "validation_output": "",
            "retry_count": 0,
            "max_retries": 3,
            "max_targets": 3,
            "min_coverage_delta": 0.5,
            "pr_url": None,
            "branch_name": "coverage-agent/20260324",
            "dry_run": False,
            "ui_lcov_path": "src/ui/coverage/lcov.info",
            "errors": [],
        }
        self.assertEqual(state["provider"], "nemotron")
        self.assertEqual(state["max_retries"], 3)
        self.assertEqual(state["max_targets"], 3)
        self.assertAlmostEqual(state["min_coverage_delta"], 0.5)
        self.assertFalse(state["dry_run"])


if __name__ == "__main__":
    unittest.main()
