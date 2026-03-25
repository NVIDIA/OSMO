# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import logging
import os
import shlex
from typing import Optional

from coverage_agent.plugins.base import ValidationResult
from coverage_agent.tools.shell import run_shell

logger = logging.getLogger(__name__)


def _file_path_to_bazel_package(file_path: str) -> str:
    """Convert a file path to a Bazel package.

    Example: src/utils/roles/user_role_sync_test.go → //src/utils/roles
    """
    return "//" + os.path.dirname(file_path)


def _file_path_to_bazel_target(file_path: str) -> Optional[str]:
    """Discover the Bazel test target for a given test file.

    Uses `bazel query` to find which test target contains this source file.
    Falls back to running all tests in the package if query fails.
    """
    package = _file_path_to_bazel_package(file_path)
    basename = os.path.basename(file_path)

    # Query for test targets that include this source file
    result = run_shell(
        f"bazel query 'kind(\".*_test\", attr(srcs, \"{basename}\", {package}/...))' 2>/dev/null"
    )
    if result.returncode == 0 and result.stdout.strip():
        # Return the first matching target
        return result.stdout.strip().split("\n")[0]

    # Fallback: run all tests in the package
    return f"{package}:all"


def run_test(test_file_path: str, timeout: int = 180) -> ValidationResult:
    """Run a test file using the appropriate build system.

    - Python/Go: Uses `bazel test` (toolchains are managed by Bazel, not on PATH)
    - UI (TypeScript): Uses `pnpm test` (Node.js is on PATH)
    """
    if test_file_path.endswith(".py"):
        return _run_bazel_test(test_file_path, timeout)
    if test_file_path.endswith(".go"):
        return _run_bazel_test(test_file_path, timeout)
    if test_file_path.endswith((".ts", ".tsx")):
        return _run_vitest(test_file_path, timeout)

    return ValidationResult(passed=False, output=f"Unknown test type: {test_file_path}", retry_hint=None)


def _run_bazel_test(test_file_path: str, timeout: int) -> ValidationResult:
    """Run a test via bazel test."""
    target = _file_path_to_bazel_target(test_file_path)
    if target is None:
        return ValidationResult(
            passed=False,
            output=f"Could not find Bazel target for {test_file_path}",
            retry_hint="Ensure the test file is listed in a BUILD file with a test rule",
        )

    logger.info("Running: bazel test %s", target)
    result = run_shell(
        f"bazel test {shlex.quote(target)} --test_output=errors",
        timeout=timeout,
    )

    output = result.stdout + result.stderr

    # bazel test prints test log locations on failure — include them
    if result.returncode != 0:
        # Try to read the test log for more details
        log_lines = [line for line in output.split("\n") if "testlogs" in line or "FAILED" in line]
        for log_line in log_lines:
            # Extract log file path and read it
            parts = log_line.strip().split()
            for part in parts:
                if "testlogs" in part and os.path.exists(part):
                    try:
                        with open(part) as log_file:
                            output += f"\n--- Test log ({part}) ---\n{log_file.read()}"
                    except OSError:
                        pass

    return ValidationResult(
        passed=result.returncode == 0,
        output=output,
        retry_hint=output if result.returncode != 0 else None,
    )


def _run_vitest(test_file_path: str, timeout: int) -> ValidationResult:
    """Run a UI test via pnpm/vitest."""
    logger.info("Running: pnpm test -- --run %s", test_file_path)
    result = run_shell(
        f"cd src/ui && pnpm test -- --run {shlex.quote(test_file_path)}",
        timeout=timeout,
    )

    return ValidationResult(
        passed=result.returncode == 0,
        output=result.stdout + result.stderr,
        retry_hint=result.stderr if result.returncode != 0 else None,
    )
