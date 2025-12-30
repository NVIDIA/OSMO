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
    'CrashLoopBackOff': 304,
    'ContainerStatusUnknown': 305,
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


class ConditionsController:
    """
    Thread-safe shared state for storing node condition rules that can be updated by one
    thread and read by multiple threads safely. Implements singleton pattern.

    Rules format: Dict[regex, regex] mapping condition.type regex to a status regex.
    The status regex must be a combination of: True|False|Unknown (OR-ed).
    """
    _instance = None

    @staticmethod
    def get_instance():
        """ Static access method. """
        if not ConditionsController._instance:
            raise osmo_errors.OSMOBackendError(
                'ConditionsController has not been created!')
        return ConditionsController._instance

    def __init__(self, initial_rules: Optional[Dict[str, str]] = None):
        """
        Initialize the shared cluster state singleton.

        Args:
            initial_rules: Initial mapping of regex -> allowed statuses
        """
        if ConditionsController._instance:
            raise osmo_errors.OSMOBackendError(
                'Only one instance of ConditionsController can exist!')

        self._lock = threading.RLock()
        self._rules: Dict[str, str] = {}
        # Validate and set initial rules, enforcing non-overridable 'Ready' policy
        self.set_rules(initial_rules or {})
        ConditionsController._instance = self

    def get_rules(self) -> Dict[str, str]:
        """Thread-safe retrieval of current rules."""
        with self._lock:
            # Return a shallow copy to avoid external mutation
            return dict(self._rules)

    def set_rules(self, rules: Dict[str, str]) -> None:
        """
        Thread-safe replace of the entire rule set with the provided mapping.

        Args:
            rules: Mapping of condition.type regex -> status regex (True|False|Unknown combos)
        """
        # Enforce: 'Ready' can only be set to 'True' if explicitly provided
        for pattern, status_regex in rules.items():
            try:
                if re.match(pattern, 'Ready') and status_regex != 'True':
                    raise osmo_errors.OSMOBackendError(
                        "Overriding 'Ready' rule is not allowed; only 'True' is permitted")
            except re.error:
                # Ignore invalid regex here; other logic already guards re errors during matching
                continue

        with self._lock:
            self._rules = dict(rules)

    def get_effective_rules(self, default_rules: Dict[str, str]) -> List[Tuple[str, str]]:
        """
        Build an ordered list of (pattern, status_regex) combining current rules and
        default rules. Provided rules take precedence; defaults are added only if no
        provided rule matches the default condition type.

        Args:
            default_rules: Mapping of condition type (literal) -> status regex

        Returns:
            List of (pattern, status_regex) pairs to evaluate in order.
        """
        with self._lock:
            effective: List[Tuple[str, str]] = []
            # First, include all provided rules as-is
            for pattern, status_regex in self._rules.items():
                effective.append((pattern, status_regex))

        # Then, add defaults for any default condition type not matched by provided patterns
        for cond_type, status_regex in default_rules.items():
            try:
                has_override = any(re.match(pattern, cond_type) for pattern, _ in effective)
            except re.error:
                has_override = False
            if not has_override:
                effective.append((f'^{re.escape(cond_type)}$', status_regex))

        return effective


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
    waiting_reasons = ['Failed', 'BackOff', 'Error', 'ErrImagePull', 'ImagePullBackOff',
                       'ContainerStatusUnknown']
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


def is_node_available(node,
                      conditions_controller: ConditionsController) -> bool:
    # Get current rules from shared state
    effective_rules: List[Tuple[str, str]] = \
        conditions_controller.get_effective_rules(DEFAULT_AVAILABLE_CONDITION)
    for condition in node.status.conditions:
        matched_any_rule = False
        allowed_by_any_rule = False
        for pattern, status_regex in effective_rules:
            try:
                if re.match(pattern, condition.type):
                    matched_any_rule = True
                    # Anchor the status regex to full match
                    if re.match(f'^(?:{status_regex})$', condition.status or ''):
                        allowed_by_any_rule = True
                        break
            except re.error:
                # Invalid regex should be ignored
                continue
        # If at least one rule matched this condition type but none allowed the status,
        # the node is not available.
        if matched_any_rule and not allowed_by_any_rule:
            return False

    return not node.spec.unschedulable


def update_resource_in_database(node_send_queue: helpers.EnqueueCallback,
                                event_send_queue: helpers.EnqueueCallback,
                                node,
                                node_cache: LRUCacheTTL,
                                conditions_controller: ConditionsController):
    """ Update a resource node in the resources database. """
    # Collect resource values from allocatable and labels
    allocatable_fields = node.status.allocatable
    allocatable_fields['cpu'] = str(int(common.convert_cpu_unit(allocatable_fields['cpu'])))
    label_fields = node.metadata.labels
    taints = [taint.to_dict() for taint in node.spec.taints] if node.spec.taints else []
    hostname = label_fields.get('kubernetes.io/hostname', '-')

    # Add availability and collect true conditions
    node_available = is_node_available(node, conditions_controller)
    conditions = []
    for condition in node.status.conditions:
        if condition.status == 'True':
            conditions.append(condition.type)
    # Update node label if enabled
    backend_config = objects.BackendListenerConfig.load()
    if backend_config.enable_node_label_update:
        update_node_verified_label(node, node_available,
                                   backend_config.node_condition_prefix, event_send_queue)
    # Filter out some fields
    keys_to_be_filtered = list(filter(lambda x: x.startswith('feature.node.kubernetes.io'),
                                        label_fields.keys()))
    for key in keys_to_be_filtered:
        label_fields.pop(key)

    curr_node_attributes = (node_available, allocatable_fields,
                            label_fields, taints, conditions)
    # The hostname should be unique within a given backend
    result: NodeCacheItem | None = node_cache.cache.get(hostname)
    # This event is the exact same as the previous event sent for this node
    if result and result.node_attributes == curr_node_attributes:
        if node_cache.ttl == 0:
            return
        time_diff = datetime.datetime.now() - result.timestamp
        if time_diff < datetime.timedelta(minutes=node_cache.ttl):
            return
    node_cache.cache.set(hostname,
                         NodeCacheItem(node_attributes=curr_node_attributes,
                                       timestamp=datetime.datetime.now()))

    # Send updated resource spec to service
    helpers.send_log_through_queue(
        backend_messages.LoggingType.DEBUG,
        f'Send node {node.metadata.name} to be updated in the database',
        event_send_queue)
    resource_message = backend_messages.MessageBody(
        type=backend_messages.MessageType.RESOURCE,
        body=backend_messages.ResourceBody(hostname=hostname,
                                           available=node_available,
                                           conditions=conditions,
                                           allocatable_fields=allocatable_fields,
                                           label_fields=label_fields,
                                           taints=taints))
    node_send_queue(resource_message)
    send_backend_message_count(event_type='node')


