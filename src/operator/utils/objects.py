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

from typing import List, Literal

import pydantic

from src.lib.utils import logging, login
from src.operator.utils.node_validation_test import test_base
from src.utils.metrics import metrics
from src.utils import static_config



class BackendBaseConfig(logging.LoggingConfig, login.LoginConfig,
                       static_config.StaticConfig):
    """Base configuration class for backend services with common service connector fields"""
    service_url: str = pydantic.Field(
        default='http://127.0.0.1:8000',
        description='The osmo service url to connect to.',
        json_schema_extra={'command_line': 'host'})
    backend: str = pydantic.Field(
        default='osmo-backend',
        description='The backend to connect to.',
        json_schema_extra={'command_line': 'backend', 'env': 'BACKEND'})
    namespace: str = pydantic.Field(
        description='The namespace for this backend.',
        json_schema_extra={'command_line': 'namespace'})
    method: Literal['dev'] | None = pydantic.Field(
        default=None,
        description='Login method',
        json_schema_extra={'command_line': 'method'})


class BackendListenerConfig(BackendBaseConfig, metrics.MetricsCreatorConfig):
    """Configuration for the backend listener service that monitors Kubernetes resources"""
    include_namespace_usage: List[str] = pydantic.Field(
        default=[],
        description='The namespaces of pods to include in node usage.',
        json_schema_extra={'command_line': 'include_namespace_usage'})
    progress_folder_path: str = pydantic.Field(
        default='/var/run/osmo',
        description='The folder path to write progress timestamps to (For liveness/startup probes)',
        json_schema_extra={
            'command_line': 'progress_folder_path',
            'env': 'OSMO_PROGRESS_FOLDER_PATH'
        })
    node_progress_file: str = pydantic.Field(
        default='last_progress_node',
        description='The file to write node watch progress timestamps to (For liveness/startup ' +
                    'probes)',
        json_schema_extra={'command_line': 'node_progress_file', 'env': 'OSMO_NODE_PROGRESS_FILE'})
    pod_progress_file: str = pydantic.Field(
        default='last_progress_pod',
        description='The file to write pod watch progress timestamps to (For liveness/startup ' +
                    'probes)',
        json_schema_extra={'command_line': 'pod_progress_file', 'env': 'OSMO_POD_PROGRESS_FILE'})
    event_progress_file: str = pydantic.Field(
        default='last_progress_event',
        description='The file to write event watch progress timestamps to (For liveness/startup ' +
                    'probes)',
        json_schema_extra={
            'command_line': 'event_progress_file',
            'env': 'OSMO_EVENT_PROGRESS_FILE'
        })
    control_progress_file: str = pydantic.Field(
        default='last_progress_control',
        description='The file to write control progress timestamps to ' +
                    '(For liveness/startup probes)',
        json_schema_extra={
            'command_line': 'control_progress_file',
            'env': 'OSMO_CONTROL_PROGRESS_FILE'
        })
    websocket_progress_file: str = pydantic.Field(
        default='last_progress_websocket',
        description='The file to write websocket progress timestamps to (For liveness/startup ' +
                    'probes)',
        json_schema_extra={
            'command_line': 'websocket_progress_file',
            'env': 'OSMO_WEBSOCKET_PROGRESS_FILE'
        })
    pod_event_cache_size: int = pydantic.Field(
        default=1024,
        description='The size of the cache for tracking pod status updates.',
        json_schema_extra={'command_line': 'pod_event_cache_size', 'env': 'POD_EVENT_CACHE_SIZE'})
    pod_event_cache_ttl: int = pydantic.Field(
        default=15,
        description='The duration a cache entry for a pod status update stays in the cache '
                    '(in minutes). If set to 0, TTL is disabled, and pod status will be '
                    'cached perpetually.',
        json_schema_extra={'command_line': 'pod_event_cache_ttl', 'env': 'POD_EVENT_CACHE_TTL'})
    node_event_cache_size: int = pydantic.Field(
        default=1024,
        description='The size of the cache for tracking node updates.',
        json_schema_extra={'command_line': 'node_event_cache_size', 'env': 'NODE_EVENT_CACHE_SIZE'})
    node_event_cache_ttl: int = pydantic.Field(
        default=15,
        description='The duration a cache entry for a node updates stays in the cache '
                    '(in minutes). If set to 0, TTL is disabled, and node status will be '
                    'cached perpetually.',
        json_schema_extra={'command_line': 'node_event_cache_ttl', 'env': 'NODE_EVENT_CACHE_TTL'})
    backend_event_cache_size: int = pydantic.Field(
        default=1024,
        description='The size of the cache for deduplicating backend updates.',
        json_schema_extra={
            'command_line': 'backend_event_cache_size',
            'env': 'BACKEND_EVENT_CACHE_SIZE'
        })
    max_unacked_messages: int = pydantic.Field(
        default=100,
        description='Threshold for number of unacknowledged messages to determine whether to '
                    'throttle sending messages. This should be smaller than "agent_queue_size"',
        json_schema_extra={'command_line': 'max_unacked_messages', 'env': 'MAX_UNACKED_MESSAGES'})
    node_condition_prefix: str = pydantic.Field(
        default=test_base.DEFAULT_NODE_CONDITION_PREFIX,
        description='Prefix for node conditions',
        json_schema_extra={'command_line': 'node_condition_prefix'})
    enable_node_label_update: bool = pydantic.Field(
        default=False,
        description='Enable updating the node_condition_prefix/verified node label based on '
                    'node availability determined by node conditions.',
        json_schema_extra={
            'command_line': 'enable_node_label_update',
            'env': 'ENABLE_NODE_LABEL_UPDATE'
        })
    list_pods_page_size: int = pydantic.Field(
        default=1000,
        description='The number of pods to list in a single page when listing pods.',
        json_schema_extra={'command_line': 'list_pods_page_size', 'env': 'LIST_PODS_PAGE_SIZE'})
    refresh_resource_state_interval: int = pydantic.Field(
        default=300,
        description='The number of seconds since last successful event fetch before triggering a '
                    'refresh of the resource state.',
        json_schema_extra={
            'command_line': 'refresh_resource_state_interval',
            'env': 'REFRESH_RESOURCE_STATE_INTERVAL'
        })
    api_qps: int = pydantic.Field(
        default=20,
        description='Kubernetes API client QPS (queries per second) setting. Controls the '
                    'sustained rate of API requests. Default is 20 (Kubernetes default is 5).',
        json_schema_extra={'command_line': 'api_qps', 'env': 'OSMO_API_QPS'})
    api_burst: int = pydantic.Field(
        default=30,
        description='Kubernetes API client burst setting. Allows temporary bursts above the QPS '
                    'limit. Default is 30 (Kubernetes default is 10).',
        json_schema_extra={'command_line': 'api_burst', 'env': 'OSMO_API_BURST'})


