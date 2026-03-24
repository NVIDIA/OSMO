# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from coverage_agent.tools.shell import run_shell


def list_build_targets(package: str) -> str:
    """List all build targets in a Bazel package."""
    result = run_shell(f"bazel query 'kind(rule, {package}/...)'")
    if result.returncode != 0:
        return f"Error querying {package}: {result.stderr}"
    return result.stdout
