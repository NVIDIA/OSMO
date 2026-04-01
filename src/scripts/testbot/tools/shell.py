# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Shell command execution with timeout and process group cleanup."""

import dataclasses
import os
import shlex
import signal
import subprocess
import tempfile


@dataclasses.dataclass
class ShellResult:
    """Captured output of a shell command execution."""

    stdout: str
    stderr: str
    returncode: int


def run_shell(command: str, timeout: int = 300) -> ShellResult:
    """Execute a shell command and return the result.

    On timeout, kills the child process tree to avoid orphans.
    """
    process = subprocess.Popen(  # pylint: disable=consider-using-with
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
        os.killpg(process.pid, signal.SIGKILL)
        stdout, stderr = process.communicate()
        return ShellResult(
            stdout=stdout or "",
            stderr=f"Command timed out after {timeout}s: {command}\n{stderr or ''}",  # pylint: disable=inconsistent-quotes
            returncode=-1,
        )


def run_shell_with_file(command_template: str, content: str, suffix: str = ".txt") -> ShellResult:
    """Run a shell command that takes a file path argument, writing content to a temp file.

    command_template should contain {} where the temp file path will be inserted.
    Example: run_shell_with_file("git commit -F {}", commit_message)
    """
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False)  # pylint: disable=consider-using-with
    try:
        tmp.write(content)
        tmp.close()
        return run_shell(command_template.format(shlex.quote(tmp.name)))
    finally:
        os.unlink(tmp.name)
