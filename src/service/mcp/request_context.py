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

from collections.abc import Iterable
import contextvars
import dataclasses
import re

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
_INVALID_CONTEXT_RESPONSE = {'error': 'Invalid MCP authentication context.'}


@dataclasses.dataclass(frozen=True, slots=True)
class RequestCredentials:
    """Gateway-authenticated credentials owned by one MCP request."""

    authorization_header: str = dataclasses.field(repr=False)
    user_name: str
    request_id: str | None


@dataclasses.dataclass(slots=True)
class _RequestState:
    credentials: RequestCredentials | None


_request_state: contextvars.ContextVar[_RequestState | None] = (
    contextvars.ContextVar('mcp_request_state', default=None))


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
                _request_state.reset(context_token)
        finally:
            _request_state.reset(mask_token)


def get_request_credentials() -> RequestCredentials:
    """Return credentials for the active MCP request."""
    request_state = _request_state.get()
    if request_state is None or request_state.credentials is None:
        raise RuntimeError('MCP request credentials are unavailable.')
    return request_state.credentials


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
        or len(request_id_values) > 1
        or len(authorization_values[0]) > MAX_AUTHORIZATION_HEADER_BYTES
        or len(user_values[0]) > MAX_USER_HEADER_BYTES
        or (
            request_id_values
            and len(request_id_values[0]) > MAX_REQUEST_ID_HEADER_BYTES
        )
    ):
        return None

    authorization_header = _decode_ascii(authorization_values[0])
    user_name = _decode_utf8(user_values[0])
    if (
        authorization_header is None
        or _BEARER_VALUE.fullmatch(authorization_header) is None
        or user_name is None
        or not _is_valid_user_name(user_name)
    ):
        return None

    request_id: str | None = None
    if request_id_values:
        request_id = _decode_ascii(request_id_values[0])
        if request_id is None or _REQUEST_ID.fullmatch(request_id) is None:
            return None

    return RequestCredentials(
        authorization_header=authorization_header,
        user_name=user_name,
        request_id=request_id,
    )


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
