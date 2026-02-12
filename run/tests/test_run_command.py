#!/usr/bin/env python3
"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

import logging
import os
import tempfile
import time
import unittest
from unittest.mock import patch

from run.run_command import run_command_with_logging


class TestRunCommandWithLogging(unittest.TestCase):
    """Unit tests for run_command_with_logging function."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_files_to_cleanup = []

    def tearDown(self):
        """Clean up temporary files created during tests."""
        for temp_file in self.temp_files_to_cleanup:
            try:
                if os.path.exists(temp_file):
                    os.unlink(temp_file)
            except (OSError, IOError):
                pass

    def test_sync_successful_command(self):
        """Test synchronous execution of a successful command."""
        cmd = ['echo', 'Hello, World!']
        process = run_command_with_logging(
            cmd, description='Test echo command'
        )

        self.temp_files_to_cleanup.extend([process.stdout_file, process.stderr_file])

        # Verify process completed successfully
        self.assertFalse(process.is_running())
        self.assertFalse(process.has_failed())
        self.assertEqual(process.get_return_code(), 0)

        # Verify process properties directly
        elapsed_time = process.get_elapsed_time()
        self.assertIsInstance(elapsed_time, float)
        self.assertGreater(elapsed_time, 0)

        # Verify output files exist and contain expected content
        self.assertTrue(os.path.exists(process.stdout_file))
        self.assertTrue(os.path.exists(process.stderr_file))

        with open(process.stdout_file, 'r', encoding='utf-8') as f:
            stdout_content = f.read().strip()
        self.assertEqual(stdout_content, 'Hello, World!')

        with open(process.stderr_file, 'r', encoding='utf-8') as f:
            stderr_content = f.read().strip()
        self.assertEqual(stderr_content, '')

    def test_sync_failing_command(self):
        """Test synchronous execution of a failing command."""
        cmd = ['false']  # Command that always fails
        process = run_command_with_logging(cmd)

        self.temp_files_to_cleanup.extend([process.stdout_file, process.stderr_file])

        # Verify process completed with failure
        self.assertFalse(process.is_running())
        self.assertTrue(process.has_failed())
        self.assertNotEqual(process.get_return_code(), 0)

        # Verify process properties directly
        elapsed_time = process.get_elapsed_time()
        self.assertIsInstance(elapsed_time, float)
        self.assertGreater(elapsed_time, 0)

        # Verify output files exist
        self.assertTrue(os.path.exists(process.stdout_file))
        self.assertTrue(os.path.exists(process.stderr_file))

    def test_sync_command_with_stderr(self):
        """Test synchronous execution of command that writes to stderr."""
        cmd = ['sh', '-c', 'echo "error message" >&2']
        process = run_command_with_logging(cmd)

        self.temp_files_to_cleanup.extend([process.stdout_file, process.stderr_file])

        # Should still be successful (stderr doesn't mean failure)
        self.assertFalse(process.has_failed())

        with open(process.stderr_file, 'r', encoding='utf-8') as f:
            stderr_content = f.read().strip()
        self.assertEqual(stderr_content, 'error message')

    def test_sync_command_with_input(self):
        """Test synchronous execution with process input."""
        cmd = ['cat']  # cat will echo whatever we send to stdin
        process_input = 'Test input data\n'
        process = run_command_with_logging(
            cmd, process_input=process_input
        )

        self.temp_files_to_cleanup.extend([process.stdout_file, process.stderr_file])

        self.assertFalse(process.has_failed())

        with open(process.stdout_file, 'r', encoding='utf-8') as f:
            stdout_content = f.read()
        self.assertEqual(stdout_content, process_input)

    def test_async_successful_command(self):
        """Test asynchronous execution of a successful command."""
        cmd = ['sleep', '0.1']  # Short sleep command
        process = run_command_with_logging(cmd, async_mode=True)

        # Initially should be running
        self.assertTrue(process.is_running())
        self.assertFalse(process.has_failed())
        self.assertIsNone(process.get_return_code())

        # Wait for completion
        success, stdout_file, stderr_file, elapsed_time = process.wait(timeout=5.0)

        self.temp_files_to_cleanup.extend([stdout_file, stderr_file])

        # Verify success
        self.assertTrue(success)
        self.assertFalse(process.is_running())
        self.assertFalse(process.has_failed())
        self.assertEqual(process.get_return_code(), 0)
        self.assertGreaterEqual(elapsed_time, 0.1)  # Should be at least the sleep time

    def test_async_failing_command(self):
        """Test asynchronous execution of a failing command."""
        cmd = ['sh', '-c', 'exit 1']  # Command that exits with code 1
        process = run_command_with_logging(cmd, async_mode=True)

        # Wait for completion
        success, stdout_file, stderr_file, _ = process.wait(timeout=5.0)

        self.temp_files_to_cleanup.extend([stdout_file, stderr_file])

        # Verify failure
        self.assertFalse(success)
        self.assertFalse(process.is_running())
        self.assertTrue(process.has_failed())
        self.assertEqual(process.get_return_code(), 1)

    def test_async_process_termination(self):
        """Test terminating an async process."""
        cmd = ['sleep', '10']  # Long-running command
        process = run_command_with_logging(cmd, async_mode=True)

        # Initially should be running
        self.assertTrue(process.is_running())

        # Terminate the process
        process.terminate()

        # Wait a bit for termination to take effect
        time.sleep(0.1)

        # Should no longer be running
        self.assertFalse(process.is_running())

        # Clean up temp files
        self.temp_files_to_cleanup.extend([process.stdout_file, process.stderr_file])

    def test_async_process_timeout(self):
        """Test async process timeout handling."""
        cmd = ['sleep', '5']  # Command that takes longer than our timeout
        process = run_command_with_logging(cmd, async_mode=True)

        # Wait with a short timeout
        success, stdout_file, stderr_file, elapsed_time = process.wait(timeout=0.1)

        self.temp_files_to_cleanup.extend([stdout_file, stderr_file])

        # Should have timed out and been terminated
        self.assertFalse(success)
        self.assertFalse(process.is_running())
        self.assertLess(elapsed_time, 1.0)  # Should be much less than the sleep time

    def test_command_with_custom_name(self):
        """Test command execution with custom name for logging."""
        cmd = ['echo', 'test']
        name = 'test_command'

        with patch('run.run_command.logger') as mock_logger:
            process = run_command_with_logging(
                cmd, name=name
            )

            self.temp_files_to_cleanup.extend([process.stdout_file, process.stderr_file])

            # Verify the command was logged with debug level
            mock_logger.debug.assert_called()
        # Check that at least one debug call included our name
            debug_calls = list(mock_logger.debug.call_args_list)
        name_in_calls = any(name in str(call) for call in debug_calls)
        self.assertTrue(name_in_calls)

    def test_async_mode_parameter(self):
        """Test that async_mode parameter works correctly."""
        cmd = ['echo', 'test']

        # Test sync mode (default)
        sync_process = run_command_with_logging(cmd)
        self.assertFalse(sync_process.is_running())  # Should be completed

        # Test async mode
        run_command_with_logging(cmd, async_mode=True)
        # For a fast command like echo, it might complete immediately, but that's ok
        # The important thing is we got a Process object

    def test_command_with_custom_cwd(self):
        """Test command execution with custom working directory."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create a test file in the temp directory
            test_file = os.path.join(temp_dir, 'test.txt')
            with open(test_file, 'w', encoding='utf-8') as f:
                f.write('test content')

            # Run ls command in the temp directory
            cmd = ['ls', 'test.txt']
            process = run_command_with_logging(
                cmd, cwd=temp_dir
            )

            self.temp_files_to_cleanup.extend([process.stdout_file, process.stderr_file])

            self.assertFalse(process.has_failed())

            with open(process.stdout_file, 'r', encoding='utf-8') as f:
                stdout_content = f.read().strip()
            self.assertEqual(stdout_content, 'test.txt')

    def test_command_with_custom_env(self):
        """Test command execution with custom environment variables."""
        cmd = ['sh', '-c', 'echo $TEST_VAR']
        custom_env = os.environ.copy()
        custom_env['TEST_VAR'] = 'test_value'

        process = run_command_with_logging(
            cmd, env=custom_env
        )

        self.temp_files_to_cleanup.extend([process.stdout_file, process.stderr_file])

        self.assertFalse(process.has_failed())

        with open(process.stdout_file, 'r', encoding='utf-8') as f:
            stdout_content = f.read().strip()
        self.assertEqual(stdout_content, 'test_value')

    def test_async_process_elapsed_time(self):
        """Test that Process correctly tracks elapsed time."""
        cmd = ['sleep', '0.1']
        process = run_command_with_logging(cmd, async_mode=True)

        # Check elapsed time while running
        initial_elapsed = process.get_elapsed_time()
        self.assertGreaterEqual(initial_elapsed, 0)

        # Wait a bit
        time.sleep(0.05)

        # Elapsed time should have increased
        mid_elapsed = process.get_elapsed_time()
        self.assertGreater(mid_elapsed, initial_elapsed)

        # Wait for completion
        _, stdout_file, stderr_file, elapsed_time = process.wait()

        self.temp_files_to_cleanup.extend([stdout_file, stderr_file])

        # Final elapsed time should be even greater
        final_elapsed = process.get_elapsed_time()
        self.assertGreater(final_elapsed, mid_elapsed)
        self.assertAlmostEqual(elapsed_time, final_elapsed, places=2)

    @patch('run.run_command.logger')
    def test_logging_behavior(self, mock_logger):
        """Test that logging works correctly."""
        cmd = ['echo', 'test output']

        process = run_command_with_logging(cmd)

        self.temp_files_to_cleanup.extend([process.stdout_file, process.stderr_file])

        # Verify that debug logging was called
        mock_logger.debug.assert_called()

        # Check that the command was logged
        debug_calls = [str(call) for call in mock_logger.debug.call_args_list]
        command_logged = any('Running command:' in call for call in debug_calls)
        self.assertTrue(command_logged)


class TestProcess(unittest.TestCase):
    """Unit tests for Process class."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_files_to_cleanup = []

    def tearDown(self):
        """Clean up temporary files created during tests."""
        for temp_file in self.temp_files_to_cleanup:
            try:
                if os.path.exists(temp_file):
                    os.unlink(temp_file)
            except (OSError, IOError):
                pass

    def test_process_properties(self):
        """Test Process basic properties."""
        cmd = ['sleep', '0.1']
        process = run_command_with_logging(cmd, async_mode=True, name='test_process')

        # Test properties
        self.assertEqual(process.name, 'test_process')
        self.assertTrue(os.path.exists(process.stdout_file))
        self.assertTrue(os.path.exists(process.stderr_file))
        self.assertIsNotNone(process.process)

        # Wait for completion and clean up
        _, stdout_file, stderr_file, _ = process.wait()
        self.temp_files_to_cleanup.extend([stdout_file, stderr_file])


if __name__ == '__main__':
    # Set up logging for tests
    logging.basicConfig(level=logging.DEBUG)
    unittest.main()
