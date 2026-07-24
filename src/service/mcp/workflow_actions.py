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

from mcp.server.fastmcp import Context

from src.service.mcp import (
    access_scope,
    gateway,
    tool_errors,
    tool_requests,
    tool_validation,
    workflows,
)
from src.service.mcp.workflow_action_models import (
    CancelWorkflowResult,
    ForceCancel,
    PoolName,
    RestartWorkflowResult,
    SubmitWorkflowSpecText,
    SubmitWorkflowResult,
    UpstreamCancelResult,
    UpstreamSubmitResult,
    UpstreamValidationResult,
    ValidateWorkflowResult,
    VariableOverrides,
    WorkflowSpecText,
    WorkflowTemplatePayload,
)
from src.service.mcp.workflow_models import (
    WORKFLOW_PRIORITIES,
    WorkflowId,
    WorkflowPriority,
)


_MAX_JSON_RESPONSE_BYTES = 64 * 1024
_MAX_VALIDATION_SPEC_BYTES = 256 * 1024
_MAX_SUBMISSION_SPEC_BYTES = 128 * 1024
_MAX_OVERRIDE_BYTES = 2048
_CLI_TEMPLATE_MARKERS = ('{%%', '{{', '{#', 'default-values')


async def osmo_submit_workflow(
    context: Context,
    workflow_spec: SubmitWorkflowSpecText,
    pool: PoolName | None = None,
    set_variables: VariableOverrides | None = None,
    set_string_variables: VariableOverrides | None = None,
    priority: WorkflowPriority = 'NORMAL',
) -> SubmitWorkflowResult:
    """Submit raw workflow YAML to Core using the caller's OSMO identity."""
    validated_spec = _validate_workflow_spec(
        workflow_spec,
        max_bytes=_MAX_SUBMISSION_SPEC_BYTES,
    )
    validated_set_variables = _validate_overrides(
        set_variables,
        field='set_variables',
    )
    validated_set_string_variables = _validate_overrides(
        set_string_variables,
        field='set_string_variables',
    )
    if priority not in WORKFLOW_PRIORITIES:
        raise tool_errors.PublicToolError('Invalid workflow priority.')

    pool_name = await _resolve_pool(context, pool)
    encoded_pool = tool_validation.safe_path_segment(
        pool_name,
        field='pool',
    )
    payload = WorkflowTemplatePayload(
        file=validated_spec,
        set_variables=validated_set_variables,
        set_string_variables=validated_set_string_variables,
        uploaded_templated_spec=(
            validated_spec
            if _is_templated_workflow(validated_spec)
            else None
        ),
    )
    query = (
        {'priority': priority}
        if priority != 'NORMAL'
        else None
    )
    response = await tool_requests.request_json_mutation(
        context,
        path=f'/api/pool/{encoded_pool}/workflow',
        operation='submit a workflow',
        max_response_bytes=_MAX_JSON_RESPONSE_BYTES,
        query=query,
        payload=payload.model_dump(mode='json', exclude_none=True),
    )
    upstream = tool_validation.validate_mutation_response(
        UpstreamSubmitResult,
        response,
        operation='submit a workflow',
    )
    return SubmitWorkflowResult(
        workflow_id=upstream.name,
        pool=pool_name,
        priority=priority,
        submitted=True,
    )


async def osmo_validate_workflow(
    context: Context,
    workflow_spec: WorkflowSpecText,
    pool: PoolName | None = None,
    set_variables: VariableOverrides | None = None,
    set_string_variables: VariableOverrides | None = None,
) -> ValidateWorkflowResult:
    """Validate workflow YAML using Core's authoritative submission checks."""
    validated_spec = _validate_workflow_spec(
        workflow_spec,
        max_bytes=_MAX_VALIDATION_SPEC_BYTES,
    )
    validated_set_variables = _validate_overrides(
        set_variables,
        field='set_variables',
    )
    validated_set_string_variables = _validate_overrides(
        set_string_variables,
        field='set_string_variables',
    )
    pool_name = await _resolve_pool(context, pool)
    encoded_pool = tool_validation.safe_path_segment(
        pool_name,
        field='pool',
    )
    payload = WorkflowTemplatePayload(
        file=validated_spec,
        set_variables=validated_set_variables,
        set_string_variables=validated_set_string_variables,
    )
    response = await tool_requests.request_json_mutation(
        context,
        path=f'/api/pool/{encoded_pool}/workflow',
        operation='validate a workflow',
        max_response_bytes=_MAX_JSON_RESPONSE_BYTES,
        query={'validation_only': True},
        payload=payload.model_dump(mode='json', exclude_none=True),
    )
    upstream = tool_validation.validate_mutation_response(
        UpstreamValidationResult,
        response,
        operation='validate a workflow',
    )
    return ValidateWorkflowResult(
        valid=True,
        pool=pool_name,
        logs=upstream.logs,
    )


