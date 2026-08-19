"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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
import multiprocessing.connection
import multiprocessing.process
import platform
import queue
import sys
import time
import unittest
from unittest import mock

import jinja2
from jinja2 import exceptions as jinja2_exceptions

from src.lib.utils import jinja_sandbox, osmo_errors


# Test functions
# These are defined as global functions to avoid pickling issues on macOS.

def triple(x):
    return x*3


def triple_or_exit_on_odd(x):
    if x % 2 == 0:
        return x*3
    else:
        sys.exit(7)


def triple_hang_on_odd(x):
    if x % 2 == 0:
        return x*3
    else:
        while True:
            time.sleep(1)


def triple_allocate_on_odd(x):
    if x % 2 == 0:
        return x*3
    else:
        return [100] * (10**15)


# This template is safe and doesen't use too much CPU or memory
GOOD_TEMPLATE = """Hello, {{ name }}!"""

BIG_TEMPLATE = """
workflow:
  name: {{name}}
  task:
{% for task_num in range(0, 512) %}
  - name: worker_{{task_num}}
    image: ubuntu:22.04
    command:
    - bash
    - -c
    - |
      echo "Hello, world!"
      sleep 1
      python3 my-script.py
{% endfor %}

"""

# This template will loop a huge number of times (with no output) which will consume lots of CPU
CPU_BOUND_TEMPLATE = """
Hello, my name is {{ name }}!
{% for i in range(100000) -%}
{% for j in range(100000) -%}
{% for k in range(100000) -%}
{% for l in range(100000) -%}
{%- endfor %}
{%- endfor %}
{%- endfor %}
{%- endfor %}
"""

# This template will build a massive string which will consume lots of memory.
# Uses explicit set statements (not a for loop) because Jinja2 scopes {% set %}
# inside {% for %} per-iteration, preventing carry-over between iterations.
# 5MB -> 10MB -> 20MB -> 40MB -> 80MB -> 160MB, exceeding the test memory limit on Linux.
MEMORY_BOUND_TEMPLATE = """
Hello, my name is {{ name }}!
{% set x = 'A' * (5 * 1024 * 1024) %}
{% set x = x + x %}
{% set x = x + x %}
{% set x = x + x %}
{% set x = x + x %}
{% set x = x + x %}
{{ x|length }}
"""

# This template will try to access an unsafe method
UNSAFE_TEMPLATE = """
Hello, my name is {{ ''.__class__}}!
"""


