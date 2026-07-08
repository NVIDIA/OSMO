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

import contextvars
import dataclasses
from typing import Iterable

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from src.lib.utils import common


_USER_HEADER = b'x-osmo-user'
_REQUEST_ID_HEADER = b'x-request-id'
_FORBIDDEN_HEADERS = frozenset((
    b'authorization',
    b'cookie',
    b'proxy-authorization',
    b'x-osmo-auth',
))


@dataclasses.dataclass(frozen=True)
class RequestIdentity:
    """Gateway-authenticated identity associated with one MCP request."""

    user_name: str
    request_id: str | None


_request_identity: contextvars.ContextVar[RequestIdentity | None] = (
    contextvars.ContextVar('mcp_request_identity', default=None))


class TrustedIdentityMiddleware:
    """Establish request-local identity from Gateway-owned headers."""

    def __init__(self, application: ASGIApp, path: str = '/mcp') -> None:
        self._application = application
        self._path = path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http' or scope.get('path') != self._path:
            await self._application(scope, receive, send)
            return

        headers = scope.get('headers', [])
        identity = _parse_identity(headers)
        if identity is None:
            response = JSONResponse(
                {'error': 'Invalid trusted identity headers.'}, status_code=400)
            await response(scope, receive, send)
            return

        token = _request_identity.set(identity)
        try:
            await self._application(scope, receive, send)
        finally:
            _request_identity.reset(token)


def get_request_identity() -> RequestIdentity:
    """Return the current trusted identity, or fail outside an MCP request."""
    identity = _request_identity.get()
    if identity is None:
        raise RuntimeError('Trusted MCP request identity is unavailable.')
    return identity


def get_request_id() -> str | None:
    """Return the current request ID when one was supplied by the Gateway."""
    identity = _request_identity.get()
    return identity.request_id if identity is not None else None


def _parse_identity(raw_headers: Iterable[tuple[bytes, bytes]]) -> RequestIdentity | None:
    headers: dict[bytes, list[bytes]] = {}
    for name, value in raw_headers:
        normalized_name = name.lower()
        if normalized_name in _FORBIDDEN_HEADERS:
            return None
        if normalized_name in (_USER_HEADER, _REQUEST_ID_HEADER):
            headers.setdefault(normalized_name, []).append(value)

    user_values = headers.get(_USER_HEADER, [])
    if len(user_values) != 1:
        return None
    user_name = _decode_nonempty(user_values[0])
    if user_name is None or not common.is_valid_authenticated_user_id(user_name):
        return None

    request_id_values = headers.get(_REQUEST_ID_HEADER, [])
    if len(request_id_values) > 1:
        return None
    request_id: str | None = None
    if request_id_values:
        request_id = _decode_nonempty(request_id_values[0])
        if request_id is None or not common.is_valid_request_id(request_id):
            return None

    return RequestIdentity(user_name=user_name, request_id=request_id)


def _decode_nonempty(value: bytes) -> str | None:
    try:
        decoded = value.decode('utf-8')
    except UnicodeDecodeError:
        return None
    if not decoded or decoded != decoded.strip():
        return None
    return decoded
