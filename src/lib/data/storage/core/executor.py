# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

"""
Generic multi-process/multi-thread executor framework for data operations.

This module provides a generic infrastructure for running jobs across multiple processes
and threads, with progress tracking and result aggregation. It separates the execution
infrastructure from business logic.
"""

import abc
import contextlib
from concurrent import futures
import datetime
import dataclasses
import logging
import multiprocessing
import pickle
import queue
from typing import (
    Any,
    Callable,
    Dict,
    Generator,
    Generic,
    Iterable,
    List,
    TypeAlias,
    Set,
    Tuple,
    TypeVar,
    cast,
)

import pydantic

from . import progress, provider
from ....utils import common, logging as logging_utils, osmo_errors


logger = logging.getLogger(__name__)

DEFAULT_NUM_PROCESSES = multiprocessing.cpu_count()
DEFAULT_NUM_THREADS = 20
DEFAULT_LOG_QUEUE_SIZE = 10_000
MAX_MULTIPLIER = 8

_T = TypeVar('_T', bound='ThreadWorkerInput')  # Input object type
_R = TypeVar('_R', bound='ThreadWorkerOutput')  # Result type


###################################
#   Executor Schemas (External)   #
###################################

class ExecutorParameters(pydantic.BaseSettings):
    """
    A class for storing parameters regarding multi-process/thread operations.

    Allows for environment variable overrides of the parameters.
    """

    class Config:
        """
        Pydantic configuration for the ExecutorParameters class.
        """
        env_prefix = 'OSMO_EXECUTOR_'

        @classmethod
        def customise_sources(
            cls,
            init_settings,
            env_settings,
            file_secret_settings,
        ):
            # Treat explicit None as "unset" so env vars can apply
            def init_without_none(settings):
                data = init_settings(settings)
                return {k: v for k, v in data.items() if v is not None}

            return (init_without_none, env_settings, file_secret_settings)

    num_processes: int | None = pydantic.Field(
        default=None,
        ge=1,
        description='The number of processes for the executor.',
    )

    num_threads: int | None = pydantic.Field(
        default=None,
        ge=1,
        description='The number of threads per process for the executor.',
    )

    num_threads_inflight_multiplier: int = pydantic.Field(
        default=4,
        ge=1,
        description='The multiplier for the number of threads to keep inflight '
                    'for a single process worker. Inflight threads = active + pending threads. '
                    'This is also used to determine the chunk size for a single process worker. '
                    'A chunk of inputs is generated ahead of time for a single process worker.',
    )

    chunk_queue_size_multiplier: int = pydantic.Field(
        default=4,
        ge=1,
        description='The multiplier for the size of the chunk queue for the executor. '
                    'This controls how many "chunks" of inputs are generated ahead of time '
                    'to be consumed by process workers. The chunk queue size is the number '
                    'of processes times this multiplier.',
    )

    log_queue_size: int = pydantic.Field(
        default=DEFAULT_LOG_QUEUE_SIZE,
        ge=1,
        description='The size of the log queue for the executor. Only used for multi-process jobs.',
    )

    @pydantic.validator(
        'num_threads_inflight_multiplier',
        'chunk_queue_size_multiplier',
    )
    @classmethod
    def _validate_multiplier_max(cls, v: int) -> int:
        if v > MAX_MULTIPLIER:
            raise ValueError('Multiplier too large; will exhaust system resources')
        return v

    @property
    def resolved_num_processes(self) -> int:
        """
        If user-provided number of processes is provided, returns that.
        Otherwise, returns 1 (in-process job).
        """
        return (
            self.num_processes
            if self.num_processes is not None
            else 1
        )

    @property
    def resolved_num_threads(self) -> int:
        """
        Returns the number of threads to use for the executor.

        If user-provided number of threads is provided, returns that.
        If multi-process job, returns default number of threads.
        Otherwise, returns 1 (single-threaded job).
        """
        return (
            self.num_threads
            if self.num_threads is not None
            else DEFAULT_NUM_THREADS
            if self.resolved_num_processes > 1
            else 1
        )

    @property
    def resolved_num_threads_inflight(self) -> int:
        """
        Returns the number of threads to keep inflight for a single process worker.

        Ensures inflight is always larger than the number of threads.
        """
        return max(
            self.resolved_num_threads * self.num_threads_inflight_multiplier,
            self.resolved_num_threads + 1,
        )

    @property
    def resolved_chunk_size(self) -> int:
        """
        Returns the chunk size for a single process worker. This is in sync with
        the number of threads to keep inflight for that process worker.
        """
        return self.resolved_num_threads_inflight

    @property
    def resolved_chunk_queue_size(self) -> int:
        """
        Returns the chunk queue size for the executor.

        Ensures queue is always larger than the number of processes
        """
        return max(
            self.resolved_num_processes * self.chunk_queue_size_multiplier,
            self.resolved_num_processes + 1,
        )


