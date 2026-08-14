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
    apps,
    tool_requests,
    tool_validation,
    workflow_submission,
)
from src.service.mcp.app_action_models import (
    MAX_APP_SPEC_BYTES,
    SubmitAppResult,
)
from src.service.mcp.app_models import AppName, AppVersionNumber
from src.service.mcp.workflow_action_models import (
    PoolName,
    VariableOverrides,
)
from src.service.mcp.workflow_models import (
    WorkflowLabelAssignments,
    WorkflowPriority,
)


async def osmo_submit_app(
    context: Context,
    name: AppName,
    pool: PoolName | None = None,
    version: AppVersionNumber | None = None,
    set_variables: VariableOverrides | None = None,
    set_string_variables: VariableOverrides | None = None,
    priority: WorkflowPriority = 'NORMAL',
    labels: WorkflowLabelAssignments | None = None,
) -> SubmitAppResult:
    """Resolve and submit one concrete READY OSMO app version."""
    apps.validated_app_name(name)
    validated_labels = (
        workflow_submission.validate_workflow_label_assignments(labels)
    )
    validated_version = tool_validation.validate_optional_integer(
        version,
        field='app version',
        minimum=1,
    )
    validated_pool = workflow_submission.validate_pool_name(pool)
    validated_set_variables = (
        workflow_submission.validate_variable_overrides(
            set_variables,
            field='set_variables',
        )
    )
    validated_set_string_variables = (
        workflow_submission.validate_variable_overrides(
            set_string_variables,
            field='set_string_variables',
        )
    )
    validated_priority = workflow_submission.validate_priority(priority)
    pool_name = await workflow_submission.resolve_pool(
        context,
        validated_pool,
    )
    resolved = await apps.resolve_ready_app_version(
        context,
        name=name,
        version=validated_version,
        operation='resolve an OSMO app submission version',
    )
    workflow_spec = await tool_requests.request_text(
        context,
        path=f'/api/app/user/{resolved.encoded_name}/spec',
        operation='get an OSMO app spec for submission',
        max_response_bytes=MAX_APP_SPEC_BYTES,
        query={'version': resolved.version},
    )
    payload = workflow_submission.build_submission_payload(
        workflow_spec,
        set_variables=validated_set_variables,
        set_string_variables=validated_set_string_variables,
    )
    upstream = await workflow_submission.request_submission(
        context,
        pool=pool_name,
        priority=validated_priority,
        payload=payload,
        operation='submit an OSMO app',
        labels=validated_labels,
        app_uuid=resolved.uuid,
        app_version=resolved.version,
    )
    return SubmitAppResult(
        workflow_id=upstream.name,
        app_name=name,
        app_version=resolved.version,
        pool=pool_name,
        priority=validated_priority,
        warnings=upstream.warnings,
        submitted=True,
    )