def update_node_verified_label(node: Any, node_available: bool,
                               node_condition_prefix: str,
                               event_send_queue: helpers.EnqueueCallback):
    """
    Update the {node_condition_prefix}verified label on a node based on its availability status.

    Args:
        node: The Kubernetes node object
        node_available: Boolean indicating if the node is available
        node_condition_prefix: Prefix for the condition label
        event_send_queue: Queue for sending log events
    """
    try:
        # Construct the label name using the configurable prefix
        label_name = f'{node_condition_prefix}verified'

        # Get current label value and determine new value
        current_label_value = node.metadata.labels.get(label_name, None)
        new_label_value = 'True' if node_available else 'False'

        # Only update if the label value has changed
        if current_label_value != new_label_value:
            # Create the Kubernetes API client and patch body
            api = client.CoreV1Api()
            patch_body = {
                'metadata': {
                    'labels': {
                        label_name: new_label_value
                    }
                }
            }

            # Apply the patch to the node
            api.patch_node(node.metadata.name, patch_body)

            helpers.send_log_through_queue(
                backend_messages.LoggingType.INFO,
                f'Updated {label_name} label on node {node.metadata.name} to {new_label_value} '
                f'(node_available: {node_available})',
                event_send_queue)

    except client.rest.ApiException as error:
        helpers.send_log_through_queue(
            backend_messages.LoggingType.WARNING,
            f'Failed to update {label_name} label on node {node.metadata.name}: {error}',
            event_send_queue)


def update_resource_usage(node_send_queue: helpers.EnqueueCallback,
                          node_name: str, pods: Iterable[Any],
                          workflow_namespace: str):
    """
    Update a resource node's usage in the resources database.
    Pods should just be the list of pods on this node
    """
    backend_config = objects.BackendListenerConfig.load()
    pods_for_node = [pod for pod in pods if pod.status.phase == 'Running'
                     or (pod.status.phase == 'Pending' and pod.spec.node_name is not None)]

    # Initialize resource request counters as dictionaries
    total_requests = {
        'cpu': 0.0,
        'memory': 0.0,
        'storage': 0.0,
        'gpu': 0
    }
    non_wf_requests = {
        'cpu': 0.0,
        'memory': 0.0,
        'storage': 0.0,
        'gpu': 0
    }

    # Calculate resource requests for each pod
    for pod in pods_for_node:
        pod_namespace = pod.metadata.namespace
        workflow_pod_namespaces = backend_config.include_namespace_usage + [workflow_namespace]

        for container in pod.spec.containers:
            if not container.resources.requests:
                continue

            requests = container.resources.requests

            # Convert resource values once
            cpu_request = common.convert_cpu_unit(requests.get('cpu', '0'))
            memory_request = common.convert_resource_value_str(
                requests.get('memory', '0'), target='Ki')
            storage_request = common.convert_resource_value_str(
                requests.get('ephemeral-storage', '0'), target='Ki')
            gpu_request = int(requests.get('nvidia.com/gpu', '0'))

            # Always add to total requests
            # Helper function to accumulate resource requests
            def add_resource_requests(
                    target_dict, cpu_request, memory_request, storage_request, gpu_request):
                target_dict['cpu'] += cpu_request
                target_dict['memory'] += memory_request
                target_dict['storage'] += storage_request
                target_dict['gpu'] += gpu_request

            # Update both counters
            add_resource_requests(
                total_requests, cpu_request, memory_request, storage_request, gpu_request)

            if not pod_namespace in workflow_pod_namespaces:
                add_resource_requests(
                    non_wf_requests, cpu_request, memory_request, storage_request, gpu_request)

    def format_resource_usage(requests):
        return {
            'cpu': str(math.ceil(requests['cpu'])),
            'memory': f"{math.ceil(requests['memory'])}Ki",
            'ephemeral-storage': f"{math.ceil(requests['storage'])}Ki",
            'nvidia.com/gpu': str(requests['gpu'])
        }

    # Format the resource usage messages
    resource_usage = format_resource_usage(total_requests)
    non_wf_resource_usage = format_resource_usage(non_wf_requests)

    resource_message = backend_messages.MessageBody(
        type=backend_messages.MessageType.RESOURCE_USAGE,
        body=backend_messages.ResourceUsageBody(
            hostname=node_name,
            usage_fields=resource_usage,
            non_workflow_usage_fields=non_wf_resource_usage
        )
    )
    node_send_queue(resource_message)
    send_backend_message_count(event_type='node')


def update_resource_database_to_service(node_send_queue: helpers.EnqueueCallback,
                                        event_send_queue: helpers.EnqueueCallback,
                                        api: Any,
                                        node_cache: LRUCacheTTL,
                                        conditions_controller: ConditionsController,
                                        progress_writer: Optional[progress.ProgressWriter] = None):
    """
    Update the resource database to the service.
    """
    current_nodes = api.list_node().items
    for node in current_nodes:
        update_resource_in_database(node_send_queue, event_send_queue,
                                    node, node_cache, conditions_controller)
        if progress_writer:
            progress_writer.report_progress()