###################################
#   Executor Schemas (Internal)   #
###################################

# Uses standard library dataclasses (instead of pydantic) to take advantage of
# `slots` for better performance.
#
# There is minimum validation done on these objects due to internal use only.

@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class ThreadWorkerInput(abc.ABC):
    """
    A class for storing the input to a thread worker.
    """

    size: int

    @abc.abstractmethod
    def error_key(self) -> str:
        """
        A unique key can be used to identify the input in error messages.
        """
        raise NotImplementedError('error_key must be implemented by subclasses')


@dataclasses.dataclass(kw_only=True, slots=True)
class ThreadWorkerOutput(abc.ABC, Generic[_R]):
    """
    A class for storing the output of a thread worker. Must implement __add__ to aggregate outputs.
    """

    @abc.abstractmethod
    def __add__(self, other: _R | None) -> _R:
        raise NotImplementedError('__add__ must be implemented by subclasses')

    @abc.abstractmethod
    def __iadd__(self, other: _R | None) -> _R:
        raise NotImplementedError('__iadd__ must be implemented by subclasses')

    def __radd__(self, other: None) -> _R:
        """
        Handles the case where the left operand is None.
        """
        return cast(_R, self)


ThreadWorker = Callable[
    [_T, provider.StorageClientProvider, progress.ProgressUpdater],
    _R
]


WorkerInputGenerator: TypeAlias = (
    Generator[_T, None, List[BaseException]] |
    Generator[_T, None, None]
)

WorkerInputChunkGenerator: TypeAlias = (
    Generator[Iterable[_T], None, List[BaseException]] |
    Generator[Iterable[_T], None, None]
)


@dataclasses.dataclass(slots=True)
class ProcessWorkerContext(Generic[_T, _R]):
    """
    A class for storing the execution contexts of all thread workers by a process worker.
    """

    output: _R | None = dataclasses.field(default=None)

    errors: List[BaseException] = dataclasses.field(default_factory=list)


@dataclasses.dataclass(slots=True)
class JobContext(Generic[_T, _R]):
    """
    A class for storing the execution context of a multi-process/thread job.
    """

    start_time: datetime.datetime = dataclasses.field(init=False)

    end_time: datetime.datetime | None = dataclasses.field(default=None)

    output: _R | None = dataclasses.field(default=None)

    errors: List[BaseException] = dataclasses.field(default_factory=list)

    def __enter__(self) -> 'JobContext[_T, _R]':
        self.start_time = common.current_time()
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.end_time = common.current_time()


class ThreadWorkerError(Exception):
    """
    An error that occurred during a thread worker execution.

    Extends base Exception class to allow for pickling.
    """
    pass


class ExecutorError(osmo_errors.OSMODataStorageError, Generic[_T, _R]):
    """
    An error that occurred during executor execution.
    """

    __slots__ = ('job_context',)

    job_context: JobContext[_T, _R]

    def __init__(
        self,
        *args,
        job_context: JobContext[_T, _R],
        **kwargs,
    ):
        self.job_context = job_context
        super().__init__(*args, **kwargs)


