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
import platform
import queue
import time
import unittest
from unittest import mock

import jinja2

from src.lib.utils import jinja_sandbox, osmo_errors


# Test functions
# These are defined as global functions to avoid pickling issues on macOS.

def triple(x):
    return x*3


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


def raise_value_error(x):
    raise ValueError(f'rejected {x}')


class FakeConnection:
    """In-process stand-in for a multiprocessing pipe end.

    Lets the containment/recovery branches of SandboxedWorker be driven
    deterministically without spawning subprocesses, whose bodies are
    invisible to both the test process and coverage instrumentation.
    """

    def __init__(self, incoming=None, result_send_effects=None, work_send_error=None):
        self.incoming = list(incoming or [])
        self.result_send_effects = list(result_send_effects or [])
        self.work_send_error = work_send_error
        self.sent = []
        self.close_count = 0
        self.close_error = None

    def close(self):
        self.close_count += 1
        if self.close_error is not None:
            raise self.close_error

    def send(self, payload):
        if isinstance(payload, jinja_sandbox.WorkResult):
            if self.result_send_effects:
                effect = self.result_send_effects.pop(0)
                if effect is not None:
                    raise effect
        elif self.work_send_error is not None:
            raise self.work_send_error
        self.sent.append(payload)

    def recv(self):
        if not self.incoming:
            raise EOFError('pipe closed')
        item = self.incoming.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    def poll(self, timeout=None):
        del timeout
        return bool(self.incoming)


class FakeProcess:
    """Records lifecycle calls so shutdown/liveness branches are observable."""

    def __init__(self, alive: bool, exitcode: int = 1):
        self.alive = alive
        self.exitcode = exitcode
        self.terminate_count = 0
        self.kill_count = 0
        self.join_count = 0

    def is_alive(self):
        return self.alive

    def terminate(self):
        self.terminate_count += 1

    def kill(self):
        self.kill_count += 1

    def join(self, timeout=None):
        del timeout
        self.join_count += 1


def detached_worker(func=triple, parent_conn=None, child_conn=None, process=None,
                    jinja_memory=1024, max_time=0.01):
    """Build a SandboxedWorker with injected pipes instead of a live subprocess."""
    # pylint: disable=protected-access
    worker = jinja_sandbox.SandboxedWorker.__new__(jinja_sandbox.SandboxedWorker)
    worker._func = func
    worker._jinja_memory = jinja_memory
    worker._max_time = max_time
    worker._parent_conn = parent_conn if parent_conn is not None else FakeConnection()
    worker._child_conn = child_conn if child_conn is not None else FakeConnection()
    worker._process = process
    worker._multiprocessing_context = None
    return worker


