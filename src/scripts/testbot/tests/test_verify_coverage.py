# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for verify_coverage.py."""

import json
import tempfile
import unittest
from pathlib import Path

from src.scripts.testbot.verify_coverage import (
    DEFAULT_TARGET_THRESHOLD,
    RANGE_HIT_FRACTION,
    RangeResult,
    TargetReport,
    _normalize_ranges,
    build_reports,
    evaluate_target,
    parse_lcov,
    render_json,
    render_markdown,
)


def _write(path: Path, content: str) -> Path:
    """Helper: write text to ``path`` and return it."""
    path.write_text(content, encoding="utf-8")
    return path


class TestParseLCOV(unittest.TestCase):
    """Tests for LCOV parsing."""

    def test_parses_per_file_da_records(self):
        lcov = (
            "TN:\n"
            "SF:src/utils/roles/roles.go\n"
            "DA:10,1\n"
            "DA:11,0\n"
            "DA:12,3\n"
            "end_of_record\n"
            "SF:src/lib/foo.py\n"
            "DA:1,42\n"
            "end_of_record\n"
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(Path(tmpdir) / "report.dat", lcov)
            coverage = parse_lcov(path)
        self.assertEqual(
            coverage["src/utils/roles/roles.go"],
            {10: 1, 11: 0, 12: 3},
        )
        self.assertEqual(coverage["src/lib/foo.py"], {1: 42})

    def test_max_aggregates_duplicate_lines(self):
        # Same source file across two test targets — take the union of hits
        # by maxing each line so we don't penalize unit tests for missing
        # branches that the integration target exercises.
        lcov = (
            "SF:src/lib/foo.py\n"
            "DA:1,0\n"
            "DA:2,1\n"
            "end_of_record\n"
            "SF:src/lib/foo.py\n"
            "DA:1,5\n"
            "DA:2,0\n"
            "end_of_record\n"
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(Path(tmpdir) / "report.dat", lcov)
            coverage = parse_lcov(path)
        self.assertEqual(coverage["src/lib/foo.py"], {1: 5, 2: 1})

    def test_ignores_other_records(self):
        lcov = (
            "SF:src/lib/foo.py\n"
            "FN:1,foo\n"
            "FNDA:1,foo\n"
            "BRDA:1,0,0,1\n"
            "DA:1,1\n"
            "LF:1\n"
            "LH:1\n"
            "end_of_record\n"
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(Path(tmpdir) / "report.dat", lcov)
            coverage = parse_lcov(path)
        self.assertEqual(coverage["src/lib/foo.py"], {1: 1})

    def test_skips_malformed_da_lines(self):
        lcov = (
            "SF:src/lib/foo.py\n"
            "DA:not-an-int,1\n"
            "DA:5\n"
            "DA:6,bad\n"
            "DA:7,2\n"
            "end_of_record\n"
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(Path(tmpdir) / "report.dat", lcov)
            coverage = parse_lcov(path)
        self.assertEqual(coverage["src/lib/foo.py"], {7: 2})

    def test_missing_file_returns_empty(self):
        coverage = parse_lcov(Path("/nonexistent/lcov.dat"))
        self.assertEqual(coverage, {})

    def test_unreadable_file_returns_empty_and_does_not_raise(self):
        # Pass an existing path that open() refuses (a directory) so the
        # parser's OSError branch fires. chmod-based denial doesn't work
        # in CI (Bazel sandbox runs as root, which bypasses file modes);
        # IsADirectoryError is a subclass of OSError and triggers
        # regardless of user.
        with tempfile.TemporaryDirectory() as tmpdir:
            coverage = parse_lcov(Path(tmpdir))
        self.assertEqual(coverage, {})


class TestNormalizeRanges(unittest.TestCase):
    """Tests for ``_normalize_ranges`` shape coercion."""

    def test_two_element_lists(self):
        self.assertEqual(
            _normalize_ranges([[10, 20], [30, 30]]),
            [(10, 20), (30, 30)],
        )

    def test_handles_single_element_and_int_entries(self):
        # Tolerate the older sidecar payload formats some scripts emit so a
        # bad sidecar doesn't crash the verifier mid-PR.
        self.assertEqual(
            _normalize_ranges([[42], 17]),
            [(42, 42), (17, 17)],
        )

    def test_drops_invalid_entries(self):
        self.assertEqual(
            _normalize_ranges(["bad", [10, "x"], [5, 1]]),  # 5>1 → dropped
            [],
        )

    def test_non_list_input_returns_empty(self):
        self.assertEqual(_normalize_ranges(None), [])
        self.assertEqual(_normalize_ranges({"start": 1, "end": 2}), [])


class TestRangeResult(unittest.TestCase):
    """Tests for the per-range ``covered`` predicate."""

    def test_covered_when_threshold_met(self):
        # The picker hands out half-line bars; one of two lines hit clears.
        result = RangeResult(start=10, end=11, hit_lines=1, total_lines=2)
        self.assertGreaterEqual(
            result.hit_lines / result.total_lines,
            RANGE_HIT_FRACTION,
        )
        self.assertTrue(result.covered)

    def test_uncovered_when_below_threshold(self):
        result = RangeResult(start=10, end=14, hit_lines=1, total_lines=5)
        self.assertLess(
            result.hit_lines / result.total_lines,
            RANGE_HIT_FRACTION,
        )
        self.assertFalse(result.covered)

    def test_zero_span_is_not_covered(self):
        # Defensive: should never come from real LCOV, but guard against
        # ZeroDivisionError in case malformed meta produces a zero-span row.
        result = RangeResult(start=0, end=0, hit_lines=0, total_lines=0)
        self.assertFalse(result.covered)


class TestEvaluateTarget(unittest.TestCase):
    """Tests for the per-file evaluation roll-up."""

    def test_counts_hits_per_range(self):
        coverage = {10: 1, 11: 1, 12: 0, 20: 0, 21: 3}
        report = evaluate_target(
            file_path="src/lib/foo.py",
            raw_ranges=[[10, 12], [20, 21]],
            file_coverage=coverage,
        )
        self.assertEqual(report.listed_lines, 5)  # 3 + 2
        self.assertEqual(report.hit_lines, 3)     # 10,11,21
        self.assertEqual(len(report.ranges), 2)
        self.assertEqual(report.ranges[0].hit_lines, 2)
        self.assertEqual(report.ranges[1].hit_lines, 1)

    def test_lcov_seen_false_when_file_missing_from_lcov(self):
        report = evaluate_target(
            file_path="src/lib/foo.py",
            raw_ranges=[[10, 11]],
            file_coverage=None,
        )
        self.assertFalse(report.lcov_seen)
        self.assertEqual(report.hit_lines, 0)
        # Listed lines still counted so the human can see how big the gap is.
        self.assertEqual(report.listed_lines, 2)

    def test_passed_threshold(self):
        # 4/5 = 80% > 70% threshold → passed
        coverage = dict.fromkeys((10, 11, 12, 13), 1)
        report = evaluate_target(
            file_path="src/lib/foo.py",
            raw_ranges=[[10, 14]],
            file_coverage=coverage,
        )
        self.assertGreaterEqual(
            report.hit_fraction, DEFAULT_TARGET_THRESHOLD,
        )
        self.assertTrue(report.passed)

    def test_still_uncovered_ranges_reports_gaps(self):
        # Range [10-11] half-covered (≥ RANGE_HIT_FRACTION) → not in gap.
        # Range [20-21] one hit out of two → covered too.
        # Range [30-34] one hit of five (20%) → still uncovered, returned.
        coverage = {10: 1, 20: 1, 30: 1}
        report = evaluate_target(
            file_path="src/lib/foo.py",
            raw_ranges=[[10, 11], [20, 21], [30, 34]],
            file_coverage=coverage,
        )
        self.assertEqual(report.still_uncovered_ranges(), [(30, 34)])


class TestBuildReports(unittest.TestCase):
    """Tests for the meta-driven report builder."""

    def test_builds_one_report_per_target(self):
        meta = [
            {"file_path": "src/lib/a.py",
             "uncovered_ranges": [[1, 2]]},
            {"file_path": "src/lib/b.py",
             "uncovered_ranges": [[10, 12]]},
        ]
        lcov = {
            "src/lib/a.py": {1: 1, 2: 1},
            # b.py absent from LCOV → lcov_seen=False
        }
        reports = build_reports(meta, lcov)
        self.assertEqual(len(reports), 2)
        self.assertEqual(reports[0].file_path, "src/lib/a.py")
        self.assertTrue(reports[0].lcov_seen)
        self.assertEqual(reports[1].file_path, "src/lib/b.py")
        self.assertFalse(reports[1].lcov_seen)

    def test_skips_invalid_meta_entries(self):
        # build_reports filters at runtime; we deliberately mix shapes here
        # to exercise the defensive isinstance checks, so this list is
        # heterogeneous on purpose.
        meta: list = [
            "not a dict",
            {},                 # missing file_path
            {"file_path": ""},  # empty file_path
            {"file_path": "src/lib/ok.py", "uncovered_ranges": []},
        ]
        reports = build_reports(meta, {})
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0].file_path, "src/lib/ok.py")


class TestRenderJSON(unittest.TestCase):
    """Tests for the JSON serializer."""

    def test_emits_dict_per_report(self):
        report = TargetReport(
            file_path="src/lib/foo.py",
            listed_lines=4,
            hit_lines=3,
            ranges=[
                RangeResult(10, 11, 2, 2),
                RangeResult(20, 21, 1, 2),
            ],
            lcov_seen=True,
        )
        payload = json.loads(render_json([report]))
        self.assertEqual(len(payload), 1)
        entry = payload[0]
        self.assertEqual(entry["file_path"], "src/lib/foo.py")
        self.assertEqual(entry["listed_lines"], 4)
        self.assertEqual(entry["hit_lines"], 3)
        self.assertAlmostEqual(entry["hit_fraction"], 0.75, places=4)
        self.assertTrue(entry["passed"])
        self.assertEqual(len(entry["ranges"]), 2)
        # Still-uncovered list lets the LLM feed the next iteration with
        # just the remaining ranges instead of re-parsing the full report.
        self.assertIn("still_uncovered_ranges", entry)

    def test_still_uncovered_ranges_round_trips_as_int_pairs(self):
        report = TargetReport(
            file_path="src/lib/foo.py",
            listed_lines=2,
            hit_lines=0,
            ranges=[RangeResult(30, 31, 0, 2)],
            lcov_seen=True,
        )
        payload = json.loads(render_json([report]))
        self.assertEqual(payload[0]["still_uncovered_ranges"], [[30, 31]])


class TestRenderMarkdown(unittest.TestCase):
    """Tests for the Markdown PR-body renderer."""

    def test_renders_heading_and_per_file_summary(self):
        report = TargetReport(
            file_path="src/utils/roles/roles.go",
            listed_lines=10,
            hit_lines=8,
            ranges=[RangeResult(1, 10, 8, 10)],
            lcov_seen=True,
        )
        md = render_markdown([report])
        self.assertIn("## Coverage gain on listed uncovered ranges", md)
        self.assertIn("src/utils/roles/roles.go", md)
        self.assertIn("8/10", md)
        self.assertIn("80%", md)
        # Passed targets get a ✅; below-threshold targets get ⚠️; LCOV-miss
        # gets ❔. Reviewers should be able to scan the marker at a glance.
        self.assertIn("✅", md)

    def test_warning_marker_when_below_threshold(self):
        report = TargetReport(
            file_path="src/lib/foo.py",
            listed_lines=10,
            hit_lines=3,  # 30% — below 70% threshold
            ranges=[RangeResult(1, 10, 3, 10)],
            lcov_seen=True,
        )
        md = render_markdown([report])
        self.assertIn("⚠️", md)

    def test_lcov_miss_marker(self):
        report = TargetReport(
            file_path="src/lib/foo.py",
            listed_lines=5,
            hit_lines=0,
            ranges=[RangeResult(1, 5, 0, 5)],
            lcov_seen=False,
        )
        md = render_markdown([report])
        self.assertIn("❔", md)
        self.assertIn("file not found in LCOV", md)

    def test_empty_input_returns_empty_string(self):
        # An empty section would just be dead whitespace in the PR body;
        # create_pr.py uses truthiness to skip when nothing to render.
        self.assertEqual(render_markdown([]), "")


if __name__ == "__main__":
    unittest.main()
