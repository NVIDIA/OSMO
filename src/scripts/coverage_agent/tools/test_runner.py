# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import logging
import shlex
from typing import Optional

from coverage_agent.plugins.base import TestType, ValidationResult, detect_test_type, file_path_to_bazel_package
from coverage_agent.tools.shell import run_shell

logger = logging.getLogger(__name__)


def _file_path_to_bazel_target(file_path: str) -> Optional[str]:
    """Discover the Bazel test target for a given test file via bazel query."""
    package = file_path_to_bazel_package(file_path)
    basename = file_path.rsplit("/", 1)[-1]

    result = run_shell(
        f"bazel query 'kind(\".*_test\", attr(srcs, \"{basename}\", {package}/...))' 2>/dev/null",
        timeout=30,
    )
    if result.returncode == 0 and result.stdout.strip():
        target = result.stdout.strip().split("\n")[0]
        logger.debug("Discovered Bazel target: %s → %s", file_path, target)
        return target

    fallback = f"{package}:all"
    logger.debug("No specific target found for %s, falling back to %s", file_path, fallback)
    return fallback


def run_test(test_file_path: str, timeout: int = 180) -> ValidationResult:
    """Run a test file using the appropriate build system.

    Python/Go: `bazel test` (toolchains are managed by Bazel, not on PATH).
    UI (TypeScript): `pnpm test` (Node.js is on PATH).
    """
    test_type = detect_test_type(test_file_path)

    if test_type in (TestType.PYTHON, TestType.GO):
        return _run_bazel_test(test_file_path, timeout)
    if test_type == TestType.UI:
        return _run_vitest(test_file_path, timeout)

    return ValidationResult(passed=False, output=f"Unknown test type: {test_file_path}", retry_hint=None)


def _run_bazel_test(test_file_path: str, timeout: int) -> ValidationResult:
    """Run a test via bazel test."""
    target = _file_path_to_bazel_target(test_file_path)

    logger.info("Running: bazel test %s", target)
    result = run_shell(f"bazel test {shlex.quote(target)} --test_output=errors", timeout=timeout)

    output = result.stdout + result.stderr

    if result.returncode != 0:
        for line in output.split("\n"):
            if "testlogs" not in line:
                continue
            for part in line.strip().split():
                if "testlogs" not in part:
                    continue
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
    result = run_shell(f"cd src/ui && pnpm test -- --run {shlex.quote(test_file_path)}", timeout=timeout)

    return ValidationResult(
        passed=result.returncode == 0,
        output=result.stdout + result.stderr,
        retry_hint=result.stderr if result.returncode != 0 else None,
    )