def refresh_resource_database(node_send_queue: helpers.EnqueueCallback,
                              event_send_queue: helpers.EnqueueCallback,
                              api: Any,
                              node_cache: LRUCacheTTL,
                              conditions_controller: ConditionsController,
                              list_pods_page_size: int = 1000,
                              progress_writer: Optional[progress.ProgressWriter] = None)\
                              -> Tuple[Any, PodList]:
    """
    Refresh the resource database to update resources in the resource database and remove
    resources in the database that no longer exist.
    """
    backend_config = objects.BackendListenerConfig.load()
    if progress_writer:
        progress_writer.report_progress()

    # Use pagination with continue token for large pod lists
    all_pods = PodList()
    continue_token = None
    pod_list_aggregated = None

    while True:
        try:
            if continue_token:
                pod_list = api.list_pod_for_all_namespaces(
                    _continue=continue_token,
                    limit=list_pods_page_size
                )
                pod_list_aggregated.items.extend(pod_list.items)
            else:
                pod_list = api.list_pod_for_all_namespaces(
                    limit=list_pods_page_size)
                pod_list_aggregated = pod_list

            # Process pods from this page
            for pod in pod_list.items:
                all_pods.update_pod(pod)

            # Check if there are more pages
            continue_token = pod_list.metadata._continue  # pylint: disable=protected-access

            if not continue_token:
                pod_list_aggregated.metadata = pod_list.metadata
                break

            if progress_writer:
                progress_writer.report_progress()

        except Exception as e:  # pylint: disable=broad-except
            logging.warning('Error during paginated pod fetch: %s', e)
            # Fallback to non-paginated call if pagination fails
            pod_list = api.list_pod_for_all_namespaces()
            for pod in pod_list.items:
                all_pods.update_pod(pod)
            break

    if progress_writer:
        progress_writer.report_progress()

    node_names = []
    current_nodes = api.list_node().items
    for node in current_nodes:
        node_name = node.metadata.labels.get('kubernetes.io/hostname', '-')
        node_names.append(node_name)
        update_resource_in_database(node_send_queue, event_send_queue,
                                    node, node_cache, conditions_controller)
        current_pods = all_pods.get_pods_by_node(node_name)
        update_resource_usage(node_send_queue, node_name, current_pods, backend_config.namespace)
        if progress_writer:
            progress_writer.report_progress()

    # Send the nodes that are still in the cluster
    node_message = backend_messages.MessageBody(
        type=backend_messages.MessageType.NODE_HASH,
        body=backend_messages.NodeBody(node_hashes=node_names))
    node_send_queue(node_message)
    send_backend_message_count(event_type='node')
    return pod_list_aggregated, all_pods


def send_connection_error_count(event_type: str = 'backend'):
    """
    Sends counter based on event types.
    """
    backend_metrics = metrics.MetricCreator.get_meter_instance()
    namespace = objects.BackendListenerConfig.load().namespace
    name = 'event_watch_connection_error_count'
    backend_metrics.send_counter(
        name=name, value=1, unit='count',
        description=f'Count of connection errors for {event_type}.',
        tags={'event_type': event_type, 'namespace': namespace}
    )


def send_stream_event_count(event_type: str = 'backend'):
    """
    Sends counter when an event is received from streaming a Kubernetes API (e.g. list pods).
    """
    backend_metrics = metrics.MetricCreator.get_meter_instance()
    namespace = objects.BackendListenerConfig.load().namespace
    name = 'kb_event_watch_count'
    backend_metrics.send_counter(
        name=name, value=1, unit='count',
        description=f'Count of events for {event_type}.',
        tags={'event_type': event_type, 'namespace': namespace}
    )


def send_backend_message_count(event_type: str = 'backend'):
    """
    Sends counter when a backend message is added to the message queue.
    """
    backend_metrics = metrics.MetricCreator.get_meter_instance()
    namespace = objects.BackendListenerConfig.load().namespace
    name = 'backend_listener_queue_event_count'
    backend_metrics.send_counter(
        name=name, value=1, unit='count',
        description=f'Count of events for {event_type}.',
        tags={'event_type': event_type, 'namespace': namespace}
    )


def send_websocket_disconnect_count(event_type: str = 'backend'):
    """
    Sends counter when a websocket disconnects.
    """
    backend_metrics = metrics.MetricCreator.get_meter_instance()
    namespace = objects.BackendListenerConfig.load().namespace
    name = 'websocket_disconnect_count'
    backend_metrics.send_counter(
        name=name, value=1, unit='count',
        description=f'Count of websocket connection disconnects for {event_type}.',
        tags={'event_type': event_type, 'namespace': namespace}
    )


def send_histogram_for_processing_times(event_type: str, processing_time: float):
    '''
    Sends histogram for processing times based on event.
    '''
    backend_metrics = metrics.MetricCreator.get_meter_instance()
    namespace = objects.BackendListenerConfig.load().namespace
    name = 'event_processing_times'
    backend_metrics.send_histogram(
        name=name, value=processing_time, unit='seconds',
        description=f'Count of websocket connection disconnects for {event_type}.',
        tags={'event_type': event_type, 'namespace': namespace}
    )


def send_backend_message_transmission_count(event_type: str = 'backend'):
    """
    Sends counter when a backend message is transmitted to the service.
    """
    backend_metrics = metrics.MetricCreator.get_meter_instance()
    namespace = objects.BackendListenerConfig.load().namespace
    name = 'backend_message_transmission_count'
    backend_metrics.send_counter(
        name=name, value=1, unit='count',
        description=f'Count of backend message transmissions for {event_type}.',
        tags={'event_type': event_type, 'namespace': namespace}
    )


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


def calculate_pod_status(pod: Any) -> Tuple[task.TaskGroupStatus, str, Optional[int]]:
    """
    Determines Pod Status.

    Args:
        pod: The Kubernetes pod object

    Returns:
        Tuple containing:
        - status: TaskGroupStatus
        - message: Error/status message
        - exit_code: Exit code if applicable
    """
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
        elif pod_waiting_status.waiting_reason in ['ContainerStatusUnknown']:
            # ContainerStatusUnknown typically occurs when a node becomes unreachable
            # and the kubelet stops reporting container status. Mark as scheduling
            # initially, then as FAILED_BACKEND_ERROR after timeout to trigger cleanup.
            status = task.TaskGroupStatus.SCHEDULING
            exit_code = None
            if pod.status.conditions:
                for condition in pod.status.conditions:
                    if condition.type == 'Ready' and condition.status == 'False':
                        now = datetime.datetime.now(datetime.timezone.utc)
                        last_transition_time = condition.last_transition_time
                        if last_transition_time:
                            time_diff = now - last_transition_time
                            # If the container is stuck in this state for more than 30 minutes,
                            # then we mark it as failed.
                            if time_diff > datetime.timedelta(minutes=30):
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


