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

import datetime
import enum
import logging
from typing import Dict, List, Optional

import pydantic

from src.lib.utils import common, osmo_errors
from src.utils.job import jobs_base


class MetricsType(enum.Enum):
    COUNTER = 'COUNTER'
    HISTOGRAM = 'HISTOGRAM'


class LoggingType(enum.Enum):
    INFO = logging.INFO
    DEBUG = logging.DEBUG
    WARNING = logging.WARNING
    EXCEPTION = logging.ERROR


class MessageType(enum.Enum):
    """ Represents the message for backend manager. """
    INIT = 'init'
    POD_LOG = 'pod_log'
    UPDATE_POD = 'update_pod'
    RESOURCE = 'resource'
    RESOURCE_USAGE = 'resource_usage'
    DELETE_RESOURCE = 'delete_resource'
    NODE_HASH = 'node_hash'
    TASK_LIST = 'task_list'
    CONTAINER_NODE = 'container_node'
    MONITOR_POD = 'monitor_pod'
    POD_CONDITIONS = 'pod_conditions'
    HEARTBEAT = 'heartbeat'
    JOB_STATUS = 'job_status'
    METRICS = 'metrics'
    LOGGING = 'logging'
    POD_EVENT = 'pod_event'
    ACK = 'ack'
    NODE_CONDITIONS = 'node_conditions'

class LoggingBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the container log body. """
    type: LoggingType
    text: str
    workflow_uuid: str | None = None


class MessageBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """
    Used for Message Structure
    """
    type: MessageType
    body: Dict | LoggingBody
    uuid: str = pydantic.Field(default_factory=common.generate_unique_id)


class InitBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the log body. """
    k8s_uid: str
    k8s_namespace: str
    version: str
    node_condition_prefix: str


class PodLogBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the log body. """
    text: str
    task: str  # task_uuid
    retry_id: int
    mask: bool = True


class ConditionMessage(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the condition message body. """
    reason: str | None = None
    message: str | None = None
    timestamp: datetime.datetime
    status: bool
    type: str


class UpdatePodBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the update pod body. """
    workflow_uuid: str
    task_uuid: str
    retry_id: int
    container: str
    node: str | None = None
    pod_ip: str | None = None
    message: str = ''
    status: str
    exit_code: int | None
    backend: str
    conditions: List[ConditionMessage] = []


class ResourceBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the resource body. """
    hostname: str
    available: bool
    conditions: List[str] = []
    processed_fields: Dict = {}
    allocatable_fields: Dict
    label_fields: Dict
    taints: List[Dict] = []


class ResourceUsageBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the resource usage body. """
    hostname: str
    usage_fields: Dict
    non_workflow_usage_fields: Dict


class DeleteResourceBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the delete resource body. """
    resource: str


class NodeBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the node body. """
    node_hashes: List[str]


class TaskListBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the list of pod names. """
    task_list: List[str]


class MonitorPodBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the container log body. """
    workflow_uuid: str
    task_uuid: str
    retry_id: int
    message: str = ''


class HeartbeatBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the container log body. """
    time: datetime.datetime


class MetricsBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the container log body. """
    type: MetricsType
    value: float
    name: str
    unit: str
    description: str


class PodConditionsBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the pod conditions body. """
    workflow_uuid: str
    task_uuid: str
    retry_id: int
    conditions: List[ConditionMessage] = []


class PodEventBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the pod event body. """
    pod_name: str
    reason: str
    timestamp: datetime.datetime
    message: str


class NodeConditionsBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """
    Body for node conditions messages from service to backend listener.
    """
    available_conditions: List[str]|None = None
    ignore_conditions: List[str]|None = None


class AckBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """
    Body for acknowledgment messages from service back to backend listener.
    """
    uuid: str


class MessageOptions(pydantic.BaseModel):
    """ Message options """
    init: Optional[InitBody] = pydantic.Field(
        description='Message for websocket init')
    pod_log: Optional[PodLogBody] = pydantic.Field(
        description='Message for error_logs')
    update_pod: Optional[UpdatePodBody] = pydantic.Field(
        description='Message for events')
    monitor_pod: Optional[MonitorPodBody] = pydantic.Field(
        description='Message for monitoring pod')
    resource: Optional[ResourceBody] = pydantic.Field(
        description='Message for resource change')
    resource_usage: Optional[ResourceUsageBody] = pydantic.Field(
        description='Message for resource usage change')
    delete_resource: Optional[DeleteResourceBody] = pydantic.Field(
        description='Message for resource change')
    node_hash: Optional[NodeBody] = pydantic.Field(
        description='Message for list of current nodes')
    task_list: Optional[TaskListBody] = pydantic.Field(
        description='Message for list of current pods in backend based on the task_uuids')
    heartbeat: Optional[HeartbeatBody] = pydantic.Field(
        description='Message for service heartbeat')
    job_status: Optional[jobs_base.JobResult] = pydantic.Field(
        description='Message of job status')
    metrics: Optional[MetricsBody] = pydantic.Field(
        description='Message to send metrics')
    logging: Optional[LoggingBody] = pydantic.Field(
        description='Message to send logs')
    pod_conditions: Optional[PodConditionsBody] = pydantic.Field(
        description='Message to send pod conditions')
    pod_event: Optional[PodEventBody] = pydantic.Field(
        description='Message to send pod event')
    ack: Optional[AckBody] = pydantic.Field(
        description='Message for acknowledgment')
    node_conditions: Optional[NodeConditionsBody] = pydantic.Field(
        description='Message for node conditions')

    @pydantic.root_validator(pre=True)
    def validate(cls, values):  # pylint: disable=no-self-argument
        """ A valid message can only be one of the two types """
        num_fields_set = sum(1 for value in values.values()
                             if value is not None)
        if num_fields_set != 1:
            raise osmo_errors.OSMOUserError(
                f'Exactly one of the following must be set {cls.__fields__.keys()}')
        return values
