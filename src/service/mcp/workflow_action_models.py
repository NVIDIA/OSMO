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


PoolName = Annotated[
    str,
    pydantic.Field(min_length=1, max_length=512),
]
WorkflowSpecText = Annotated[
    str,
    pydantic.Field(min_length=1, max_length=256 * 1024),
]
VariableOverride = Annotated[
    str,
    pydantic.Field(min_length=2, max_length=2048),
]
VariableOverrides = Annotated[
    list[VariableOverride],
    pydantic.Field(max_length=50),
]


class WorkflowTemplatePayload(ClosedToolModel):
    """Exact Core TemplateSpec fields accepted from an MCP workflow action."""

    file: str
    set_variables: list[str]
    set_string_variables: list[str]


class UpstreamValidationResult(ClosedToolModel):
    """Allowlisted validation-only fields from Core's SubmitResponse."""

    model_config = pydantic.ConfigDict(extra='ignore')

    name: Annotated[str, pydantic.Field(min_length=1, max_length=512)]
    logs: Literal['Workflow validation succeeded.']


class ValidateWorkflowResult(ClosedToolModel):
    """Compact confirmation of an authoritative Core validation."""

    valid: bool
    pool: PoolName
    logs: Literal['Workflow validation succeeded.']
