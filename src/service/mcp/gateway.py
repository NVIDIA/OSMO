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
from collections.abc import AsyncIterator
import contextlib
import dataclasses
from urllib import parse

import httpx

from src.lib.utils import login
from src.service.mcp import request_context


_USER_AGENT = 'osmo-mcp'


class GatewayClientError(RuntimeError):
    """A sanitized failure while calling the configured OSMO Gateway."""


@dataclasses.dataclass(frozen=True, slots=True)
class GatewayResponse:
    """Bounded Gateway response safe for tool-specific validation."""

    status_code: int
    body: bytes = dataclasses.field(repr=False)


class GatewayClient:
    """Send request-scoped authenticated calls to one fixed Gateway origin."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        request_timeout_seconds: float,
    ) -> None:
        self._client = client
        self._request_timeout_seconds = request_timeout_seconds

    async def request(
        self,
        method: str,
        path: str,
        *,
        max_response_bytes: int,
    ) -> GatewayResponse:
        """Call a fixed OSMO API path with the active request's bearer header."""
        _validate_api_path(path)
        if max_response_bytes < 1:
            raise ValueError('max_response_bytes must be positive.')

        credentials = request_context.get_request_credentials()
        headers = {
            login.OSMO_AUTH_HEADER: credentials.authorization_header,
            'User-Agent': _USER_AGENT,
        }
        if credentials.request_id is not None:
            headers[login.REQUEST_ID_HEADER] = credentials.request_id

        request = self._client.build_request(method, path, headers=headers)
        # AsyncClient retains response cookies process-wide. Never let that
        # shared state become credentials on another caller's request.
        request.headers.pop('cookie', None)

        try:
            # HTTPX timeouts cover individual I/O phases. This outer deadline
            # also bounds peers that continually return data without finishing.
            async with asyncio.timeout(self._request_timeout_seconds):
                response = await self._client.send(request, stream=True)
                try:
                    if not response.is_success:
                        return GatewayResponse(response.status_code, b'')

                    response_body = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(response_body) + len(chunk) > max_response_bytes:
                            raise GatewayClientError(
                                'OSMO Gateway response exceeds the size limit.')
                        response_body.extend(chunk)
                finally:
                    await response.aclose()
        except (TimeoutError, httpx.RequestError):
            raise GatewayClientError('OSMO Gateway is unavailable.') from None

        return GatewayResponse(response.status_code, bytes(response_body))


@dataclasses.dataclass(frozen=True, slots=True)
class AppContext:
    """Process-lifetime dependencies shared by MCP tool calls."""

    gateway: GatewayClient


@contextlib.asynccontextmanager
async def create_app_context(
    *,
    api_url: str,
    request_timeout_seconds: float,
    transport: httpx.AsyncBaseTransport | None = None,
) -> AsyncIterator[AppContext]:
    """Create one headerless HTTP connection pool for the MCP process."""
    async with httpx.AsyncClient(
        base_url=api_url,
        follow_redirects=False,
        timeout=httpx.Timeout(request_timeout_seconds),
        transport=transport,
        trust_env=False,
    ) as client:
        yield AppContext(
            gateway=GatewayClient(
                client,
                request_timeout_seconds=request_timeout_seconds,
            ),
        )


def _validate_api_path(path: str) -> None:
    parsed_path = parse.urlsplit(path)
    if (
        parsed_path.scheme or
        parsed_path.netloc or
        parsed_path.query or
        parsed_path.fragment or
        not parsed_path.path.startswith('/api/')
    ):
        raise ValueError('Gateway requests require a relative OSMO API path.')

    decoded_path = parsed_path.path
    while True:
        next_decoded_path = parse.unquote(decoded_path)
        if next_decoded_path == decoded_path:
            break
        decoded_path = next_decoded_path
    if (
        '\\' in decoded_path or
        any(segment in ('.', '..') for segment in decoded_path.split('/'))
    ):
        raise ValueError('Gateway requests require a relative OSMO API path.')