class TestJinjaSandbox(unittest.TestCase):
    """Test that the jinja sandbox works as expected"""
    @classmethod
    def setUpClass(cls):
        # Initialize the renderer with a slightly longer timeout to allow memory errors to happen.
        # 50MB gives enough headroom for Python 3.14's higher virtual memory baseline while
        # still catching MEMORY_BOUND_TEMPLATE (which tries to allocate 160MB).
        jinja_sandbox.SandboxedJinjaRenderer(workers=2, max_time=3, jinja_memory=50*1024*1024)

    @classmethod
    def tearDownClass(cls):
        # Shutdown Jinja renderer workers to prevent process leaks
        # pylint: disable=protected-access  # Accessing singleton instance for test cleanup
        if jinja_sandbox.SandboxedJinjaRenderer._instance:
            jinja_sandbox.SandboxedJinjaRenderer._instance.shutdown()
            jinja_sandbox.SandboxedJinjaRenderer._instance = None

    def test_sandboxed_worker_good(self):
        values = [1, 5, 10, 100, 1000]
        results = [triple(x) for x in values]
        worker = jinja_sandbox.SandboxedWorker(triple)
        for value, result in zip(values, results):
            self.assertEqual(worker.run(value), result)

    def test_sandboxed_worker_too_much_cpu(self):
        values = [0, 1, 2]
        results = [3*x if x % 2 == 0 else None for x in values]

        worker = jinja_sandbox.SandboxedWorker(triple_hang_on_odd)
        for value, result in zip(values, results):
            if result is None:
                with self.assertRaises(TimeoutError):
                    worker.run(value)
            else:
                self.assertEqual(worker.run(value), result)

    def test_sandboxed_worker_too_much_memory(self):
        values = [0, 1, 2]
        results = [3*x if x % 2 == 0 else None for x in values]

        worker = jinja_sandbox.SandboxedWorker(triple_allocate_on_odd)
        for value, result in zip(values, results):
            if result is None:
                with self.assertRaises(MemoryError):
                    worker.run(value)
            else:
                self.assertEqual(worker.run(value), result)

    def test_good_template(self):
        result = jinja_sandbox.sandboxed_jinja_substitute(GOOD_TEMPLATE, {'name': 'World'})
        self.assertEqual(result, 'Hello, World!')

    def test_cpu_bound_template(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUsageError, 'TimeoutError'):
            jinja_sandbox.sandboxed_jinja_substitute(CPU_BOUND_TEMPLATE, {'name': 'World'})

    @unittest.skipIf(platform.system() == 'Darwin',
                     'Memory limits not supported on macOS - test in CI/Linux')
    def test_memory_bound_template(self):
        # On Linux, memory limits should trigger MemoryError
        with self.assertRaisesRegex(osmo_errors.OSMOUsageError, 'MemoryError'):
            jinja_sandbox.sandboxed_jinja_substitute(MEMORY_BOUND_TEMPLATE, {'name': 'World'})

    def test_unsafe_template(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUsageError, 'SecurityError'):
            jinja_sandbox.sandboxed_jinja_substitute(UNSAFE_TEMPLATE, {'name': 'World'})

    def test_big_template_multiple_times(self):
        for _ in range(5):
            jinja_sandbox.sandboxed_jinja_substitute(BIG_TEMPLATE, {'name': 'my-workflow'})


class TestRenderTemplate(unittest.TestCase):
    """Test the sandbox boundary enforced by the template rendering function itself"""

    def test_render_template_substitutes_value_from_data(self):
        result = jinja_sandbox.SandboxedJinjaRenderer.render_template(
            GOOD_TEMPLATE, {'name': 'World'})

        self.assertEqual(result, 'Hello, World!')

    def test_render_template_missing_variable_raises_undefined_error(self):
        with self.assertRaises(jinja2_exceptions.UndefinedError):
            jinja_sandbox.SandboxedJinjaRenderer.render_template(GOOD_TEMPLATE, {})

    def test_render_template_attribute_access_raises_security_error(self):
        with self.assertRaises(jinja2.exceptions.SecurityError):
            jinja_sandbox.SandboxedJinjaRenderer.render_template(
                UNSAFE_TEMPLATE, {'name': 'World'})