#################################
#    Executor Implementation    #
#################################


def _execute_single_thread(
    thread_worker: ThreadWorker[_T, _R],
    thread_worker_inputs: Iterable[_T],
    client_provider: provider.StorageClientProvider,
    progress_updater: progress.ProgressUpdater,
) -> ProcessWorkerContext[_T, _R]:
    """
    Executes thread_worker in a single thread.
    """
    result = ProcessWorkerContext[_T, _R]()
    thread_worker_inputs_iter = iter(thread_worker_inputs)

    while True:
        try:
            thread_worker_input = next(thread_worker_inputs_iter)
        except StopIteration as iter_error:
            if iter_error.value is not None:
                result.errors.extend(iter_error.value)
            break

        try:
            output: _R = thread_worker(
                thread_worker_input,
                client_provider,
                progress_updater,
            )

            if result.output is None:
                result.output = output
            else:
                result.output += output

        except Exception as error:  # pylint: disable=broad-except
            error_type = type(error).__name__
            error_message = error.args[0] if error.args else str(error)
            result.errors.append(
                ThreadWorkerError(
                    f'{thread_worker_input.error_key()}: '
                    f'{error_type}: {error_message}',
                ),
            )

    return result


def _execute_multi_thread(
    thread_worker: ThreadWorker[_T, _R],
    thread_worker_max_inflight: int,
    thread_worker_inputs: Iterable[_T],
    thread_executor: futures.ThreadPoolExecutor,
    client_provider: provider.StorageClientProvider,
    progress_updater: progress.ProgressUpdater,
) -> ProcessWorkerContext[_T, _R]:
    """
    Executes thread_worker using a thread pool executor.
    """
    result = ProcessWorkerContext[_T, _R]()
    thread_worker_input_iter = iter(thread_worker_inputs)
    workers: Dict[futures.Future[_R], str] = {}

    # Limit the number of inflight futures to avoid excessive memory usage.
    def _submit() -> bool:
        try:
            thread_worker_input = next(thread_worker_input_iter)
        except StopIteration as iter_error:
            if iter_error.value is not None:
                result.errors.extend(iter_error.value)
            return False

        future: futures.Future[_R] = thread_executor.submit(
            thread_worker,
            thread_worker_input,
            client_provider,
            progress_updater,
        )
        workers[future] = thread_worker_input.error_key()

        return True

    # Fill up the inflight queue with futures
    while len(workers) < thread_worker_max_inflight and _submit():
        pass

    # Wait for the futures to complete
    while workers:
        done, _ = futures.wait(workers, return_when=futures.FIRST_COMPLETED)
        for future in done:
            error_key = workers.pop(future)
            error = future.exception()

            if error:
                error_type = type(error).__name__
                error_message = error.args[0] if error.args else str(error)
                result.errors.append(
                    ThreadWorkerError(
                        f'{error_key}: {error_type}: {error_message}',
                    ),
                )
            else:
                if result.output is None:
                    result.output = future.result()
                else:
                    result.output += future.result()

            # Submit more work if we have room
            while len(workers) < thread_worker_max_inflight and _submit():
                pass

    return result


def _process_worker(
    thread_worker: ThreadWorker[_T, _R],
    thread_worker_count: int,
    thread_worker_max_inflight: int,
    client_factory: provider.StorageClientFactory,
    chunk_queue: queue.Queue[Iterable[_T] | None],
    log_queue: queue.Queue[logging.LogRecord | None],
    progress_update_queue: queue.Queue[progress.ProgressUpdateSnapshot | None] | None,
) -> ProcessWorkerContext[_T, _R]:
    """
    Run thread workers with a persistent thread pool and client pool.
    """
    # Enable multiprocess-safe logging.
    logging_utils.configure_process_worker_logging(log_queue)

    progress_updater: progress.ProgressUpdater = (
        progress.MultiProcessProgressUpdater(progress_update_queue)
        if progress_update_queue is not None
        else progress.NoOpProgressUpdater()
    )

    def _iter_items_from_chunk() -> Iterable[_T]:
        while True:
            chunk = chunk_queue.get()
            if chunk is None:
                break
            yield from chunk

    with client_factory.to_provider(pool=True) as client_provider:

        with futures.ThreadPoolExecutor(
            max_workers=thread_worker_count,
            thread_name_prefix='osmo-data-thread',
        ) as thread_executor:

            with progress_updater:

                return _execute_multi_thread(
                    thread_worker,
                    thread_worker_max_inflight,
                    _iter_items_from_chunk(),
                    thread_executor,
                    client_provider,
                    progress_updater,
                )


