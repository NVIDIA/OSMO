# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Shared guardrails for testbot scripts.

Ensures testbot only commits test files and never modifies source code.
"""

import fnmatch
import logging
import os
import subprocess

logger = logging.getLogger(__name__)

TEST_FILE_PATTERNS = [
    "test_*.py",
    "*_test.go",
    "*.test.ts",
    "*.test.tsx",
]


def is_test_file(file_path: str) -> bool:
    """Check if a file path matches known test file patterns.

    BUILD files are only allowed inside /tests/ directories to prevent
    modifications to source-package BUILD files.
    """
    basename = file_path.rsplit("/", maxsplit=1)[-1]
    if basename == "BUILD" and "/tests/" in file_path:
        return True
    return any(fnmatch.fnmatch(basename, pattern) for pattern in TEST_FILE_PATTERNS)


def _detect_changes() -> tuple[set[str], set[str]]:
    """Detect tracked modifications and untracked files.

    Returns (tracked_changed, untracked) sets, excluding .claude/ paths.
    """
    diff_result = subprocess.run(
        ["git", "diff", "--name-only"],
        capture_output=True, text=True, check=False,
    )
    if diff_result.returncode != 0:
        logger.error("git diff failed: %s", diff_result.stderr[:200])
    untracked_result = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard"],
        capture_output=True, text=True, check=False,
    )
    if untracked_result.returncode != 0:
        logger.error("git ls-files failed: %s", untracked_result.stderr[:200])

    tracked_changed: set[str] = set()
    for line in diff_result.stdout.strip().splitlines():
        if line and not line.startswith(".claude/"):
            tracked_changed.add(line)

    untracked: set[str] = set()
    for line in untracked_result.stdout.strip().splitlines():
        if line and not line.startswith(".claude/"):
            untracked.add(line)

    return tracked_changed, untracked


def get_changed_files() -> list[str]:
    """Return all changed files (tracked and untracked).

    Used by the respond workflow where source code fixes are allowed.
    Logs test vs non-test breakdown for visibility.
    """
    tracked_changed, untracked = _detect_changes()
    all_files = sorted(tracked_changed | untracked)

    test_files = [f for f in all_files if is_test_file(f)]
    non_test_files = [f for f in all_files if not is_test_file(f)]

    if test_files:
        logger.info("Test files changed: %s", test_files)
    if non_test_files:
        logger.info("Non-test files changed: %s", non_test_files)

    return all_files


def get_changed_test_files() -> list[str]:
    """Return changed test files only. Discards non-test changes.

    Used by the generate workflow where only test files are allowed.
    Non-test tracked files are reverted; non-test untracked files are deleted.
    """
    tracked_changed, untracked = _detect_changes()
    all_files = tracked_changed | untracked

    test_files = []
    non_test_tracked = []
    non_test_untracked = []
    for file_path in sorted(all_files):
        if is_test_file(file_path):
            test_files.append(file_path)
        elif file_path in untracked:
            non_test_untracked.append(file_path)
        else:
            non_test_tracked.append(file_path)

    if non_test_tracked:
        logger.warning(
            "Reverting %d non-test tracked file(s): %s",
            len(non_test_tracked), non_test_tracked,
        )
        subprocess.run(["git", "checkout", "--"] + non_test_tracked, check=False)

    if non_test_untracked:
        logger.warning(
            "Deleting %d non-test untracked file(s): %s",
            len(non_test_untracked), non_test_untracked,
        )
        for file_path in non_test_untracked:
            try:
                os.remove(file_path)
            except OSError as exc:
                logger.error("Failed to delete %s: %s", file_path, exc)

    return test_files
