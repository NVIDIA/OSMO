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

from typing import Annotated, Any, Literal

import pydantic

from src.service.mcp.tool_models import ClosedToolModel, ExtensibleUpstreamModel


CREDENTIAL_NAME_PATTERN = r'^[a-zA-Z]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$'
MAX_CREDENTIAL_NAME_LENGTH = 512

CredentialType = Literal['REGISTRY', 'DATA', 'GENERIC']
CredentialName = Annotated[
    str,
    pydantic.Field(
        min_length=1,
        max_length=MAX_CREDENTIAL_NAME_LENGTH,
        pattern=CREDENTIAL_NAME_PATTERN,
    ),
]
CredentialNameInput = Annotated[
    Any,
    pydantic.WithJsonSchema({
        'type': 'string',
        'minLength': 1,
        'maxLength': MAX_CREDENTIAL_NAME_LENGTH,
        'pattern': CREDENTIAL_NAME_PATTERN,
    }),
]
class UpstreamDeletedCredential(ExtensibleUpstreamModel):
    """Allowlisted metadata for one credential returned by Core."""

    cred_name: CredentialName
    cred_type: CredentialType


class UpstreamDeleteCredentialResult(ExtensibleUpstreamModel):
    """Allowlisted Core response for one credential deletion."""

    credentials: Annotated[
        list[UpstreamDeletedCredential],
        pydantic.Field(min_length=1, max_length=1),
    ]


class DeleteCredentialResult(ClosedToolModel):
    """Compact confirmation that Core deleted one credential."""

    cred_name: CredentialName
    cred_type: CredentialType
    deleted: Literal[True]
