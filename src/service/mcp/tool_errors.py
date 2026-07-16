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
import unicodedata

from mcp.server.fastmcp.exceptions import ToolError


GENERIC_TOOL_ERROR = 'MCP tool failed.'
MAX_PUBLIC_TOOL_ERROR_BYTES = 4096

_MAX_TOOL_ERROR_CHARS = 2048
_MAX_UPSTREAM_MESSAGE_CHARS = 1024
_MAX_VALIDATION_ERRORS = 3
_SAFE_IDENTIFIER = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}')
_URL_USERINFO = re.compile(
    r'(?P<scheme>\b[A-Za-z][A-Za-z0-9+.-]*://)[^/@\s]+@'
)
_BEARER_VALUE = re.compile(
    r'\bBearer\s+[A-Za-z0-9._~+/-]+=*',
    flags=re.IGNORECASE,
)
_JWT_VALUE = re.compile(
    r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b'
)
_SENSITIVE_ASSIGNMENT = re.compile(
    r'(?P<prefix>\b(?:authorization|password|secret|token|api[_-]?key|'
    r'access[_-]?key|private[_-]?key|client[_-]?secret|assertion|credential|'
    r'signature|x-amz-signature|x-amz-credential)\b["\']?\s*[:=]\s*)'
    r'(?P<value>\[REDACTED\]|"(?:\\.|[^"\\])*"|'
    r'\'(?:\\.|[^\'\\])*\'|"(?:\\.|[^"\\])*\Z|'
    r'\'(?:\\.|[^\'\\])*\Z|[^,;&}\]]+)',
    flags=re.IGNORECASE,
)


class PublicToolError(ToolError):
    """A bounded error whose message is explicitly approved for MCP clients."""

    def __init__(self, message: str) -> None:
        super().__init__(
            message if _is_public_message(message) else GENERIC_TOOL_ERROR
        )


def from_fastmcp_error(error: ToolError) -> PublicToolError | None:
    """Recover an intentional public error from FastMCP's generic wrapper."""
    cause = error.__cause__
    # Subclasses are not implicitly trusted to preserve the bounded message.
    if type(cause) is PublicToolError:  # pylint: disable=unidiomatic-typecheck
        return PublicToolError(str(error))
    return None


def upstream_error(
    operation: str,
    status_code: int,
    *,
    body: bytes = b'',
    body_truncated: bool = False,
    suppress_upstream_details: bool = False,
) -> str:
    """Map one upstream failure to a bounded, allowlisted public message."""
    if status_code == 401:
        message = 'OSMO rejected the active authentication'
    elif status_code == 403:
        message = 'OSMO authorization denied the request'
    elif status_code == 404:
        message = 'OSMO could not find the requested resource'
    elif status_code == 429:
        message = 'OSMO rate limited the request'
    elif 500 <= status_code < 600:
        message = 'OSMO service is unavailable'
    else:
        message = 'OSMO request failed'
    result = f'{message} while attempting to {operation} (HTTP {status_code}).'
    if status_code in (400, 409, 422) and not suppress_upstream_details:
        detail = _actionable_upstream_detail(
            status_code,
            body,
            body_truncated=body_truncated,
        )
        if detail is not None:
            result = f'{result} OSMO detail: {detail}'
    return bounded_safe_error(result)


def bounded_safe_error(message: str) -> str:
    """Scrub and bound text before intentionally exposing it to a client."""
    safe_message = safe_error_text(message)
    if len(safe_message) <= _MAX_TOOL_ERROR_CHARS:
        return safe_message
    return safe_message[:_MAX_TOOL_ERROR_CHARS - 1].rstrip() + '\u2026'


def safe_error_text(value: str) -> str:
    """Redact common credentials and collapse log/control injection."""
    value = _URL_USERINFO.sub(r'\g<scheme>[REDACTED]@', value)
    value = _BEARER_VALUE.sub('Bearer [REDACTED]', value)
    value = _JWT_VALUE.sub('[REDACTED]', value)
    value = _SENSITIVE_ASSIGNMENT.sub(
        lambda match: (
            match.group(0)
            if match.group('value') == '[REDACTED]'
            else match.group('prefix') + '[REDACTED]'
        ),
        value,
    )
    without_controls = ''.join(
        character
        for character in value
        if unicodedata.category(character) not in ('Cc', 'Cf')
        or character.isspace()
    )
    return ' '.join(without_controls.split())


def _actionable_upstream_detail(
    status_code: int,
    body: bytes,
    *,
    body_truncated: bool,
) -> str | None:
    """Extract only known, non-payload OSMO validation fields."""
    if not body or body_truncated:
        return None
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, ValueError, TypeError, RecursionError):
        return None
    if not isinstance(payload, dict):
        return None

    if status_code == 422:
        validation_detail = _fastapi_validation_detail(payload.get('detail'))
        if validation_detail is not None:
            return validation_detail

    fields: list[str] = []
    raw_message = payload.get('message')
    if isinstance(raw_message, str):
        safe_message = safe_error_text(raw_message)
        safe_message = safe_message[:_MAX_UPSTREAM_MESSAGE_CHARS]
        if safe_message:
            fields.append(safe_message)
    for name in ('error_code', 'workflow_id'):
        raw_value = payload.get(name)
        if (
            isinstance(raw_value, str)
            and _SAFE_IDENTIFIER.fullmatch(raw_value) is not None
        ):
            fields.append(f'{name}={raw_value}')
    return '; '.join(fields) or None


def _fastapi_validation_detail(value: object) -> str | None:
    """Project FastAPI validation errors to locations and messages only."""
    if not isinstance(value, list):
        return None
    errors: list[str] = []
    for item in value[:_MAX_VALIDATION_ERRORS]:
        if not isinstance(item, dict):
            continue
        location = _validation_location(item.get('loc'))
        raw_message = item.get('msg')
        if location is None or not isinstance(raw_message, str):
            continue
        message = safe_error_text(raw_message)
        message = message[:_MAX_UPSTREAM_MESSAGE_CHARS]
        if message:
            errors.append(f'{location} - {message}')
    if not errors:
        return None
    return 'Validation failed at ' + '; '.join(errors)


def _validation_location(value: object) -> str | None:
    if not isinstance(value, list) or not value or len(value) > 8:
        return None
    parts: list[str] = []
    for part in value:
        if isinstance(part, bool) or not isinstance(part, (str, int)):
            return None
        normalized = str(part)
        if _SAFE_IDENTIFIER.fullmatch(normalized) is None:
            return None
        parts.append(normalized)
    return '.'.join(parts)


def _is_public_message(message: object) -> bool:
    if not isinstance(message, str) or not message or message != message.strip():
        return False
    try:
        encoded_message = message.encode('utf-8')
    except UnicodeEncodeError:
        return False
    return (
        len(encoded_message) <= MAX_PUBLIC_TOOL_ERROR_BYTES
        and all(character.isprintable() for character in message)
    )