def _chunk_generator(
    worker_input_gen: WorkerInputGenerator[_T],
    progress_update_queue: queue.Queue[progress.ProgressUpdateSnapshot | None] | None,
    chunk_size: int,
) -> WorkerInputChunkGenerator[_T]:
    """
    A generator that chunks the input generator into chunks of the given size.
    """
    ret: List[BaseException] | None = None

    while True:
        chunk_item_size = 0
        chunk: List[_T] = []

        # Materialize the chunk for better inter-process communication
        for _ in range(chunk_size):
            try:
                item = next(worker_input_gen)
                chunk_item_size += item.size
                chunk.append(item)
            except StopIteration as iter_error:
                ret = iter_error.value
                break

        if not chunk:
            return ret

        if progress_update_queue is not None:
            # Progress tracker enabled.
            progress_update_queue.put(
                progress.ProgressUpdateSnapshot(total_size_change=chunk_item_size),
            )

        yield chunk

    return ret


def _run_multi_process_job(
    thread_worker: ThreadWorker[_T, _R],
    thread_worker_input_gen: WorkerInputGenerator[_T],
    client_factory: provider.StorageClientFactory,
    enable_progress_tracker: bool,
    process_worker_count: int,
    thread_worker_count: int,
    thread_worker_max_inflight: int,
    chunk_size: int,
    chunk_queue_size: int,
    log_queue_size: int,
) -> JobContext[_T, _R]:
    """
    Execute a job in multiple processes, iterating inputs in chunks,
    with shared progress and a client pool.
    """
    def _execute(
        chunk_queue: queue.Queue[Iterable[_T] | None],
        log_queue: queue.Queue[logging.LogRecord | None],
        progress_update_queue: queue.Queue[progress.ProgressUpdateSnapshot | None] | None,
    ) -> JobContext[_T, _R]:
        """
        Create persistent process workers and feed them chunks of inputs.
        """
        with JobContext[_T, _R]() as job_context:

            try:
                with futures.ProcessPoolExecutor(process_worker_count) as process_executor:
                    workers: Set[futures.Future[ProcessWorkerContext[_T, _R]]] = set()

                    def _start_worker() -> None:
                        workers.add(
                            process_executor.submit(
                                _process_worker,
                                thread_worker,
                                thread_worker_count,
                                thread_worker_max_inflight,
                                client_factory,
                                chunk_queue,
                                log_queue,
                                progress_update_queue,
                            ),
                        )

                    # Start with one worker
                    _start_worker()

                    try:
                        chunk_gen = _chunk_generator(
                            thread_worker_input_gen,
                            progress_update_queue,
                            chunk_size,
                        )

                        # Fill up the queue with chunks.
                        chunk_gen_errors: List[BaseException] | None = None
                        while True:
                            # Get the next chunk from the generator.
                            try:
                                chunk = next(chunk_gen)
                            except StopIteration as gen_error:
                                chunk_gen_errors = gen_error.value
                                break

                            try:
                                # Try to put the chunk in the queue without blocking.
                                chunk_queue.put(chunk, block=False)

                                # After a non-blocking put, if the queue size exceeds
                                # the number of workers, and we still have room for more workers,
                                # we can start a new process worker.
                                if len(workers) < process_worker_count:
                                    try:
                                        # Try to determine if the items in queue have
                                        # exceeded existing workers capacity. No need to
                                        # start a new worker if existing workers are
                                        # processing the queue fast enough.
                                        if chunk_queue.qsize() > len(workers):
                                            _start_worker()
                                    except (NotImplementedError, AttributeError, OSError):
                                        # Queue size is not supported or unreliable,
                                        # so we greedily start a new worker.
                                        _start_worker()

                            except queue.Full:
                                if all(future.done() for future in workers):
                                    # No consumers left; don't deadlock trying to put chunks
                                    logger.error('Queue is full but no workers are running')
                                    break

                                # Consumers are alive, block until space is available.
                                chunk_queue.put(chunk)

                        if chunk_gen_errors:
                            # Collect any errors from the chunk generator.
                            job_context.errors.extend(chunk_gen_errors)

                    finally:
                        # Always signal the workers to finish to prevent deadlocks...
                        alive_worker_count = len([f for f in workers if not f.done()])
                        for _ in range(alive_worker_count):
                            if all(future.done() for future in workers):
                                # No consumers left; don't deadlock trying to send sentinel.
                                break
                            chunk_queue.put(None)

                    # Collect the results from the workers.
                    while workers:
                        done, _ = futures.wait(workers, return_when=futures.FIRST_COMPLETED)

                        for future in done:
                            workers.discard(future)

                            error = future.exception()
                            if error:
                                job_context.errors.append(error)
                                continue

                            ctx = future.result()

                            # Accumulate errors from all process workers
                            job_context.errors.extend(ctx.errors)

                            # Accumulate outputs from all process workers
                            if ctx.output is not None:
                                if job_context.output is None:
                                    job_context.output = ctx.output
                                else:
                                    job_context.output += ctx.output

            except Exception as error:  # pylint: disable=broad-except
                raise ExecutorError(
                    f'Error running multi-process job: {error}',
                    job_context=job_context,
                ) from error

            return job_context

    with multiprocessing.Manager() as manager:
        chunk_queue: queue.Queue[Iterable[_T] | None] = manager.Queue(chunk_queue_size)
        log_queue: queue.Queue[logging.LogRecord | None] = manager.Queue(log_queue_size)

        with logging_utils.multiprocess_logging_listener(log_queue):

            if enable_progress_tracker:
                # Enables progress tracking infrastructure.
                progress_update_queue: queue.Queue[
                    progress.ProgressUpdateSnapshot | None
                ] = manager.Queue()

                with progress.create_multi_process_progress(progress_update_queue):
                    return _execute(chunk_queue, log_queue, progress_update_queue)

            else:
                # Disables progress tracking.
                return _execute(chunk_queue, log_queue, None)


