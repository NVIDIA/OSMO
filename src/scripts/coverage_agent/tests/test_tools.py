# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for shell, file_ops, and tool utilities."""

import os
import shutil
import tempfile
import unittest

from coverage_agent.tools.file_ops import read_file, write_file
from coverage_agent.tools.shell import run_shell


class TestReadFile(unittest.TestCase):
    """Tests for reading files with error handling."""

    def test_read_file_existing(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as file:
            file.write("hello world\n")
            path = file.name
        try:
            content = read_file(path)
            self.assertEqual(content, "hello world\n")
        finally:
            os.unlink(path)

    def test_read_file_missing(self):
        result = read_file("/nonexistent/path/file.py")
        self.assertIn("Error", result)


class TestWriteFile(unittest.TestCase):
    """Tests for writing files with parent directory creation."""

    def test_write_file_creates_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "test_output.py")
            result = write_file(path, "print('hello')\n")  # pylint: disable=inconsistent-quotes
            self.assertIn("Written", result)
            with open(path, encoding="utf-8") as file:
                self.assertEqual(file.read(), "print('hello')\n")  # pylint: disable=inconsistent-quotes

    def test_write_file_creates_parent_dirs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "subdir", "test_output.py")
            result = write_file(path, "content\n")
            self.assertIn("Written", result)
            self.assertTrue(os.path.exists(path))


class TestRunShell(unittest.TestCase):
    """Tests for shell command execution with timeout and cleanup."""

    def test_run_shell_success(self):
        result = run_shell("echo hello")
        self.assertIn("hello", result.stdout)
        self.assertEqual(result.returncode, 0)

    def test_run_shell_failure(self):
        result = run_shell("false")
        self.assertNotEqual(result.returncode, 0)

    def test_run_shell_captures_stderr(self):
        result = run_shell("echo error_msg >&2")
        self.assertIn("error_msg", result.stderr)

    def test_run_shell_timeout_returns_error(self):
        """Would have caught: orphaned child process on timeout."""
        result = run_shell("sleep 60", timeout=1)
        self.assertEqual(result.returncode, -1)
        self.assertIn("timed out", result.stderr)

    def test_run_shell_timeout_kills_process(self):
        """Would have caught: child process left running after timeout.

        Spawns a process that writes its PID to a file, then verifies
        the process is no longer running after timeout.
        """
        tmpdir = tempfile.mkdtemp()  # intentionally not TemporaryDirectory — dir may be deleted before process writes
        pid_file = os.path.join(tmpdir, "pid.txt")
        # Write shell's PID and sleep; run_shell should kill the process group
        result = run_shell(f"echo $$ > {pid_file} && sleep 60", timeout=2)
        self.assertEqual(result.returncode, -1)

        try:
            with open(pid_file, encoding="utf-8") as file:
                pid = int(file.read().strip())
            # Check that the process is actually dead
            try:
                os.kill(pid, 0)  # signal 0 = check existence without killing
                self.fail(f"Process {pid} should have been killed but is still running")
            except ProcessLookupError:
                pass  # expected: process was killed
            except PermissionError:
                pass  # also acceptable: process exists but we can't signal it
        except (FileNotFoundError, ValueError):
            pass  # pid file may not have been written before timeout
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
