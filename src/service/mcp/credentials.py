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

from collections.abc import Mapping
from typing import Annotated

from fastmcp import Context
import pydantic

from src.service.mcp import tool_requests
from src.service.mcp.tool_errors import PublicToolError


_CREDENTIALS_PATH = '/api/credentials'
_MAX_CREDENTIAL_RESPONSE_BYTES = 1024 * 1024
_CREDENTIAL_FIELDS = ('cred_name', 'cred_type')


class CredentialMetadata(pydantic.BaseModel, extra='forbid'):
    """Non-secret metadata for one OSMO credential."""

    cred_name: Annotated[str, pydantic.Field(min_length=1)]
    cred_type: Annotated[str, pydantic.Field(min_length=1)]


class CredentialListResult(pydantic.BaseModel, extra='forbid'):
    """The active user's credential metadata."""

    credentials: list[CredentialMetadata]


async def osmo_list_credentials(context: Context) -> CredentialListResult:
    """List credential names and types without secret-bearing values."""
    response = await tool_requests.request_json_object(
        context,
        path=_CREDENTIALS_PATH,
        operation='list OSMO credentials',
        max_response_bytes=_MAX_CREDENTIAL_RESPONSE_BYTES,
    )
    return _project_credential_metadata(response)


def _project_credential_metadata(
    response: tool_requests.JsonObject,
) -> CredentialListResult:
    raw_credentials = response.get('credentials')
    if not isinstance(raw_credentials, list):
        raise _invalid_response()

    projected_credentials: list[dict[str, object]] = []
    for credential in raw_credentials:
        if not isinstance(credential, Mapping):
            raise _invalid_response()
        if any(field not in credential for field in _CREDENTIAL_FIELDS):
            raise _invalid_response()
        projected_credentials.append({
            field: credential[field]
            for field in _CREDENTIAL_FIELDS
        })

    try:
        return CredentialListResult.model_validate(
            {'credentials': projected_credentials},
            strict=True,
        )
    except pydantic.ValidationError:
        raise _invalid_response() from None


def _invalid_response() -> PublicToolError:
    return PublicToolError(
        'OSMO returned an invalid response while attempting to list OSMO credentials.'
    )
