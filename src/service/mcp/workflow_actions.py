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
    tool_errors,
    tool_requests,
    tool_validation,
)
from src.service.mcp.workflow_action_models import (
    PoolName,
    UpstreamValidationResult,
    ValidateWorkflowResult,
    VariableOverrides,
    WorkflowSpecText,
    WorkflowTemplatePayload,
)


_MAX_JSON_RESPONSE_BYTES = 64 * 1024
_MAX_WORKFLOW_SPEC_BYTES = 256 * 1024
_MAX_OVERRIDE_BYTES = 2048


async def osmo_validate_workflow(
    context: Context,
    workflow_spec: WorkflowSpecText,
    pool: PoolName | None = None,
    set_variables: VariableOverrides | None = None,
    set_string_variables: VariableOverrides | None = None,
) -> ValidateWorkflowResult:
    """Validate workflow YAML using Core's authoritative submission checks."""
    validated_spec = _validate_workflow_spec(workflow_spec)
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
        payload=payload.model_dump(mode='json'),
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


def _validate_workflow_spec(workflow_spec: str) -> str:
    try:
        encoded_spec = workflow_spec.encode('utf-8')
    except (AttributeError, UnicodeEncodeError):
        encoded_spec = b''
    if (
        not isinstance(workflow_spec, str)
        or not workflow_spec.strip()
        or len(encoded_spec) > _MAX_WORKFLOW_SPEC_BYTES
        or any(
            not character.isprintable()
            and character not in '\n\r\t'
            for character in workflow_spec
        )
    ):
        raise tool_errors.PublicToolError('Invalid workflow_spec.')
    return workflow_spec


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
