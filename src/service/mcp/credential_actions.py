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

import json
import re
from typing import cast
from urllib import parse

from mcp.server.fastmcp import Context

from src.lib.api import credential_payload as credential_payload_contract
from src.lib.api import storage as storage_contract
from src.service.mcp import tool_errors, tool_requests, tool_validation
from src.service.mcp.credential_action_models import (
    CREDENTIAL_NAME_PATTERN,
    MAX_CREDENTIAL_NAME_LENGTH,
    MAX_CREDENTIAL_PAYLOAD_ENTRIES,
    MAX_CREDENTIAL_PAYLOAD_KEY_LENGTH,
    MAX_CREDENTIAL_PAYLOAD_VALUE_LENGTH,
    CredentialNameInput,
    CredentialPayloadInput,
    CredentialType,
    CredentialTypeInput,
    DeleteCredentialResult,
    SetCredentialResult,
    UpstreamDeleteCredentialResult,
)


_CREDENTIALS_PATH = '/api/credentials'
_MAX_SET_CREDENTIAL_RESPONSE_BYTES = 1024
_MAX_DELETE_CREDENTIAL_RESPONSE_BYTES = 64 * 1024
_MAX_ENCODED_PAYLOAD_BYTES = 128 * 1024
_CREDENTIAL_NAME = re.compile(CREDENTIAL_NAME_PATTERN)
_CREDENTIAL_TYPES = frozenset(('REGISTRY', 'DATA', 'GENERIC'))
_REGISTRY_FIELDS = frozenset(('auth', 'registry', 'username'))
_REGISTRY_REQUIRED_FIELDS = frozenset(('auth',))
_DATA_FIELDS = frozenset((
    'access_key_id',
    'access_key',
    'endpoint',
    'region',
    'override_url',
    'addressing_style',
))
_DATA_REQUIRED_FIELDS = frozenset((
    'access_key_id',
    'access_key',
    'endpoint',
))
_DATA_ADDRESSING_STYLES = frozenset(('auto', 'path', 'virtual'))


async def osmo_set_credential(
    context: Context,
    name: CredentialNameInput,
    cred_type: CredentialTypeInput,
    payload: CredentialPayloadInput,
) -> SetCredentialResult:
    """Set one OSMO credential without returning its payload."""
    validated_name, encoded_name = _validate_credential_name(name)
    validated_type = _validate_credential_type(cred_type)
    request_payload = _credential_request_payload(
        validated_type,
        payload,
    )
    response = await tool_requests.request_json_mutation(
        context,
        method='POST',
        path=f'{_CREDENTIALS_PATH}/{encoded_name}',
        operation='set an OSMO credential',
        max_response_bytes=_MAX_SET_CREDENTIAL_RESPONSE_BYTES,
        payload=request_payload,
    )
    if response is not None:
        raise tool_errors.uncertain_write_error('set an OSMO credential')
    return SetCredentialResult(
        cred_name=validated_name,
        cred_type=validated_type,
        saved=True,
    )


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


def _validate_credential_type(
    credential_type: object,
) -> CredentialType:
    if (
        not isinstance(credential_type, str)
        or credential_type not in _CREDENTIAL_TYPES
    ):
        raise tool_errors.PublicToolError('Invalid cred_type.')
    return cast(CredentialType, credential_type)


def _credential_request_payload(
    credential_type: CredentialType,
    payload: object,
) -> dict[str, object]:
    validated_payload = _validate_payload_values(payload)
    payload_fields = frozenset(validated_payload)

    if credential_type == 'REGISTRY':
        if (
            not _REGISTRY_REQUIRED_FIELDS.issubset(payload_fields)
            or not payload_fields.issubset(_REGISTRY_FIELDS)
            or (
                'registry' in validated_payload
                and _has_unsafe_url_components(
                    validated_payload['registry']
                )
            )
        ):
            raise _invalid_payload()
    elif credential_type == 'DATA':
        if (
            not _DATA_REQUIRED_FIELDS.issubset(payload_fields)
            or not payload_fields.issubset(_DATA_FIELDS)
            or (
                'addressing_style' in validated_payload
                and validated_payload['addressing_style']
                not in _DATA_ADDRESSING_STYLES
            )
            or _has_unsafe_url_components(
                validated_payload['endpoint']
            )
            or re.fullmatch(
                storage_contract.STORAGE_CREDENTIAL_REGEX,
                validated_payload['endpoint'],
            ) is None
            or (
                'override_url' in validated_payload
                and _has_unsafe_url_components(
                    validated_payload['override_url']
                )
            )
        ):
            raise _invalid_payload()

    request_payload = (
        credential_payload_contract.build_credential_request_envelope(
            credential_type,
            validated_payload,
        )
    )

    try:
        encoded_payload = json.dumps(
            request_payload,
            ensure_ascii=False,
            separators=(',', ':'),
        ).encode('utf-8')
    except (TypeError, ValueError, UnicodeEncodeError, RecursionError):
        raise _invalid_payload() from None
    if len(encoded_payload) > _MAX_ENCODED_PAYLOAD_BYTES:
        raise _invalid_payload()
    return request_payload


def _validate_payload_values(payload: object) -> dict[str, str]:
    if (
        not isinstance(payload, dict)
        or not payload
        or len(payload) > MAX_CREDENTIAL_PAYLOAD_ENTRIES
    ):
        raise _invalid_payload()

    validated: dict[str, str] = {}
    for key, raw_value in payload.items():
        if not _valid_payload_key(key):
            raise _invalid_payload()
        if not _valid_payload_value(raw_value):
            raise _invalid_payload()
        validated[key] = raw_value
    return validated


def _valid_payload_key(value: object) -> bool:
    if not isinstance(value, str) or not value or value != value.strip():
        return False
    try:
        encoded_length = len(value.encode('utf-8'))
    except UnicodeEncodeError:
        return False
    return (
        encoded_length <= MAX_CREDENTIAL_PAYLOAD_KEY_LENGTH
        and all(character.isprintable() for character in value)
    )


def _valid_payload_value(value: object) -> bool:
    if not isinstance(value, str) or not value or '\x00' in value:
        return False
    try:
        encoded_length = len(value.encode('utf-8'))
    except UnicodeEncodeError:
        return False
    return encoded_length <= MAX_CREDENTIAL_PAYLOAD_VALUE_LENGTH


def _has_unsafe_url_components(value: str) -> bool:
    """Reject secret-bearing URL components instead of storing them."""
    if '?' in value or '#' in value:
        return True
    candidate = (
        value
        if '://' in value or value.startswith('//')
        else f'//{value}'
    )
    try:
        parsed = parse.urlsplit(candidate)
        return parsed.username is not None or parsed.password is not None
    except ValueError:
        return True


def _invalid_payload() -> tool_errors.PublicToolError:
    return tool_errors.PublicToolError('Invalid credential payload.')
