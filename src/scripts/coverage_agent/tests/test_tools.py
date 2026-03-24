# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import os
import tempfile
import unittest

from coverage_agent.tools.file_ops import read_file, write_file
from coverage_agent.tools.shell import run_shell


class TestReadFile(unittest.TestCase):
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
    def test_write_file_creates_file(self):
        path = os.path.join(tempfile.mkdtemp(), "test_output.py")
        try:
            result = write_file(path, "print('hello')\n")
            self.assertIn("Written", result)
            with open(path) as file:
                self.assertEqual(file.read(), "print('hello')\n")
        finally:
            if os.path.exists(path):
                os.unlink(path)

    def test_write_file_creates_parent_dirs(self):
        path = os.path.join(tempfile.mkdtemp(), "subdir", "test_output.py")
        try:
            result = write_file(path, "content\n")
            self.assertIn("Written", result)
            self.assertTrue(os.path.exists(path))
        finally:
            if os.path.exists(path):
                os.unlink(path)


class TestRunShell(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
