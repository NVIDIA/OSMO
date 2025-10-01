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
The rsync module implements client-side functionalities for rsync with remote workflows.
"""

import asyncio
import dataclasses
import datetime
import enum
import http
import json
import logging
from logging import handlers
import multiprocessing
import os
import signal
import socket
import sys
from typing import Callable, Dict, List, Set, Tuple

from python import runfiles  # type: ignore
import requests
from watchdog import events, observers  # type: ignore
from watchdog.observers import api  # type: ignore
import urllib3

from ..utils import (
    client,
    client_configs,
    common,
    login,
    osmo_errors,
    paths,
    port_forward,
    validation
)

BAZEL_RSYNC_BIN = 'osmo_workspace/src/lib/rsync/rsync_bin'
RSYNC_BUFFER_SIZE = 8 * 1024  # 8KB
RSYNC_FLAGS = '-av'
LOCAL_HOST_IP = '127.0.0.1'

DEFAULT_DAEMON_DEBOUNCE_DELAY = 30.0
DEFAULT_DAEMON_POLL_INTERVAL = 120.0
DEFAULT_DAEMON_RECONCILE_INTERVAL = 60.0
DEFAULT_DAEMON_MAX_LOG_SIZE = 2 * 1024 * 1024  # 2MB

logger = logging.getLogger(__name__)


@dataclasses.dataclass(frozen=True)
class RsyncPortForwardParams:
    """
    Parameters for the rsync port-forward.
    """
    router_address: str
    key: str
    cookie: str


@dataclasses.dataclass(frozen=True)
class RsyncRequest:
    """
    Represents the parameters for remote rsync request.
    """
    workflow_id: str
    task_name: str
    src: str
    dst_module: str
    dst_path: str
    original_dst_path: str


@dataclasses.dataclass(frozen=True)
class RsyncModuleInfo:
    """
    Represents a module in a remote workflow task.
    """
    name: str
    path: str
    writable: bool


DEFAULT_MODULE_INFO: RsyncModuleInfo = RsyncModuleInfo(
    name='osmo',
    path='/osmo/run/workspace',
    writable=True,
)


@dataclasses.dataclass
class RsyncDaemonMetadata:
    """
    Represents the metadata for a running rsync daemon.
    """
    pid: int
    rsync_request: RsyncRequest
    start_time: str
    last_synced: str | None = None

    @classmethod
    def from_dict(cls, data: Dict) -> 'RsyncDaemonMetadata':
        """Create RsyncDaemonMetadata from dictionary with nested objects."""
        rsync_request_data = data['rsync_request']
        rsync_request = RsyncRequest(**rsync_request_data)

        return cls(
            pid=data['pid'],
            rsync_request=rsync_request,
            start_time=data['start_time'],
            last_synced=data.get('last_synced'),
        )


class RsyncDaemonStatus(enum.Enum):
    """
    Represents the status of a running rsync daemon.
    """
    RUNNING = 'RUNNING'
    STOPPED = 'STOPPED'


@dataclasses.dataclass
class RsyncDaemonInfo:
    """
    Represents the info for a running rsync daemon.
    """
    metadata: RsyncDaemonMetadata
    status: RsyncDaemonStatus
    log_file: str | None


def _is_retryable_osmo_error(err: osmo_errors.OSMOError) -> bool:
    if not err.status_code:
        return False

    return err.status_code in (
        # 4xx
        http.HTTPStatus.REQUEST_TIMEOUT,
        http.HTTPStatus.TOO_EARLY,
        http.HTTPStatus.TOO_MANY_REQUESTS,
        # 5xx
        http.HTTPStatus.INTERNAL_SERVER_ERROR,
        http.HTTPStatus.BAD_GATEWAY,
        http.HTTPStatus.SERVICE_UNAVAILABLE,
        http.HTTPStatus.GATEWAY_TIMEOUT,
    )


async def _get_task_rsync_port_forward_params(
    service_client: client.ServiceClient,
    workflow_id: str,
    task_name: str,
) -> RsyncPortForwardParams:
    retry = 0
    while True:
        try:
            rsync_request_result = service_client.request(
                client.RequestMethod.POST,
                f'api/workflow/{workflow_id}/rsync/task/{task_name}',
            )
            return RsyncPortForwardParams(
                router_address=rsync_request_result['router_address'],
                key=rsync_request_result['key'],
                cookie=rsync_request_result['cookie'],
            )
        except osmo_errors.OSMOError as err:
            if _is_retryable_osmo_error(err):
                retry += 1
                delay = port_forward.get_exponential_backoff_delay(retry)
                logger.info('Retrying rsync task request in %d seconds...', int(delay))
                await asyncio.sleep(delay)
                continue
            else:
                raise


async def get_task_rsync_port_forward_params(
    service_client: client.ServiceClient,
    workflow_id: str,
    task_name: str,
    timeout: int = 10,
) -> RsyncPortForwardParams:
    """
    Get the rsync port-forward parameters for a given task in a workflow.
    """
    try:
        return await asyncio.wait_for(
            _get_task_rsync_port_forward_params(service_client, workflow_id, task_name),
            timeout=timeout,
        )
    except asyncio.TimeoutError as err:
        logger.error('Timeout waiting for rsync client parameters: %s', err)
        raise
    except Exception as err:  # pylint: disable=broad-except
        logger.error('Error getting task rsync client parameters: %s', err)
        raise


async def _get_workflow_task(
    service_client: client.ServiceClient,
    workflow_id: str,
    task_name: str,
) -> Dict:
    retry = 0
    while True:
        try:
            return service_client.request(
                client.RequestMethod.GET,
                f'api/workflow/{workflow_id}/task/{task_name}',
            )
        except osmo_errors.OSMOError as err:
            if _is_retryable_osmo_error(err):
                retry += 1
                delay = port_forward.get_exponential_backoff_delay(retry)
                logger.info('Retrying workflow task request in %d seconds...', int(delay))
                await asyncio.sleep(delay)
                continue
            else:
                raise


async def get_workflow_task(
    service_client: client.ServiceClient,
    workflow_id: str,
    task_name: str,
    timeout: int = 10,
) -> Dict:
    try:
        return await asyncio.wait_for(
            _get_workflow_task(service_client, workflow_id, task_name),
            timeout=timeout,
        )
    except asyncio.TimeoutError as err:
        logger.error('Timeout waiting for workflow task: %s', err)
        raise
    except Exception as err:  # pylint: disable=broad-except
        logger.error('Error getting workflow task: %s', err)
        raise


class RsyncUploadCounter:
    """
    A counter to synchronize concurrent async uploads.

    This is used to keep track of pending upload requests during an ongoing upload.
    And to ensure that the reconciliation loop will eventually reconcile any pending
    uploads not fulfilled.
    """

    _pending_counter: int
    _complete_counter: int
    _counter_lock: asyncio.Lock

    def __init__(self):
        self._pending_counter = 0
        self._complete_counter = 0
        self._counter_lock = asyncio.Lock()

    async def increment_pending(self):
        """
        Increment the pending counter.
        """
        async with self._counter_lock:
            self._pending_counter += 1

    async def get_pending(self) -> int:
        """
        Get the current pending counter.
        """
        async with self._counter_lock:
            return self._pending_counter

    async def set_complete(self, count: int):
        """
        Set the complete counter to the maximum of the current complete counter and the
        provided count.
        """
        async with self._counter_lock:
            self._complete_counter = max(count, self._complete_counter)

    async def needs_upload(self) -> bool:
        """
        Check if there are any pending uploads needed to be reconciled.
        """
        async with self._counter_lock:
            return self._complete_counter < self._pending_counter


class RsyncClient:
    """
    A client wrapper for rsync with a remote workflow task.
    """

    _service_client: client.ServiceClient
    _rsync_bin_path: str

    _rsync_request: RsyncRequest
    _timeout: int

    # Client stop event
    _stop_event: asyncio.Event

    # TCP Port-forwarding loop
    _tcp_ready: asyncio.Event
    _tcp_close: asyncio.Event
    _sock: socket.socket | None
    _port_forward_task: asyncio.Task | None

    # Upload reconciliation loop
    _reconcile_interval: float
    _reconcile_upload_task: asyncio.Task | None

    # Upload
    _upload_lock: asyncio.Lock
    _upload_counter: RsyncUploadCounter
    _upload_rate_limiter: common.TokenBucket | None
    _upload_callback: Callable | None

    @staticmethod
    def _resolve_rsync_bin_path() -> str:
        """Resolve the path to the rsync binary."""
        # If we are running in a Bazel environment
        bazel_runfiles = runfiles.Runfiles.Create()
        if bazel_runfiles is not None:
            bin_path = bazel_runfiles.Rlocation(BAZEL_RSYNC_BIN)
            if bin_path is not None:
                return bin_path

        # Fallback to local path
        current_dir = os.path.dirname(os.path.realpath(__file__))
        rsync_bin_path = os.path.join(current_dir, 'rsync_bin')

        if not os.path.exists(rsync_bin_path):
            raise FileNotFoundError(f'Rsync binary not found at {rsync_bin_path}')

        return rsync_bin_path

    def __init__(
        self,
        service_client: client.ServiceClient,
        rsync_request: RsyncRequest,
        stop_event: asyncio.Event | None = None,
        *,
        timeout: int = 30,
        upload_rate_limit: int | None = None,
        reconcile_interval: float = 60.0,
        upload_callback: Callable | None = None,
    ):
        self._service_client: client.ServiceClient = service_client
        self._rsync_bin_path: str = self._resolve_rsync_bin_path()

        self._rsync_request: RsyncRequest = rsync_request
        self._timeout: int = timeout

        self._stop_event = stop_event or asyncio.Event()

        self._tcp_ready: asyncio.Event = asyncio.Event()
        self._tcp_close: asyncio.Event = asyncio.Event()
        self._sock: socket.socket | None = None
        self._port_forward_task: asyncio.Task | None = None

        self._reconcile_upload_task: asyncio.Task | None = None
        self._reconcile_interval: float = reconcile_interval

        self._upload_lock: asyncio.Lock = asyncio.Lock()
        self._upload_counter: RsyncUploadCounter = RsyncUploadCounter()
        self._upload_rate_limiter: common.TokenBucket | None = None
        if upload_rate_limit:
            self._upload_rate_limiter = common.TokenBucket(
                capacity=upload_rate_limit,
                refill_rate=upload_rate_limit,
            )
        self._upload_callback = upload_callback

    @property
    def src(self) -> str:
        return self._rsync_request.src

    @property
    def stopped(self) -> bool:
        return self._stop_event.is_set()

    async def start(self) -> None:
        """
        Starts a TCP port-forwarding server on a free ephemeral port.
        """
        logger.info('Starting rsync client...')

        self._port_forward_task = asyncio.create_task(self._port_forward())
        self._port_forward_task.add_done_callback(self._on_port_forward_done)
        self._reconcile_upload_task = asyncio.create_task(self._reconcile_upload())

        try:
            await common.first_completed([
                asyncio.wait_for(self._tcp_ready.wait(), timeout=self._timeout),
                self._stop_event.wait(),
            ])
        except asyncio.TimeoutError as err:
            self._port_forward_task.cancel()
            self._reconcile_upload_task.cancel()
            raise osmo_errors.OSMOError(
                'Timed out waiting for TCP port forwarding to be ready, '
                'is Rsync running on the remote task?',
                workflow_id=self._rsync_request.workflow_id,
            ) from err

        if self._stop_event.is_set():
            raise osmo_errors.OSMOError('Rsync client cannot be started')

        # Validate that the requested module is eligible for rsync
        modules = await self.list_modules()

        if not modules:
            raise osmo_errors.OSMOError(
                'No rsync modules found on the remote task, is Rsync running on the remote task?',
                workflow_id=self._rsync_request.workflow_id,
            )

        if self._rsync_request.dst_module not in modules:
            raise osmo_errors.OSMOError(
                f'Rsync module {self._rsync_request.dst_module} is not eligible for rsync',
                workflow_id=self._rsync_request.workflow_id,
            )

    async def stop(self) -> None:
        """
        Stops the TCP port-forwarding server.
        """
        logger.info('Stopping rsync client...')

        self._stop_event.set()
        self._tcp_close.set()

        if self._port_forward_task is not None:
            try:
                self._port_forward_task.cancel()
            except Exception:  # pylint: disable=broad-except
                pass

        if self._reconcile_upload_task is not None:
            try:
                self._reconcile_upload_task.cancel()
            except Exception:  # pylint: disable=broad-except
                pass

        if self._sock is not None:
            self._sock.close()
            self._sock = None

    async def upload(self) -> None:
        """
        Uploads from the local path to the remote workflow task.
        """
        logger.info('Uploading %s', self._rsync_request.src)

        await self._upload_counter.increment_pending()

        if self._stop_event.is_set() or self._sock is None:
            raise osmo_errors.OSMOError('Rsync client is not running')

        if self._upload_lock.locked():
            logger.info('Upload already in progress, queueing...')
            return

        # Asyncio cancellation is not immediate, so we use a lock to synchronize concurrent
        # upload attempts.
        async with self._upload_lock:
            try:
                await asyncio.wait_for(self._tcp_ready.wait(), timeout=self._timeout)
            except asyncio.TimeoutError as err:
                raise osmo_errors.OSMOError(
                    'Timeout waiting for TCP port forwarding to be ready',
                    workflow_id=self._rsync_request.workflow_id,
                ) from err

            local_port = self._sock.getsockname()[1]
            resolved_dst = os.path.join(
                f'rsync://{LOCAL_HOST_IP}:{local_port}',
                self._rsync_request.dst_module,
                self._rsync_request.dst_path,
            )

            logger.debug('Uploading from %s to %s, with flags %s',
                         self._rsync_request.src, resolved_dst, RSYNC_FLAGS)

            # Get the current pending counter
            cur_pending_counter = await self._upload_counter.get_pending()

            try:
                process = await asyncio.create_subprocess_exec(
                    self._rsync_bin_path,
                    RSYNC_FLAGS,
                    self._rsync_request.src,
                    resolved_dst,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )

                _, stderr = await process.communicate()
                if process.returncode != 0:
                    raise osmo_errors.OSMOError(f'Rsync failed: {stderr.decode()}')
                else:
                    logger.info(
                        'Rsync upload completed successfully for %s/%s',
                        self._rsync_request.workflow_id,
                        self._rsync_request.task_name,
                    )

                    # Reconcile the upload counter
                    await self._upload_counter.set_complete(cur_pending_counter)

                    # Call the upload callback if it is set
                    if self._upload_callback is not None:
                        try:
                            self._upload_callback()
                        except Exception as err:  # pylint: disable=broad-except
                            logger.error('Error calling upload callback: %s', err)
            except (asyncio.CancelledError, InterruptedError, KeyboardInterrupt):
                logger.info('Rsync upload cancelled for %s/%s',
                            self._rsync_request.workflow_id,
                            self._rsync_request.task_name)
            except Exception as err:  # pylint: disable=broad-except
                logger.error('Error running rsync upload: %s', err)
                raise

    async def list_modules(self) -> List[str]:
        """
        Lists all modules in the remote workflow task.
        """
        if self._stop_event.is_set() or self._sock is None:
            raise osmo_errors.OSMOError('Rsync client is not running')

        local_port = self._sock.getsockname()[1]
        remote_host = f'rsync://{LOCAL_HOST_IP}:{local_port}'

        logger.debug('Listing modules from %s', remote_host)

        try:
            process = await asyncio.create_subprocess_exec(
                self._rsync_bin_path,
                remote_host,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            stdout, stderr = await process.communicate()
            if process.returncode != 0:
                raise osmo_errors.OSMOError(f'Rsync failed: {stderr.decode()}')

            # Parse the output to get the module names
            output = []
            lines = stdout.decode().splitlines()
            for line in lines:
                module_name = line.split()[0]
                output.append(module_name)

            return output
        except (asyncio.CancelledError, InterruptedError, KeyboardInterrupt):
            pass
        except Exception as err:  # pylint: disable=broad-except
            logger.debug('Error running rsync module list: %s', err)
            return []

        return []

    async def _port_forward(self):
        async def _wait_for_reconnect(retry: int):
            delay = port_forward.get_exponential_backoff_delay(retry)
            logger.info('Reconnect to rsync port in %d seconds...', int(delay))
            await asyncio.sleep(delay)

        retry = 0
        while not self._stop_event.is_set():
            logger.info('Starting rsync port forwarding...%s',
                        f' (retry {retry})' if retry > 0 else '')
            try:
                # Initiate Rsync port-forward
                rsync_port_forward_params = await get_task_rsync_port_forward_params(
                    self._service_client,
                    self._rsync_request.workflow_id,
                    self._rsync_request.task_name,
                    self._timeout,
                )

                self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self._sock.bind((LOCAL_HOST_IP, 0))  # ephemeral port

                message = (
                    f'Starting rsync port forwarding from {self._rsync_request.workflow_id}/'
                    f'{self._rsync_request.task_name} to '
                    f'{self._sock.getsockname()[0]}:{self._sock.getsockname()[1]}.'
                )

                await common.first_completed([
                    port_forward.run_tcp_with_sock(
                        self._service_client,
                        self._sock,
                        message,
                        f'api/router/rsync/{self._rsync_request.workflow_id}/client',
                        self._timeout,
                        rsync_port_forward_params.router_address,
                        rsync_port_forward_params.key,
                        rsync_port_forward_params.cookie,
                        params={'timeout': str(self._timeout)},
                        ready_event=self._tcp_ready,
                        close_event=self._tcp_close,
                        buffer_size=RSYNC_BUFFER_SIZE,
                        ws_write_rate_limiter=self._upload_rate_limiter,
                    ),
                    self._stop_event.wait(),
                ])

                if self._stop_event.is_set():
                    break

                retry += 1
                await _wait_for_reconnect(retry)
            except osmo_errors.OSMOError as err:
                if not _is_retryable_osmo_error(err):
                    raise
                logger.error('Rsync port-forward connection failed, retrying...: %s', err)
                retry += 1
                if self._stop_event.is_set():
                    break
                await _wait_for_reconnect(retry)
            except (
                # Catch a broad range of network-related exceptions
                ConnectionError,
                asyncio.TimeoutError,
                socket.gaierror,
                socket.herror,
                socket.timeout,
                urllib3.exceptions.MaxRetryError,
                urllib3.exceptions.TimeoutError,
                requests.exceptions.ConnectionError,
                requests.exceptions.Timeout,
            ) as err:
                logger.error('Rsync port-forward connection failed, retrying...: %s', err)
                retry += 1
                if self._stop_event.is_set():
                    break
                await _wait_for_reconnect(retry)
            except (asyncio.CancelledError, InterruptedError, KeyboardInterrupt):
                break
            finally:
                self._tcp_ready.clear()
                self._tcp_close.clear()
                if self._sock is not None:
                    self._sock.close()
                    self._sock = None

    def _on_port_forward_done(self, task: asyncio.Task):
        """
        Callback for the port-forward task completion (success or failure).
        """
        if task.exception() and not self._stop_event.is_set():
            logger.error('Port forward task failed with fatal exception: %s', task.exception())
            asyncio.create_task(self.stop())

    async def _reconcile_upload(self):
        """
        Continuously monitors the upload state and performs uploads when needed.
        """
        while not self._stop_event.is_set():
            await common.first_completed([
                self._tcp_ready.wait(),
                self._stop_event.wait(),
            ])

            if self._stop_event.is_set():
                break

            if not self._upload_lock.locked() and await self._upload_counter.needs_upload():
                logger.info('Reconciling upload for %s', self._rsync_request.src)
                try:
                    await self.upload()
                except Exception as err:  # pylint: disable=broad-except
                    logger.error('Error reconciling upload: %s', err)

            await common.first_completed([
                self._stop_event.wait(),
                asyncio.sleep(self._reconcile_interval),
            ])


class DebounceTimer:
    """
    A timer that debounces function calls.
    """

    _loop: asyncio.AbstractEventLoop
    _delay: float
    _timer: asyncio.Task | None

    def __init__(
        self,
        loop: asyncio.AbstractEventLoop,
        delay: float = 5.0,
    ):
        self._delay = delay
        self._loop = loop
        self._timer: asyncio.Task | None = None

    def debounce(self, func: Callable):
        """
        Debounces the function call by delaying the execution of the function by the delay. If
        an existing timer is already running, it will be cancelled and a new timer will be created.
        """
        self.cancel()

        async def _execute_after_delay():
            try:
                await asyncio.sleep(self._delay)
                if asyncio.iscoroutinefunction(func):
                    await func()
                else:
                    func()
            except asyncio.CancelledError:
                pass

        logger.debug('Debouncing function call... will execute in %s seconds', self._delay)
        self._timer = self._loop.create_task(_execute_after_delay())

    def cancel(self):
        """
        Cancels the debounce timer.
        """
        if self._timer is not None and not self._timer.done():
            logger.debug('Cancelling existing debounce timer...')
            self._timer.cancel()


class PathEventHandler(events.FileSystemEventHandler):
    """
    A file system event handler for a given path and destination. This handler will debounce
    file system events to prevent excessive uploads.
    """

    _loop: asyncio.AbstractEventLoop
    _rsync_client: RsyncClient
    _debounce_timer: DebounceTimer

    def __init__(
        self,
        rsync_client: RsyncClient,
        debounce_delay: float = 30.0,
    ):
        self._loop = asyncio.get_event_loop()
        self._rsync_client = rsync_client
        self._debounce_timer = DebounceTimer(loop=self._loop, delay=debounce_delay)

    def on_any_event(self, event: events.FileSystemEvent):
        """
        Called when any file system event occurs. Dispatches the debounce timer to upload to a
        registered rsync client.
        """
        logger.info('Path event handler (%s) detected changes...', self._rsync_client.src)
        logger.debug('Event: %s', event)
        self._debounce_timer.debounce(self._rsync_client.upload)

    async def stop(self):
        """
        Stops the debounce timer.
        """
        self._debounce_timer.cancel()


class WorkspaceObserver:
    """
    Keeps track of a single path and destination. Coordinates between file system event changes
    and a rsync client subscribed to the path.
    """

    _observer: api.BaseObserver
    _path_observer: PathEventHandler

    @staticmethod
    def _get_eligible_file_system_events() -> List[type[events.FileSystemEvent]]:
        return [
            events.FileModifiedEvent,
            events.FileCreatedEvent,
            events.DirModifiedEvent,
            events.DirCreatedEvent,
        ]

    def __init__(
        self,
        rsync_request: RsyncRequest,
        rsync_client: RsyncClient,
        debounce_delay: float = 30.0,
    ):
        # Initialize path event handler
        self._path_event_handler = PathEventHandler(
            debounce_delay=debounce_delay,
            rsync_client=rsync_client,
        )

        # Initialize observer
        self._observer = observers.Observer()
        self._observer.schedule(
            self._path_event_handler,
            rsync_request.src,
            recursive=True,
            event_filter=WorkspaceObserver._get_eligible_file_system_events(),
        )

    def start(self):
        """
        Starts the workspace observer thread.
        """
        self._observer.start()

    async def stop(self):
        """
        Stops the underlying path event handler and observer.
        """
        await self._path_event_handler.stop()
        self._observer.unschedule_all()
        self._observer.stop()
        self._observer.join()


class RsyncUploadDaemon:
    """
    A daemon that uploads a file/directory to a remote workflow task continuously.
    """

    _service_client: client.ServiceClient
    _rsync_request: RsyncRequest
    _pid_file: str

    _poll_interval: float
    _debounce_delay: float
    _reconcile_interval: float
    _timeout: int
    _rate_limit: int | None

    _poll_task: asyncio.Task | None
    _stop_event: asyncio.Event

    _workspace_observer: WorkspaceObserver | None
    _rsync_client: RsyncClient | None

    def __init__(
        self,
        service_client: client.ServiceClient,
        rsync_request: RsyncRequest,
        pid_file: str,
        poll_interval: float = 120.0,
        debounce_delay: float = 30.0,
        reconcile_interval: float = 60.0,
        timeout: int = 30,
        rate_limit: int | None = None,
    ):
        self._service_client = service_client
        self._rsync_request = rsync_request
        self._pid_file = pid_file

        self._poll_interval = poll_interval
        self._debounce_delay = debounce_delay
        self._reconcile_interval = reconcile_interval
        self._timeout = timeout
        self._rate_limit = rate_limit

        self._poll_task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

        self._workspace_observer = None
        self._rsync_client = None

    async def start(self):
        """
        Starts the rsync daemon.
        """
        logger.info('Starting rsync daemon...')

        # Start the poll PID file task
        self._poll_pid_file_task = asyncio.create_task(self.poll_pid_file())

        while not self._stop_event.is_set():
            try:
                await common.first_completed([
                    self.poll_task(),
                    self._stop_event.wait(),
                ])

                if self._stop_event.is_set():
                    break
            except (asyncio.CancelledError, InterruptedError, KeyboardInterrupt):
                break
            except Exception as err:  # pylint: disable=broad-except
                logger.error('Error polling task: %s', err)

            await common.first_completed([
                self._stop_event.wait(),
                asyncio.sleep(self._poll_interval),
            ])

        logger.info('Rsync daemon stopped')

    async def stop(self):
        """
        Stops the rsync daemon.
        """
        logger.info('Stopping rsync daemon...')

        self._stop_event.set()
        if self._poll_task is not None and not self._poll_task.done():
            try:
                self._poll_task.cancel()
            except Exception as err:  # pylint: disable=broad-except
                logger.error('Error shutting down poll task: %s', err)

        if self._workspace_observer is not None:
            try:
                await self._workspace_observer.stop()
            except Exception as err:  # pylint: disable=broad-except
                logger.error('Error stopping workspace observer: %s', err)

        if self._rsync_client is not None:
            try:
                await self._rsync_client.stop()
            except Exception as err:  # pylint: disable=broad-except
                logger.error('Error stopping rsync client: %s', err)

        if self._poll_pid_file_task is not None and not self._poll_pid_file_task.done():
            try:
                self._poll_pid_file_task.cancel()
            except Exception as err:  # pylint: disable=broad-except
                logger.error('Error shutting down poll PID file task: %s', err)

    async def poll_pid_file(self) -> None:
        """
        Polls the PID file to ensure consistency.
        """
        while not self._stop_event.is_set():
            # Check if the PID file is valid
            try:
                with open(self._pid_file, 'r', encoding='utf-8') as f:
                    data = json.loads(f.read())
                    pid = data.get('pid')
                    assert isinstance(pid, int)

                if os.getpid() != pid:
                    logger.info(
                        'Rsync daemon PID %s does not match current process PID %s, stopping...',
                        pid, os.getpid(),
                    )
                    await self.stop()
                    break

                await common.first_completed([
                    self._stop_event.wait(),
                    asyncio.sleep(self._poll_interval),
                ])
            except (asyncio.CancelledError, InterruptedError, KeyboardInterrupt):
                break
            except (FileNotFoundError, json.JSONDecodeError) as err:
                logger.error('Error reading PID file: %s', err)
                await self.stop()
                break
            except Exception as err:  # pylint: disable=broad-except
                logger.error('Error polling PID file: %s', err)
                await self.stop()
                raise

    async def poll_task(self) -> None:
        logger.info('Polling task...')

        task = await get_workflow_task(
            self._service_client,
            self._rsync_request.workflow_id,
            self._rsync_request.task_name,
            self._timeout,
        )

        if 'status' not in task:
            logger.error('Task status not found')
            return

        task_status = task['status']

        if task_status in (
            'SUBMITTING',
            'WAITING',
            'PROCESSING',
            'SCHEDULING',
            'INITIALIZING',
            'RESCHEDULED',
        ):
            # Pending state
            logger.info('Task is in pending state: %s', task_status)
            return

        if task_status != 'RUNNING':
            # Terminal state
            logger.info('Task is in terminal state: %s', task_status)
            return await self.stop()

        # Running state
        logger.info('Task is in running state...')
        return await self.handle_running_task()

    def _upload_callback(self):
        """
        Updates the last synced time in the PID file.
        """
        with open(self._pid_file, 'r+', encoding='utf-8') as f:
            metadata_dict = json.loads(f.read())
            metadata_dict['last_synced'] = datetime.datetime.now().isoformat()
            f.seek(0)
            f.write(json.dumps(metadata_dict))
            f.truncate()

    async def handle_running_task(self) -> None:
        """
        Handles rsync with a single task.
        """
        if self._rsync_client is None:
            self._rsync_client = RsyncClient(
                self._service_client,
                self._rsync_request,
                self._stop_event,
                timeout=self._timeout,
                upload_rate_limit=self._rate_limit,
                reconcile_interval=self._reconcile_interval,
                upload_callback=self._upload_callback,
            )
            await self._rsync_client.start()
            await self._rsync_client.upload()  # Initial sync

        if self._workspace_observer is None:
            self._workspace_observer = WorkspaceObserver(
                rsync_request=self._rsync_request,
                rsync_client=self._rsync_client,
                debounce_delay=self._debounce_delay,
            )
            self._workspace_observer.start()


def _exit_process():
    """
    Gracefully exits the current process.
    """
    sys.stdout.flush()
    sys.stderr.flush()
    logging.shutdown()

    # Bypasses anything that catches SystemExit (i.e. MacOS)
    os._exit(0)  # pylint: disable=protected-access


def _get_daemon_dir() -> str:
    """
    Returns the directory for the rsync daemon.
    """
    return os.path.join(client_configs.get_client_state_dir(), 'rsync')


def _get_log_file(workflow_id: str, task_name: str) -> str:
    """
    Returns the log file for the rsync daemon.
    """
    return os.path.join(
        _get_daemon_dir(),
        f'rsync_daemon_{workflow_id}_{task_name}.log',
    )


def _get_pid_file(workflow_id: str, task_name: str) -> str:
    """
    Returns the PID file for the rsync daemon.
    """
    return os.path.join(
        _get_daemon_dir(),
        f'rsync_daemon_{workflow_id}_{task_name}.pid',
    )


def _run_daemon(
    login_config: login.LoginConfig,
    rsync_request: RsyncRequest,
    poll_interval: float,
    debounce_delay: float,
    reconcile_interval: float,
    timeout: int,
    rate_limit: int | None,
    max_log_size: int,
    verbose_logging: bool,
):
    """
    Runs the rsync daemon in a separate process.

    :param login_config: The login config to use.
    :param rsync_request: The rsync request to use.
    :param poll_interval: The poll interval.
    :param debounce_delay: The debounce delay.
    :param reconcile_interval: The reconcile interval.
    :param timeout: The connection timeout.
    :param rate_limit: The rate limit.
    :param max_log_size: The maximum log size in bytes.
    :param verbose_logging: Whether to enable verbose logging.
    """
    os.makedirs(_get_daemon_dir(), exist_ok=True)

    # Write daemon metadata to a file
    pid_file = _get_pid_file(rsync_request.workflow_id, rsync_request.task_name)
    with open(pid_file, 'w', encoding='utf-8') as f:
        f.write(json.dumps(
            dataclasses.asdict(
                RsyncDaemonMetadata(
                    pid=os.getpid(),
                    rsync_request=rsync_request,
                    start_time=datetime.datetime.now().isoformat(),
                ),
            ),
        ))

    # Setup logging to file for daemon process
    log_file = _get_log_file(rsync_request.workflow_id, rsync_request.task_name)

    # Configure log rotation handler
    file_handler = handlers.RotatingFileHandler(
        log_file,
        maxBytes=max_log_size,
        backupCount=1,
    )
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s - %(process)d - %(filename)s:%(lineno)d - '
        '%(name)s - %(levelname)s - %(message)s'
    ))

    # Configure the logging system to capture all loggers
    logging.basicConfig(
        level=logging.INFO if verbose_logging else logging.WARNING,
        handlers=[file_handler],
        force=True
    )

    # Explicitly set up the module logger
    module_logger = logging.getLogger(__name__)
    module_logger.setLevel(logging.DEBUG if verbose_logging else logging.INFO)
    module_logger.propagate = False
    if not module_logger.handlers:
        module_logger.addHandler(file_handler)

    # Run the daemon
    event_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(event_loop)

    login_manager = client.LoginManager(
        login_config,
        user_agent_prefix=client.LIB_USER_AGENT_PREFIX,
    )
    service_client = client.ServiceClient(login_manager)

    rsync_upload_daemon = RsyncUploadDaemon(
        service_client,
        rsync_request,
        pid_file,
        poll_interval,
        debounce_delay,
        reconcile_interval,
        timeout,
        rate_limit,
    )

    # Register signal handlers for graceful shutdown
    def handle_signal(signum, _):
        logger.info('Received signal %d, stopping daemon...', signum)
        event_loop.call_soon_threadsafe(lambda: asyncio.create_task(rsync_upload_daemon.stop()))

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    try:
        event_loop.run_until_complete(rsync_upload_daemon.start())
    except Exception as err:  # pylint: disable=broad-except
        logger.error('Error running rsync daemon: %s', err)
    finally:
        event_loop.close()

    # Remove the PID file
    pid_file = _get_pid_file(rsync_request.workflow_id, rsync_request.task_name)
    if os.path.exists(pid_file):
        os.remove(pid_file)

    # Exit the daemon process
    _exit_process()


def _is_process_running(pid: int) -> bool:
    """
    Returns whether a process is running.
    """
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _validate_daemon_exists(rsync_request: RsyncRequest) -> bool:
    """
    Validates that a daemon exists and is running.

    If a PID file exists but the PID is no longer running, it is removed.
    """
    pid_file = _get_pid_file(rsync_request.workflow_id, rsync_request.task_name)
    if not os.path.exists(pid_file):
        return False

    with open(pid_file, 'r', encoding='utf-8') as f:
        data = json.loads(f.read())
        pid = data.get('pid')
        assert isinstance(pid, int)

    if _is_process_running(pid):
        logger.info('Existing rsync daemon running for %s/%s with PID %s',
                    rsync_request.workflow_id, rsync_request.task_name, pid)
        return True

    logger.info('Existing rsync daemon PID file exists but PID %s does not exist, removing', pid)
    os.remove(pid_file)
    return False


def rsync_upload_task_daemon(
    login_config: login.LoginConfig,
    rsync_request: RsyncRequest,
    *,
    poll_interval: float = 120.0,
    debounce_delay: float = 30.0,
    reconcile_interval: float = 60.0,
    timeout: int = 30,
    rate_limit: int | None = None,
    max_log_size: int = 2 * 1024 * 1024,
    verbose_logging: bool = False,
    quiet: bool = False,
):
    """
    Creates a background daemon that uploads a file/directory to a remote workflow
    task continuously.

    :param login_config: The login config to use.
    :param rsync_request: The rsync request to use.
    :param poll_interval: The interval to poll the workflow for changes.
    :param debounce_delay: The debounce delay for the upload.
    :param reconcile_interval: The interval to reconcile the upload.
    :param timeout: The connection timeout for the upload.
    :param rate_limit: The rate limit for the upload.
    :param max_log_size: The maximum log size in bytes.
    :param verbose_logging: Whether to enable verbose logging.
    :param quiet: Whether to suppress the output.
    """
    if _validate_daemon_exists(rsync_request):
        logger.info(
            'Rsync daemon already running, please stop the existing daemon '
            'before starting a new one.'
        )
        return

    process = multiprocessing.Process(
        target=_run_daemon,
        args=(
            login_config,
            rsync_request,
            poll_interval,
            debounce_delay,
            reconcile_interval,
            timeout,
            rate_limit,
            max_log_size,
            verbose_logging,
        ),
        daemon=False,
    )
    process.start()

    if not quiet:
        log_file = _get_log_file(rsync_request.workflow_id, rsync_request.task_name)
        logger.info('Rsync daemon started in detached process: PID %s', process.pid)
        logger.info('To view daemon logs: tail -f %s', log_file)

    # Exit the parent process
    _exit_process()


def rsync_status(
    workflow_id: str | None = None,
    task_name: str | None = None,
    statuses: Set[RsyncDaemonStatus] | None = None,
) -> List[RsyncDaemonInfo]:
    """
    Fetches a list of specified rsync daemons.

    :param workflow_id: Optional. The workflow id.
    :param task_name: Optional. The task name.
    :param statuses: Optional. The statuses to filter by.

    :return: A list of rsync daemons.
    """
    daemons: List[RsyncDaemonInfo] = []

    daemon_dir = _get_daemon_dir()

    if not os.path.exists(daemon_dir):
        return daemons

    for file in os.listdir(daemon_dir):
        if not file.endswith('.pid'):
            continue

        with open(os.path.join(daemon_dir, file), 'r', encoding='utf-8') as f:
            data = json.loads(f.read())

            try:
                rsync_daemon_metadata = RsyncDaemonMetadata.from_dict(data)
            except Exception as err:  # pylint: disable=broad-except
                logger.error('Error parsing rsync daemon metadata: %s', err)
                continue

            if workflow_id is not None and\
                    workflow_id != rsync_daemon_metadata.rsync_request.workflow_id:
                continue

            if task_name is not None and\
                    task_name != rsync_daemon_metadata.rsync_request.task_name:
                continue

            daemon_status = RsyncDaemonStatus.STOPPED if not _is_process_running(
                rsync_daemon_metadata.pid) else RsyncDaemonStatus.RUNNING

            if statuses is not None and daemon_status not in statuses:
                continue

            log_file = _get_log_file(
                rsync_daemon_metadata.rsync_request.workflow_id,
                rsync_daemon_metadata.rsync_request.task_name,
            )
            daemon_log_file = log_file if os.path.exists(log_file) else None

            daemons.append(RsyncDaemonInfo(
                metadata=rsync_daemon_metadata,
                status=daemon_status,
                log_file=daemon_log_file,
            ))

    return daemons


async def rsync_upload_task(
    service_client: client.ServiceClient,
    rsync_request: RsyncRequest,
    *,
    timeout: int = 10,
    rate_limit: int | None = None,
):
    """
    Convenience method for uploading a file/directory to a single remote workflow task.

    :param service_client: The service client to use.
    :param rsync_request: The rsync request.
    :param timeout: Optional. The connection timeout.
    :param rate_limit: Optional. The rate limit for the upload.
    """
    rsync_client = RsyncClient(
        service_client,
        rsync_request,
        timeout=timeout,
        upload_rate_limit=rate_limit,
    )
    try:
        await rsync_client.start()
        await rsync_client.upload()
    finally:
        if not rsync_client.stopped:
            await rsync_client.stop()


def get_rsync_config(service_client: client.ServiceClient) -> Dict:
    """
    Fetches the rsync config.

    :param service_client: The service client to use.

    :return: The rsync config.
    """
    plugins_config = service_client.request(
        client.RequestMethod.GET,
        'api/plugins/configs',
    )
    return plugins_config.get('rsync', {})


def get_allowed_paths(rsync_config: Dict) -> List[RsyncModuleInfo]:
    """
    Fetches configured rsync modules.

    :param rsync_config: The rsync config.

    :return: The allowed paths.
    """
    output = [
        DEFAULT_MODULE_INFO,
    ]

    if 'allowed_paths' not in rsync_config:
        return output

    allowed_paths = rsync_config['allowed_paths']
    for module_name, path_config in allowed_paths.items():
        output.append(RsyncModuleInfo(
            module_name,
            os.path.normpath(path_config['path']),
            path_config['writable'],
        ))
    return output


def get_lead_task_name(service_client: client.ServiceClient, workflow_id: str) -> str:
    """
    Fetches the lead task name for a given workflow.
    """
    workflow = service_client.request(
        client.RequestMethod.GET,
        f'api/workflow/{workflow_id}',
    )

    groups = workflow.get('groups', [])
    if not groups:
        raise osmo_errors.OSMOUserError(f'Workflow {workflow_id} has no groups')

    lead_group = groups[0]
    lead_group_name = lead_group.get('name', '')
    tasks = lead_group.get('tasks', [])
    if not tasks:
        raise osmo_errors.OSMOUserError(f'Lead group {lead_group_name} has no tasks')

    for task in tasks:
        if task.get('lead', False):
            return task.get('name')

    raise osmo_errors.OSMOUserError(f'Cannot find lead task in group {lead_group_name}')


def validate_src_path(src: str) -> str:
    """
    Validates and parses a src path.

    :param src: The src path.

    :return: The sanitized src path.
    :raises osmo_errors.OSMOUserError: If the src path is invalid.
    """
    if not src:
        raise osmo_errors.OSMOUserError('Invalid rsync path format: missing source')

    resolved_src = paths.resolve_local_path(src)

    sanitized_src = validation.sanitized_path(resolved_src)
    if sanitized_src is None:
        raise osmo_errors.OSMOUserError(f'Invalid format for source path: {src}')

    if not os.path.exists(sanitized_src):
        raise osmo_errors.OSMOUserError(f'Source path does not exist: {src}')

    return sanitized_src


def validate_dst_path(rsync_config: Dict, dst: str) -> Tuple[str, str]:
    """
    Validates and parses a dst path.

    :param rsync_config: The rsync config.
    :param dst: The dst path.

    :return: A tuple of (module, sanitized dst path).
    :raises osmo_errors.OSMOUserError: If the dst path is invalid.
    """
    if not dst.startswith('/'):
        raise osmo_errors.OSMOUserError(
            f'Destination path must be an absolute path on remote host: {dst}')

    sanitized_dst = validation.sanitized_path(dst)
    if sanitized_dst is None:
        raise osmo_errors.OSMOUserError(f'Invalid format for destination path: {dst}')

    rsync_module = None
    allowed_paths = get_allowed_paths(rsync_config)

    # Reverse lexicographically sort the allowed paths to match the longest path first
    # Strip the common path from the desired file_path to get the relative path
    allowed_paths = sorted(allowed_paths, key=lambda x: len(x.path), reverse=True)
    for allowed_path in allowed_paths:
        if os.path.commonpath([allowed_path.path, sanitized_dst]) == allowed_path.path:
            if allowed_path.writable:
                rsync_module = allowed_path
                sanitized_dst = sanitized_dst[len(allowed_path.path):].lstrip(os.sep)
                break

    if rsync_module is None:
        raise osmo_errors.OSMOUserError(
            f'Destination path is not allowed for rsync: {dst}. The allowed base paths are: '
            f'{", ".join([path.path for path in allowed_paths])}')

    return rsync_module.name, sanitized_dst


def parse_rsync_request(
    rsync_config: Dict,
    workflow_id: str,
    task_name: str,
    rsync_path: str,
) -> RsyncRequest:
    """
    Parses a rsync path into a rsync request.

    :param rsync_config: The rsync config.
    :param workflow_id: The workflow id.
    :param task_name: The task name.
    :param rsync_path: The rsync path.

    :return: The rsync request.
    """
    # Find the first unescaped colon
    colon_index = -1
    for i, char in enumerate(rsync_path):
        if char == ':':
            if i > 0 and rsync_path[i - 1] == '\\':
                continue
            colon_index = i
            break
    if colon_index == -1:
        raise osmo_errors.OSMOUserError(
            'Invalid rsync path format: missing colon, path should be in the format of <src>:<dst>')

    # Validate the source
    src = rsync_path[:colon_index]
    sanitized_src = validate_src_path(src)

    # Validate the destination
    dst = rsync_path[colon_index + 1:]
    dst_module, sanitized_dst = validate_dst_path(rsync_config, dst)

    return RsyncRequest(
        workflow_id=workflow_id,
        task_name=task_name,
        src=sanitized_src,
        dst_module=dst_module,
        dst_path=sanitized_dst,
        original_dst_path=dst,
    )


def _resolve_float_param(
    rsync_config: Dict,
    param_name: str,
    default_value: float,
    user_value: float | None,
) -> float:
    """
    Resolves a float parameter value.
    """
    if param_name not in rsync_config:
        return user_value or default_value

    server_value = rsync_config.get(param_name, default_value)

    return max(server_value, user_value or server_value)


def rsync_upload(
    service_client: client.ServiceClient,
    workflow_id: str,
    task_name: str | None,
    path: str,
    *,
    daemon: bool = False,
    timeout: int = 10,
    upload_rate_limit: int | None = None,
    daemon_debounce_delay: float | None = None,
    daemon_poll_interval: float | None = None,
    daemon_reconcile_interval: float | None = None,
    daemon_max_log_size: int = DEFAULT_DAEMON_MAX_LOG_SIZE,
    daemon_verbose_logging: bool = False,
    quiet: bool = False,
):
    """
    Rsync uploads to a remote workflow task.

    If no task name is specified, rsync will be performed to the lead task of the first group.

    :param service_client: The service client to use.
    :param workflow_id: The workflow id.
    :param task_name: The task name.
    :param path: The rsync path.
    :param daemon: Whether to run the rsync daemon.
    :param timeout: The connection timeout.
    :param upload_rate_limit: The rate limit for the upload.
    :param daemon_debounce_delay: The debounce delay for the daemon.
    :param daemon_poll_interval: The poll interval for the daemon.
    :param daemon_reconcile_interval: The reconcile interval for the daemon.
    :param daemon_max_log_size: The maximum log size for the daemon.
    :param daemon_verbose_logging: Whether to enable verbose logging for the daemon.
    :param quiet: Whether to suppress the output.
    """
    rsync_config = get_rsync_config(service_client)
    task_name = task_name or get_lead_task_name(service_client, workflow_id)
    rsync_request = parse_rsync_request(rsync_config, workflow_id, task_name, path)

    # Determine the rate limit to use.
    # If the server rate limit is not configured or is zero, default to user provided rate limit.
    # If the server rate limit is configured, use the lowest of the two.
    rate_limit = upload_rate_limit
    if (config_rate_limit := rsync_config.get('client_upload_rate_limit', 0)) > 0:
        rate_limit = min(rate_limit or config_rate_limit, config_rate_limit)

    if not daemon:
        asyncio.get_event_loop().run_until_complete(
            rsync_upload_task(
                service_client,
                rsync_request,
                timeout=timeout,
                rate_limit=rate_limit,
            )
        )
    else:
        debounce_delay = _resolve_float_param(
            rsync_config,
            'daemon_debounce_delay',
            DEFAULT_DAEMON_DEBOUNCE_DELAY,
            daemon_debounce_delay,
        )
        poll_interval = _resolve_float_param(
            rsync_config,
            'daemon_poll_interval',
            DEFAULT_DAEMON_POLL_INTERVAL,
            daemon_poll_interval,
        )
        reconcile_interval = _resolve_float_param(
            rsync_config,
            'daemon_reconcile_interval',
            DEFAULT_DAEMON_RECONCILE_INTERVAL,
            daemon_reconcile_interval,
        )

        rsync_upload_task_daemon(
            service_client.login_manager.login_config,
            rsync_request,
            poll_interval=poll_interval,
            debounce_delay=debounce_delay,
            reconcile_interval=reconcile_interval,
            timeout=timeout,
            rate_limit=rate_limit,
            max_log_size=daemon_max_log_size,
            verbose_logging=daemon_verbose_logging,
            quiet=quiet,
        )
