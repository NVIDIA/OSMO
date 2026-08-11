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

import re

from mcp.server.fastmcp import Context

import src.lib.utils.workflow_labels as shared_labels
from src.service.mcp import (
    access_scope,
    gateway,
    tool_errors,
    tool_requests,
    tool_validation,
)
from src.service.mcp.workflow_models import (
    MAX_QUERY_TEXT_BYTES as _MAX_QUERY_TEXT_BYTES,
    MAX_QUERY_VALUES as _MAX_QUERY_VALUES,
    MAX_WORKFLOW_LABEL_KEY_BYTES as _MAX_WORKFLOW_LABEL_KEY_BYTES,
    MAX_WORKFLOW_LABEL_SELECTOR_BYTES as _MAX_WORKFLOW_LABEL_SELECTOR_BYTES,
    WORKFLOW_ID_PATTERN as _WORKFLOW_ID_PATTERN,
    WORKFLOW_PRIORITIES as _WORKFLOW_PRIORITIES,
    WORKFLOW_STATUSES as _WORKFLOW_STATUSES,
    GetWorkflowResult,
    LastNLines,
    ListWorkflowsResult,
    PageLimit,
    PageOffset,
    QueryText,
    QueryTextList,
    RetryId,
    WorkflowDetail,
    WorkflowEventsResult,
    WorkflowGroup,
    WorkflowId,
    WorkflowLabelKeys,
    WorkflowLabelSelectors,
    WorkflowLogsResult,
    WorkflowPageLimit,
    WorkflowPriority,
    WorkflowPriorities,
    WorkflowSpecResult,
    WorkflowStatus,
    WorkflowStatuses,
    WorkflowSummary,
    WorkflowTask,
    _UpstreamWorkflowDetail,
    _UpstreamWorkflowPage,
)


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
    'WorkflowPageLimit',
    'WorkflowPriorities',
    'WorkflowPriority',
    'WorkflowSpecResult',
    'WorkflowStatus',
    'WorkflowStatuses',
    'WorkflowSummary',
    'WorkflowTask',
    'workflow_path',
    'workflow_path_segment',
    'osmo_get_workflow',
    'osmo_get_workflow_events',
    'osmo_get_workflow_logs',
    'osmo_get_workflow_spec',
    'osmo_list_workflows',
)


_WORKFLOWS_PATH = '/api/workflow'
_MAX_JSON_RESPONSE_BYTES = 1024 * 1024
_MAX_TEXT_RESPONSE_BYTES = 32 * 1024
_MAX_QUERY_BYTES = 16 * 1024