def _get_progress_updater_resources(
    enable_progress_tracker: bool,
    thread_worker_count: int,
) -> Tuple[contextlib.AbstractContextManager, progress.ProgressUpdater]:
    """
    Get the progress tracker/updater resources based on execution parameters.
    """
    if not enable_progress_tracker:
        return contextlib.nullcontext(), progress.NoOpProgressUpdater()

    elif thread_worker_count == 1:
        return progress.create_single_thread_progress()

    return progress.create_multi_thread_progress()


def _run_in_process_job(
    thread_worker: ThreadWorker[_T, _R],
    thread_worker_count: int,
    thread_worker_max_inflight: int,
    thread_worker_input_gen: WorkerInputGenerator[_T],
    client_factory: provider.StorageClientFactory,
    enable_progress_tracker: bool,
) -> JobContext[_T, _R]:
    """
    Executes a single-process job.
    """
    # Choose the progress tracker/updater base on execution parameters.
    tracker_ctx, progress_updater = _get_progress_updater_resources(
        enable_progress_tracker,
        thread_worker_count,
    )

    # Iterate over the worker inputs, updating the progress tracker if enabled.
    def _iter_worker_inputs() -> WorkerInputGenerator[_T]:
        ret: List[BaseException] | None = None
        while True:
            try:
                worker_input = next(thread_worker_input_gen)
            except StopIteration as iter_error:
                ret = iter_error.value
                break
            progress_updater.update(total_size_change=worker_input.size)
            yield worker_input
        return ret

    with JobContext[_T, _R]() as job_context:
        try:
            with tracker_ctx, progress_updater:

                if thread_worker_count == 1:
                    # Single-threaded execution.
                    with client_factory.to_provider() as cacheable_client_provider:

                        ctx = _execute_single_thread(
                            thread_worker,
                            _iter_worker_inputs(),
                            cacheable_client_provider,
                            progress_updater,
                        )

                else:
                    # Multi-threaded execution.
                    with client_factory.to_provider(pool=True) as storage_client_pool:

                        with futures.ThreadPoolExecutor(
                            max_workers=thread_worker_count,
                            thread_name_prefix='osmo-data-thread',
                        ) as thread_executor:

                            ctx = _execute_multi_thread(
                                thread_worker,
                                thread_worker_max_inflight,
                                _iter_worker_inputs(),
                                thread_executor,
                                storage_client_pool,
                                progress_updater,
                            )

                job_context.output = ctx.output
                job_context.errors.extend(ctx.errors)

        except Exception as error:  # pylint: disable=broad-except
            raise ExecutorError(
                f'Error running in-process job: {error}',
                job_context=job_context,
            ) from error

        return job_context