class TestSandboxedWorkerSubprocessBody(unittest.TestCase):
    """Cover the worker loop that normally executes inside a spawned subprocess."""

    def setUp(self):
        # pylint: disable=protected-access
        signal_patch = mock.patch.object(jinja_sandbox.signal, 'signal')
        setrlimit_patch = mock.patch.object(jinja_sandbox.resource, 'setrlimit')
        self.signal = signal_patch.start()
        self.setrlimit = setrlimit_patch.start()
        self.addCleanup(signal_patch.stop)
        self.addCleanup(setrlimit_patch.stop)

    def test_subprocess_main_signals_ready_then_returns_each_result(self):
        child = FakeConnection(incoming=[jinja_sandbox.WorkItem((5,), {})])
        parent = FakeConnection()
        worker = detached_worker(parent_conn=parent, child_conn=child)

        worker._subprocess_main()  # pylint: disable=protected-access

        self.assertEqual(child.sent[0], 'ready')
        self.assertEqual(child.sent[1].result, 15)
        self.assertFalse(child.sent[1].is_exception)
        self.assertEqual(parent.close_count, 1)

    def test_subprocess_main_applies_the_memory_limit_before_accepting_work(self):
        worker = detached_worker(child_conn=FakeConnection())

        worker._subprocess_main()  # pylint: disable=protected-access

        self.setrlimit.assert_called_once()
        limit_args = self.setrlimit.call_args.args
        self.assertEqual(limit_args[0], jinja_sandbox.resource.RLIMIT_AS)
        self.assertEqual(limit_args[1][0], limit_args[1][1])

    def test_subprocess_main_returns_function_exceptions_as_flagged_results(self):
        child = FakeConnection(incoming=[jinja_sandbox.WorkItem((7,), {})])
        worker = detached_worker(func=raise_value_error, child_conn=child)

        worker._subprocess_main()  # pylint: disable=protected-access

        self.assertTrue(child.sent[1].is_exception)
        self.assertIsInstance(child.sent[1].result, ValueError)

    def test_subprocess_main_replaces_an_unserializable_result_with_a_memory_error(self):
        child = FakeConnection(
            incoming=[jinja_sandbox.WorkItem((5,), {})],
            result_send_effects=[MemoryError('too big'), None])
        worker = detached_worker(child_conn=child)

        worker._subprocess_main()  # pylint: disable=protected-access

        self.assertEqual(len(child.sent), 2)
        self.assertTrue(child.sent[1].is_exception)
        self.assertIsInstance(child.sent[1].result, MemoryError)
        self.assertIn('Result too large', str(child.sent[1].result))

    def test_subprocess_main_stops_when_the_memory_error_report_also_fails(self):
        child = FakeConnection(
            incoming=[jinja_sandbox.WorkItem((5,), {}), jinja_sandbox.WorkItem((6,), {})],
            result_send_effects=[MemoryError('too big'), MemoryError('still too big')])
        worker = detached_worker(child_conn=child)

        worker._subprocess_main()  # pylint: disable=protected-access

        self.assertEqual(child.sent, ['ready'])
        self.assertEqual(len(child.incoming), 1)

    def test_subprocess_main_stops_when_the_parent_closed_the_result_pipe(self):
        child = FakeConnection(
            incoming=[jinja_sandbox.WorkItem((5,), {}), jinja_sandbox.WorkItem((6,), {})],
            result_send_effects=[EOFError('gone')])
        worker = detached_worker(child_conn=child)

        worker._subprocess_main()  # pylint: disable=protected-access

        self.assertEqual(child.sent, ['ready'])
        self.assertEqual(len(child.incoming), 1)

    def test_set_memory_limit_is_skipped_on_macos(self):
        worker = detached_worker()

        with mock.patch.object(jinja_sandbox.platform, 'system', return_value='Darwin'):
            worker._set_memory_limit()  # pylint: disable=protected-access

        self.setrlimit.assert_not_called()


