"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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
import json
import os
from typing import List

import pydantic

from src.utils import backend_messages

STATUS_TOKEN_ENV = 'OSMO_TASKGROUP_STATUS_TOKEN'


class TaskStatusCondition(pydantic.BaseModel, extra='forbid'):
    """Condition reported by the OSMOTaskGroup controller for a runtime pod."""
    type: str
    status: str
    reason: str | None = None
    message: str | None = None
    timestamp: datetime.datetime | None = None


class TaskStatusUpdate(pydantic.BaseModel, extra='forbid'):
    """Per-task status update reported through the TaskGroupStatusService."""
    workflow_uuid: str
    task_uuid: str
    retry_id: int
    container: str = ''
    node: str | None = None
    pod_ip: str | None = None
    message: str = ''
    status: str
    exit_code: int | None = None
    backend: str = ''
    conditions: List[TaskStatusCondition] = pydantic.Field(default_factory=list)


class ReportOTGStatusRequest(pydantic.BaseModel, extra='forbid'):
    """API-server status ingestion payload forwarded from gRPC."""
    namespace: str
    name: str
    workflow_uuid: str = ''
    group_uuid: str = ''
    phase: str = ''
    status_json: str = ''
    task_status_updates: List[TaskStatusUpdate] = pydantic.Field(default_factory=list)


class ReportOTGStatusResponse(pydantic.BaseModel, extra='forbid'):
    """Response for accepted OSMOTaskGroup status reports."""
    accepted: bool
    updates: int


def backend_updates_from_report(
        report: ReportOTGStatusRequest) -> List[backend_messages.UpdatePodBody]:
    """Convert a status report into existing backend pod update messages."""
    updates = list(report.task_status_updates)
    if not updates:
        updates = task_updates_from_status_json(report.status_json)
    return [backend_update_from_task_update(update) for update in updates]


def task_updates_from_status_json(status_json: str) -> List[TaskStatusUpdate]:
    """Extract per-task updates from the serialized CR status runtimeStatus."""
    if not status_json:
        return []
    status_payload = json.loads(status_json)
    runtime_status = status_payload.get('runtimeStatus') or {}
    raw_updates = runtime_status.get('task_status_updates') or []
    return [TaskStatusUpdate(**update) for update in raw_updates]


def backend_update_from_task_update(
        update: TaskStatusUpdate) -> backend_messages.UpdatePodBody:
    return backend_messages.UpdatePodBody(
        workflow_uuid=update.workflow_uuid,
        task_uuid=update.task_uuid,
        retry_id=update.retry_id,
        container=update.container,
        node=empty_to_none(update.node),
        pod_ip=empty_to_none(update.pod_ip),
        message=update.message,
        status=update.status,
        exit_code=normalized_exit_code(update),
        backend=update.backend,
        conditions=[
            backend_messages.ConditionMessage(
                type=condition.type,
                status=condition.status,
                reason=condition.reason,
                message=condition.message,
                timestamp=condition.timestamp or datetime.datetime.now(datetime.timezone.utc),
            )
            for condition in update.conditions
        ],
    )


def normalized_exit_code(update: TaskStatusUpdate) -> int | None:
    if update.exit_code is None or update.exit_code < 0:
        return None
    if update.status not in ('COMPLETED', 'FAILED') and update.exit_code == 0:
        return None
    return update.exit_code


def empty_to_none(value: str | None) -> str | None:
    if value == '':
        return None
    return value


def is_valid_status_token(header_value: str | None) -> bool:
    expected_token = os.environ.get(STATUS_TOKEN_ENV)
    if not expected_token:
        return False
    return header_value == expected_token
