# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for the graph routing functions."""

import unittest

from testbot.graph import route_done, route_review, route_validation
from testbot.state import TestbotState, TestTarget


def _make_state(**overrides) -> TestbotState:
    """Create a minimal TestbotState with sensible defaults."""
    defaults: TestbotState = {
        "provider": "nemotron",
        "lcov_path": "bazel-out/_coverage/_coverage_report.dat",
        "targets": [
            TestTarget("src/a.py", [(1, 10)], 20.0, None, "python", "//src"),
            TestTarget("src/b.py", [(1, 5)], 40.0, None, "python", "//src"),
        ],
        "current_index": 0,
        "generated_files": [],
        "last_generated": None,
        "validation_passed": False,
        "validation_output": "",
        "review_passed": False,
        "retry_count": 0,
        "max_retries": 3,
        "max_targets": 5,
        "max_lines": 100,
        "min_coverage_delta": 0.5,
        "pr_url": None,
        "branch_name": "testbot/test",
        "dry_run": False,
        "ui_lcov_path": "src/ui/coverage/lcov.info",
        "coverage_source": "local",
        "codecov_token": "",
        "errors": [],
    }
    return {**defaults, **overrides}


class TestRouteValidation(unittest.TestCase):
    """Tests for validation routing: retry, skip, review, done."""

    def test_retry_on_failure_with_retries_left(self):
        state = _make_state(validation_passed=False, retry_count=1, max_retries=3)
        self.assertEqual(route_validation(state), "retry")

    def test_skip_on_failure_retries_exhausted(self):
        state = _make_state(validation_passed=False, retry_count=3, max_retries=3)
        self.assertEqual(route_validation(state), "skip")

    def test_done_on_failure_retries_exhausted_last_target(self):
        state = _make_state(validation_passed=False, retry_count=3, max_retries=3, current_index=1)
        self.assertEqual(route_validation(state), "done")

    def test_review_on_pass(self):
        state = _make_state(validation_passed=True, current_index=0)
        self.assertEqual(route_validation(state), "review")


class TestRouteReview(unittest.TestCase):
    """Tests for review routing: next, retry, skip, done."""

    def test_next_on_review_pass_more_targets(self):
        state = _make_state(review_passed=True, current_index=0)
        self.assertEqual(route_review(state), "next")

    def test_done_on_review_pass_last_target(self):
        state = _make_state(review_passed=True, current_index=1)
        self.assertEqual(route_review(state), "done")

    def test_retry_on_review_fail_retries_left(self):
        state = _make_state(review_passed=False, retry_count=1, max_retries=3)
        self.assertEqual(route_review(state), "retry")

    def test_skip_on_review_fail_retries_exhausted(self):
        state = _make_state(review_passed=False, retry_count=3, max_retries=3)
        self.assertEqual(route_review(state), "skip")

    def test_done_on_review_fail_retries_exhausted_last_target(self):
        state = _make_state(review_passed=False, retry_count=3, max_retries=3, current_index=1)
        self.assertEqual(route_review(state), "done")


class TestRouteDone(unittest.TestCase):
    """Tests for done routing: create_pr vs abort."""

    def test_create_pr_when_files_exist(self):
        state = _make_state(generated_files=["src/tests/test_a.py"])
        self.assertEqual(route_done(state), "create_pr")

    def test_abort_when_no_files(self):
        state = _make_state(generated_files=[])
        self.assertEqual(route_done(state), "abort")


if __name__ == "__main__":
    unittest.main()