class TestSandboxedWorkerRecovery(unittest.TestCase):
    """Cover the parent-side failure recovery branches of SandboxedWorker."""

    def test_worker_rejects_a_child_that_sends_an_unexpected_ready_signal(self):
        worker = detached_worker(parent_conn=FakeConnection(incoming=['not-ready']))

        with self.assertRaisesRegex(osmo_errors.OSMOServerError, 'ready signal'):
            worker._wait_for_child_ready()  # pylint: disable=protected-access

    def test_worker_rejects_a_child_that_exited_before_signalling_ready(self):
        worker = detached_worker(parent_conn=FakeConnection())

        with self.assertRaisesRegex(osmo_errors.OSMOServerError, 'failed to start'):
            worker._wait_for_child_ready()  # pylint: disable=protected-access

    def test_run_gives_up_after_restarting_a_persistently_broken_pipe(self):
        parent = FakeConnection(work_send_error=BrokenPipeError('broken'))
        worker = detached_worker(parent_conn=parent)
        worker._restart = mock.Mock()  # pylint: disable=protected-access

        with self.assertRaisesRegex(osmo_errors.OSMOServerError, 'after 3 retries'):
            worker.run(5)

        self.assertEqual(worker._restart.call_count, 4)  # pylint: disable=protected-access

    def test_run_raises_a_timeout_when_no_result_arrives_in_time(self):
        worker = detached_worker(parent_conn=FakeConnection())
        worker._restart = mock.Mock()  # pylint: disable=protected-access

        with self.assertRaisesRegex(TimeoutError, 'time limit'):
            worker.run(5)

        worker._restart.assert_called_once()  # pylint: disable=protected-access

    def test_run_reports_a_memory_error_when_the_result_pipe_closes(self):
        worker = detached_worker(parent_conn=FakeConnection(incoming=[EOFError('gone')]))
        worker._restart = mock.Mock()  # pylint: disable=protected-access

        with self.assertRaisesRegex(MemoryError, 'memory limit of 1024 bytes'):
            worker.run(5)

        worker._restart.assert_called_once()  # pylint: disable=protected-access

    def test_run_reports_a_dead_process_even_when_a_result_arrived(self):
        worker = detached_worker(
            parent_conn=FakeConnection(incoming=[jinja_sandbox.WorkResult(15)]),
            process=FakeProcess(alive=False, exitcode=137))
        worker._restart = mock.Mock()  # pylint: disable=protected-access

        with self.assertRaisesRegex(osmo_errors.OSMOServerError, 'exit code 137'):
            worker.run(5)

        worker._restart.assert_called_once()  # pylint: disable=protected-access

    def test_run_translates_a_child_memory_error_into_the_configured_limit(self):
        result = jinja_sandbox.WorkResult(MemoryError('inner'), is_exception=True)
        worker = detached_worker(
            parent_conn=FakeConnection(incoming=[result]),
            process=FakeProcess(alive=True))

        with self.assertRaisesRegex(MemoryError, 'memory limit of 1024 bytes'):
            worker.run(5)

    def test_shutdown_ignores_a_connection_that_cannot_be_closed(self):
        parent = FakeConnection()
        parent.close_error = OSError('already closed')
        process = FakeProcess(alive=False)
        worker = detached_worker(parent_conn=parent, process=process)

        worker.shutdown()

        self.assertEqual(parent.close_count, 1)
        self.assertEqual(process.terminate_count, 0)

    def test_shutdown_kills_a_worker_that_ignores_termination(self):
        process = FakeProcess(alive=True)
        worker = detached_worker(process=process)

        worker.shutdown()

        self.assertEqual(process.terminate_count, 1)
        self.assertEqual(process.kill_count, 1)
        self.assertEqual(process.join_count, 2)


class DrainedQueue:
    """Queue stub that reports items but hands out none, as in a shutdown race."""

    def empty(self):
        return False

    def get_nowait(self):
        raise queue.Empty()


class TestSandboxedWorkerPoolShutdown(unittest.TestCase):
    """Cover the pool shutdown loop's concurrent-drain exit."""

    def test_pool_shutdown_stops_when_the_queue_drains_concurrently(self):
        # pylint: disable=protected-access
        pool = jinja_sandbox.SandboxedWorkerPool.__new__(jinja_sandbox.SandboxedWorkerPool)
        pool._workers = DrainedQueue()  # type: ignore[assignment]

        pool.shutdown()

        self.assertIsInstance(pool._workers, DrainedQueue)


class TestRenderTemplate(unittest.TestCase):
    """Cover the render entry point that normally only runs inside a worker."""

    def test_render_template_substitutes_provided_data(self):
        result = jinja_sandbox.SandboxedJinjaRenderer.render_template(
            GOOD_TEMPLATE, {'name': 'World'})

        self.assertEqual(result, 'Hello, World!')

    def test_render_template_blocks_attribute_escapes(self):
        with self.assertRaises(jinja2.exceptions.SecurityError):
            jinja_sandbox.SandboxedJinjaRenderer.render_template(UNSAFE_TEMPLATE, {})

    def test_render_template_rejects_undefined_variables(self):
        with self.assertRaises(jinja2.exceptions.UndefinedError):
            jinja_sandbox.SandboxedJinjaRenderer.render_template(GOOD_TEMPLATE, {})


if __name__ == '__main__':
    unittest.main()
