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
    """Execute a shell command and return the result.

    On timeout, kills the child process tree to avoid orphans.
    """
    process = subprocess.Popen(
        command,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
        return ShellResult(stdout=stdout, stderr=stderr, returncode=process.returncode)
    except subprocess.TimeoutExpired:
        import os
        import signal

        os.killpg(process.pid, signal.SIGKILL)
        stdout, stderr = process.communicate()
        return ShellResult(
            stdout=stdout or "",
            stderr=f"Command timed out after {timeout}s: {command}\n{stderr or ''}",
            returncode=-1,
        )
