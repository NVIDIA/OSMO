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
import subprocess
import tempfile
import threading
import time
from typing import List, Optional, Tuple

from tqdm import tqdm


logger = logging.getLogger()

# Global process registry for cleanup
_global_process_registry: List['Process'] = []
_registry_lock = threading.Lock()


class Process:
    """Represents a process that can be monitored and terminated."""

    def __init__(self, process: subprocess.Popen, stdout_file: str, stderr_file: str,
                 name: str | None = None):
        self.process = process
        self.stdout_file = stdout_file
        self.stderr_file = stderr_file
        self.name = name
        self._start_time = time.time()
        self._registered = False
        self._register_for_cleanup()

    def _register_for_cleanup(self) -> None:
        """Register this process for cleanup."""
        if not self._registered:
            with _registry_lock:
                _global_process_registry.append(self)
            self._registered = True

    def _unregister_from_cleanup(self) -> None:
        """Remove this process from cleanup registry."""
        if self._registered:
            try:
                with _registry_lock:
                    _global_process_registry.remove(self)
                self._registered = False
            except ValueError:
                # Process was already removed
                pass

    def terminate(self) -> None:
        """Terminate the process and remove from cleanup registry."""
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()

        # Remove from cleanup registry after termination
        self._unregister_from_cleanup()

    def is_running(self) -> bool:
        """Check if the process is still running."""
        return self.process.poll() is None

    def has_failed(self) -> bool:
        """Check if the process has terminated with a non-zero exit code."""
        return_code = self.process.poll()
        return return_code is not None and return_code != 0

    def get_return_code(self) -> Optional[int]:
        """Get the return code of the process (None if still running)."""
        return self.process.poll()

    def get_elapsed_time(self) -> float:
        """Get the elapsed time since the process started."""
        return time.time() - self._start_time

    def wait(self, timeout: Optional[float] = None) -> Tuple[bool, str, str, float]:
        """Wait for the process to complete and return the result."""
        try:
            return_code = self.process.wait(timeout=timeout)
            elapsed_time = self.get_elapsed_time()
            success = return_code == 0
            # Remove from cleanup registry since process has completed
            self._unregister_from_cleanup()
            return success, self.stdout_file, self.stderr_file, elapsed_time
        except subprocess.TimeoutExpired:
            self.terminate()  # This will also unregister from cleanup
            elapsed_time = self.get_elapsed_time()
            return False, self.stdout_file, self.stderr_file, elapsed_time



