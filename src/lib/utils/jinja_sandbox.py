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

import dataclasses
import multiprocessing
import multiprocessing.connection
import queue
import platform
import resource
import signal
from typing import Any, Callable, Dict, Tuple

import jinja2
import jinja2.sandbox
from jinja2 import exceptions  # pylint: disable=unused-import

from . import osmo_errors

MAX_RETRIES = 3
DEFAULT_WORKERS = 2
DEFAULT_MAX_TIME = 0.5
DEFAULT_JINJA_MEMORY = 100*1024*1024


@dataclasses.dataclass
class WorkItem:
    args: Tuple
    kwargs: Dict[str, Any]


@dataclasses.dataclass
class WorkResult:
    result: Any
    is_exception: bool = False


class SandboxedWorker:
    """Creates a worker that can run the given function in a sandboxed subprocess"""

    def __init__(self, func: Callable, jinja_memory: int = DEFAULT_JINJA_MEMORY,
                 max_time: float = DEFAULT_MAX_TIME):
        self._max_time = max_time
        self._jinja_memory = jinja_memory
        self._func = func

        # Initialize pipe and process
        self._parent_conn, self._child_conn = multiprocessing.Pipe()
        self._process = multiprocessing.Process(target=self._subprocess_main, daemon=True)
        self._process.start()
        self._child_conn.close()

        # Wait for child to signal it's ready
        self._wait_for_child_ready()

    def _wait_for_child_ready(self):
        """Wait for the child process to signal it's ready to receive work"""
        try:
            # Wait for the "ready" signal from child process
            ready_signal = self._parent_conn.recv()
            if ready_signal != 'ready':
                raise osmo_errors.OSMOServerError(
                    'Child process did not send expected ready signal')
        except EOFError as e:
            raise osmo_errors.OSMOServerError(
                'Child process failed to start or exited unexpectedly') from e

    def _set_memory_limit(self):
        if platform.system() == 'Darwin':
            # RLIMIT_AS/RLIMIT_DATA are not supported on macOS
            return

        current_usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
        new_limit = current_usage + self._jinja_memory
        resource.setrlimit(resource.RLIMIT_AS, (new_limit, new_limit))

    def _subprocess_main(self):
        # Let the default SIGTERM handler terminate the process
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        self._parent_conn.close()

        self._set_memory_limit()

        # Signal that the subprocess isready to receive work
        self._child_conn.send('ready')

        # Run implementation and send result through pipe
        while True:
            # Get work item, break on EOFError
            try:
                work_item = self._child_conn.recv()
            except EOFError:
                break

            # Run given function and save the result/exception
            try:
                result = self._func(*work_item.args, **work_item.kwargs)
                is_exception = False
            except Exception as e:  # pylint: disable=broad-except
                result = e
                is_exception = True

            # Send result through pipe, break on EOFError
            try:
                self._child_conn.send(WorkResult(result, is_exception=is_exception))
            except EOFError:
                break

    def _restart(self):
        self._parent_conn, self._child_conn = multiprocessing.Pipe()
        self._process.kill()
        self._process = multiprocessing.Process(target=self._subprocess_main, daemon=True)
        self._process.start()
        self._child_conn.close()

        # Wait for the restarted child to be ready
        self._wait_for_child_ready()

    def run(self, *args, **kwargs) -> Any:
        retries = 0
        while True:
            try:
                self._parent_conn.send(WorkItem(args, kwargs))
                break
            # If it fails, restart the worker process and try again
            except BrokenPipeError as err:
                self._restart()
                if retries >= MAX_RETRIES:
                    raise osmo_errors.OSMOServerError(
                        f'Process failed to start after {MAX_RETRIES} retries due to {err}. '
                        'Please resubmit and try again.')
                retries += 1

        # Wait up to max_time for the result. If we don't have a result by then,
        # assume the process is stuck and restart it.
        if not self._parent_conn.poll(timeout=self._max_time):
            self._restart()
            raise TimeoutError(f'Process exceeded time limit of {self._max_time} seconds')

        result = self._parent_conn.recv()

        # If the process has died, then restart it and throw an exception
        if not self._process.is_alive():
            self._restart()
            raise osmo_errors.OSMOServerError(
                f'Process died unexpectedly exit code {self._process.exitcode}')

        # If the process returned an exception, re-raise a MemoryError with more details,
        # otherwise, just raise it
        if result.is_exception:
            if isinstance(result.result, MemoryError):
                raise MemoryError(
                    f'Sandboxed process exceeded memory limit of {self._jinja_memory} bytes') \
                    from result.result
            else:
                raise result.result

        # Otherwise, return the result
        return result.result

    def shutdown(self):
        """Terminate the worker process and close connections"""
        try:
            self._parent_conn.close()
        except Exception:  # pylint: disable=broad-except
            pass

        if self._process and self._process.is_alive():
            self._process.terminate()
            self._process.join(timeout=1)
            if self._process.is_alive():
                self._process.kill()
                self._process.join(timeout=1)


