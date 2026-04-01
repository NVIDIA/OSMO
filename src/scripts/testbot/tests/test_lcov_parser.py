# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for CoverageEntry and file type detection."""

import unittest

from testbot.lcov_parser import CoverageEntry
from testbot.plugins.base import TestType, detect_test_type


class TestCoverageEntry(unittest.TestCase):
    """Tests for the CoverageEntry dataclass."""

    def test_coverage_entry_fields(self):
        entry = CoverageEntry(
            file_path="src/foo.py",
            total_lines=10,
            covered_lines=7,
            coverage_pct=70.0,
            uncovered_ranges=[(3, 5)],
        )
        self.assertEqual(entry.file_path, "src/foo.py")
        self.assertEqual(entry.total_lines, 10)
        self.assertEqual(entry.covered_lines, 7)
        self.assertAlmostEqual(entry.coverage_pct, 70.0)
        self.assertEqual(entry.uncovered_ranges, [(3, 5)])

    def test_ui_files_detected_as_ui_type(self):
        self.assertEqual(detect_test_type("src/ui/src/lib/utils.ts"), TestType.UI)
        self.assertEqual(detect_test_type("src/ui/src/lib/api/adapter/pools.ts"), TestType.UI)
        self.assertEqual(detect_test_type("src/ui/src/lib/api/generated.ts"), TestType.UI)


if __name__ == "__main__":
    unittest.main()
