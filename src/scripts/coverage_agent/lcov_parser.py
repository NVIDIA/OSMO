# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Parse LCOV coverage report files into structured coverage entries."""

import dataclasses
import fnmatch


@dataclasses.dataclass
class CoverageEntry:
    """A single file entry parsed from an LCOV coverage report."""

    file_path: str
    total_lines: int
    covered_lines: int
    coverage_pct: float
    uncovered_ranges: list[tuple[int, int]]


IGNORE_PATTERNS = [
    "src/tests/**",
    "src/scripts/**",
    "bzl/**",
    "run/**",
    "deployments/**",
]

GENERATED_FILE_PATTERNS = [
    "*generated.ts",
    "*_pb2.py",
    "*_pb2_grpc.py",
]


def _is_ignored(file_path: str) -> bool:
    for pattern in IGNORE_PATTERNS:
        if fnmatch.fnmatch(file_path, pattern):
            return True
    for pattern in GENERATED_FILE_PATTERNS:
        if fnmatch.fnmatch(file_path.split("/")[-1], pattern):
            return True
    return False


def _compute_uncovered_ranges(line_hits: dict[int, int]) -> list[tuple[int, int]]:
    uncovered_lines = sorted(line_num for line_num, hits in line_hits.items() if hits == 0)
    if not uncovered_lines:
        return []

    ranges = []
    start = uncovered_lines[0]
    end = uncovered_lines[0]

    for line_num in uncovered_lines[1:]:
        if line_num == end + 1:
            end = line_num
        else:
            ranges.append((start, end))
            start = line_num
            end = line_num

    ranges.append((start, end))
    return ranges


def parse_lcov(lcov_path: str) -> list[CoverageEntry]:
    """Parse an LCOV file and return coverage entries sorted by coverage_pct ascending."""
    entries = []
    current_file = None
    line_hits: dict[int, int] = {}
    total_lines = 0
    hit_lines = 0

    with open(lcov_path, encoding="utf-8") as file:
        for raw_line in file:
            line = raw_line.strip()

            if line.startswith("SF:"):
                current_file = line[3:]
                line_hits = {}
                total_lines = 0
                hit_lines = 0

            elif line.startswith("DA:") and current_file is not None:
                parts = line[3:].split(",")
                line_num = int(parts[0])
                hits = int(parts[1])
                line_hits[line_num] = hits

            elif line.startswith("LF:"):
                total_lines = int(line[3:])

            elif line.startswith("LH:"):
                hit_lines = int(line[3:])

            elif line == "end_of_record" and current_file is not None:
                if not _is_ignored(current_file) and total_lines > 0:
                    coverage_pct = (hit_lines / total_lines) * 100.0
                    uncovered_ranges = _compute_uncovered_ranges(line_hits)
                    entries.append(
                        CoverageEntry(
                            file_path=current_file,
                            total_lines=total_lines,
                            covered_lines=hit_lines,
                            coverage_pct=coverage_pct,
                            uncovered_ranges=uncovered_ranges,
                        )
                    )
                current_file = None
                line_hits = {}

    entries.sort(key=lambda entry: entry.coverage_pct)
    return entries