class SandboxedWorkerPool:
    """A pool of sandboxed workers that can run the given function in a sandboxed subprocess"""

    def __init__(self, func: Callable, num_workers: int, jinja_memory: int = DEFAULT_JINJA_MEMORY,
                 max_time: float = DEFAULT_MAX_TIME):
        self._workers: queue.Queue[SandboxedWorker] = queue.Queue()
        for _ in range(num_workers):
            self._workers.put(SandboxedWorker(
                func=func,
                jinja_memory=jinja_memory,
                max_time=max_time,
            ))

    def run(self, *args, **kwargs) -> Any:
        worker = self._workers.get()
        try:
            return worker.run(*args, **kwargs)
        finally:
            self._workers.put(worker)

    def shutdown(self):
        """Shutdown all workers in the pool"""
        while not self._workers.empty():
            try:
                worker = self._workers.get_nowait()
                worker.shutdown()
            except queue.Empty:
                break


class SandboxedJinjaRenderer:
    """Safely renders Jinja templates in a pool of sandboxed worker subprocesses"""
    _instance = None

    @staticmethod
    def render_template(template: str, data: Dict) -> str:
        j2_env = jinja2.sandbox.SandboxedEnvironment(undefined=jinja2.StrictUndefined)
        j2_template = j2_env.from_string(template)
        return j2_template.render(data)

    def __init__(self, workers: int = DEFAULT_WORKERS, max_time: float = DEFAULT_MAX_TIME,
                 jinja_memory: int = DEFAULT_JINJA_MEMORY):
        self.workers = workers
        self.max_time = max_time
        self.jinja_memory = jinja_memory
        self._pool = SandboxedWorkerPool(
            self.render_template, self.workers, jinja_memory=self.jinja_memory,
            max_time=self.max_time)
        self.__class__._instance = self

    @classmethod
    def get_instance(
        cls,
        workers: int | None = None,
        max_time: float | None = None,
        jinja_memory: int | None = None,
    ) -> 'SandboxedJinjaRenderer':
        if cls._instance is None or \
            (workers is not None and cls._instance.workers != workers) or \
            (max_time is not None and cls._instance.max_time != max_time) or \
                (jinja_memory is not None and cls._instance.jinja_memory != jinja_memory):
            effective_workers = workers if workers is not None else DEFAULT_WORKERS
            effective_max_time = max_time if max_time is not None else DEFAULT_MAX_TIME
            effective_jinja_memory = jinja_memory if jinja_memory is not None \
                else DEFAULT_JINJA_MEMORY
            cls._instance = cls(workers=effective_workers, max_time=effective_max_time,
                                jinja_memory=effective_jinja_memory)

        return cls._instance

    def substitute(self, template: str, data: Dict) -> str:
        return self._pool.run(template, data)

    def shutdown(self):
        """Shutdown the worker pool and reset singleton"""
        if self._pool:
            self._pool.shutdown()
        self.__class__._instance = None  # pylint: disable=protected-access


def sandboxed_jinja_substitute(
    template: str,
    data: Dict,
    workers: int | None = None,
    max_time: float | None = None,
    jinja_memory: int | None = None,
) -> str:
    """Render a Jinja template with unsave methods prohibited and with an sandboxed worker pool"""
    renderer = SandboxedJinjaRenderer.get_instance(workers=workers, max_time=max_time,
                                                   jinja_memory=jinja_memory)
    try:
        return renderer.substitute(template, data)
    except (jinja2.exceptions.TemplateError, TimeoutError, MemoryError) as e:
        raise osmo_errors.OSMOUsageError(f'Jinja substitution failure: {type(e)}: {e}')
