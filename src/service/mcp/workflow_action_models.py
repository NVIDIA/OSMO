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

from typing import Annotated, Literal

import pydantic

from src.service.mcp.tool_models import ClosedToolModel
from src.service.mcp.workflow_models import (
    WorkflowId,
    WorkflowPriority,
    WorkflowWarnings,
)


PoolName = Annotated[
    str,
    pydantic.Field(min_length=1, max_length=512),
]
WorkflowSpecText = Annotated[
    str,
    pydantic.Field(min_length=1, max_length=256 * 1024),
]
SubmitWorkflowSpecText = Annotated[
    str,
    pydantic.Field(min_length=1, max_length=128 * 1024),
]
VariableOverride = Annotated[
    str,
    pydantic.Field(min_length=2, max_length=2048),
]
VariableOverrides = Annotated[
    list[VariableOverride],
    pydantic.Field(
        max_length=50,
        description=(
            'Workflow template field=value overrides. Values may be '
            'sensitive: prefer OSMO credentials for secrets. MCP does not '
            'return or log overrides, but the calling client may retain its '
            'submitted arguments.'
        ),
        json_schema_extra={'writeOnly': True},
    ),
]
ForceCancel = Annotated[
    pydantic.StrictBool,
    pydantic.Field(),
]


class WorkflowTemplatePayload(ClosedToolModel):
    """Exact Core TemplateSpec fields accepted from an MCP workflow action."""

    file: str
    set_variables: list[str]
    set_string_variables: list[str]
    uploaded_templated_spec: str | None = None


class UpstreamValidationResult(ClosedToolModel):
    """Allowlisted validation-only fields from Core's SubmitResponse."""

    model_config = pydantic.ConfigDict(extra='ignore')

    name: Annotated[str, pydantic.Field(min_length=1, max_length=512)]
    logs: Literal['Workflow validation succeeded.']
    warnings: WorkflowWarnings = pydantic.Field(default_factory=list)


class ValidateWorkflowResult(ClosedToolModel):
    """Compact confirmation of an authoritative Core validation."""

    valid: bool
    pool: PoolName
    logs: Literal['Workflow validation succeeded.']
    warnings: WorkflowWarnings = pydantic.Field(default_factory=list)


class UpstreamSubmitResult(ClosedToolModel):
    """Allowlisted normal-submission fields from Core's SubmitResponse."""

    model_config = pydantic.ConfigDict(extra='ignore')

    name: WorkflowId
    overview: Annotated[str, pydantic.Field(min_length=1, max_length=16_384)]
    logs: Annotated[str, pydantic.Field(min_length=1, max_length=16_384)]
    warnings: WorkflowWarnings = pydantic.Field(default_factory=list)


class SubmitWorkflowResult(ClosedToolModel):
    """Compact confirmation that Core accepted a workflow submission."""

    workflow_id: WorkflowId
    pool: PoolName
    priority: WorkflowPriority
    warnings: WorkflowWarnings = pydantic.Field(default_factory=list)
    submitted: Literal[True]


class UpstreamCancelResult(ClosedToolModel):
    """Allowlisted fields from Core's CancelResponse."""

    model_config = pydantic.ConfigDict(extra='ignore')

    name: WorkflowId


class RestartWorkflowResult(ClosedToolModel):
    """Compact confirmation that Core accepted a workflow restart."""

    workflow_id: WorkflowId
    parent_workflow_id: WorkflowId
    pool: PoolName
    warnings: WorkflowWarnings = pydantic.Field(default_factory=list)
    restart_submitted: Literal[True]


class CancelWorkflowResult(ClosedToolModel):
    """Compact confirmation that Core accepted a cancellation request."""

    workflow_id: WorkflowId
    force: bool
    cancellation_submitted: Literal[True]
