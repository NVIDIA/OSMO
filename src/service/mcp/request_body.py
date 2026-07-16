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

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


MAX_MCP_REQUEST_BODY_BYTES = 1024 * 1024

_CONTENT_LENGTH_HEADER = b'content-length'
_REQUEST_TOO_LARGE = {
    'error': 'MCP request body exceeds the 1 MiB limit.',
}


class RequestBodyLimitMiddleware:
    """Enforce a bounded request body for one ASGI HTTP path."""

    def __init__(
        self,
        application: ASGIApp,
        *,
        path: str = '/mcp',
        max_body_bytes: int = MAX_MCP_REQUEST_BODY_BYTES,
    ) -> None:
        if (
            isinstance(max_body_bytes, bool)
            or not isinstance(max_body_bytes, int)
            or max_body_bytes < 1
        ):
            raise ValueError('max_body_bytes must be a positive integer.')
        self._application = application
        self._path = path
        self._max_body_bytes = max_body_bytes

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if scope['type'] != 'http' or scope.get('path') != self._path:
            await self._application(scope, receive, send)
            return

        content_length = _content_length(scope)
        if (
            content_length is not None
            and content_length > self._max_body_bytes
        ):
            await _reject_request(scope, receive, send)
            return

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
            if len(buffered_body) + len(chunk) > self._max_body_bytes:
                await _reject_request(scope, receive, send)
                return
            buffered_body.extend(chunk)
            if not message.get('more_body', False):
                break

        buffered_messages: list[Message] = []
        if saw_request_message:
            buffered_messages.append({
                'type': 'http.request',
                'body': bytes(buffered_body),
                'more_body': terminal_message is not None,
            })
        if terminal_message is not None:
            buffered_messages.append(terminal_message)

        next_message = 0

        async def replay_receive() -> Message:
            nonlocal next_message
            if next_message < len(buffered_messages):
                message = buffered_messages[next_message]
                next_message += 1
                return message
            return await receive()

        await self._application(scope, replay_receive, send)


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


async def _reject_request(
    scope: Scope,
    receive: Receive,
    send: Send,
) -> None:
    response = JSONResponse(_REQUEST_TOO_LARGE, status_code=413)
    await response(scope, receive, send)