def run_command_with_logging(
    cmd: List[str],
    description: Optional[str] = None,
    process_input: Optional[str] = None,
    cwd: Optional[str] = None,
    async_mode: bool = False,
    name: Optional[str] = None,
    env: Optional[dict] = None,
) -> Process:
    """
    Run a command and redirect output to temporary files.

    Args:
        cmd: Command to run
        description: Optional description for progress bar (only used in sync mode)
        process_input: Optional input to send to the process
        cwd: Working directory for the command
        async_mode: If True, return immediately; if False, wait for completion
        name: Optional name for identifying processes in logs
        env: Optional environment variables

    Returns:
        Process object for monitoring and control. In sync mode, the process will
        already be completed when returned.

    Note:
        The Process contains stdout and stderr file paths that point to temporary files
        that are not automatically deleted.
    """
    logger.debug('Running command: %s', ' '.join(cmd))

    if cwd is None:
        cwd = os.environ.get('BUILD_WORKSPACE_DIRECTORY', os.getcwd())


    # Create temp files
    stdout_file = tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix='.out')  # pylint: disable=consider-using-with
    stderr_file = tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix='.err')  # pylint: disable=consider-using-with

    try:
        # Start the process
        process = subprocess.Popen(  # pylint: disable=consider-using-with
            cmd,
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )

        def read_stdout():
            """Read stdout lines and write directly to file."""
            try:
                stdout_stream = process.stdout
                if stdout_stream is None:
                    return
                for line in stdout_stream:
                    stdout_file.write(line)
                    if name:
                        logger.debug('> [%s] %s', name, line.rstrip())
                    else:
                        logger.debug('> %s', line.rstrip())
            except (IOError, OSError):
                pass
            finally:
                try:
                    stdout_file.flush()
                except (OSError, IOError):
                    pass

        def read_stderr():
            """Read stderr lines and write directly to file."""
            try:
                stderr_stream = process.stderr
                if stderr_stream is None:
                    return
                for line in stderr_stream:
                    stderr_file.write(line)
                    if name:
                        logger.debug('> [%s] %s', name, line.rstrip())
                    else:
                        logger.debug('> %s', line.rstrip())
            except (IOError, OSError):
                pass
            finally:
                try:
                    stderr_file.flush()
                except (OSError, IOError):
                    pass

        stdout_thread = threading.Thread(target=read_stdout, daemon=True)
        stderr_thread = threading.Thread(target=read_stderr, daemon=True)
        stdout_thread.start()
        stderr_thread.start()

        if process_input is not None and process.stdin is not None:
            try:
                process.stdin.write(process_input)
                process.stdin.flush()
            except (BrokenPipeError, OSError):
                pass
            finally:
                process.stdin.close()

        # Create Process object
        process_obj = Process(process, stdout_file.name, stderr_file.name, name)

        if async_mode:
            return process_obj

        # Sync mode - wait for process to complete
        if description and logger.level != logging.DEBUG:
            with tqdm(
                total=1,
                desc=description,
                bar_format='{desc}... {elapsed}s',
                leave=False,
                ncols=80
            ) as bar:
                while process.poll() is None:
                    time.sleep(0.1)
                    bar.update(0)

        process.wait()

        stdout_thread.join(timeout=1.0)
        stderr_thread.join(timeout=1.0)

        # Close files in sync mode
        stdout_file.close()
        stderr_file.close()

        return process_obj

    except OSError:
        # Clean up on error
        try:
            stdout_file.close()
            stderr_file.close()
        except (OSError, IOError):
            pass
        # Create a dummy process that represents failure
        dummy_process = subprocess.Popen(['false'], stdout=subprocess.DEVNULL,  # pylint: disable=consider-using-with
                                          stderr=subprocess.DEVNULL)
        dummy_process.wait()  # This will set return code to 1
        return Process(dummy_process, stdout_file.name, stderr_file.name, name)


def cleanup_registered_processes(service_type: str = 'services') -> None:
    """Cleanup all registered processes."""
    global _global_process_registry  # pylint: disable=global-variable-not-assigned
    if not _global_process_registry:
        return

    logger.info('🛑 Shutting down OSMO %s...', service_type)

    # Print log file locations before terminating processes
    logger.info('\n📋 %s log file locations:', service_type.capitalize())
    logger.info('=' * 60)
    for process in _global_process_registry:
        if process.name:
            logger.info('📄 %s:', process.name)
            logger.info('   stdout: %s', process.stdout_file)
            logger.info('   stderr: %s', process.stderr_file)
    logger.info('=' * 60)

    # Create a copy of the list since terminate() will modify the original list
    with _registry_lock:
        processes_to_terminate = _global_process_registry.copy()
    for process in processes_to_terminate:
        if process.is_running():
            try:
                process.terminate()  # This will automatically unregister the process
            except OSError:
                pass

    # Clear any remaining processes (shouldn't be any after termination)
    with _registry_lock:
        _global_process_registry.clear()
    logger.info('✅ All %s stopped', service_type)


def wait_for_all_processes() -> None:
    """Wait indefinitely for all processes or throw a RuntimeError if any process fails."""
    while True:
        with _registry_lock:
            if not _global_process_registry:
                return
            for process in _global_process_registry:
                if process.has_failed():
                    raise RuntimeError(f'Process {process.name} failed')
        time.sleep(5)
