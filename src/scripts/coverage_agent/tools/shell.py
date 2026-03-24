# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import dataclasses
import subprocess


@dataclasses.dataclass
class ShellResult:
    stdout: str
    stderr: str
    returncode: int


def run_shell(command: str, timeout: int = 300) -> ShellResult:
    """Execute a shell command and return the result."""
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return ShellResult(
            stdout=result.stdout,
            stderr=result.stderr,
            returncode=result.returncode,
        )
    except subprocess.TimeoutExpired:
        return ShellResult(
            stdout="",
            stderr=f"Command timed out after {timeout}s: {command}",
            returncode=-1,
        )
