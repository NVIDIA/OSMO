# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Shared guardrails for testbot scripts.

Ensures testbot only commits test files and never modifies source code.
"""

import fnmatch
import logging
import subprocess

logger = logging.getLogger(__name__)

TEST_FILE_PATTERNS = [
    "test_*.py",
    "*_test.go",
    "*.test.ts",
    "*.test.tsx",
    "BUILD",
]


def is_test_file(file_path: str) -> bool:
    """Check if a file path matches known test file patterns."""
    basename = file_path.rsplit("/", maxsplit=1)[-1]
    return any(fnmatch.fnmatch(basename, pattern) for pattern in TEST_FILE_PATTERNS)


def get_changed_test_files() -> list[str]:
    """Return list of changed test files only. Discards non-test changes.

    Detects both modified tracked files and new untracked files.
    Any non-test file changes are reverted via git checkout.
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
    all_files = set()
    for output in (diff_result.stdout, untracked_result.stdout):
        for line in output.strip().splitlines():
            if line and not line.startswith(".claude/"):
                all_files.add(line)

    test_files = []
    non_test_files = []
    for file_path in sorted(all_files):
        if is_test_file(file_path):
            test_files.append(file_path)
        else:
            non_test_files.append(file_path)

    if non_test_files:
        logger.warning(
            "Discarding %d non-test file(s) modified by Claude: %s",
            len(non_test_files), non_test_files,
        )
        subprocess.run(["git", "checkout", "--"] + non_test_files, check=False)

    return test_files
