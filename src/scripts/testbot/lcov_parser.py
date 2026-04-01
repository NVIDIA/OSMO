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
    """Check if a file path matches ignore or generated-file patterns."""
    for pattern in IGNORE_PATTERNS:
        if fnmatch.fnmatch(file_path, pattern):
            return True
    for pattern in GENERATED_FILE_PATTERNS:
        if fnmatch.fnmatch(file_path.split("/")[-1], pattern):
            return True
    return False