async def osmo_list_workflows(
    context: Context,
    status: WorkflowStatuses | None = None,
    name: QueryText | None = None,
    pool: QueryTextList | None = None,
    tags: QueryTextList | None = None,
    app: QueryText | None = None,
    priority: WorkflowPriorities | None = None,
    labels: WorkflowLabelSelectors | None = None,
    no_labels: WorkflowLabelKeys | None = None,
    limit: WorkflowPageLimit = 50,
    offset: PageOffset = 0,
) -> ListWorkflowsResult:
    """List the active user's workflows across accessible pools, newest first."""
    tool_validation.validate_page(
        limit,
        offset,
        maximum_limit=50,
    )
    query: dict[str, gateway.QueryValue] = {
        'limit': limit,
        'offset': offset,
        'order': 'DESC',
    }
    requested_pools = (
        tool_validation.validate_query_values(
            pool,
            field='pool',
            max_count=_MAX_QUERY_VALUES,
            max_value_bytes=_MAX_QUERY_TEXT_BYTES,
        )
        if pool is not None
        else None
    )
    if status is not None:
        statuses = tool_validation.validate_query_values(
            status,
            field='status',
            max_count=_MAX_QUERY_VALUES,
            max_value_bytes=_MAX_QUERY_TEXT_BYTES,
        )
        if any(value not in _WORKFLOW_STATUSES for value in statuses):
            raise tool_errors.PublicToolError('Invalid workflow status.')
        query['statuses'] = statuses
    if name is not None:
        query['name'] = tool_validation.validate_query_text(
            name,
            field='name',
            max_bytes=_MAX_QUERY_TEXT_BYTES,
        )
    if tags is not None:
        query['tags'] = tool_validation.validate_query_values(
            tags,
            field='tags',
            max_count=_MAX_QUERY_VALUES,
            max_value_bytes=_MAX_QUERY_TEXT_BYTES,
        )
    if app is not None:
        query['app'] = tool_validation.validate_query_text(
            app,
            field='app',
            max_bytes=_MAX_QUERY_TEXT_BYTES,
        )
    if priority is not None:
        priorities = tool_validation.validate_query_values(
            priority,
            field='priority',
            max_count=_MAX_QUERY_VALUES,
            max_value_bytes=_MAX_QUERY_TEXT_BYTES,
        )
        if any(value not in _WORKFLOW_PRIORITIES for value in priorities):
            raise tool_errors.PublicToolError('Invalid workflow priority.')
        query['priority'] = priorities
    if labels is not None:
        query['label'] = _validate_label_selectors(labels)
    if no_labels is not None:
        query['no_label'] = _validate_missing_label_keys(no_labels)

    scope = await access_scope.request_access_scope(context)
    if requested_pools is not None:
        if any(
            pool_name not in scope.pool_names
            for pool_name in requested_pools
        ):
            raise tool_errors.PublicToolError(
                'One or more requested pools are not accessible.'
            )
        selected_pools = requested_pools
    else:
        selected_pools = list(scope.pools)
    if not selected_pools:
        return ListWorkflowsResult(
            workflows=[],
            count=0,
            more_entries=False,
            offset=offset,
            limit=limit,
        )
    query['pools'] = selected_pools
    tool_validation.validate_query_size(
        query,
        operation='Workflow query',
        max_bytes=_MAX_QUERY_BYTES,
    )

    response = await tool_requests.request_json_object(
        context,
        path=_WORKFLOWS_PATH,
        operation='list workflows',
        max_response_bytes=_MAX_JSON_RESPONSE_BYTES,
        query=query,
    )
    page = tool_validation.validate_response(
        _UpstreamWorkflowPage,
        response,
        operation='list workflows',
    )
    summaries = [
        WorkflowSummary.model_validate(item.model_dump(), strict=True)
        for item in page.workflows
    ]
    return ListWorkflowsResult(
        workflows=summaries,
        count=len(summaries),
        more_entries=page.more_entries,
        offset=offset,
        limit=limit,
    )


async def osmo_get_workflow(
    context: Context,
    workflow_id: WorkflowId,
    verbose: bool = False,
    skip_groups: bool = False,
) -> GetWorkflowResult:
    """Get one workflow's status, task groups, and task metadata."""
    path = workflow_path(workflow_id)
    query: dict[str, bool] = {}
    if verbose:
        query['verbose'] = True
    if skip_groups:
        query['skip_groups'] = True
    response = await tool_requests.request_json_object(
        context,
        path=path,
        operation='get a workflow',
        max_response_bytes=_MAX_JSON_RESPONSE_BYTES,
        query=query or None,
    )
    upstream = tool_validation.validate_response(
        _UpstreamWorkflowDetail,
        response,
        operation='get a workflow',
    )
    workflow = WorkflowDetail.model_validate(upstream.model_dump(), strict=True)
    return GetWorkflowResult(workflow=workflow)


async def osmo_get_workflow_logs(
    context: Context,
    workflow_id: WorkflowId,
    task_name: QueryText | None = None,
    error_logs: bool = False,
    last_n_lines: LastNLines | None = None,
    retry_id: RetryId | None = None,
) -> WorkflowLogsResult:
    """Get bounded workflow or task logs; error/retry logs require a task."""
    path = workflow_path(
        workflow_id,
        suffix='error_logs' if error_logs else 'logs',
    )
    validated_task_name = _validate_task_controls(
        task_name=task_name,
        retry_id=retry_id,
        error_logs=error_logs,
    )
    tool_validation.validate_optional_integer(
        last_n_lines,
        field='last_n_lines',
        minimum=1,
        maximum=10_000,
    )
    query: dict[str, gateway.QueryValue] = {}
    if validated_task_name is not None:
        query['task_name'] = validated_task_name
    if last_n_lines is not None:
        query['last_n_lines'] = last_n_lines
    if retry_id is not None:
        query['retry_id'] = retry_id
    logs_result = await tool_requests.request_truncated_text(
        context,
        path=path,
        operation='get workflow logs',
        max_response_bytes=_MAX_TEXT_RESPONSE_BYTES,
        query=query or None,
    )
    return WorkflowLogsResult(
        workflow_id=workflow_id,
        task_name=validated_task_name,
        retry_id=retry_id,
        error_logs=error_logs,
        logs=logs_result.text,
        truncated=logs_result.truncated,
        truncation_reason=logs_result.truncation_reason,
    )