def send_pod_conditions(event_send_queue: helpers.EnqueueCallback,
                        pod_conditions_cache: LRUCacheTTL,
                        workflow_uuid: str,
                        task_uuid: str,
                        retry_id: int,
                        conditions_messages: List[backend_messages.ConditionMessage]):
    """
    Sends pod conditions to the service if they haven't been sent recently.

    Args:
        event_send_queue: Queue for sending events
        pod_conditions_cache: Cache for tracking sent conditions
        workflow_uuid: UUID of the workflow
        task_uuid: UUID of the task
        retry_id: Retry ID
        conditions_messages: List of condition messages to send
    """
    pod_conditions_key = (task_uuid, tuple(c.json() for c in conditions_messages))

    if not check_ttl_cache(pod_conditions_cache, pod_conditions_key):
        pod_conditions_message = backend_messages.MessageBody(
            type=backend_messages.MessageType.POD_CONDITIONS,
            body=backend_messages.PodConditionsBody(workflow_uuid=workflow_uuid,
                                                    task_uuid=task_uuid,
                                                    retry_id=retry_id,
                                                    conditions=conditions_messages))
        event_send_queue(pod_conditions_message)
        send_backend_message_count(event_type='event')
        pod_conditions_cache.cache.set(pod_conditions_key, datetime.datetime.now())