class BackendWorkerConfig(BackendBaseConfig, metrics.MetricsCreatorConfig):
    """Configuration for the backend worker service that executes jobs"""
    test_runner_namespace: str = pydantic.Field(
        default='osmo-test',
        description='The namespace for the test runner.',
        json_schema_extra={'command_line': 'test_runner_namespace'})
    test_runner_cronjob_spec_file: str = pydantic.Field(
        default='test_runner_cronjob_spec/spec.yaml',
        description='Path to the test runner cronjob specification YAML file',
        json_schema_extra={
            'command_line': 'test_runner_cronjob_spec_file',
            'env': 'TEST_RUNNER_CRONJOB_SPEC_FILE'
        })
    progress_folder_path: str = pydantic.Field(
        default='/var/run/osmo',
        description='The folder path to write progress timestamps to (For liveness/startup probes)',
        json_schema_extra={
            'command_line': 'progress_folder_path',
            'env': 'OSMO_PROGRESS_FOLDER_PATH'
        })
    worker_heartbeat_progress_file: str = pydantic.Field(
        default='last_progress_worker_heartbeat',
        description='The file to write worker heartbeat progress timestamps to (For ' +
                    'liveness/startup probes)',
        json_schema_extra={
            'command_line': 'worker_heartbeat_progress_file',
            'env': 'OSMO_WORKER_HEARTBEAT_PROGRESS_FILE'
        })
    worker_job_progress_file: str = pydantic.Field(
        default='last_progress_worker_job',
        description='The file to write worker job progress timestamps to (For liveness/startup ' +
                    'probes)',
        json_schema_extra={
            'command_line': 'worker_job_progress_file',
            'env': 'OSMO_WORKER_JOB_PROGRESS_FILE'
        })
    progress_iter_frequency: str = pydantic.Field(
        default='15s',
        description='How often to write to progress file when processing tasks in a loop ('
                    'e.g. write to progress every 100 tasks processed, like uploaded to DB)',
        json_schema_extra={
            'command_line': 'progress_iter_frequency',
            'env': 'OSMO_PROGRESS_ITER_FREQUENCY'
        })
    node_condition_prefix: str = pydantic.Field(
        default=test_base.DEFAULT_NODE_CONDITION_PREFIX,
        description='Prefix for node conditions',
        json_schema_extra={'command_line': 'node_condition_prefix'})


class TestRunnerConfig(BackendBaseConfig):
    """Configuration for resource tests."""
    test_name: str = pydantic.Field(
        description='Name of the test to run',
        json_schema_extra={'command_line': 'backend_test_name', 'env': 'BACKEND_TEST_NAME'})
    namespace: str = pydantic.Field(
        description='Kubernetes namespace to run test in',
        json_schema_extra={'command_line': 'namespace', 'env': 'NAMESPACE'})
    node_condition_prefix: str = pydantic.Field(
        default=test_base.DEFAULT_NODE_CONDITION_PREFIX,
        description='Prefix for node conditions',
        json_schema_extra={'env': 'NODE_CONDITION_PREFIX', 'command_line': 'node_condition_prefix'})
    prefix: str = pydantic.Field(
        default='osmo',
        description='Prefix for daemonset names',
        json_schema_extra={'command_line': 'prefix', 'env': 'PREFIX'})
    read_from_osmo: bool = pydantic.Field(
        default=True,
        description='Whether to read test config from OSMO service',
        json_schema_extra={'command_line': 'read_from_osmo'})
    read_from_file: str | None = pydantic.Field(
        default='/tmp/test_config.json',
        description='Whether to read test config from file',
        json_schema_extra={'command_line': 'read_from_file'})
    service_account: str | None = pydantic.Field(
        default='test-runner',
        description='Service account name to use for the daemonset pods',
        json_schema_extra={'command_line': 'service_account', 'env': 'SERVICE_ACCOUNT'})

    @pydantic.model_validator(mode='before')
    @classmethod
    def validate_config_source(cls, values):
        read_from_osmo = values.get('read_from_osmo', True)
        service_url = values.get('service_url')
        read_from_file = values.get('read_from_file')

        # If reading from OSMO, service_url is required
        if read_from_osmo:
            if not service_url:
                raise ValueError('service_url is required when read_from_osmo is True')
        else:
            # If not reading from OSMO, read_from_file is required
            if not read_from_file:
                raise ValueError('read_from_file is required when read_from_osmo is False')

        return values