############################
#   Executor Public APIs   #
############################


def run_job(
    thread_worker: ThreadWorker[_T, _R],
    thread_worker_input_gen: WorkerInputGenerator[_T],
    client_factory: provider.StorageClientFactory,
    enable_progress_tracker: bool,
    executor_params: ExecutorParameters,
) -> JobContext[_T, _R]:
    """
    Unified entry point for executing a job.
    """
    # Resolve executor parameters to determine execution strategy.
    num_processes: int = executor_params.resolved_num_processes
    num_threads: int = executor_params.resolved_num_threads
    num_threads_inflight: int = executor_params.resolved_num_threads_inflight

    # If the number of processes is 1, we run the job in the main process.
    if num_processes == 1:
        logger.debug(
            'Running job in single-process mode with parameters: %s',
            {
                'num_threads': num_threads,
                'num_threads_inflight': num_threads_inflight,
                'enable_progress_tracker': enable_progress_tracker,
            },
        )

        return _run_in_process_job(
            thread_worker=thread_worker,
            thread_worker_count=num_threads,
            thread_worker_max_inflight=num_threads_inflight,
            thread_worker_input_gen=thread_worker_input_gen,
            client_factory=client_factory,
            enable_progress_tracker=enable_progress_tracker,
        )

    # Chunking parameters used only by multi-process jobs.
    chunk_size: int = executor_params.resolved_chunk_size
    chunk_queue_size: int = executor_params.resolved_chunk_queue_size

    logger.debug(
        'Running job in multi-process mode with parameters: %s',
        {
            'num_processes': num_processes,
            'num_threads': num_threads,
            'num_threads_inflight': num_threads_inflight,
            'chunk_size': chunk_size,
            'chunk_queue_size': chunk_queue_size,
            'enable_progress_tracker': enable_progress_tracker,
        },
    )

    return _run_multi_process_job(
        thread_worker=thread_worker,
        thread_worker_input_gen=thread_worker_input_gen,
        client_factory=client_factory,
        enable_progress_tracker=enable_progress_tracker,
        process_worker_count=num_processes,
        thread_worker_count=num_threads,
        thread_worker_max_inflight=num_threads_inflight,
        chunk_size=chunk_size,
        chunk_queue_size=chunk_queue_size,
        log_queue_size=executor_params.log_queue_size,
    )


def validate_picklable(obj: Any) -> bool:
    """
    Validate that the object is picklable.
    """
    try:
        pickled = pickle.dumps(obj)
        pickle.loads(pickled)
        return True
    except (pickle.PickleError, AttributeError, TypeError):
        return False
