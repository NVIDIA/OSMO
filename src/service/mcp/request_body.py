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

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


MAX_MCP_REQUEST_BODY_BYTES = 1024 * 1024
MAX_CONCURRENT_MCP_REQUESTS = 16
MCP_REQUEST_BODY_TIMEOUT_SECONDS = 10

_CONTENT_LENGTH_HEADER = b'content-length'
_REQUEST_TOO_LARGE = {
    'error': 'MCP request body exceeds the 1 MiB limit.',
}
_REQUEST_BODY_TIMEOUT = {
    'error': 'MCP request body timed out.',
}
_REQUEST_CAPACITY_EXCEEDED = {
    'error': 'MCP service is temporarily at capacity.',
}
_METHOD_NOT_ALLOWED = {
    'error': 'MCP accepts POST requests only.',
}


class _RequestBodyTooLarge(Exception):
    """Internal fixed signal for a streamed request-body overflow."""


class RequestBodyLimitMiddleware:
    """Bound POST body size, read time, and in-flight work for one path."""

    def __init__(
        self,
        application: ASGIApp,
        *,
        path: str = '/mcp',
        max_body_bytes: int = MAX_MCP_REQUEST_BODY_BYTES,
        max_concurrent_requests: int = MAX_CONCURRENT_MCP_REQUESTS,
        body_timeout_seconds: float = MCP_REQUEST_BODY_TIMEOUT_SECONDS,
    ) -> None:
        if (
            isinstance(max_body_bytes, bool)
            or not isinstance(max_body_bytes, int)
            or max_body_bytes < 1
        ):
            raise ValueError('max_body_bytes must be a positive integer.')
        if (
            isinstance(max_concurrent_requests, bool)
            or not isinstance(max_concurrent_requests, int)
            or max_concurrent_requests < 1
        ):
            raise ValueError(
                'max_concurrent_requests must be a positive integer.'
            )
        if (
            isinstance(body_timeout_seconds, bool)
            or not isinstance(body_timeout_seconds, (int, float))
            or body_timeout_seconds <= 0
        ):
            raise ValueError('body_timeout_seconds must be positive.')
        self._application = application
        self._path = path
        self._max_body_bytes = max_body_bytes
        self._max_concurrent_requests = max_concurrent_requests
        self._body_timeout_seconds = float(body_timeout_seconds)
        self._active_requests = 0

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if scope['type'] != 'http' or scope.get('path') != self._path:
            await self._application(scope, receive, send)
            return
        if scope.get('method') != 'POST':
            await _send_error(
                scope,
                receive,
                send,
                _METHOD_NOT_ALLOWED,
                405,
                headers={'Allow': 'POST'},
            )
            return

        content_length = _content_length(scope)
        if (
            content_length is not None
            and content_length > self._max_body_bytes
        ):
            await _send_error(scope, receive, send, _REQUEST_TOO_LARGE, 413)
            return

        if self._active_requests >= self._max_concurrent_requests:
            await _send_error(
                scope,
                receive,
                send,
                _REQUEST_CAPACITY_EXCEEDED,
                503,
                headers={'Retry-After': '1'},
            )
            return

        self._active_requests += 1
        try:
            try:
                async with asyncio.timeout(self._body_timeout_seconds):
                    buffered_request, terminal_message = (
                        await _read_bounded_request(
                            receive,
                            self._max_body_bytes,
                        )
                    )
            except _RequestBodyTooLarge:
                await _send_error(
                    scope,
                    receive,
                    send,
                    _REQUEST_TOO_LARGE,
                    413,
                )
                return
            except TimeoutError:
                await _send_error(
                    scope,
                    receive,
                    send,
                    _REQUEST_BODY_TIMEOUT,
                    408,
                )
                return

            async def replay_receive() -> Message:
                nonlocal buffered_request, terminal_message
                if buffered_request is not None:
                    message = buffered_request
                    buffered_request = None
                    return message
                if terminal_message is not None:
                    message = terminal_message
                    terminal_message = None
                    return message
                return await receive()

            await self._application(scope, replay_receive, send)
        finally:
            self._active_requests -= 1


async def _read_bounded_request(
    receive: Receive,
    max_body_bytes: int,
) -> tuple[Message | None, Message | None]:
    """Consolidate one bounded request without retaining the accumulator."""
    buffered_body = bytearray()
    saw_request_message = False
    terminal_message: Message | None = None
    while True:
        message = await receive()
        if message['type'] != 'http.request':
            terminal_message = message
            break
        saw_request_message = True
        chunk = message.get('body', b'')
        if len(buffered_body) + len(chunk) > max_body_bytes:
            raise _RequestBodyTooLarge()
        buffered_body.extend(chunk)
        if not message.get('more_body', False):
            break

    if not saw_request_message:
        return None, terminal_message
    return ({
        'type': 'http.request',
        'body': bytes(buffered_body),
        'more_body': terminal_message is not None,
    }, terminal_message)


def _content_length(scope: Scope) -> int | None:
    """Return one valid declared length; streamed counting remains authoritative."""
    values = [
        value
        for name, value in scope.get('headers', [])
        if name.lower() == _CONTENT_LENGTH_HEADER
    ]
    if len(values) != 1:
        return None
    try:
        value = values[0].decode('ascii')
        if not value or not value.isdecimal():
            return None
        return int(value)
    except (UnicodeDecodeError, ValueError):
        return None


async def _send_error(
    scope: Scope,
    receive: Receive,
    send: Send,
    body: dict[str, str],
    status_code: int,
    *,
    headers: dict[str, str] | None = None,
) -> None:
    response = JSONResponse(body, status_code=status_code, headers=headers)
    await response(scope, receive, send)
