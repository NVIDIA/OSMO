# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Analyze coverage data and select targets for test generation."""

import glob
import logging
import os
from typing import Optional

from testbot.codecov_client import fetch_coverage
from testbot.lcov_parser import CoverageEntry
from testbot.plugins.base import TestType, detect_test_type, file_path_to_bazel_package
from testbot.state import TestbotState, TestTarget

logger = logging.getLogger(__name__)


def find_existing_test(
    source_path: str, test_type: TestType, repo_root: str = ".",
) -> Optional[str]:
    """Find an existing test file for a given source file.

    Returns a normalized path relative to repo_root (no ./ prefix).
    """
    if os.path.isabs(source_path):
        abs_source = source_path
    else:
        abs_source = os.path.join(repo_root, source_path)
    source_dir = os.path.dirname(abs_source)
    source_name = os.path.splitext(os.path.basename(abs_source))[0]

    result = None
    if test_type == TestType.PYTHON:
        test_dir = os.path.join(source_dir, "tests")
        pattern = os.path.join(test_dir, f"test_{source_name}.py")
        matches = glob.glob(pattern)
        if matches:
            result = matches[0]

    elif test_type == TestType.GO:
        pattern = os.path.join(source_dir, f"{source_name}_test.go")
        if os.path.exists(pattern):
            result = pattern

    elif test_type == TestType.UI:
        for ext in (".test.ts", ".test.tsx"):
            pattern = os.path.join(source_dir, f"{source_name}{ext}")
            if os.path.exists(pattern):
                result = pattern
                break

    # Normalize: strip ./ prefix from paths like ./src/utils/roles/roles_test.go
    if result and result.startswith("./"):
        result = result[2:]
    return result


def should_skip_file(
    entry: CoverageEntry, min_lines: int = 10, max_lines: int = 500,
) -> Optional[str]:
    """Check if a file should be skipped. Returns skip reason or None."""
    if entry.total_lines < min_lines:
        return f"too small ({entry.total_lines} lines < {min_lines})"
    if entry.total_lines > max_lines:
        return f"too large ({entry.total_lines} lines > {max_lines})"
    return None


def _cap_uncovered_ranges(
    ranges: list[tuple[int, int]], max_lines: int,
) -> list[tuple[int, int]]:
    """Trim uncovered ranges to stay within max_lines total."""
    capped = []
    remaining = max_lines
    for start, end in ranges:
        span = end - start + 1
        if span <= remaining:
            capped.append((start, end))
            remaining -= span
        else:
            if remaining > 0:
                capped.append((start, start + remaining - 1))
            break
    return capped


def select_targets(
    entries: list[CoverageEntry],
    max_targets: int,
    max_lines_per_target: int = 0,
    repo_root: str = ".",
    min_lines: int = 10,
    max_lines: int = 500,
) -> list[TestTarget]:
    """Select the best coverage targets from parsed LCOV entries."""
    targets = []

    for entry in entries:
        skip_reason = should_skip_file(entry, min_lines=min_lines, max_lines=max_lines)
        if skip_reason:
            logger.debug("Skipping %s: %s", entry.file_path, skip_reason)
            continue

        test_type = detect_test_type(entry.file_path)
        if test_type is None:
            logger.debug("Skipping %s: unsupported file type", entry.file_path)
            continue

        existing_test = find_existing_test(entry.file_path, test_type, repo_root=repo_root)
        build_package = file_path_to_bazel_package(entry.file_path)

        uncovered_ranges = entry.uncovered_ranges
        if max_lines_per_target > 0:
            original_lines = sum(e - s + 1 for s, e in uncovered_ranges)
            uncovered_ranges = _cap_uncovered_ranges(uncovered_ranges, max_lines_per_target)
            capped_lines = sum(e - s + 1 for s, e in uncovered_ranges)
            if capped_lines < original_lines:
                logger.info(
                    "  Capped %s: %d -> %d uncovered lines",
                    entry.file_path, original_lines, capped_lines,
                )

        targets.append(
            TestTarget(
                file_path=entry.file_path,
                uncovered_ranges=uncovered_ranges,
                coverage_pct=entry.coverage_pct,
                existing_test_path=existing_test,
                test_type=test_type.value,
                build_package=build_package,
            )
        )

        if len(targets) >= max_targets:
            break

    logger.info("Selected %d targets from %d coverage entries", len(targets), len(entries))
    for target in targets:
        uncovered_lines = sum(e - s + 1 for s, e in target.uncovered_ranges)
        logger.info(
            "  %.1f%% %s (%d uncovered lines, existing_test=%s)",
            target.coverage_pct, target.file_path, uncovered_lines, target.existing_test_path,
        )

    return targets


def analyze_coverage(state: TestbotState) -> TestbotState:
    """LangGraph node: fetch coverage data from Codecov and populate targets."""
    token = state.get("codecov_token", "")
    if not token:
        logger.error("No Codecov token provided (set CODECOV_TOKEN env var)")
        return {**state, "targets": []}

    all_entries = fetch_coverage(token=token)
    all_entries.sort(key=lambda entry: entry.coverage_pct)
    logger.info("Total: %d coverage entries", len(all_entries))

    targets = select_targets(
        all_entries,
        max_targets=state["max_targets"],
        max_lines_per_target=state.get("max_lines", 0),
    )
    return {**state, "targets": targets}
