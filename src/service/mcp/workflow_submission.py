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

from src.lib.utils import workflow as workflow_utils
from src.service.mcp import (
    access_scope,
    tool_errors,
    tool_requests,
    tool_validation,
)
from src.service.mcp.workflow_action_models import (
    UpstreamSubmitResult,
    WorkflowTemplatePayload,
)
from src.service.mcp.workflow_models import (
    WORKFLOW_PRIORITIES,
    WorkflowPriority,
)


_MAX_SUBMISSION_SPEC_BYTES = 128 * 1024
_MAX_JSON_RESPONSE_BYTES = 64 * 1024
_MAX_OVERRIDE_BYTES = 2048


def validate_pool_name(pool: str | None) -> str | None:
    """Validate an optional explicit workflow-submission pool."""
    if pool is None:
        return None
    validated_pool = tool_validation.validate_query_text(
        pool,
        field='pool',
        max_bytes=512,
    )
    tool_validation.safe_path_segment(validated_pool, field='pool')
    return validated_pool


async def resolve_pool(context: Context, pool: str | None) -> str:
    """Resolve an explicit pool or the caller's unambiguous profile default."""
    validated_pool = validate_pool_name(pool)
    if validated_pool is not None:
        return validated_pool

    scope = await access_scope.request_access_scope(context)
    if scope.default_pool is not None:
        validated_default = validate_pool_name(scope.default_pool)
        if validated_default is not None:
            return validated_default
    if len(scope.pools) == 1:
        validated_only_pool = validate_pool_name(scope.pools[0])
        if validated_only_pool is not None:
            return validated_only_pool
    raise tool_errors.PublicToolError(
        'No unambiguous accessible pool is configured.'
    )


def validate_priority(priority: WorkflowPriority) -> WorkflowPriority:
    """Validate one workflow scheduling priority without coercion."""
    if priority not in WORKFLOW_PRIORITIES:
        raise tool_errors.PublicToolError('Invalid workflow priority.')
    return priority


def validate_variable_overrides(
    values: list[str] | None,
    *,
    field: str,
) -> list[str]:
    """Validate bounded CLI-compatible workflow template overrides."""
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


def build_submission_payload(
    workflow_spec: str,
    *,
    set_variables: list[str],
    set_string_variables: list[str],
) -> WorkflowTemplatePayload:
    """Build the exact Core template payload for one bounded submission."""
    validated_spec = tool_validation.validate_inline_text(
        workflow_spec,
        field='workflow_spec',
        max_bytes=_MAX_SUBMISSION_SPEC_BYTES,
    )
    return WorkflowTemplatePayload(
        file=validated_spec,
        set_variables=set_variables,
        set_string_variables=set_string_variables,
        uploaded_templated_spec=(
            validated_spec
            if workflow_utils.is_templated_workflow(validated_spec)
            else None
        ),
    )


async def request_submission(
    context: Context,
    *,
    pool: str,
    priority: WorkflowPriority,
    payload: WorkflowTemplatePayload,
    operation: str,
    app_uuid: str | None = None,
    app_version: int | None = None,
) -> UpstreamSubmitResult:
    """Perform one non-retried Core workflow submission."""
    validated_priority = validate_priority(priority)
    encoded_pool = tool_validation.safe_path_segment(
        pool,
        field='pool',
    )
    if (app_uuid is None) != (app_version is None):
        raise ValueError(
            'App UUID and version must be provided together.'
        )
    submission_query: dict[str, str | int] = {}
    if app_uuid is not None and app_version is not None:
        submission_query['app_uuid'] = tool_validation.validate_query_text(
            app_uuid,
            field='app UUID',
            max_bytes=512,
        )
        submission_query['app_version'] = (
            tool_validation.validate_integer(
                app_version,
                field='app version',
                minimum=1,
            )
        )
    if validated_priority != 'NORMAL':
        submission_query['priority'] = validated_priority
    response = await tool_requests.request_json_mutation(
        context,
        path=f'/api/pool/{encoded_pool}/workflow',
        operation=operation,
        max_response_bytes=_MAX_JSON_RESPONSE_BYTES,
        query=submission_query or None,
        payload=payload.model_dump(mode='json', exclude_none=True),
    )
    return tool_validation.validate_mutation_response(
        UpstreamSubmitResult,
        response,
        operation=operation,
    )
