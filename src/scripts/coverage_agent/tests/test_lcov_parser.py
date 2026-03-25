# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for the LCOV coverage report parser."""

import os
import tempfile
import unittest

from coverage_agent.lcov_parser import CoverageEntry, parse_lcov
from coverage_agent.plugins.base import TestType, detect_test_type


BASIC_LCOV = """\
SF:src/lib/utils/common.py
DA:1,1
DA:2,1
DA:3,0
DA:4,0
DA:5,1
LF:5
LH:3
end_of_record
SF:src/service/core/auth/auth_service.py
DA:10,1
DA:11,0
DA:12,0
DA:13,0
DA:14,1
LF:5
LH:2
end_of_record
"""

IGNORED_PATHS_LCOV = """\
SF:src/tests/common/fixtures.py
DA:1,1
DA:2,0
LF:2
LH:1
end_of_record
SF:src/scripts/export_openapi.py
DA:1,0
LF:1
LH:0
end_of_record
SF:bzl/py.bzl
DA:1,0
LF:1
LH:0
end_of_record
SF:src/service/core/auth/auth_service.py
DA:1,1
DA:2,0
LF:2
LH:1
end_of_record
"""

GENERATED_FILES_LCOV = """\
SF:src/ui/src/lib/api/generated.ts
DA:1,0
DA:2,0
LF:2
LH:0
end_of_record
SF:src/service/proto/service_pb2.py
DA:1,0
LF:1
LH:0
end_of_record
SF:src/lib/utils/common.py
DA:1,1
DA:2,0
LF:2
LH:1
end_of_record
"""

UI_LCOV = """\
SF:src/ui/src/lib/utils.ts
DA:1,1
DA:2,1
DA:3,0
DA:4,0
DA:5,1
LF:5
LH:3
end_of_record
SF:src/ui/src/lib/api/generated.ts
DA:1,0
DA:2,0
LF:2
LH:0
end_of_record
SF:src/ui/src/lib/api/adapter/pools.ts
DA:1,1
DA:2,0
DA:3,0
DA:4,0
LF:4
LH:1
end_of_record
"""

UNCOVERED_RANGES_LCOV = """\
SF:src/lib/utils/common.py
DA:1,1
DA:2,1
DA:3,0
DA:4,0
DA:5,0
DA:6,1
DA:7,0
DA:8,1
DA:9,0
DA:10,0
LF:10
LH:4
end_of_record
"""


def _write_lcov(content: str) -> str:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".dat", delete=False) as file:
        file.write(content)
        return file.name


class TestLcovParser(unittest.TestCase):
    """Tests for LCOV file parsing, filtering, and range computation."""

    def test_parse_basic_lcov(self):
        path = _write_lcov(BASIC_LCOV)
        try:
            entries = parse_lcov(path)
            self.assertEqual(len(entries), 2)

            self.assertEqual(entries[0].file_path, "src/service/core/auth/auth_service.py")
            self.assertEqual(entries[0].total_lines, 5)
            self.assertEqual(entries[0].covered_lines, 2)
            self.assertAlmostEqual(entries[0].coverage_pct, 40.0)

            self.assertEqual(entries[1].file_path, "src/lib/utils/common.py")
            self.assertAlmostEqual(entries[1].coverage_pct, 60.0)
        finally:
            os.unlink(path)

    def test_parse_uncovered_ranges(self):
        path = _write_lcov(UNCOVERED_RANGES_LCOV)
        try:
            entries = parse_lcov(path)
            self.assertEqual(len(entries), 1)
            entry = entries[0]
            self.assertEqual(entry.uncovered_ranges, [(3, 5), (7, 7), (9, 10)])
        finally:
            os.unlink(path)

    def test_filter_ignored_paths(self):
        path = _write_lcov(IGNORED_PATHS_LCOV)
        try:
            entries = parse_lcov(path)
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0].file_path, "src/service/core/auth/auth_service.py")
        finally:
            os.unlink(path)

    def test_filter_generated_files(self):
        path = _write_lcov(GENERATED_FILES_LCOV)
        try:
            entries = parse_lcov(path)
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0].file_path, "src/lib/utils/common.py")
        finally:
            os.unlink(path)

    def test_empty_lcov(self):
        path = _write_lcov("")
        try:
            entries = parse_lcov(path)
            self.assertEqual(entries, [])
        finally:
            os.unlink(path)

    def test_sort_by_coverage(self):
        path = _write_lcov(BASIC_LCOV)
        try:
            entries = parse_lcov(path)
            coverages = [e.coverage_pct for e in entries]
            self.assertEqual(coverages, sorted(coverages))
        finally:
            os.unlink(path)

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


    def test_parse_ui_lcov(self):
        """Verifies Vitest LCOV output is parsed correctly, with generated.ts filtered."""
        path = _write_lcov(UI_LCOV)
        try:
            entries = parse_lcov(path)
            file_paths = [e.file_path for e in entries]
            self.assertIn("src/ui/src/lib/utils.ts", file_paths)
            self.assertIn("src/ui/src/lib/api/adapter/pools.ts", file_paths)
            self.assertNotIn("src/ui/src/lib/api/generated.ts", file_paths)
        finally:
            os.unlink(path)

    def test_ui_files_detected_as_ui_type(self):
        """Verifies that UI files from Vitest LCOV get detect_test_type == UI.

        Note: generated.ts IS a valid UI file by path — it's filtered out by the
        LCOV parser's _is_ignored(), not by detect_test_type(). This test verifies
        both layers work correctly together.
        """
        self.assertEqual(detect_test_type("src/ui/src/lib/utils.ts"), TestType.UI)
        self.assertEqual(detect_test_type("src/ui/src/lib/api/adapter/pools.ts"), TestType.UI)
        # generated.ts is a valid UI type by extension — filtered at LCOV parser level
        self.assertEqual(detect_test_type("src/ui/src/lib/api/generated.ts"), TestType.UI)


if __name__ == "__main__":
    unittest.main()
