# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import glob
import logging
import os
from typing import Optional

from coverage_agent.lcov_parser import CoverageEntry, parse_lcov
from coverage_agent.plugins.base import TestType, detect_test_type, file_path_to_bazel_package
from coverage_agent.state import CoverageState, CoverageTarget

logger = logging.getLogger(__name__)


def find_existing_test(source_path: str, test_type: TestType, repo_root: str = ".") -> Optional[str]:
    """Find an existing test file for a given source file."""
    abs_source = os.path.join(repo_root, source_path) if not os.path.isabs(source_path) else source_path
    source_dir = os.path.dirname(abs_source)
    source_name = os.path.splitext(os.path.basename(abs_source))[0]

    if test_type == TestType.PYTHON:
        test_dir = os.path.join(source_dir, "tests")
        pattern = os.path.join(test_dir, f"test_{source_name}.py")
        matches = glob.glob(pattern)
        if matches:
            return matches[0]

    elif test_type == TestType.GO:
        pattern = os.path.join(source_dir, f"{source_name}_test.go")
        if os.path.exists(pattern):
            return pattern

    elif test_type == TestType.UI:
        for ext in (".test.ts", ".test.tsx"):
            pattern = os.path.join(source_dir, f"{source_name}{ext}")
            if os.path.exists(pattern):
                return pattern

    return None


def should_skip_file(entry: CoverageEntry, min_lines: int = 10, max_lines: int = 500) -> Optional[str]:
    """Check if a file should be skipped. Returns skip reason or None."""
    if entry.total_lines < min_lines:
        return f"too small ({entry.total_lines} lines < {min_lines})"
    if entry.total_lines > max_lines:
        return f"too large ({entry.total_lines} lines > {max_lines})"
    return None


def select_targets(
    entries: list[CoverageEntry],
    max_targets: int,
    repo_root: str = ".",
    min_lines: int = 10,
    max_lines: int = 500,
) -> list[CoverageTarget]:
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

        targets.append(
            CoverageTarget(
                file_path=entry.file_path,
                uncovered_ranges=entry.uncovered_ranges,
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
        logger.info("  %.1f%% %s (existing_test=%s)", target.coverage_pct, target.file_path, target.existing_test_path)

    return targets


def analyze_coverage(state: CoverageState) -> CoverageState:
    """LangGraph node: parse backend + UI LCOV files and populate targets."""
    all_entries = []

    backend_lcov = state.get("lcov_path", "bazel-out/_coverage/_coverage_report.dat")
    logger.info("Parsing backend LCOV from %s", backend_lcov)
    try:
        backend_entries = parse_lcov(backend_lcov)
        logger.info("Backend: %d coverage entries", len(backend_entries))
        all_entries.extend(backend_entries)
    except FileNotFoundError:
        logger.warning("Backend LCOV not found at %s, skipping", backend_lcov)

    ui_lcov = state.get("ui_lcov_path", "src/ui/coverage/lcov.info")
    logger.info("Parsing UI LCOV from %s", ui_lcov)
    try:
        ui_entries = parse_lcov(ui_lcov)
        # Vitest LCOV paths are relative to src/ui/ (e.g., "src/lib/utils.ts").
        # Prefix with "src/ui/" so detect_test_type recognizes them as UI files.
        for entry in ui_entries:
            if not entry.file_path.startswith("src/ui/"):
                entry.file_path = f"src/ui/{entry.file_path}"
        logger.info("UI: %d coverage entries", len(ui_entries))
        all_entries.extend(ui_entries)
    except FileNotFoundError:
        logger.warning("UI LCOV not found at %s, skipping", ui_lcov)

    # Re-sort merged entries by coverage ascending
    all_entries.sort(key=lambda entry: entry.coverage_pct)
    logger.info("Total: %d coverage entries from all sources", len(all_entries))

    targets = select_targets(all_entries, max_targets=state["max_targets"])
    return {**state, "targets": targets}
