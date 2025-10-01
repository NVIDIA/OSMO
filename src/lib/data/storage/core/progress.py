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
Module for managing progress tracking.
"""

import dataclasses
import os
import queue
import threading
import math
import datetime
from typing import NamedTuple, Protocol, Tuple
from typing_extensions import override

import tqdm

from ....utils import common


###############################################
# Progress Tracker Environment Variable Names #
###############################################


# The interval at which the progress tracker will flush its updates to the queue.
# Only applies to multi-process progress trackers.
OSMO_PROGRESS_FLUSH_INTERVAL = 'OSMO_PROGRESS_FLUSH_INTERVAL'


# The minimum interval at which the progress tracker will update the progress bar.
OSMO_PROGRESS_MIN_UPDATE_INTERVAL = 'OSMO_PROGRESS_MIN_UPDATE_INTERVAL'


###############################################

def _get_progress_flush_interval() -> datetime.timedelta:
    """
    Get the progress flush interval from the environment variable.
    """
    return common.to_timedelta(os.getenv(OSMO_PROGRESS_FLUSH_INTERVAL, '1s'))


def _get_progress_min_update_interval() -> datetime.timedelta:
    """
    Get the progress min update interval from the environment variable.
    """
    return common.to_timedelta(os.getenv(OSMO_PROGRESS_MIN_UPDATE_INTERVAL, '250ms'))


class ProgressUpdateSnapshot(NamedTuple):
    """
    A snapshot of the progress update.

    Used to pass progress updates between processes.
    """
    total_size_change: int = 0
    amount_change: int = 0
    name: str = ''


@dataclasses.dataclass(slots=True)
class ProgressUpdate:
    """
    Message options for updating the progress tracker.
    """

    total_size_change: int = 0
    amount_change: int = 0
    name: str = ''

    def reset(self):
        self.total_size_change = 0
        self.amount_change = 0
        self.name = ''

    def snapshot(self) -> ProgressUpdateSnapshot:
        return ProgressUpdateSnapshot(
            self.total_size_change,
            self.amount_change,
            self.name,
        )


class ProgressTracker(tqdm.tqdm):
    """
    Inherits TQDM for custom progress bar if it is a non interactive terminal.
    """

    def __init__(
        self,
        *args,
        increment_counter: int,
        **kwargs,
    ):
        self.increment_counter = increment_counter
        self.increment_size = 1
        self.threshold = 1
        self.last_update_time = common.current_time()
        self.min_update_interval = _get_progress_min_update_interval()
        self.interactive = ProgressTracker._is_interactive_session()

        super().__init__(*args, **kwargs)

        if not self.interactive:
            self.ascii = True  # Don't show non ascii characters
            self.bar_format = (
                '{desc}: {percentage:3.0f}%| {n_fmt}/{total_fmt} '
                '[{elapsed}<{remaining}, {rate_fmt}{postfix}]'
            )

        self.increment_size = self._calculate_increment_size(self.increment_counter, self.total)

        self.n: int  # Informs pylint this exists

    @staticmethod
    def status_printer(file):
        """
        For interactive terminals, this function returns the default function which prints
        using the TextIO file provided.

        For non interactive terminals (e.g. Docker containers), it utilizes Python print
        """
        return (
            tqdm.tqdm.status_printer(file)
            if ProgressTracker._is_interactive_session()
            else print
        )

    @staticmethod
    def _calculate_increment_size(increment_counter: int, total: int) -> int:
        """
        Update the progress bar every increment_counter or 1/10th of the total size
        """
        return max(min(increment_counter, math.ceil(total / 10)), 1)

    @staticmethod
    def _is_interactive_session() -> bool:
        """
        Check if we are an interactive session and can render real progress bars.
        """
        term = os.environ.get('TERM')
        return bool(term and term.lower() not in ['dumb', ''])

    def progress_update(self, progress_update: ProgressUpdateSnapshot):
        """
        Update the progress tracker with the progress update.
        """
        if progress_update.total_size_change > 0:
            self.total += progress_update.total_size_change
            self.increment_size = self._calculate_increment_size(self.increment_counter, self.total)
            self.threshold = self.n // self.increment_size + 1

        elif progress_update.total_size_change < 0:
            self.n = self.n + progress_update.total_size_change
            self.last_print_n = self.last_print_n + progress_update.total_size_change

        if progress_update.name:
            self.set_postfix(file_name=progress_update.name, refresh=True)

        if progress_update.amount_change != 0:
            self.update(progress_update.amount_change)

    @override
    def refresh(self, *args, **kwargs):
        now = common.current_time()

        # Always respect the minimum update interval
        if now - self.last_update_time < self.min_update_interval:
            return

        # If not interactive, update on specific intervals
        count_trigger = False
        if self.n // self.increment_size >= self.threshold:
            count_trigger = True
            self.threshold = self.n // self.increment_size + 1

        # Refresh if interactive, if the count trigger is hit, or if 5 mins has passed
        if (
            self.interactive or
            count_trigger or
            (now - self.last_update_time > datetime.timedelta(minutes=5))
        ):
            self.last_update_time = now
            super().refresh(*args, **kwargs)


class ProgressUpdater(Protocol):
    """
    Interface for making progress updates.
    """

    def __enter__(self) -> 'ProgressUpdater':
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        pass

    def update(
        self,
        *,
        total_size_change: int | None = None,
        amount_change: int | None = None,
        name: str | None = None,
    ) -> None:
        """
        Update the progress tracker with the progress update.
        """
        pass


class NoOpProgressUpdater(ProgressUpdater):
    """
    A progress updater that does nothing.
    """

    def __enter__(self) -> 'NoOpProgressUpdater':
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        pass

    def update(
        self,
        *,
        total_size_change: int | None = None,
        amount_change: int | None = None,
        name: str | None = None,
    ) -> None:
        pass


class SingleThreadProgressUpdater(ProgressUpdater):
    """
    A progress updater that can be used to update the progress tracker in a single thread.
    """

    def __init__(self, progress_tracker: ProgressTracker):
        self.progress_tracker = progress_tracker

    def __enter__(self) -> 'SingleThreadProgressUpdater':
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        pass

    def update(
        self,
        *,
        total_size_change: int | None = None,
        amount_change: int | None = None,
        name: str | None = None,
    ):
        self.progress_tracker.progress_update(
            ProgressUpdateSnapshot(
                total_size_change=total_size_change or 0,
                amount_change=amount_change or 0,
                name=name or '',
            )
        )


class MultiThreadProgressUpdater(SingleThreadProgressUpdater):
    """
    A progress updater that can be used to update the progress tracker in a multi-threaded manner.
    """

    def __init__(self, progress_tracker: ProgressTracker):
        super().__init__(progress_tracker)
        self.lock = threading.Lock()

    def __enter__(self) -> 'MultiThreadProgressUpdater':
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        pass

    def update(
        self,
        *,
        total_size_change: int | None = None,
        amount_change: int | None = None,
        name: str | None = None,
    ):
        if (
            total_size_change is not None
            or amount_change is not None
            or name is not None
        ):
            with self.lock:
                super().update(
                    total_size_change=total_size_change,
                    amount_change=amount_change,
                    name=name,
                )


class MultiProcessProgressUpdater(ProgressUpdater):
    """
    Thread-safe message options for accumulating progress updates from multiple threads and
    periodically flushing them to a queue.
    """

    _progress_update_queue: queue.Queue[ProgressUpdateSnapshot | None]
    _progress_update: ProgressUpdate
    _lock: threading.Lock
    _has_updates: bool

    _flush_thread: threading.Thread
    _flush_stop_event: threading.Event
    _flush_interval: datetime.timedelta
    _last_flush_time: datetime.datetime

    def __init__(
        self,
        progress_update_queue: queue.Queue[ProgressUpdateSnapshot | None],
        *,
        flush_interval: datetime.timedelta | None = None,
    ):
        self._progress_update_queue = progress_update_queue

        self._progress_update = ProgressUpdate()
        self._lock = threading.Lock()
        self._has_updates = False

        self._flush_thread = threading.Thread(target=self._flush_worker, daemon=True)
        self._flush_stop_event = threading.Event()
        self._flush_interval = flush_interval or _get_progress_flush_interval()
        self._last_flush_time = common.current_time()

    def __enter__(self) -> 'MultiProcessProgressUpdater':
        self._flush_thread.start()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self._flush_stop_event.set()
        self._flush_thread.join()

    def _flush_worker(self):
        while not self._flush_stop_event.wait(timeout=self._flush_interval.total_seconds()):
            # Check if it is time to flush
            if common.current_time() - self._last_flush_time >= self._flush_interval:
                self._flush()

        # Flush any remaining updates
        self._flush()

    def _flush(self) -> None:
        """
        Flush the progress update.
        """
        snapshot: ProgressUpdateSnapshot | None = None

        with self._lock:
            if self._has_updates:
                snapshot = self._progress_update.snapshot()
                self._progress_update.reset()
                self._has_updates = False
                self._last_flush_time = common.current_time()

        if snapshot is not None:
            self._progress_update_queue.put(snapshot)

    def update(
        self,
        *,
        total_size_change: int | None = None,
        amount_change: int | None = None,
        name: str | None = None,
    ):
        """
        Update the progress update with the given values.
        """
        if (
            total_size_change is not None
            or amount_change is not None
            or name is not None
        ):
            with self._lock:
                if total_size_change is not None:
                    self._progress_update.total_size_change += total_size_change
                if amount_change is not None:
                    self._progress_update.amount_change += amount_change
                if name is not None:
                    self._progress_update.name = name

                self._has_updates = True


class MultiProcessProgressTracker:
    """
    A progress tracker that can be updated from multiple processes/threads.
    """

    _progress_update_queue: queue.Queue[ProgressUpdateSnapshot | None]
    _progress_thread: threading.Thread
    _progress_tracker: ProgressTracker

    def __init__(
        self,
        *args,
        progress_update_queue: queue.Queue[ProgressUpdateSnapshot | None],
        **kwargs,
    ):
        self._progress_tracker = ProgressTracker(*args, **kwargs)
        self._progress_update_queue = progress_update_queue
        self._progress_thread = threading.Thread(target=self._progress_thread_worker, daemon=True)

    def _progress_thread_worker(self):
        # Keep draining the queue until we get a sentinel value (None)
        for update in iter(self._progress_update_queue.get, None):
            self._progress_tracker.progress_update(update)

    def __enter__(self) -> 'MultiProcessProgressTracker':
        self._progress_tracker.__enter__()
        self._progress_thread.start()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        # Signal the progress thread to stop
        self._progress_update_queue.put(None)
        self._progress_thread.join()
        self._progress_tracker.__exit__(exc_type, exc_value, traceback)


def create_single_thread_progress(
    *,
    increment_counter=10*(1024**3),
    total=0,
    unit='B',
    unit_scale=True,
    unit_divisor=1024,
    colour='#76b900',
    **kwargs,
) -> Tuple[ProgressTracker, SingleThreadProgressUpdater]:
    """
    Create a progress tracker and progress updater for a single process/thread.
    """
    progress_tracker = ProgressTracker(
        increment_counter=increment_counter,
        total=total,
        unit=unit,
        unit_scale=unit_scale,
        unit_divisor=unit_divisor,
        colour=colour,
        **kwargs,
    )
    return progress_tracker, SingleThreadProgressUpdater(progress_tracker)


def create_multi_thread_progress(
    *,
    increment_counter=10*(1024**3),
    total=0,
    unit='B',
    unit_scale=True,
    unit_divisor=1024,
    colour='#76b900',
    **kwargs,
) -> Tuple[ProgressTracker, MultiThreadProgressUpdater]:
    """
    Create a progress tracker and progress updater for a multi-threaded process.
    """
    progress_tracker = ProgressTracker(
        increment_counter=increment_counter,
        total=total,
        unit=unit,
        unit_scale=unit_scale,
        unit_divisor=unit_divisor,
        colour=colour,
        **kwargs,
    )
    return progress_tracker, MultiThreadProgressUpdater(progress_tracker)


def create_multi_process_progress(
    progress_update_queue: queue.Queue[ProgressUpdateSnapshot | None],
    *,
    increment_counter=10*(1024**3),
    total=0,
    unit='B',
    unit_scale=True,
    unit_divisor=1024,
    colour='#76b900',
    **kwargs,
) -> MultiProcessProgressTracker:
    """
    Create a multi-process progress tracker.
    """
    return MultiProcessProgressTracker(
        progress_update_queue=progress_update_queue,
        increment_counter=increment_counter,
        total=total,
        unit=unit,
        unit_scale=unit_scale,
        unit_divisor=unit_divisor,
        colour=colour,
        **kwargs,
    )