async def osmo_get_workflow_events(
    context: Context,
    workflow_id: WorkflowId,
    task_name: QueryText | None = None,
    retry_id: RetryId | None = None,
) -> WorkflowEventsResult:
    """Get bounded workflow scheduling and lifecycle events."""
    path = workflow_path(workflow_id, suffix='events')
    validated_task_name = _validate_task_controls(
        task_name=task_name,
        retry_id=retry_id,
        error_logs=False,
    )
    query: dict[str, gateway.QueryValue] = {}
    if validated_task_name is not None:
        query['task_name'] = validated_task_name
    if retry_id is not None:
        query['retry_id'] = retry_id
    events_result = await tool_requests.request_truncated_text(
        context,
        path=path,
        operation='get workflow events',
        max_response_bytes=_MAX_TEXT_RESPONSE_BYTES,
        query=query or None,
    )
    return WorkflowEventsResult(
        workflow_id=workflow_id,
        task_name=validated_task_name,
        retry_id=retry_id,
        events=events_result.text,
        truncated=events_result.truncated,
        truncation_reason=events_result.truncation_reason,
    )


async def osmo_get_workflow_spec(
    context: Context,
    workflow_id: WorkflowId,
    use_template: bool = False,
) -> WorkflowSpecResult:
    """Get a bounded, redacted workflow YAML spec."""
    path = workflow_path(workflow_id, suffix='spec')
    spec_result = await tool_requests.request_truncated_text(
        context,
        path=path,
        operation='get a workflow spec',
        max_response_bytes=_MAX_TEXT_RESPONSE_BYTES,
        query={'use_template': use_template},
    )
    return WorkflowSpecResult(
        workflow_id=workflow_id,
        use_template=use_template,
        spec=spec_result.text,
        truncated=spec_result.truncated,
        truncation_reason=spec_result.truncation_reason,
    )


def workflow_path(
    workflow_id: str,
    *,
    suffix: str | None = None,
) -> str:
    """Build a fixed Core workflow route from one canonical ID."""
    encoded_workflow_id = workflow_path_segment(workflow_id)
    path = f'{_WORKFLOWS_PATH}/{encoded_workflow_id}'
    return f'{path}/{suffix}' if suffix is not None else path


def workflow_path_segment(workflow_id: str) -> str:
    """Validate and encode one canonical workflow ID for a fixed route."""
    if re.fullmatch(_WORKFLOW_ID_PATTERN, workflow_id) is None:
        raise tool_errors.PublicToolError('Invalid workflow_id.')
    return tool_validation.safe_path_segment(
        workflow_id,
        field='workflow_id',
    )


def _validate_task_controls(
    *,
    task_name: str | None,
    retry_id: int | None,
    error_logs: bool,
) -> str | None:
    validated_task_name = None
    if task_name is not None:
        validated_task_name = tool_validation.validate_query_text(
            task_name,
            field='task_name',
            max_bytes=_MAX_QUERY_TEXT_BYTES,
        )
    tool_validation.validate_optional_integer(
        retry_id,
        field='retry_id',
        minimum=0,
        maximum=1_000_000,
    )
    if error_logs and validated_task_name is None:
        raise tool_errors.PublicToolError(
            'task_name is required when error_logs is true.'
        )
    if retry_id is not None and validated_task_name is None:
        raise tool_errors.PublicToolError(
            'task_name is required when retry_id is set.'
        )
    return validated_task_name


def _validate_label_selectors(values: list[str]) -> list[str]:
    """Validate Core-compatible workflow label selectors."""
    validated = tool_validation.validate_query_values(
        values,
        field='labels',
        max_count=_MAX_QUERY_VALUES,
        max_value_bytes=_MAX_WORKFLOW_LABEL_SELECTOR_BYTES,
    )
    try:
        for selector in validated:
            shared_labels.parse_workflow_label_selector(selector)
    except ValueError as error:
        raise tool_errors.PublicToolError('Invalid labels.') from error
    return validated


def _validate_missing_label_keys(values: list[str]) -> list[str]:
    """Validate Core-compatible absent workflow label keys."""
    validated = tool_validation.validate_query_values(
        values,
        field='no_labels',
        max_count=_MAX_QUERY_VALUES,
        max_value_bytes=_MAX_WORKFLOW_LABEL_KEY_BYTES,
    )
    try:
        for key in validated:
            shared_labels.validate_workflow_label_key(key)
    except ValueError as error:
        raise tool_errors.PublicToolError('Invalid no_labels.') from error
    return validated