class TestSandboxedWorkerRecovery(unittest.TestCase):
    """Test the parent-side failure and worker-recycling paths of SandboxedWorker"""

    def test_worker_run_send_always_broken_raises_server_error(self):
        worker = jinja_sandbox.SandboxedWorker(triple, max_time=5)
        self.addCleanup(worker.shutdown)

        with mock.patch.object(multiprocessing.connection.Connection, 'send',
                               side_effect=BrokenPipeError('pipe is closed')):
            with self.assertRaisesRegex(osmo_errors.OSMOServerError,
                                        'failed to start after 3 retries'):
                worker.run(3)

    def test_worker_run_child_exits_before_result_raises_server_error(self):
        worker = jinja_sandbox.SandboxedWorker(triple_or_exit_on_odd, max_time=5)
        self.addCleanup(worker.shutdown)

        with self.assertRaisesRegex(osmo_errors.OSMOServerError, 'died unexpectedly exit code 7'):
            worker.run(1)

    def test_worker_run_dead_process_with_result_raises_server_error(self):
        worker = jinja_sandbox.SandboxedWorker(triple, max_time=5)
        self.addCleanup(worker.shutdown)

        # The first recv stands in for a result arriving from a process that has already died;
        # the second satisfies the ready handshake of the restart that follows.
        with mock.patch.object(multiprocessing.connection.Connection, 'recv',
                               side_effect=[jinja_sandbox.WorkResult('stale result'), 'ready']):
            with mock.patch.object(multiprocessing.process.BaseProcess, 'is_alive',
                                   return_value=False):
                with self.assertRaisesRegex(osmo_errors.OSMOServerError, 'died unexpectedly'):
                    worker.run(3)

    def test_worker_init_unexpected_ready_signal_raises_server_error(self):
        with mock.patch.object(multiprocessing.connection.Connection, 'recv',
                               return_value='not-the-ready-signal'):
            with self.assertRaisesRegex(osmo_errors.OSMOServerError, 'ready signal'):
                jinja_sandbox.SandboxedWorker(triple, max_time=5)

    def test_worker_init_child_pipe_at_eof_raises_server_error(self):
        with mock.patch.object(multiprocessing.connection.Connection, 'recv',
                               side_effect=EOFError):
            with self.assertRaisesRegex(osmo_errors.OSMOServerError, 'failed to start'):
                jinja_sandbox.SandboxedWorker(triple, max_time=5)

    def test_worker_init_unexpected_ready_signal_leaves_no_live_child(self):
        children_before_init = set(multiprocessing.active_children())

        with mock.patch.object(multiprocessing.connection.Connection, 'recv',
                               return_value='not-the-ready-signal'):
            with self.assertRaises(osmo_errors.OSMOServerError):
                jinja_sandbox.SandboxedWorker(triple, max_time=5)

        self.assertEqual(set(multiprocessing.active_children()) - children_before_init, set())

    def test_worker_init_child_pipe_at_eof_leaves_no_live_child(self):
        children_before_init = set(multiprocessing.active_children())

        with mock.patch.object(multiprocessing.connection.Connection, 'recv',
                               side_effect=EOFError):
            with self.assertRaises(osmo_errors.OSMOServerError):
                jinja_sandbox.SandboxedWorker(triple, max_time=5)

        self.assertEqual(set(multiprocessing.active_children()) - children_before_init, set())

    def test_worker_shutdown_connection_close_failure_is_swallowed(self):
        worker = jinja_sandbox.SandboxedWorker(triple, max_time=5)

        with mock.patch.object(multiprocessing.connection.Connection, 'close',
                               side_effect=OSError('handle is closed')) as mock_close:
            worker.shutdown()

        self.assertTrue(mock_close.called)

    def test_worker_shutdown_process_surviving_terminate_is_killed(self):
        worker = jinja_sandbox.SandboxedWorker(triple, max_time=5)

        with mock.patch.object(multiprocessing.process.BaseProcess, 'is_alive',
                               return_value=True):
            with mock.patch.object(multiprocessing.process.BaseProcess, 'kill') as mock_kill:
                worker.shutdown()

        self.assertTrue(mock_kill.called)


class TestSandboxedWorkerPoolRecovery(unittest.TestCase):
    """Test that the pool keeps handing out usable workers after a child dies"""

    def test_pool_run_after_child_death_returns_fresh_result(self):
        pool = jinja_sandbox.SandboxedWorkerPool(triple_or_exit_on_odd, num_workers=1, max_time=5)
        self.addCleanup(pool.shutdown)

        with self.assertRaises(osmo_errors.OSMOServerError):
            pool.run(1)

        self.assertEqual(pool.run(2), 6)

    def test_pool_shutdown_empty_queue_race_stops_cleanly(self):
        pool = jinja_sandbox.SandboxedWorkerPool(triple, num_workers=1, max_time=5)
        self.addCleanup(pool.shutdown)

        with mock.patch.object(queue.Queue, 'get_nowait',
                               side_effect=queue.Empty) as mock_get_nowait:
            pool.shutdown()

        self.assertTrue(mock_get_nowait.called)


if __name__ == '__main__':
    unittest.main()
