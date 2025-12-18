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
# $ bazel run @osmo_workspace//src/operator:backend_listener_binary -- --host http://127.0.0.1:8080 --namespace osmo-prod --method dev --username testuser

import asyncio
import copy
import datetime
import enum
import itertools
import json
import logging
import math
import os
import re
import signal
import sys
import threading
import time
import traceback
from functools import partial
from typing import Any, Dict, Iterable, List, NamedTuple, Optional, Tuple
from urllib.parse import urlparse

import kubernetes  # type: ignore
import opentelemetry.metrics as otelmetrics
import pydantic  # type: ignore
import urllib3  # type: ignore
import websockets
import websockets.exceptions
from kubernetes import client
from kubernetes import config as kube_config  # type: ignore

from src.lib.utils import common
from src.lib.utils import logging as osmo_logging
from src.lib.utils import osmo_errors, version
from src.operator import helpers
from src.operator.utils import login, objects, service_connector
from src.utils import backend_messages
from src.utils.job import task
from src.utils.metrics import metrics
from src.utils.progress_check import progress

TIMEOUT_SEC = 60

EXIT_CODE_OFFSETS = {
    'INIT': 255,
    'PREFLIGHT': 1000,
    'CTRL': 2000,
}

WAITING_REASON_ERROR_CODE = {
    'ImagePullBackOff' : 301,
    'ErrImagePull' : 302,
    'ContainerCreateConfigError' : 303,
    'CrashLoopBackOff': 304
}

DEFAULT_AVAILABLE_CONDITION = {'Ready': 'True'}

class WebSocketConnectionType(enum.Enum):
    """Enum class for websocket connection types."""
    POD = 'pod'
    NODE = 'node'
    EVENT = 'event'
    HEARTBEAT = 'heartbeat'
    CONTROL = 'control'


def get_container_exit_code(container_name: str, exit_code: int) -> int:
    # Update the exit codes with the offsets
    if container_name == 'osmo-init':
        return EXIT_CODE_OFFSETS['INIT'] + exit_code
    if container_name == 'preflight-test':
        return EXIT_CODE_OFFSETS['PREFLIGHT'] + exit_code
    if container_name == 'osmo-ctrl':
        return EXIT_CODE_OFFSETS['CTRL'] + exit_code
    return exit_code