async def osmo_restart_workflow(
    context: Context,
    workflow_id: WorkflowId,
    pool: PoolName | None = None,
) -> RestartWorkflowResult:
    """Restart a failed workflow after authorizing read access to its source."""
    source = await workflows.osmo_get_workflow(
        context,
        workflow_id,
        skip_groups=True,
    )
    pool_name = (
        await _resolve_pool(context, pool)
        if pool is not None or source.workflow.pool is None
        else source.workflow.pool
    )
    encoded_pool = tool_validation.safe_path_segment(
        pool_name,
        field='pool',
    )
    encoded_workflow_id = workflows.workflow_path_segment(workflow_id)
    response = await tool_requests.request_json_mutation(
        context,
        path=(
            f'/api/pool/{encoded_pool}/workflow/'
            f'{encoded_workflow_id}/restart'
        ),
        operation='restart a workflow',
        max_response_bytes=_MAX_JSON_RESPONSE_BYTES,
    )
    upstream = tool_validation.validate_mutation_response(
        UpstreamSubmitResult,
        response,
        operation='restart a workflow',
    )
    return RestartWorkflowResult(
        workflow_id=upstream.name,
        parent_workflow_id=workflow_id,
        pool=pool_name,
        restart_submitted=True,
    )


async def osmo_cancel_workflow(
    context: Context,
    workflow_id: WorkflowId,
    force: ForceCancel = False,
) -> CancelWorkflowResult:
    """Request cancellation of one workflow through Core."""
    if not isinstance(force, bool):
        raise tool_errors.PublicToolError('Invalid force.')
    encoded_workflow_id = workflows.workflow_path_segment(workflow_id)
    query: dict[str, gateway.QueryValue] = {'force': force}
    response = await tool_requests.request_json_mutation(
        context,
        path=f'/api/workflow/{encoded_workflow_id}/cancel',
        operation='cancel a workflow',
        max_response_bytes=_MAX_JSON_RESPONSE_BYTES,
        query=query,
    )
    upstream = tool_validation.validate_mutation_response(
        UpstreamCancelResult,
        response,
        operation='cancel a workflow',
    )
    if upstream.name != workflow_id:
        raise tool_errors.uncertain_write_error('cancel a workflow')
    return CancelWorkflowResult(
        workflow_id=upstream.name,
        force=force,
        cancellation_submitted=True,
    )


async def _resolve_pool(context: Context, pool: str | None) -> str:
    if pool is not None:
        return tool_validation.validate_query_text(
            pool,
            field='pool',
            max_bytes=512,
        )

    scope = await access_scope.request_access_scope(context)
    if scope.default_pool is not None:
        return scope.default_pool
    if len(scope.pools) == 1:
        return scope.pools[0]
    raise tool_errors.PublicToolError(
        'No unambiguous accessible pool is configured.'
    )


def _validate_workflow_spec(
    workflow_spec: str,
    *,
    max_bytes: int,
) -> str:
    try:
        encoded_spec = workflow_spec.encode('utf-8')
    except (AttributeError, UnicodeEncodeError):
        encoded_spec = b''
    if (
        not isinstance(workflow_spec, str)
        or not workflow_spec.strip()
        or len(encoded_spec) > max_bytes
        or any(
            not character.isprintable()
            and character not in '\n\r\t'
            for character in workflow_spec
        )
    ):
        raise tool_errors.PublicToolError('Invalid workflow_spec.')
    return workflow_spec


def _is_templated_workflow(workflow_spec: str) -> bool:
    """Match the CLI's lightweight template detection without its runtime."""
    return any(marker in workflow_spec for marker in _CLI_TEMPLATE_MARKERS)


def _validate_overrides(
    values: list[str] | None,
    *,
    field: str,
) -> list[str]:
    if values is None:
        return []
    if (
        not isinstance(values, list)
        or len(values) > 50
    ):
        raise tool_errors.PublicToolError(f'Invalid {field}.')

    validated: list[str] = []
    for value in values:
        try:
            encoded_value = value.encode('utf-8')
        except (AttributeError, UnicodeEncodeError):
            encoded_value = b''
        key, separator, _ = value.partition('=') if isinstance(
            value, str
        ) else ('', '', '')
        if (
            not separator
            or not key
            or key != key.strip()
            or len(encoded_value) > _MAX_OVERRIDE_BYTES
            or any(
                ord(character) < 0x20 or ord(character) == 0x7F
                for character in value
            )
        ):
            raise tool_errors.PublicToolError(f'Invalid {field}.')
        validated.append(value)
    return validated
