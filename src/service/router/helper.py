"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import logging
from typing import Callable, Dict, Tuple

import fastapi
import fastapi.responses
from starlette.datastructures import Headers


def resolve_session_key_decorator(service_host: str) -> Callable[[Headers], str | None]:
    """
    Decorator that returns a function for resolving session keys from headers.

    Args:
        service_host: The host of the service.

    Returns:
        Callable[[Headers], str | None]: A function that takes headers and returns session key.
    """

    def resolve_session_key(headers: Headers) -> str | None:
        """
        Resolves the session key from the request host.

        Args:
            headers: The headers of the request.

        Returns:
            str | None: The session key extracted from the hostname, or None if the request
                        is made directly to the service host.
        """
        request_host = headers.get('host', '')
        if 'x-forwarded-host' in headers:
            request_host = headers['x-forwarded-host']
        if ':' in request_host:
            request_host = request_host.split(':')[0]
        if request_host != service_host and request_host.endswith(f'.{service_host}'):
            session_key = request_host.removesuffix(f'.{service_host}')
            logging.info('Resolved session key: %s', session_key)
            return session_key
        else:
            return None

    return resolve_session_key


async def http2raw(request: fastapi.Request | fastapi.WebSocket) -> bytes:
    """Convert a request header to raw HTTP request bytes."""
    method = request.method if isinstance(request, fastapi.Request) else 'GET'
    request_lines = [
        f'{method} {request.url.path}'
        f'{"?" + request.url.query if request.url.query else ""} '
        'HTTP/1.1'
    ]
    for name, value in request.headers.items():
        request_lines.append(f'{name}: {value}')

    return '\r\n'.join(request_lines).encode() + b'\r\n\r\n'


def split_headers_body(response_bytes: bytes) -> Tuple[int, Dict[str, str], bytes]:
    """Split raw HTTP response bytes into headers and body."""
    headers_raw, body = response_bytes.split(b'\r\n\r\n', 1)
    headers_lines = headers_raw.split(b'\r\n')

    # Parse status line
    status_line = headers_lines[0].decode()
    _, status_code_str, _ = status_line.split(' ', 2)
    status_code = int(status_code_str)

    # Parse headers
    headers = {}
    for line in headers_lines[1:]:
        if line:
            name, value = line.decode().split(': ', 1)
            headers[name.lower()] = value

    return status_code, headers, body


async def stream_content(ws: fastapi.WebSocket, close: asyncio.Event, data: bytes, length: int):
    """Stream content from websocket with specified length."""
    try:
        if data:
            yield data
        curr_length = len(data)
        while curr_length < length:
            data = await ws.receive_bytes()
            yield data
            curr_length += len(data)
    except fastapi.WebSocketDisconnect:
        logging.info('WebSocket disconnected while streaming response')
    finally:
        if close:
            close.set()


async def stream_chunked(ws: fastapi.WebSocket, close: asyncio.Event, initial_body: bytes):
    """
    Stream chunked transfer encoding response without buffering entire response in memory.
    """
    # Process initial body if it contains chunk data
    buffer = initial_body
    pos = 0

    while True:
        # Process any complete chunks in the buffer
        while pos < len(buffer):
            # Find chunk size line end
            size_end = buffer.find(b'\r\n', pos)
            if size_end == -1:
                # Incomplete chunk size line, need more data
                break

            # Parse chunk size (hex)
            try:
                chunk_size = int(buffer[pos:size_end].decode(), 16)
            except ValueError:
                logging.error('Invalid chunk size in chunked response')
                if close:
                    close.set()
                return

            if chunk_size == 0:  # End marker "0"
                if close:
                    close.set()
                return

            # Check if we have the complete chunk data
            chunk_start = size_end + 2
            chunk_end = chunk_start + chunk_size
            chunk_trailer_end = chunk_end + 2  # Include trailing CRLF

            if chunk_trailer_end > len(buffer):
                # Incomplete chunk, need more data
                break

            # Extract and yield chunk data
            chunk_data = buffer[chunk_start:chunk_end]
            if chunk_data:
                yield chunk_data

            # Move position to next chunk
            pos = chunk_trailer_end

        # If we processed some data, remove it from buffer
        if pos > 0:
            buffer = buffer[pos:]
            pos = 0

        # Receive more data from websocket
        try:
            data = await ws.receive_bytes()
            buffer += data
        except fastapi.WebSocketDisconnect:
            logging.info('WebSocket disconnected while streaming chunked response')
            break