class PodErrorInfo(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Lightweight class for storing information about pod failure"""
    error_message: str = ''
    exit_codes: Dict[str, int] = {}
    error_reasons: Dict[str, str] = {}

    def get_exit_code(self) -> int | None:
        codes = copy.deepcopy(self.exit_codes)
        # Update the exit codes with the offsets
        if 'osmo-init' in self.exit_codes:
            codes['osmo-init'] = get_container_exit_code('osmo-init', self.exit_codes['osmo-init'])
        if 'preflight-test' in self.exit_codes:
            codes['preflight-test'] = get_container_exit_code(
                'preflight-test', self.exit_codes['preflight-test'])
        if 'osmo-ctrl' in self.exit_codes:
            codes['osmo-ctrl'] = get_container_exit_code('osmo-ctrl', self.exit_codes['osmo-ctrl'])
        # Return the maximum exit code
        if codes:
            return max(codes.values())
        return None


class PodWaitingStatus(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Lightweight class for storing information about pod status. """
    waiting_on_error: bool
    waiting_reason: str | None
    error_info: PodErrorInfo = pydantic.Field(default_factory=PodErrorInfo)


class PodList:
    """ Store all pods by node and name """
    def __init__(self):
        self._pods = {}

    def delete_pod(self, pod):
        """ Delete the given pod """
        # Skip if pod is not connected to a node:
        if not pod.spec.node_name:
            return

        try:
            # Delete the pod from the node
            del self._pods[pod.spec.node_name][pod.metadata.name]
            # Delete the node if it's empty
            if not self._pods[pod.spec.node_name]:
                del self._pods[pod.spec.node_name]
        except KeyError:
            logging.warning(
                'Pod %s not found in node %s in pod list',
                pod.metadata.name,
                pod.spec.node_name)

    def update_pod(self, pod):
        """Given a k8s pod event, update our pod list """
        # Skip if pod is not connected to a node:
        if not pod.spec.node_name:
            return

        # Create the node if it doesn't exist.
        if pod.spec.node_name not in self._pods:
            self._pods[pod.spec.node_name] = {}
        self._pods[pod.spec.node_name][pod.metadata.name] = pod

    def get_pods_by_node(self, node: str) -> Iterable[Any]:
        """ Get all pods that belong to a given node """
        return self._pods.get(node, {}).values()


class LRUCacheTTL:
    """
    Simple class to encapsulate LRUCache with TTL (in minutes).
    """
    cache: common.LRUCache
    ttl: int

    def __init__(self, capacity: int, ttl: int):
        """
        Initialize the LRUCacheTTL instance.

        :param capacity: The maximum number of items in the cache.
        :param ttl: The time-to-live (in minutes) for each item in the cache.
        """
        self.cache: common.LRUCache = common.LRUCache(capacity)
        self.ttl: int = max(0, ttl)


class NodeCacheItem(NamedTuple):
    """
    Simple class to store node information in LRUCache.
    """
    node_attributes: Tuple
    timestamp: datetime.datetime


class UnackMessages:
    """
    Class to store un-acked messages.
    """
    _unack_messages: Dict[str, backend_messages.MessageBody]
    _ready_to_send: asyncio.Event
    _max_unacked_messages: int
    _connection_type: WebSocketConnectionType

    def __init__(self, connection_type: WebSocketConnectionType, max_unacked_messages: int = 0):
        self._max_unacked_messages = max_unacked_messages if max_unacked_messages > 0 else 0
        self._unack_messages = {}
        self._ready_to_send = asyncio.Event()
        self._ready_to_send.set()
        self._connection_type = connection_type

    def qsize(self) -> int:
        return len(self._unack_messages)

    def list_messages(self) -> List[backend_messages.MessageBody]:
        # Dictionaries starting from python 3.7 are ordered by default
        return list(self._unack_messages.values())

    async def add_message(self, message: backend_messages.MessageBody):
        await self._ready_to_send.wait()
        self._unack_messages[message.uuid] = message
        if self._max_unacked_messages and len(self._unack_messages) >= self._max_unacked_messages:
            logging.warning('Reached max unacked message count for %s of %s',
                            self._connection_type.value, self._max_unacked_messages)
            self._ready_to_send.clear()

    def remove_message(self, message_uuid: str):
        if message_uuid in self._unack_messages:
            del self._unack_messages[message_uuid]
            self._ready_to_send.set()
        else:
            logging.warning('Message %s not found in unack_messages', message_uuid)


def error_msg_container_name(container_status_name: str):
    """ Construct the container name used for error messages. """
    if container_status_name == 'osmo-ctrl':
        return 'OSMO Control'
    elif container_status_name == 'preflight-test':
        return 'OSMO Preflight Test'
    else:
        return f'Task {container_status_name}'


def get_container_waiting_error_info(pod: kubernetes.client.models.v1_pod.V1Pod) -> \
    PodWaitingStatus:
    """
    Determines if a pod has encountered errors that make the container wait forever.

    Args:
        pod: The given pod.

    Returns:
        A PodWaitingStatus object that stores error information about the waiting pod
    """
    waiting_reasons = ['Failed', 'BackOff', 'Error', 'ErrImagePull', 'ImagePullBackOff']
    exit_codes = {}
    # container_statuses or init_container_statuses can be None
    for container_status in itertools.chain(
        pod.status.container_statuses or [], pod.status.init_container_statuses or []):
        state = container_status.state
        if state.waiting:
            # state is a dict state's status amd reason is a string
            state_reasons = state.waiting.reason if state.waiting.reason else ''
            if any(reason in state_reasons for reason in waiting_reasons):
                container_name = error_msg_container_name(container_status.name)
                exit_codes[container_status.name] = \
                    WAITING_REASON_ERROR_CODE.get(state_reasons, 999)
                error_info = PodErrorInfo(exit_codes=exit_codes)

                message = f'Failure reason: Exit code {error_info.get_exit_code()} due to ' \
                          f'{container_name} failed with ' \
                          f'{state.waiting.reason}: {state.waiting.message}.'
                error_info.error_message = message

                return PodWaitingStatus(waiting_on_error=True,
                                        waiting_reason=state.waiting.reason,
                                        error_info=error_info)
    return PodWaitingStatus(waiting_on_error=False)


def check_running_pod_containers(pod: kubernetes.client.models.v1_pod.V1Pod) -> PodErrorInfo:
    # Add more reasons here for cases when one container terminated and we want the service
    # to clean up the pod
    reasons = ['StartError']
    container_statuses = pod.status.container_statuses if pod.status.container_statuses else []
    for container_status in container_statuses:
        state = container_status.state
        if state.terminated:
            # If OSMO Control is terminated (completed or failed)
            # If the user container has a reason that requires cleanup immediately
            if container_status.name == 'osmo-ctrl' or \
                state.terminated.reason in reasons:
                return get_container_failure_message(pod)

    return PodErrorInfo(error_message='', exit_codes={})


def get_container_failure_message(pod: kubernetes.client.models.v1_pod.V1Pod) -> PodErrorInfo:
    """ Fetch the failure reason and message from a failed pod. """
    # container_statuses or init_container_statuses can be None
    error_msg = ''
    exit_codes = {}
    error_reasons = {}
    for container_status in itertools.chain(
        pod.status.init_container_statuses or [], pod.status.container_statuses or []):
        state = container_status.state
        if state.terminated and state.terminated.reason != 'Completed':
            container_name = error_msg_container_name(container_status.name)
            exit_code = state.terminated.exit_code

            # Get the error code from the message if it is osmo-ctrl
            if container_name == error_msg_container_name('osmo-ctrl'):
                if state.terminated.message:
                    try:
                        message_json = json.loads(state.terminated.message)
                        if 'code' in message_json:
                            exit_code = message_json['code']
                    except json.JSONDecodeError:
                        pass

            error_msg += f'\n- Exit code ' \
                         f'{get_container_exit_code(container_status.name, exit_code)} ' \
                         f'due to {container_name} failure. '
            exit_codes[container_status.name] = exit_code
            error_reasons[container_status.name] = state.terminated.reason

    error_info = PodErrorInfo(exit_codes=exit_codes, error_reasons=error_reasons)
    if error_msg:
        # Error message begins with space so not space between to and error_msg
        error_info.error_message = f'Failure reason:{error_msg}'
    return error_info


def check_failure_pod_conditions(pod: Any) -> Tuple[bool, task.TaskGroupStatus | None, int | None]:
    """
    Check if the pod conditions are met.

    Returns:
        Tuple[bool, task.TaskGroupStatus | None, int | None]:
            - bool: True if the pod conditions indicate a failure
            - task.TaskGroupStatus: The OSMO status of the pod, None if no failure is found
            - int: The exit code of the pod, None if no failure is found
    """
    if pod.status.conditions:
        for condition in pod.status.conditions:
            # In the future, add more condition checks to match the right errors and exit code
            if condition.type == 'DisruptionTarget' and condition.status == 'True':
                return True, task.TaskGroupStatus.FAILED_BACKEND_ERROR, \
                    task.ExitCode.FAILED_BACKEND_ERROR.value
    return False, None, None


def check_preemption_by_scheduler(pod: Any) -> Tuple[bool, str]:
    """
    Check if the pod is preempted by the scheduler.
    """
    if pod.status.conditions:
        for condition in pod.status.conditions:
            if condition.status == 'True' \
                and condition.reason == 'PreemptionByScheduler':
                return True, f'Pod was preempted at {condition.last_transition_time}. '
    return False, ''


def calculate_pod_status(pod: Any) \
    -> Tuple[task.TaskGroupStatus, str, Optional[int]]:
    """ Determines Pod Status """
    is_preempted, message = check_preemption_by_scheduler(pod)
    if is_preempted:
        return (task.TaskGroupStatus.FAILED_PREEMPTED,
                message,
                task.ExitCode.FAILED_PREEMPTED.value)

    pod_waiting_status = get_container_waiting_error_info(pod)
    message = pod_waiting_status.error_info.error_message
    status_map = {
        'Pending': task.TaskGroupStatus.SCHEDULING,
        'Running': task.TaskGroupStatus.RUNNING,
        'Succeeded': task.TaskGroupStatus.COMPLETED,
        'Failed': task.TaskGroupStatus.FAILED,
        'StartError': task.TaskGroupStatus.FAILED_START_ERROR
    }
    status = status_map[pod.status.phase]

    # Check if pod is in the process of initializing
    if pod.status.init_container_statuses:
        for init_status in pod.status.init_container_statuses:
            if init_status.state.waiting:
                if init_status.state.waiting.reason and \
                    init_status.state.waiting.reason in \
                        ['ContainerCreating', 'PodInitializing']:
                    status = task.TaskGroupStatus.INITIALIZING
                    break

    exit_code: int | None = None

    # StartError can happen in a container, but the pod status phase is still 'Running'
    if status == task.TaskGroupStatus.RUNNING:
        error_info = check_running_pod_containers(pod)
        if error_info.exit_codes:
            exit_code = error_info.get_exit_code()
            message = error_info.error_message
            # Set status as failed to trigger cleanup
            status = task.TaskGroupStatus.FAILED

    elif status.failed():
        error_info = get_container_failure_message(pod)
        message = error_info.error_message
        if pod.status.message:
            message = f'Pod {pod.metadata.name} error message: {pod.status.message}\n' + message
        exit_code = error_info.get_exit_code()
        if exit_code is None:
            exit_code = task.ExitCode.FAILED_UNKNOWN.value
        if any(reason == 'OOMKilled' for reason in error_info.error_reasons.values()):
            status = task.TaskGroupStatus.FAILED_EVICTED
            exit_code = task.ExitCode.FAILED_EVICTED.value

    elif status == task.TaskGroupStatus.COMPLETED:
        exit_code = 0

    if pod_waiting_status.waiting_on_error:
        error_info = pod_waiting_status.error_info \
            if pod_waiting_status.error_info is not None else PodErrorInfo()
        exit_code = error_info.get_exit_code()
        if pod_waiting_status.waiting_reason in ['ErrImagePull', 'ImagePullBackOff']:
            status = task.TaskGroupStatus.FAILED_IMAGE_PULL
        elif pod_waiting_status.waiting_reason in ['CreateContainerConfigError']:
            status = task.TaskGroupStatus.SCHEDULING
            exit_code = None
            if pod.status.conditions:
                for condition in pod.status.conditions:
                    # When a container fails to create, the pod will not be Ready.
                    # The lastTransitionTime of this condition is the closest timestamp.
                    if condition.type == 'Ready' and condition.status == 'False':
                        now = datetime.datetime.now()
                        last_transition_time = condition.last_transition_time
                        if last_transition_time:
                            time_diff = now - last_transition_time
                            # If the container is stuck in this state for more than 10 minutes,
                            # then we mark it as failed.
                            if time_diff > datetime.timedelta(minutes=10):
                                status = task.TaskGroupStatus.FAILED_BACKEND_ERROR
                                exit_code = task.ExitCode.FAILED_BACKEND_ERROR.value
                                break
        else:
            status = task.TaskGroupStatus.FAILED
    if pod.status.reason == 'Evicted':
        status = task.TaskGroupStatus.FAILED_EVICTED
        exit_code = task.ExitCode.FAILED_EVICTED.value
    elif pod.status.reason == 'StartError':
        status = task.TaskGroupStatus.FAILED_START_ERROR
        exit_code = task.ExitCode.FAILED_START_ERROR.value
    elif pod.status.reason == 'UnexpectedAdmissionError':
        # e.g. GPU drops
        status = task.TaskGroupStatus.FAILED_BACKEND_ERROR
        exit_code = task.ExitCode.FAILED_BACKEND_ERROR.value
    else:
        # Check if the pod conditions indicate a failure
        failure_found, failure_status, failure_exit_code = check_failure_pod_conditions(pod)
        # Add failure_status and failure_exit_code to condition for lint purposes
        if failure_found and failure_status and failure_exit_code:
            status = failure_status
            exit_code = failure_exit_code
    return status, message, exit_code


def check_ttl_cache(cache: LRUCacheTTL, cache_key: Tuple) -> bool:
    """
    Determines if cache query is valid based on cache state and TTL.

    Args:
        cache: The cache storing previously sent pod conditions
        cache_key: The key identifying this specific set of conditions

    Returns:
        True if cache query is valid, False otherwise
    """
    cache_timestamp = cache.cache.get(cache_key)
    if not cache_timestamp:
        return False

    # If set to 0, TTL is disabled - always use cache
    if cache.ttl == 0:
        return True

    # Check if TTL has expired
    time_diff = datetime.datetime.now() - cache_timestamp
    return time_diff < datetime.timedelta(minutes=cache.ttl)


def send_pod_status(pod_send_queue: helpers.EnqueueCallback,
                    pod: Any,
                    pod_cache: LRUCacheTTL,
                    status: str,
                    message: str,
                    exit_code: Optional[int],
                    conditions_messages: List[backend_messages.ConditionMessage],
                    backend_name: str):
    """ Send pod status to the service """

    workflow_uuid = pod.metadata.labels['osmo.workflow_uuid']
    task_uuid = pod.metadata.labels['osmo.task_uuid']
    retry_id = pod.metadata.labels.get('osmo.retry_id', 0)

    # containers[0] is osmo-exec, container[1] is osmo-ctrl container
    container_name = pod.spec.containers[0].name

    # Send Information for Update Task
    pod_key = (workflow_uuid, task_uuid, retry_id, status)
    if check_ttl_cache(pod_cache, pod_key):
        return
    pod_cache.cache.set(pod_key, datetime.datetime.now())

    container_message = backend_messages.MessageBody(
        type=backend_messages.MessageType.UPDATE_POD,
        body=backend_messages.UpdatePodBody(workflow_uuid=workflow_uuid,
                                            task_uuid=task_uuid,
                                            retry_id=retry_id,
                                            container=container_name,
                                            message=message,
                                            node=pod.spec.node_name,
                                            pod_ip=pod.status.pod_ip,
                                            status=status,
                                            exit_code=exit_code,
                                            conditions=conditions_messages,
                                            backend=backend_name),
        timestamp=datetime.datetime.now(datetime.timezone.utc))
    pod_send_queue(container_message)


def watch_pod_events(pod_send_queue: helpers.EnqueueCallback,
                     config: objects.BackendListenerConfig,):
    """ Watches events for the pods in the cluster. """
    pod_status_cache = LRUCacheTTL(config.pod_event_cache_size, config.pod_event_cache_ttl)
    api = get_thread_local_api(config)
    while True:
        try:
            watcher = kubernetes.watch.Watch(return_type=client.V1Pod)

            # Create a helper function to log when the thread is watching for events, and when it
            # receives one
            def watch_events():
                for event in watcher.stream(api.list_namespaced_pod,
                                            namespace=config.namespace,
                                            timeout_seconds=0,
                                            _request_timeout=TIMEOUT_SEC):
                    yield event['object']

            for pod in watch_events():
                if not pod.metadata.labels:
                    continue
                if 'osmo.task_uuid' not in pod.metadata.labels:
                    continue
                if 'osmo.workflow_uuid' not in pod.metadata.labels:
                    continue

                # Ignore unknown status, which usually dues to temproary connection issue.
                if pod.status.phase == 'Unknown':
                    continue

                conditions_messages = [
                    backend_messages.ConditionMessage(
                        reason=condition.reason,
                        message=condition.message,
                        timestamp=condition.last_transition_time,
                        status=condition.status,
                        type=condition.type
                    ) for condition in (pod.status.conditions or [])
                ]

                # status, message, exit_code = calculate_pod_status(pod)
                status = pod.status.phase
                message = pod.status.message or ''
                exit_code = -1

                send_pod_status(pod_send_queue, pod, pod_status_cache,
                                status, message, exit_code,
                                conditions_messages, config.backend)
        except KeyboardInterrupt:
            sys.exit(0)
        except Exception: # pylint: disable=broad-except
            logging.error('Unexpected error in watch_pod_events: %s', traceback.format_exc())
            logging.info('Restarting watch_pod_events...')
            # Sleep briefly before retrying to avoid tight loop on persistent errors
            time.sleep(3)


async def websocket_connect(config: objects.BackendListenerConfig,
                            message_queue: asyncio.Queue[backend_messages.MessageBody],
                            unack_messages: UnackMessages,
                            connection_type: WebSocketConnectionType):
    """ Watches events in the cluster. """
    backend_name: str = config.backend
    endpoint = f'api/agent/listener/{connection_type.value}/backend/{backend_name}'
    parsed_uri = urlparse(config.service_url)
    scheme = 'ws'
    if parsed_uri.scheme == 'https':
        scheme = 'wss'
    url = f'{scheme}://{parsed_uri.netloc}/{endpoint}'

    _, headers = await login.get_headers(config)

    while True:
        message = None
        try:
            async with websockets.connect(url, extra_headers=headers) as websocket:  # type: ignore
                for message in unack_messages.list_messages():
                    await websocket.send(message.json())

                async def _send_message():
                    while True:
                        try:
                            message = await asyncio.wait_for(
                                message_queue.get(), timeout=TIMEOUT_SEC)
                            await unack_messages.add_message(message)
                            await websocket.send(message.json())
                            logging.info('Sent message: type=%s, uuid=%s', message.type.value, message.uuid)
                            message_queue.task_done()
                        except asyncio.exceptions.TimeoutError:
                            pass

                async def _receive_message():
                    while True:
                        try:
                            raw_message = await websocket.recv()
                            message_data = json.loads(raw_message)
                            message = backend_messages.MessageBody(**message_data)
                            message_options = {
                                message.type.value: message.body
                            }
                            message_option = backend_messages.MessageOptions(**message_options)
                            if message_option.ack:
                                unack_messages.remove_message(message_option.ack.uuid)
                                logging.info('Received ACK: uuid=%s', message_option.ack.uuid)
                            elif message_option.node_conditions:
                                await message_queue.put(message)
                            else:
                                logging.warning('Unknown message type: %s', message.type.value)

                        except pydantic.ValidationError as err:
                            logging.warning('Invalid message received from backend %s: %s',
                                            backend_name, str(err))
                        except asyncio.exceptions.TimeoutError:
                            pass

                await asyncio.gather(_send_message(),  _receive_message())

        except (websockets.ConnectionClosed,  # type: ignore
                websockets.exceptions.WebSocketException,  # type: ignore
                ConnectionRefusedError,
                websockets.exceptions.InvalidStatusCode,  # type: ignore
                asyncio.exceptions.TimeoutError) as err:
            if isinstance(err, websockets.exceptions.WebSocketException) and \
                message:
                logging.warning('Message failed to send: %s', message)
                await message_queue.put(message)
            logging.info('WebSocket connection %s closed due to: %s\nReconnecting...',
                         connection_type.value, err)
            await asyncio.sleep(3)  # Wait before reconnecting

            _, headers = await login.get_headers(config)


def get_thread_local_api(config: objects.BackendListenerConfig) -> client.CoreV1Api:
    """Get or create a thread-local Kubernetes API client."""
    if config.method == 'dev':
        kube_config.load_kube_config()
    else:
        kube_config.load_incluster_config()

    # Create a custom configuration to set QPS and burst settings
    configuration = client.Configuration().get_default_copy()

    # Set QPS (queries per second) - default is 5
    # Increase this to allow more sustained API requests per second
    configuration.qps = config.api_qps

    # Set burst - default is 10
    # This allows temporary bursts above the QPS limit
    configuration.burst = config.api_burst

    # Create API client with custom configuration
    api_client = client.ApiClient(configuration)
    return client.CoreV1Api(api_client)


async def main():
    config = objects.BackendListenerConfig.load()
    osmo_logging.init_logger('workflow-listener', config)
    logging.getLogger('websockets.client').setLevel(logging.ERROR)

    pod_send_queue: asyncio.Queue[backend_messages.MessageBody] = asyncio.Queue()
    unack_pod_messages = UnackMessages(WebSocketConnectionType.POD,
                                       config.max_unacked_messages)

    event_loop = asyncio.get_event_loop()

    def threadsafe_send(send_queue: asyncio.Queue[backend_messages.MessageBody]):
        def threadsafe_send_impl(message: backend_messages.MessageBody):
            future = asyncio.run_coroutine_threadsafe(send_queue.put(message), event_loop)
            future.result()
        return threadsafe_send_impl

    try:

        pod_thread = threading.Thread(
            target=watch_pod_events,
            args=[threadsafe_send(pod_send_queue), config],
            daemon=True)
        pod_thread.start()

        await websocket_connect(config,
                                pod_send_queue,
                                unack_pod_messages,
                                WebSocketConnectionType.POD)
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info('Shutdown complete')
        sys.exit(0)