def send_pod_status(pod_send_queue: helpers.EnqueueCallback,
                    event_send_queue: helpers.EnqueueCallback,
                    pod: Any,
                    pod_cache: LRUCacheTTL,
                    pod_conditions_cache: LRUCacheTTL,
                    status: task.TaskGroupStatus,
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

    # Send pod conditions if needed
    send_pod_conditions(event_send_queue, pod_conditions_cache,
                        workflow_uuid, task_uuid, retry_id, conditions_messages)

    # Send Information for Update Task
    pod_key = (workflow_uuid, task_uuid, retry_id, status.value)
    if check_ttl_cache(pod_cache, pod_key):
        helpers.send_log_through_queue(
            backend_messages.LoggingType.DEBUG,
            f'Skip pod status {pod_key} because of cache hit',
            event_send_queue)
        return
    pod_cache.cache.set(pod_key, datetime.datetime.now())

    helpers.send_log_through_queue(
        backend_messages.LoggingType.DEBUG,
        f'Send update status {status.value} for task_uuid {task_uuid} '\
        f'for workflow {workflow_uuid} to service',
        event_send_queue, workflow_uuid=workflow_uuid)
    container_message = backend_messages.MessageBody(
        type=backend_messages.MessageType.UPDATE_POD,
        body=backend_messages.UpdatePodBody(workflow_uuid=workflow_uuid,
                                            task_uuid=task_uuid,
                                            retry_id=retry_id,
                                            container=container_name,
                                            message=message,
                                            node=pod.spec.node_name,
                                            pod_ip=pod.status.pod_ip,
                                            status=status.value,
                                            exit_code=exit_code,
                                            conditions=conditions_messages,
                                            backend=backend_name))
    pod_send_queue(container_message)
    send_backend_message_count(event_type='pod')


def send_pod_monitor(pod_send_queue: helpers.EnqueueCallback,
                     event_send_queue: helpers.EnqueueCallback, pod: Any, message: str):
    """ Send pod to be monitored. This happens when a pod is failing to start """

    workflow_uuid = pod.metadata.labels['osmo.workflow_uuid']
    task_uuid = pod.metadata.labels['osmo.task_uuid']
    retry_id = pod.metadata.labels.get('osmo.retry_id', 0)

    # Send Container information to Service
    helpers.send_log_through_queue(
        backend_messages.LoggingType.DEBUG,
        f'Sending pod {task_uuid} for workflow {workflow_uuid} to be monitored in the service',
        event_send_queue, workflow_uuid=workflow_uuid)
    container_message = backend_messages.MessageBody(
        type=backend_messages.MessageType.MONITOR_POD,
        body=backend_messages.MonitorPodBody(workflow_uuid=workflow_uuid,
                                             task_uuid=task_uuid,
                                             retry_id=retry_id,
                                             message=message))
    pod_send_queue(container_message)
    send_backend_message_count(event_type='pod')


def watch_pod_events(progress_writer: progress.ProgressWriter,
                     pod_send_queue: helpers.EnqueueCallback,
                     node_send_queue: helpers.EnqueueCallback,
                     event_send_queue: helpers.EnqueueCallback,
                     config: objects.BackendListenerConfig,
                     kube_pod_list: Any,
                     node_cache: LRUCacheTTL,
                     all_pods: PodList,
                     conditions_controller: ConditionsController):
    """ Watches events for the pods in the cluster. """
    pod_status_cache = LRUCacheTTL(config.pod_event_cache_size, config.pod_event_cache_ttl)
    pod_conditions_cache = LRUCacheTTL(config.pod_event_cache_size, config.pod_event_cache_ttl)
    api = get_thread_local_api(config)
    last_resource_version = kube_pod_list.metadata.resource_version
    last_successful = datetime.datetime.now()
    refreshed_resource_state = True
    while True:
        try:
            time_diff = datetime.datetime.now() - last_successful
            if time_diff > datetime.timedelta(
                seconds=config.refresh_resource_state_interval):
                kube_pod_list, all_pods = refresh_resource_database(
                    node_send_queue,
                    event_send_queue,
                    api,
                    node_cache,
                    conditions_controller,
                    config.list_pods_page_size,
                    progress_writer
                )
                last_successful = datetime.datetime.now()
                last_resource_version = kube_pod_list.metadata.resource_version
                refreshed_resource_state = True

            watcher = kubernetes.watch.Watch(return_type=client.V1Pod)

            # Create a helper function to log when the thread is watching for events, and when it
            # receives one
            def watch_events(kube_pod_list):
                progress_writer.report_progress()
                nonlocal last_resource_version
                nonlocal refreshed_resource_state
                helpers.send_log_through_queue(
                    backend_messages.LoggingType.INFO,
                    f'Using resource version {last_resource_version} for pod events',
                    event_send_queue)

                if refreshed_resource_state:
                    for pod in kube_pod_list.items:
                        if pod.metadata.namespace == config.namespace:
                            yield pod
                    refreshed_resource_state = False

                for event in watcher.stream(api.list_pod_for_all_namespaces, timeout_seconds=0,
                                            _request_timeout=TIMEOUT_SEC,
                                            resource_version=last_resource_version):
                    progress_writer.report_progress()
                    last_resource_version = event['object'].metadata.resource_version

                    # Update our "all_pods" dictionary
                    if event['type'] == 'DELETED':
                        all_pods.delete_pod(event['object'])
                    else:
                        all_pods.update_pod(event['object'])

                    if event['object'].metadata.namespace == config.namespace:
                        yield event['object']

            for pod in watch_events(kube_pod_list):
                start_time = datetime.datetime.now()
                if not pod.metadata.labels:
                    continue
                if 'osmo.task_uuid' not in pod.metadata.labels:
                    continue
                if 'osmo.workflow_uuid' not in pod.metadata.labels:
                    continue

                if pod.spec.node_name:
                    current_pods = all_pods.get_pods_by_node(pod.spec.node_name)
                    update_resource_usage(
                        node_send_queue, pod.spec.node_name, current_pods, config.namespace)

                # Ignore pods with Unknown phase status (usually due to temporary connection issue)
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

                status, message, exit_code = calculate_pod_status(pod)

                if not status.in_queue() and pod.status.phase == 'Pending':
                    send_pod_monitor(pod_send_queue, event_send_queue, pod, message)

                send_pod_status(pod_send_queue, event_send_queue, pod, pod_status_cache,
                                pod_conditions_cache, status, message, exit_code,
                                conditions_messages, config.backend)

                last_successful = datetime.datetime.now()
                event_processing_time =  (last_successful - start_time).total_seconds()
                send_histogram_for_processing_times(event_type='pod',
                                                    processing_time=event_processing_time)
                send_stream_event_count(event_type='pod')

        except kubernetes.client.exceptions.ApiException as error:
            send_connection_error_count(event_type='pod')
            helpers.send_log_through_queue(
                backend_messages.LoggingType.WARNING,
                f'Cluster monitor errored out during watch pod events due to {error} retrying ...',
                event_send_queue)
            if error.status == 410:
                # Reset last resource version
                last_resource_version = ''
            progress_writer.report_progress()
        except urllib3.exceptions.ReadTimeoutError:
            helpers.send_log_through_queue(
                backend_messages.LoggingType.INFO,
                'Connection timed out during watch pod events, reestablishing watch stream.',
                event_send_queue)
            progress_writer.report_progress()
        except (urllib3.exceptions.MaxRetryError, urllib3.exceptions.ProtocolError) as error:
            send_connection_error_count(event_type='pod')
            helpers.send_log_through_queue(
                backend_messages.LoggingType.WARNING,
                f'Connection error during watch pod events: {error}, retrying ...',
                event_send_queue)
        except KeyboardInterrupt:
            sys.exit(0)
        except Exception as error: # pylint: disable=broad-except
            helpers.send_log_through_queue(
                backend_messages.LoggingType.EXCEPTION,
                f'Got unexpected exception of type {type(error).__name__}',
                event_send_queue)
            helpers.send_log_through_queue(
                backend_messages.LoggingType.EXCEPTION,
                traceback.format_exc(),
                event_send_queue)
            os.kill(os.getpid(), signal.SIGINT)


def watch_node_events(progress_writer: progress.ProgressWriter,
                      node_send_queue: helpers.EnqueueCallback,
                      event_send_queue: helpers.EnqueueCallback,
                      node_cache: LRUCacheTTL,
                      conditions_controller: ConditionsController,
                      config: objects.BackendListenerConfig):
    """ Watches events for the nodes in the cluster. """
    last_resource_version = ''
    api = get_thread_local_api(config)
    last_successful = datetime.datetime.now()
    while True:
        try:
            time_diff = datetime.datetime.now() - last_successful
            if time_diff > datetime.timedelta(
                seconds=config.refresh_resource_state_interval):
                refresh_resource_database(
                    node_send_queue,
                    event_send_queue,
                    api,
                    node_cache,
                    conditions_controller,
                    config.list_pods_page_size,
                    progress_writer
                )
                last_successful = datetime.datetime.now()

            watcher = kubernetes.watch.Watch(return_type=client.V1Node)

            # Create a helper function to log when the thread is watching for events, and when it
            # receives one
            def watch_events():
                progress_writer.report_progress()
                nonlocal last_resource_version
                helpers.send_log_through_queue(
                    backend_messages.LoggingType.DEBUG,
                    'Waiting for node event',
                    event_send_queue)
                for event in watcher.stream(api.list_node, timeout_seconds=0,
                                            _request_timeout=TIMEOUT_SEC,
                                            resource_version=last_resource_version):
                    progress_writer.report_progress()
                    node = event['object']
                    last_resource_version = node.metadata.resource_version
                    helpers.send_log_through_queue(
                        backend_messages.LoggingType.DEBUG,
                        f'Got node event for node {node.metadata.name}, resource version ' +\
                        f'{last_resource_version}',
                        event_send_queue)
                    yield event

            for event in watch_events():
                start_time = datetime.datetime.now()
                node = event['object']

                if event['type'] == 'DELETED':
                    # Send Information for DELETE resource
                    label_fields = node.metadata.labels
                    deleted_node_name = label_fields.get('kubernetes.io/hostname', '-')
                    container_message = backend_messages.MessageBody(
                        type=backend_messages.MessageType.DELETE_RESOURCE,
                        body=backend_messages.DeleteResourceBody(resource=deleted_node_name))
                    node_send_queue(container_message)
                    send_backend_message_count(event_type='node')
                else:
                    update_resource_in_database(node_send_queue, event_send_queue, node,
                                                node_cache, conditions_controller)
                last_successful = datetime.datetime.now()
                event_processing_time =  (last_successful - start_time).total_seconds()
                send_histogram_for_processing_times(event_type='node',
                                                    processing_time=event_processing_time)
                send_stream_event_count(event_type='node')

        except kubernetes.client.exceptions.ApiException as error:
            send_connection_error_count(event_type='node')
            helpers.send_log_through_queue(
                backend_messages.LoggingType.WARNING,
                f'Cluster monitor errored out during watch node events due to {error} retrying ...',
                event_send_queue)
            if error.status == 410:
                # Reset last resource version
                last_resource_version = ''

        except urllib3.exceptions.ReadTimeoutError:
            helpers.send_log_through_queue(
                backend_messages.LoggingType.INFO,
                'Connection timed out during watch node events, reestablishing watch stream.',
                event_send_queue)

        except (urllib3.exceptions.MaxRetryError, urllib3.exceptions.ProtocolError) as error:
            send_connection_error_count(event_type='node')
            helpers.send_log_through_queue(
                backend_messages.LoggingType.WARNING,
                f'Cluster monitor errored out during watch node events due to {error} retrying ...',
                event_send_queue)
        except KeyboardInterrupt:
            sys.exit(0)
        except Exception as error: # pylint: disable=broad-except
            helpers.send_log_through_queue(
                backend_messages.LoggingType.EXCEPTION,
                f'Got unexpected exception of type {type(error).__name__}',
                event_send_queue)
            helpers.send_log_through_queue(
                backend_messages.LoggingType.EXCEPTION,
                traceback.format_exc(),
                event_send_queue)
            os.kill(os.getpid(), signal.SIGINT)


def watch_backend_events(progress_writer: progress.ProgressWriter,
                         event_send_queue: helpers.EnqueueCallback,
                         config: objects.BackendListenerConfig):
    """ Watches events in the cluster. """
    last_resource_version = ''
    api = get_thread_local_api(config)
    event_cache = common.LRUCache(config.backend_event_cache_size)
    while True:
        try:
            watcher = kubernetes.watch.Watch(return_type=client.CoreV1Event)
            pod_pattern = re.compile(r'Pod\s+\S+/([^\s]+)\s+was preempted')
            progress_writer.report_progress()
            for event in watcher.stream(api.list_namespaced_event,
                                        namespace=config.namespace,
                                        timeout_seconds=0,
                                        _request_timeout=TIMEOUT_SEC,
                                        resource_version=last_resource_version):
                event_obj = event['object']
                last_resource_version = event_obj.metadata.resource_version
                logging.debug('%s %s %s %s %s', event_obj.type, event_obj.reason,
                    event_obj.involved_object.name, event_obj.last_timestamp, event_obj.message)
                send_stream_event_count(event_type='backend')
                if event_obj.involved_object.kind == 'Pod':
                    cached_timestamp = event_cache.get(
                        (event_obj.type,
                         event_obj.reason,
                         event_obj.involved_object.name))

                    if cached_timestamp and event_obj.last_timestamp and \
                        cached_timestamp >= event_obj.last_timestamp:
                        logging.debug(
                            'Skipping duplicate event - Pod: %s, Type: %s, Reason: %s, Time: %s',
                            event_obj.involved_object.name, event_obj.type, event_obj.reason,
                            event_obj.last_timestamp)
                        # This event has already been sent, skipping
                        continue

                    # Set the cache to the current timestamp
                    event_cache.set(
                        (event_obj.type,
                         event_obj.reason,
                         event_obj.involved_object.name),
                        event_obj.last_timestamp or datetime.datetime.now())

                    pod_event_message = backend_messages.MessageBody(
                        type=backend_messages.MessageType.POD_EVENT,
                        body=backend_messages.PodEventBody(
                            pod_name=event_obj.involved_object.name,
                            reason=event_obj.reason or '',
                            message=event_obj.message or '',
                            timestamp=event_obj.last_timestamp or datetime.datetime.now()
                        )
                    )
                    event_send_queue(pod_event_message)
                    send_backend_message_count(event_type='backend')

                elif event_obj.involved_object.kind == 'PodGroup':
                    if event_obj.reason == 'Evict' and \
                        event_obj.reporting_component == 'kai-scheduler':
                        match = pod_pattern.search(event_obj.message)
                        if match:
                            pod_name = match.group(1)
                            pod_event_message = backend_messages.MessageBody(
                                type=backend_messages.MessageType.POD_EVENT,
                                body=backend_messages.PodEventBody(
                                    pod_name=pod_name,
                                    reason=event_obj.reason,
                                    message=event_obj.message,
                                    timestamp=event_obj.last_timestamp or datetime.datetime.now()
                                )
                            )
                            event_send_queue(pod_event_message)
                            send_backend_message_count(event_type='backend')
                        else:
                            logging.warning('Failed to parse pod name from event message: %s',
                                            event_obj.message)
                progress_writer.report_progress()

        except kubernetes.client.exceptions.ApiException as error:
            send_connection_error_count(event_type='backend')
            logging.warning('Cluster monitor errored out during watch events due to %s, '
                                 'retrying ...', error)
            helpers.send_log_through_queue(
                backend_messages.LoggingType.WARNING,
                f'Cluster monitor errored out during watch events due to %s, {error} ' +\
                'retrying ...',
                event_send_queue)
            if error.status == 410:
                # Reset last resource version
                last_resource_version = ''
        except urllib3.exceptions.ReadTimeoutError:
            helpers.send_log_through_queue(
                backend_messages.LoggingType.WARNING,
                'Connection timed out during watch backend events, reestablishing watch stream.',
                event_send_queue)
        except (urllib3.exceptions.MaxRetryError, urllib3.exceptions.ProtocolError) as error:
            send_connection_error_count(event_type='backend')
            helpers.send_log_through_queue(
                backend_messages.LoggingType.WARNING,
                f'Cluster monitor errored out during watch backend events due to {error} ' +\
                'retrying ...',
                event_send_queue)
        except KeyboardInterrupt:
            sys.exit(0)
        except Exception as error:  # pylint: disable=broad-except
            helpers.send_log_through_queue(
                backend_messages.LoggingType.EXCEPTION,
                f'Got unexpected exception of type {type(error).__name__}',
                event_send_queue)
            helpers.send_log_through_queue(
                backend_messages.LoggingType.EXCEPTION,
                traceback.format_exc(),
                event_send_queue)
            os.kill(os.getpid(), signal.SIGINT)


async def heartbeat(send_queue: asyncio.Queue[backend_messages.MessageBody]):
    """ Watches events in the cluster. """
    while True:
        await send_queue.put(backend_messages.MessageBody(
            type=backend_messages.MessageType.HEARTBEAT,
            body=backend_messages.HeartbeatBody(time=common.current_time())))
        await asyncio.sleep(20)


def get_service_control_updates(
        progress_writer: progress.ProgressWriter,
        control_receive_queue: helpers.DequeueCallback,
        node_send_queue: helpers.EnqueueCallback,
        event_send_queue: helpers.EnqueueCallback,
        api: client.CoreV1Api,
        node_cache: LRUCacheTTL,
        conditions_controller: ConditionsController
    ):
    """
    Watches and processes control messages for backend node condition updates sent from the service.

    Listens on the control receive queue for messages that may contain updated node condition rules,
    as provided by the service.
    Upon receiving such a message, updates the runtime node condition rules in the
    conditions_controller and applies the new rules to all nodes by updating the resource database,
    and logs the update.

    Args:
        progress_writer: ProgressWriter instance for reporting status.
        control_receive_queue: Callback to receive control messages from the queue.
        node_send_queue: Callback for sending messages to node send queue.
        event_send_queue: Callback for sending messages to event send queue.
        api: Kubernetes CoreV1Api instance.
        node_cache: LRU TTL cache for node data.
        conditions_controller: ConditionsController instance managing node condition rules.
    """
    while True:
        try:
            # Wait for Control messages using threadsafe receive
            try:
                message_body = control_receive_queue()
            except osmo_errors.OSMOBackendError as e:
                # No message available, sleep and continue
                logging.info('No message available, sleeping and continuing %s', e)
                raise
            logging.info('Received message: %s', message_body)
            # Use MessageOptions pattern for type-safe message handling
            message_options = {
                message_body.type.value: message_body.body
            }
            message_option = backend_messages.MessageOptions(**message_options)

            if message_option.node_conditions:
                # Handle node conditions update messages using rules directly
                try:
                    new_rules: Dict[str, str] = getattr(message_option.node_conditions,
                                                        'rules', {}) or {}
                except AttributeError:
                    new_rules = {}

                # Ensure default Ready => True exists if no rule matches 'Ready'
                try:
                    has_ready_override = any(
                        re.match(pattern, 'Ready') for pattern in new_rules.keys())
                except re.error:
                    has_ready_override = False
                if not has_ready_override:
                    new_rules['^Ready$'] = 'True'

                # Apply rules in bulk
                conditions_controller.set_rules(new_rules)

                update_resource_database_to_service(node_send_queue, event_send_queue,
                                                    api, node_cache, conditions_controller,
                                                    progress_writer)
                helpers.send_log_through_queue(
                    backend_messages.LoggingType.INFO,
                    'Updated resource database with node condition rules',
                    event_send_queue)
            else:
                helpers.send_log_through_queue(
                    backend_messages.LoggingType.WARNING,
                    f'Unexpected message type for control updates: {message_body.type.value}',
                    event_send_queue)

        except json.JSONDecodeError as error:
            helpers.send_log_through_queue(
                backend_messages.LoggingType.WARNING,
                f'Failed to parse control message: {error}',
                event_send_queue)
        except KeyboardInterrupt:
            sys.exit(0)
        except Exception as error:  # pylint: disable=broad-except
            helpers.send_log_through_queue(
                backend_messages.LoggingType.EXCEPTION,
                f'Error processing control message: {error}',
                event_send_queue)


async def websocket_connect(progress_writer: progress.ProgressWriter,
                            config: objects.BackendListenerConfig,
                            message_queue: asyncio.Queue[backend_messages.MessageBody],
                            unack_messages: UnackMessages,
                            connection_type: WebSocketConnectionType,
                            uid: Any):
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
        progress_writer.report_progress()
        message = None
        try:
            async with websockets.connect(url, extra_headers=headers) as websocket:  # type: ignore
                await helpers.send_log_through_websocket(
                    backend_messages.LoggingType.INFO,
                    f'Successfully connected to {url}',
                    websocket)
                init_message = backend_messages.MessageBody(
                    type=backend_messages.MessageType.INIT,
                    body=backend_messages.InitBody(
                        k8s_uid=uid,
                        k8s_namespace=config.namespace,
                        version=str(version.VERSION),
                        node_condition_prefix=config.node_condition_prefix))
                await websocket.send(init_message.json())

                for message in unack_messages.list_messages():
                    await websocket.send(message.json())
                    progress_writer.report_progress()

                async def _send_message():
                    while True:
                        try:
                            message = await asyncio.wait_for(
                                message_queue.get(), timeout=TIMEOUT_SEC)
                            await unack_messages.add_message(message)
                            await websocket.send(message.json())
                            message_queue.task_done()
                            send_backend_message_transmission_count(
                                event_type=connection_type.value)
                        except asyncio.exceptions.TimeoutError:
                            pass
                        finally:
                            progress_writer.report_progress()

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
                            elif message_option.node_conditions:
                                await message_queue.put(message)
                            else:
                                logging.warning('Unknown message type: %s', message.type.value)

                        except pydantic.ValidationError as err:
                            logging.warning('Invalid message received from backend %s: %s',
                                            backend_name, str(err))
                        except asyncio.exceptions.TimeoutError:
                            pass
                        finally:
                            progress_writer.report_progress()

                # Control connections are receive-only, other connections need both send and receive
                if connection_type == WebSocketConnectionType.CONTROL:
                    # Control connection only receives messages
                    await _receive_message()
                else:
                    # Other connections send and receive messages
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
            send_websocket_disconnect_count(event_type=connection_type.value)
            await asyncio.sleep(3)  # Wait before reconnecting

            _, headers = await login.get_headers(config)


def get_backend_message_queue_length(queues: Dict[str, asyncio.Queue | UnackMessages], *args) \
        -> Iterable[otelmetrics.Observation]:
    '''Callback to send queue lengths for osmo service job queue'''
    # pylint: disable=unused-argument
    for queue_name, queue in queues.items():
        length = queue.qsize()
        yield otelmetrics.Observation(length, {'queue_type': queue_name})


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
    osmo_logging.init_logger('backend-listener', config)
    logging.getLogger('websockets.client').setLevel(logging.ERROR)
    listener_metrics = metrics.MetricCreator(config=config).get_meter_instance()

    # Get backend conditions from service instead of hardcoded config
    service_login = service_connector.OsmoServiceConnector(config.service_url,
                                                           config.backend, config)
    backend_config_payload = None
    if service_login:
        try:
            backend_config_payload = service_login.get_backend_config()
        except Exception as e:  # pylint: disable=broad-except
            logging.warning('Failed to retrieve backend conditions from service: %s', e)

    # Initialize shared ConditionsController with rules (singleton)
    init_rules: Dict[str, str] = {}
    if backend_config_payload:
        node_conditions = backend_config_payload.get('node_conditions', {})
        # Expect rules mapping directly
        init_rules = node_conditions.get('rules', {}) or {}
        logging.info('Retrieved backend condition rules from service: %s', init_rules)
    else:
        logging.warning('Failed to retrieve backend condition rules from service; using none')

    # Ensure default Ready => True exists if no provided rule matches 'Ready'
    try:
        has_ready_override = any(
            re.match(pattern, 'Ready') for pattern in init_rules.keys())
    except re.error:
        has_ready_override = False
    if not has_ready_override:
        init_rules['^Ready$'] = 'True'

    conditions_controller = ConditionsController(init_rules)

    cluster_api = get_thread_local_api(config)

    uid = cluster_api.read_namespace(name='kube-system').metadata.uid

    control_receive_queue: asyncio.Queue[backend_messages.MessageBody] = asyncio.Queue()
    pod_send_queue: asyncio.Queue[backend_messages.MessageBody] = asyncio.Queue()
    node_send_queue: asyncio.Queue[backend_messages.MessageBody] = asyncio.Queue()
    event_send_queue: asyncio.Queue[backend_messages.MessageBody] = asyncio.Queue()
    heartbeat_send_queue: asyncio.Queue[backend_messages.MessageBody] = asyncio.Queue()
    unack_control_messages = UnackMessages(WebSocketConnectionType.CONTROL,
                                           config.max_unacked_messages)
    unack_pod_messages = UnackMessages(WebSocketConnectionType.POD,
                                       config.max_unacked_messages)
    unack_node_messages = UnackMessages(WebSocketConnectionType.NODE,
                                        config.max_unacked_messages)
    unack_event_messages = UnackMessages(WebSocketConnectionType.EVENT,
                                         config.max_unacked_messages)
    unack_heartbeat_messages = UnackMessages(WebSocketConnectionType.HEARTBEAT,
                                             config.max_unacked_messages)

    backend_message_queues = {
        'control_receive_queue': control_receive_queue,
        'pod_send_queue': pod_send_queue,
        'node_send_queue': node_send_queue,
        'event_send_queue': event_send_queue,
        'heartbeat_send_queue': heartbeat_send_queue,
        'unack_control_messages': unack_control_messages,
        'unack_pod_messages': unack_pod_messages,
        'unack_node_messages': unack_node_messages,
        'unack_event_messages': unack_event_messages,
        'unack_heartbeat_messages': unack_heartbeat_messages,
    }

    listener_metrics.send_observable_gauge(
        'backend_listener_queue_length',
        callbacks=partial(get_backend_message_queue_length, backend_message_queues),
        description='Length of backend listener queues',
        unit='count')

    event_loop = asyncio.get_event_loop()

    # Create progress writers
    control_progress_writer = progress.ProgressWriter(
        os.path.join(config.progress_folder_path, config.control_progress_file))
    event_progress_writer = progress.ProgressWriter(
        os.path.join(config.progress_folder_path, config.event_progress_file))
    pod_progress_writer = progress.ProgressWriter(
        os.path.join(config.progress_folder_path, config.pod_progress_file))
    node_progress_writer = progress.ProgressWriter(
        os.path.join(config.progress_folder_path, config.node_progress_file))
    websocket_progress_writer = progress.ProgressWriter(
        os.path.join(config.progress_folder_path, config.websocket_progress_file))
    control_progress_writer.report_progress()
    event_progress_writer.report_progress()
    pod_progress_writer.report_progress()
    node_progress_writer.report_progress()
    websocket_progress_writer.report_progress()

    def threadsafe_send(send_queue: asyncio.Queue[backend_messages.MessageBody]):
        def threadsafe_send_impl(message: backend_messages.MessageBody):
            future = asyncio.run_coroutine_threadsafe(send_queue.put(message), event_loop)
            future.result()
        return threadsafe_send_impl

    def threadsafe_receive(receive_queue: asyncio.Queue):
        def threadsafe_receive_impl():
            try:
                # Use .get() with run_coroutine_threadsafe for proper async queue operations
                future = asyncio.run_coroutine_threadsafe(receive_queue.get(), event_loop)
                return future.result()
            except (asyncio.CancelledError, asyncio.InvalidStateError, RuntimeError) as e:
                # Queue operation failed, raise an exception to signal no message available
                raise osmo_errors.OSMOBackendError(f'Other exceptios: {e}')
        return threadsafe_receive_impl

    node_ttl_cache = LRUCacheTTL(config.node_event_cache_size, config.node_event_cache_ttl)
    # Refresh resource database to update existing nodes and remove non-existing nodes
    kube_pod_list, pod_list = await asyncio.to_thread(refresh_resource_database,
        threadsafe_send(node_send_queue), threadsafe_send(event_send_queue),
        cluster_api, node_ttl_cache, conditions_controller,
        config.list_pods_page_size, pod_progress_writer)

    try:

        control_read_thread = threading.Thread(
            target=get_service_control_updates,
            args=[control_progress_writer,
                  threadsafe_receive(control_receive_queue),
                  threadsafe_send(node_send_queue),
                  threadsafe_send(event_send_queue),
                  cluster_api,
                  node_ttl_cache,
                  conditions_controller],
            daemon=True)
        pod_thread = threading.Thread(
            target=watch_pod_events,
            args=[pod_progress_writer, threadsafe_send(pod_send_queue),
                  threadsafe_send(node_send_queue),
                  threadsafe_send(event_send_queue), config,
                  kube_pod_list, node_ttl_cache, pod_list,
                  conditions_controller],
            daemon=True)
        node_thread = threading.Thread(target=watch_node_events,
                                       args=[node_progress_writer,
                                             threadsafe_send(node_send_queue),
                                             threadsafe_send(event_send_queue),
                                             node_ttl_cache,
                                             conditions_controller,
                                             config],
                                       daemon=True)
        cluster_event_thread = threading.Thread(
            target=watch_backend_events,
            args=[event_progress_writer,
                  threadsafe_send(event_send_queue),
                  config],
            daemon=True)
        threads = [control_read_thread, pod_thread, node_thread, cluster_event_thread]

        for thread in threads:
            thread.start()

        await asyncio.gather(heartbeat(heartbeat_send_queue),
                             websocket_connect(websocket_progress_writer, config,
                                               control_receive_queue,
                                               unack_control_messages,
                                               WebSocketConnectionType.CONTROL,
                                               uid),
                             websocket_connect(websocket_progress_writer, config,
                                               pod_send_queue,
                                               unack_pod_messages,
                                               WebSocketConnectionType.POD,
                                               uid),
                             websocket_connect(websocket_progress_writer, config,
                                               node_send_queue,
                                               unack_node_messages,
                                               WebSocketConnectionType.NODE,
                                               uid),
                             websocket_connect(websocket_progress_writer, config,
                                               event_send_queue,
                                               unack_event_messages,
                                               WebSocketConnectionType.EVENT,
                                               uid),
                             websocket_connect(websocket_progress_writer, config,
                                               heartbeat_send_queue,
                                               unack_heartbeat_messages,
                                               WebSocketConnectionType.HEARTBEAT,
                                               uid))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == '__main__':
    asyncio.run(main())
