# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import glob
import os
from typing import Optional

from coverage_agent.lcov_parser import CoverageEntry, parse_lcov
from coverage_agent.state import CoverageState, CoverageTarget


def detect_test_type(file_path: str) -> Optional[str]:
    """Detect the test type based on file extension and path."""
    if file_path.endswith(".py"):
        return "python"
    if file_path.endswith(".go"):
        return "go"
    if file_path.startswith("src/ui/") and (file_path.endswith(".ts") or file_path.endswith(".tsx")):
        return "ui"
    return None


def find_existing_test(source_path: str, test_type: str, repo_root: str = ".") -> Optional[str]:
    """Find an existing test file for a given source file."""
    abs_source = os.path.join(repo_root, source_path) if not os.path.isabs(source_path) else source_path
    source_dir = os.path.dirname(abs_source)
    source_name = os.path.splitext(os.path.basename(abs_source))[0]

    if test_type == "python":
        test_dir = os.path.join(source_dir, "tests")
        pattern = os.path.join(test_dir, f"test_{source_name}.py")
        matches = glob.glob(pattern)
        if matches:
            return matches[0]

    elif test_type == "go":
        pattern = os.path.join(source_dir, f"{source_name}_test.go")
        if os.path.exists(pattern):
            return pattern

    elif test_type == "ui":
        pattern = os.path.join(source_dir, f"{source_name}.test.ts")
        if os.path.exists(pattern):
            return pattern
        pattern_tsx = os.path.join(source_dir, f"{source_name}.test.tsx")
        if os.path.exists(pattern_tsx):
            return pattern_tsx

    return None


def should_skip_file(entry: CoverageEntry, min_lines: int = 10, max_lines: int = 500) -> bool:
    """Check if a file should be skipped based on size heuristics."""
    if entry.total_lines < min_lines:
        return True
    if entry.total_lines > max_lines:
        return True
    return False


def _compute_build_package(file_path: str) -> str:
    """Compute the Bazel package path from a file path."""
    directory = os.path.dirname(file_path)
    return f"//{directory}"


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
        if should_skip_file(entry, min_lines=min_lines, max_lines=max_lines):
            continue

        test_type = detect_test_type(entry.file_path)
        if test_type is None:
            continue

        existing_test = find_existing_test(entry.file_path, test_type, repo_root=repo_root)
        build_package = _compute_build_package(entry.file_path)

        targets.append(
            CoverageTarget(
                file_path=entry.file_path,
                uncovered_ranges=entry.uncovered_ranges,
                coverage_pct=entry.coverage_pct,
                existing_test_path=existing_test,
                test_type=test_type,
                build_package=build_package,
            )
        )

        if len(targets) >= max_targets:
            break

    return targets


def analyze_coverage(state: CoverageState) -> CoverageState:
    """LangGraph node: parse LCOV and populate targets."""
    lcov_path = state.get("lcov_path", "bazel-out/_coverage/_coverage_report.dat")
    entries = parse_lcov(lcov_path)
    targets = select_targets(entries, max_targets=state["max_targets"])
    return {**state, "targets": targets}
