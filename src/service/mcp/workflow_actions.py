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

from fastmcp import Context

from src.service.mcp import (
    gateway,
    tool_errors,
    tool_requests,
    tool_validation,
    workflow_submission,
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
    WorkflowId,
    WorkflowLabelAssignments,
    WorkflowPriority,
)


_MAX_JSON_RESPONSE_BYTES = 64 * 1024
_MAX_VALIDATION_SPEC_BYTES = 256 * 1024


async def osmo_submit_workflow(
    context: Context,
    workflow_spec: SubmitWorkflowSpecText,
    pool: PoolName | None = None,
    set_variables: VariableOverrides | None = None,
    set_string_variables: VariableOverrides | None = None,
    priority: WorkflowPriority = 'NORMAL',
    labels: WorkflowLabelAssignments | None = None,
) -> SubmitWorkflowResult:
    """Submit raw workflow YAML to Core using the caller's OSMO identity."""
    validated_labels = (
        workflow_submission.validate_workflow_label_assignments(labels)
    )
    validated_set_variables = workflow_submission.validate_variable_overrides(
        set_variables,
        field='set_variables',
    )
    validated_set_string_variables = (
        workflow_submission.validate_variable_overrides(
            set_string_variables,
            field='set_string_variables',
        )
    )
    validated_priority = workflow_submission.validate_priority(priority)
    validated_pool = workflow_submission.validate_pool_name(pool)
    payload = workflow_submission.build_submission_payload(
        workflow_spec,
        set_variables=validated_set_variables,
        set_string_variables=validated_set_string_variables,
    )
    pool_name = await workflow_submission.resolve_pool(
        context,
        validated_pool,
    )
    upstream = await workflow_submission.request_submission(
        context,
        pool=pool_name,
        priority=validated_priority,
        payload=payload,
        operation='submit a workflow',
        labels=validated_labels,
    )
    return SubmitWorkflowResult(
        workflow_id=upstream.name,
        pool=pool_name,
        priority=validated_priority,
        warnings=upstream.warnings,
        submitted=True,
    )


async def osmo_validate_workflow(
    context: Context,
    workflow_spec: WorkflowSpecText,
    pool: PoolName | None = None,
    set_variables: VariableOverrides | None = None,
    set_string_variables: VariableOverrides | None = None,
    labels: WorkflowLabelAssignments | None = None,
) -> ValidateWorkflowResult:
    """Validate workflow YAML using Core's authoritative submission checks."""
    validated_labels = (
        workflow_submission.validate_workflow_label_assignments(labels)
    )
    validated_spec = tool_validation.validate_inline_text(
        workflow_spec,
        field='workflow_spec',
        max_bytes=_MAX_VALIDATION_SPEC_BYTES,
    )
    validated_set_variables = workflow_submission.validate_variable_overrides(
        set_variables,
        field='set_variables',
    )
    validated_set_string_variables = (
        workflow_submission.validate_variable_overrides(
            set_string_variables,
            field='set_string_variables',
        )
    )
    validated_pool = workflow_submission.validate_pool_name(pool)
    pool_name = await workflow_submission.resolve_pool(
        context,
        validated_pool,
    )
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
        query=workflow_submission.build_submission_query(
            labels=validated_labels,
            validation_only=True,
        ),
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
        warnings=upstream.warnings,
    )


async def osmo_restart_workflow(
    context: Context,
    workflow_id: WorkflowId,
    pool: PoolName | None = None,
) -> RestartWorkflowResult:
    """Restart a failed workflow after authorizing read access to its source."""
    validated_pool = workflow_submission.validate_pool_name(pool)
    source = await workflows.osmo_get_workflow(
        context,
        workflow_id,
        skip_groups=True,
    )
    pool_name = (
        await workflow_submission.resolve_pool(context, validated_pool)
        if validated_pool is not None or source.workflow.pool is None
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
        warnings=upstream.warnings,
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
