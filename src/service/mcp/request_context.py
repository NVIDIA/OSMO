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

from collections.abc import Iterator
import contextlib
import contextvars
import dataclasses
import re

from fastmcp.server.auth import AccessToken
from fastmcp.server.dependencies import get_access_token, get_http_request



REQUEST_ID_HEADER = 'x-request-id'

_REQUEST_ID_HEADER = REQUEST_ID_HEADER.encode('ascii')
_BEARER_VALUE = re.compile(
    r'Bearer [A-Za-z0-9._~+/-]+=*',
    flags=re.IGNORECASE,
)
_REQUEST_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:-]*')
MAX_REQUEST_ID_HEADER_BYTES = 128
MIN_BEARER_TOKEN_SUBSTRING_BYTES = 16
MIN_BEARER_TOKEN_BYTES = MIN_BEARER_TOKEN_SUBSTRING_BYTES


class RequestContextUnavailable(RuntimeError):
    """The current task is not owned by an active MCP request."""


@dataclasses.dataclass(frozen=True, slots=True)
class RequestCredentials:
    """Gateway-authenticated credentials owned by one MCP request."""

    authorization_header: str = dataclasses.field(repr=False)
    request_id: str | None

    def __post_init__(self) -> None:
        if not _is_supported_authorization_header(self.authorization_header):
            raise ValueError('Unsupported MCP authorization header.')


_active_tool_name: contextvars.ContextVar[str | None] = (
    contextvars.ContextVar('mcp_active_tool_name', default=None))


def get_request_credentials() -> RequestCredentials:
    """Return credentials for the active request from FastMCP's access token."""
    access_token = get_access_token()
    if access_token is None:
        raise RequestContextUnavailable(
            'MCP request credentials are unavailable.')
    return _credentials_from_access_token(access_token)


def get_active_tool_name() -> str | None:
    """Return the canonical MCP tool name for the active invocation, if any."""
    return _active_tool_name.get()


@contextlib.contextmanager
def track_tool(name: str) -> Iterator[None]:
    """Bind a canonical tool name to downstream Gateway telemetry."""
    token = _active_tool_name.set(name)
    try:
        yield
    finally:
        _active_tool_name.reset(token)


@contextlib.contextmanager
def track_request_task() -> Iterator[RequestCredentials]:
    """Bind the active request's credentials for the duration of a tool call.

    FastMCP owns request-task cancellation, so this only carries credentials.
    """
    yield get_request_credentials()


def _credentials_from_access_token(
    access_token: AccessToken,
) -> RequestCredentials:
    """Relay the verified upstream token returned by FastMCP's OIDC proxy."""
    authorization_header = f'Bearer {access_token.token}'
    if not _is_supported_authorization_header(authorization_header):
        raise RequestContextUnavailable(
            'MCP request credentials are unavailable.')

    request_id = None
    try:
        raw_request_ids = [
            value
            for name, value in get_http_request().scope.get('headers', [])
            if name.lower() == _REQUEST_ID_HEADER
        ]
    except RuntimeError:
        raw_request_ids = []
    request_id_is_valid, request_id = _parse_request_id(
        raw_request_ids,
        authorization_header,
    )
    if not request_id_is_valid:
        raise RequestContextUnavailable(
            'MCP request credentials are unavailable.')

    return RequestCredentials(
        authorization_header=authorization_header,
        request_id=request_id,
    )


def request_id_overlaps_bearer(
    authorization_header: str,
    request_id: str | None,
) -> bool:
    """Return whether a request ID discloses meaningful bearer material."""
    if request_id is None:
        return False
    _, separator, bearer_token = authorization_header.partition(' ')
    if not separator or not bearer_token:
        return False
    if request_id == bearer_token:
        return True
    if (
        len(request_id) < MIN_BEARER_TOKEN_SUBSTRING_BYTES
        or len(bearer_token) < MIN_BEARER_TOKEN_SUBSTRING_BYTES
    ):
        return False
    return any(
        request_id[start:start + MIN_BEARER_TOKEN_SUBSTRING_BYTES]
        in bearer_token
        for start in range(
            len(request_id) - MIN_BEARER_TOKEN_SUBSTRING_BYTES + 1
        )
    )


def _parse_request_id(
    raw_values: list[bytes],
    authorization_header: str,
) -> tuple[bool, str | None]:
    if (
        len(raw_values) > 1
        or (
            raw_values
            and len(raw_values[0]) > MAX_REQUEST_ID_HEADER_BYTES
        )
    ):
        return False, None
    if not raw_values:
        return True, None

    request_id = _decode_ascii(raw_values[0])
    if (
        request_id is None
        or _REQUEST_ID.fullmatch(request_id) is None
        or request_id_overlaps_bearer(authorization_header, request_id)
    ):
        return False, None
    return True, request_id


def _is_supported_authorization_header(value: str) -> bool:
    """Require enough bearer entropy for reliable reflection detection."""
    if _BEARER_VALUE.fullmatch(value) is None:
        return False
    _, _, bearer_token = value.partition(' ')
    return len(bearer_token) >= MIN_BEARER_TOKEN_BYTES


def _decode_ascii(value: bytes) -> str | None:
    try:
        return value.decode('ascii')
    except UnicodeDecodeError:
        return None


