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

import asyncio
from collections.abc import Iterable
from collections.abc import Iterator
import contextlib
import contextvars
import dataclasses
import re

from fastmcp.server.auth import AccessToken
from fastmcp.server.dependencies import get_access_token, get_http_request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from src.lib.utils import login


REQUEST_ID_HEADER = 'x-request-id'

_AUTHORIZATION_HEADER = login.OSMO_AUTH_HEADER.lower().encode('ascii')
_USER_HEADER = login.OSMO_USER_HEADER.lower().encode('ascii')
_REQUEST_ID_HEADER = REQUEST_ID_HEADER.encode('ascii')
_CONTEXT_HEADERS = frozenset((
    _AUTHORIZATION_HEADER,
    _USER_HEADER,
    _REQUEST_ID_HEADER,
))
_BEARER_VALUE = re.compile(
    r'Bearer [A-Za-z0-9._~+/-]+=*',
    flags=re.IGNORECASE,
)
_REQUEST_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:-]*')
MAX_AUTHORIZATION_HEADER_BYTES = 128 * 1024
MAX_USER_HEADER_BYTES = 256
MAX_REQUEST_ID_HEADER_BYTES = 128
MIN_BEARER_TOKEN_SUBSTRING_BYTES = 16
MIN_BEARER_TOKEN_BYTES = MIN_BEARER_TOKEN_SUBSTRING_BYTES
_INVALID_CONTEXT_RESPONSE = {'error': 'Invalid MCP authentication context.'}


class RequestContextUnavailable(RuntimeError):
    """The current task is not owned by an active MCP request."""


@dataclasses.dataclass(frozen=True, slots=True)
class RequestCredentials:
    """Gateway-authenticated credentials owned by one MCP request."""

    authorization_header: str = dataclasses.field(repr=False)
    user_name: str
    request_id: str | None

    def __post_init__(self) -> None:
        if not _is_supported_authorization_header(self.authorization_header):
            raise ValueError('Unsupported MCP authorization header.')


@dataclasses.dataclass(slots=True)
class _RequestState:
    credentials: RequestCredentials | None
    active_tasks: set[asyncio.Task[object]] = dataclasses.field(
        default_factory=set,
    )


_request_state: contextvars.ContextVar[_RequestState | None] = (
    contextvars.ContextVar('mcp_request_state', default=None))
_active_tool_name: contextvars.ContextVar[str | None] = (
    contextvars.ContextVar('mcp_active_tool_name', default=None))


class RequestContextMiddleware:
    """Bind Gateway-owned authentication headers to one MCP request."""

    def __init__(self, application: ASGIApp, path: str = '/mcp') -> None:
        self._application = application
        self._path = path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        mask_token = _request_state.set(None)
        try:
            if scope['type'] != 'http' or scope.get('path') != self._path:
                await self._application(scope, receive, send)
                return

            credentials = _parse_credentials(scope.get('headers', []))
            if credentials is None:
                response = JSONResponse(_INVALID_CONTEXT_RESPONSE, status_code=400)
                await response(scope, receive, send)
                return

            downstream_scope = dict(scope)
            downstream_scope['headers'] = [
                (name, value)
                for name, value in scope.get('headers', [])
                if name.lower() not in _CONTEXT_HEADERS
            ]
            request_state = _RequestState(credentials=credentials)
            context_token = _request_state.set(request_state)
            try:
                await self._application(downstream_scope, receive, send)
            finally:
                request_state.credentials = None
                for active_task in tuple(request_state.active_tasks):
                    active_task.cancel()
                request_state.active_tasks.clear()
                _request_state.reset(context_token)
        finally:
            _request_state.reset(mask_token)


def get_request_credentials() -> RequestCredentials:
    """Return credentials from the active request's configured trust boundary."""
    access_token = get_access_token()
    if access_token is not None:
        return _credentials_from_access_token(access_token)

    request_state = _request_state.get()
    if request_state is not None and request_state.credentials is not None:
        return request_state.credentials

    raise RequestContextUnavailable(
        'MCP request credentials are unavailable.')


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
    """Cancel the current tool task when its owning MCP request ends."""
    request_state = _request_state.get()
    current_task = asyncio.current_task()
    if request_state is None:
        # FastMCP owns request-task cancellation in the integrated auth mode.
        yield get_request_credentials()
        return
    if (
        request_state.credentials is None
        or current_task is None
    ):
        raise RequestContextUnavailable(
            'MCP request credentials are unavailable.')

    credentials = request_state.credentials
    request_state.active_tasks.add(current_task)
    try:
        yield credentials
    finally:
        request_state.active_tasks.discard(current_task)


def _credentials_from_access_token(
    access_token: AccessToken,
) -> RequestCredentials:
    """Relay the verified upstream token returned by FastMCP's OIDC proxy."""
    claims = access_token.claims or {}
    upstream_claims = claims.get('upstream_claims')
    if isinstance(upstream_claims, dict):
        claims = upstream_claims

    user_name = next((
        value
        for name in ('preferred_username', 'unique_name', 'upn', 'email', 'sub')
        if isinstance((value := claims.get(name)), str)
        and _is_valid_user_name(value)
    ), None)
    authorization_header = f'Bearer {access_token.token}'
    if user_name is None or not _is_supported_authorization_header(
        authorization_header
    ):
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
        user_name=user_name,
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


def _parse_credentials(
    raw_headers: Iterable[tuple[bytes, bytes]],
) -> RequestCredentials | None:
    relevant_headers: dict[bytes, list[bytes]] = {}
    for name, value in raw_headers:
        normalized_name = name.lower()
        if normalized_name in _CONTEXT_HEADERS:
            relevant_headers.setdefault(normalized_name, []).append(value)

    authorization_values = relevant_headers.get(_AUTHORIZATION_HEADER, [])
    user_values = relevant_headers.get(_USER_HEADER, [])
    request_id_values = relevant_headers.get(_REQUEST_ID_HEADER, [])
    if (
        len(authorization_values) != 1
        or len(user_values) != 1
        or len(authorization_values[0]) > MAX_AUTHORIZATION_HEADER_BYTES
        or len(user_values[0]) > MAX_USER_HEADER_BYTES
    ):
        return None

    authorization_header = _decode_ascii(authorization_values[0])
    user_name = _decode_utf8(user_values[0])
    if (
        authorization_header is None
        or not _is_supported_authorization_header(authorization_header)
        or user_name is None
        or not _is_valid_user_name(user_name)
    ):
        return None

    request_id_is_valid, request_id = _parse_request_id(
        request_id_values,
        authorization_header,
    )
    if not request_id_is_valid:
        return None

    return RequestCredentials(
        authorization_header=authorization_header,
        user_name=user_name,
        request_id=request_id,
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


def _decode_utf8(value: bytes) -> str | None:
    try:
        return value.decode('utf-8')
    except UnicodeDecodeError:
        return None


def _is_valid_user_name(user_name: str) -> bool:
    try:
        encoded_length = len(user_name.encode('utf-8'))
    except UnicodeEncodeError:
        return False
    return (
        bool(user_name)
        and user_name == user_name.strip()
        and encoded_length <= MAX_USER_HEADER_BYTES
        and all(character.isprintable() for character in user_name)
    )
