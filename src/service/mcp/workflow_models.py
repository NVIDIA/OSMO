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

from collections.abc import Sequence
from typing import Annotated, Literal

import pydantic

from src.service.mcp.tool_models import ClosedToolModel, PageLimit, PageOffset


__all__ = (
    'GetWorkflowResult',
    'LastNLines',
    'ListWorkflowsResult',
    'PageLimit',
    'PageOffset',
    'QueryText',
    'QueryTextList',
    'RetryId',
    'WorkflowDetail',
    'WorkflowEventsResult',
    'WorkflowGroup',
    'WorkflowId',
    'WorkflowLogsResult',
    'WorkflowPriorities',
    'WorkflowPriority',
    'WorkflowSpecResult',
    'WorkflowStatus',
    'WorkflowStatuses',
    'WorkflowSummary',
    'WorkflowTask',
)


MAX_QUERY_TEXT_BYTES = 512
MAX_QUERY_VALUES = 50
WORKFLOW_ID_PATTERN = r'[A-Za-z](?:[A-Za-z0-9_-]*[A-Za-z0-9])?-[0-9]+'

LastNLines = Annotated[pydantic.StrictInt, pydantic.Field(ge=1, le=10_000)]
RetryId = Annotated[pydantic.StrictInt, pydantic.Field(ge=0, le=1_000_000)]
QueryText = Annotated[str, pydantic.Field(min_length=1, max_length=512)]
WorkflowId = Annotated[
    str,
    pydantic.Field(
        min_length=3,
        max_length=512,
        pattern=f'^{WORKFLOW_ID_PATTERN}$',
        description='Canonical OSMO workflow ID; UUID lookup is not supported.',
    ),
]
QueryTextList = Annotated[
    list[QueryText],
    pydantic.Field(min_length=1, max_length=MAX_QUERY_VALUES),
]
WorkflowStatus = Literal[
    'RUNNING',
    'PENDING',
    'WAITING',
    'COMPLETED',
    'FAILED',
    'FAILED_EXEC_TIMEOUT',
    'FAILED_SERVER_ERROR',
    'FAILED_QUEUE_TIMEOUT',
    'FAILED_SUBMISSION',
    'FAILED_CANCELED',
    'FAILED_BACKEND_ERROR',
    'FAILED_IMAGE_PULL',
    'FAILED_EVICTED',
    'FAILED_START_ERROR',
    'FAILED_START_TIMEOUT',
    'FAILED_PREEMPTED',
]
WorkflowStatuses = Annotated[
    list[WorkflowStatus],
    pydantic.Field(min_length=1, max_length=MAX_QUERY_VALUES),
]
WorkflowPriority = Literal['HIGH', 'NORMAL', 'LOW']
WorkflowPriorities = Annotated[
    list[WorkflowPriority],
    pydantic.Field(min_length=1, max_length=3),
]

WORKFLOW_STATUSES = frozenset(
    pydantic.TypeAdapter(WorkflowStatus).json_schema()['enum']
)
WORKFLOW_PRIORITIES = frozenset(('HIGH', 'NORMAL', 'LOW'))


class WorkflowSummary(ClosedToolModel):
    """Stable, non-secret fields from one workflow-list entry."""

    user: str
    name: str
    workflow_uuid: str
    submit_time: str
    status: str
    priority: str
    pool: str | None = None
    overview: str | None = None
    app_owner: str | None = None
    app_name: str | None = None
    app_version: int | None = None


class WorkflowTask(ClosedToolModel):
    """Task state returned as part of a workflow query."""

    name: str
    retry_id: int
    status: str
    failure_message: str | None = None
    exit_code: int | None = None
    start_time: str | None = None
    end_time: str | None = None
    node_name: str | None = None
    lead: bool = False


class WorkflowGroup(ClosedToolModel):
    """Task-group state returned as part of a workflow query."""

    name: str
    status: str
    failure_message: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    tasks: Sequence[WorkflowTask]


class WorkflowDetail(ClosedToolModel):
    """Bounded workflow status and task metadata, excluding embedded specs."""

    name: str
    uuid: str
    submitted_by: str
    submit_time: str
    status: str
    priority: str
    cancelled_by: str | None = None
    parent_name: str | None = None
    parent_job_id: int | None = None
    tags: list[str]
    start_time: str | None = None
    end_time: str | None = None
    pool: str | None = None
    backend: str | None = None
    app_owner: str | None = None
    app_name: str | None = None
    app_version: int | None = None
    overview: str | None = None
    groups: Sequence[WorkflowGroup]


class _UpstreamWorkflowSummary(WorkflowSummary):
    model_config = pydantic.ConfigDict(extra='ignore')


class _UpstreamWorkflowTask(WorkflowTask):
    model_config = pydantic.ConfigDict(extra='ignore')


class _UpstreamWorkflowGroup(WorkflowGroup):
    model_config = pydantic.ConfigDict(extra='ignore')

    tasks: list[_UpstreamWorkflowTask]


class _UpstreamWorkflowDetail(WorkflowDetail):
    model_config = pydantic.ConfigDict(extra='ignore')

    groups: list[_UpstreamWorkflowGroup]


class _UpstreamWorkflowPage(ClosedToolModel):
    workflows: list[_UpstreamWorkflowSummary]
    more_entries: bool


class ListWorkflowsResult(ClosedToolModel):
    workflows: list[WorkflowSummary]
    count: int
    more_entries: bool
    offset: int
    limit: int


class GetWorkflowResult(ClosedToolModel):
    workflow: WorkflowDetail


class WorkflowLogsResult(ClosedToolModel):
    workflow_id: str
    task_name: str | None
    retry_id: int | None
    error_logs: bool
    logs: str
    truncated: bool
    truncation_reason: str | None


class WorkflowEventsResult(ClosedToolModel):
    workflow_id: str
    task_name: str | None
    retry_id: int | None
    events: str
    truncated: bool
    truncation_reason: str | None


class WorkflowSpecResult(ClosedToolModel):
    workflow_id: str
    use_template: bool
    spec: str
    truncated: bool
    truncation_reason: str | None
