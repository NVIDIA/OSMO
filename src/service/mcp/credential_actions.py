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

from src.service.mcp import tool_errors, tool_requests, tool_validation
from src.service.mcp.credential_action_models import (
    CREDENTIAL_NAME_PATTERN,
    MAX_CREDENTIAL_NAME_LENGTH,
    CredentialNameInput,
    DeleteCredentialResult,
    UpstreamDeleteCredentialResult,
)


_CREDENTIALS_PATH = '/api/credentials'
_MAX_DELETE_CREDENTIAL_RESPONSE_BYTES = 64 * 1024
_CREDENTIAL_NAME = re.compile(CREDENTIAL_NAME_PATTERN)


async def osmo_delete_credential(
    context: Context,
    name: CredentialNameInput,
) -> DeleteCredentialResult:
    """Delete one OSMO credential and return only non-secret metadata."""
    validated_name, encoded_name = _validate_credential_name(name)
    response = await tool_requests.request_json_mutation(
        context,
        method='DELETE',
        path=f'{_CREDENTIALS_PATH}/{encoded_name}',
        operation='delete an OSMO credential',
        max_response_bytes=_MAX_DELETE_CREDENTIAL_RESPONSE_BYTES,
        payload=None,
    )
    upstream = tool_validation.validate_mutation_response(
        UpstreamDeleteCredentialResult,
        response,
        operation='delete an OSMO credential',
    )
    deleted_credential = upstream.credentials[0]
    if deleted_credential.cred_name != validated_name:
        raise tool_errors.uncertain_write_error(
            'delete an OSMO credential'
        )
    return DeleteCredentialResult(
        cred_name=deleted_credential.cred_name,
        cred_type=deleted_credential.cred_type,
        deleted=True,
    )


def _validate_credential_name(name: object) -> tuple[str, str]:
    if not isinstance(name, str):
        raise tool_errors.PublicToolError('Invalid credential name.')
    try:
        encoded_length = len(name.encode('utf-8'))
    except UnicodeEncodeError:
        encoded_length = MAX_CREDENTIAL_NAME_LENGTH + 1
    if (
        encoded_length > MAX_CREDENTIAL_NAME_LENGTH
        or _CREDENTIAL_NAME.fullmatch(name) is None
    ):
        raise tool_errors.PublicToolError('Invalid credential name.')
    return (
        name,
        tool_validation.safe_path_segment(
            name,
            field='credential name',
        ),
    )
