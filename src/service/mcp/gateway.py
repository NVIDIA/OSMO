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
import math
from urllib import parse

import httpx

from src.lib.utils import login
from src.service.mcp import request_context


_ALLOWED_METHODS = frozenset(('GET', 'POST', 'PATCH', 'DELETE'))
_USER_AGENT = 'osmo-mcp'
_IDENTITY_ENCODING = 'identity'
_HTTP_LIMITS = httpx.Limits(
    max_connections=100,
    max_keepalive_connections=20,
    keepalive_expiry=30,
)


class GatewayClientError(RuntimeError):
    """A sanitized failure while calling the configured OSMO Gateway."""


@dataclasses.dataclass(frozen=True, slots=True)
class GatewayResponse:
    """A bounded Gateway response safe for tool-specific validation."""

    status_code: int
    body: bytes = dataclasses.field(repr=False)


class GatewayClient:
    """Send caller-bound requests to one configured OSMO Gateway origin."""

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
        credentials: request_context.RequestCredentials,
        max_response_bytes: int,
    ) -> GatewayResponse:
        """Call a fixed API path with credentials from the active MCP request."""
        if method not in _ALLOWED_METHODS:
            raise ValueError('Gateway request method is not allowed.')
        _validate_api_path(path)
        if max_response_bytes < 1:
            raise ValueError('max_response_bytes must be positive.')

        headers = {
            login.OSMO_AUTH_HEADER: credentials.authorization_header,
            'Accept-Encoding': _IDENTITY_ENCODING,
            'User-Agent': _USER_AGENT,
        }
        if credentials.request_id is not None:
            headers[request_context.REQUEST_ID_HEADER] = credentials.request_id

        request = self._client.build_request(method, path, headers=headers)
        # HTTPX stores response cookies on the process-wide client. Never let
        # that shared state become credentials on a later caller's request.
        request.headers.pop('cookie', None)

        try:
            async with asyncio.timeout(self._request_timeout_seconds):
                response = await self._client.send(request, stream=True)
                try:
                    if 300 <= response.status_code < 400:
                        raise GatewayClientError(
                            'OSMO Gateway returned an unsafe redirect.')
                    if not response.is_success:
                        return GatewayResponse(response.status_code, b'')

                    if response.headers.get(
                        'content-encoding', _IDENTITY_ENCODING
                    ).lower() != _IDENTITY_ENCODING:
                        raise GatewayClientError(
                            'OSMO Gateway returned an invalid response.')
                    _validate_content_length(response, max_response_bytes)
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
        finally:
            # Set-Cookie is upstream response data, never caller-independent
            # client state. Clear it even when streaming or decoding fails.
            self._client.cookies.clear()

        response_body_bytes = bytes(response_body)
        if _contains_relayed_credentials(response_body_bytes, credentials):
            raise GatewayClientError(
                'OSMO Gateway returned an invalid response.')
        return GatewayResponse(response.status_code, response_body_bytes)


@dataclasses.dataclass(frozen=True, slots=True)
class AppContext:
    """Process-lifetime dependencies shared by MCP tool calls."""

    gateway: GatewayClient


@contextlib.asynccontextmanager
async def create_app_context(
    *,
    gateway_url: str,
    request_timeout_seconds: float,
    transport: httpx.AsyncBaseTransport | None = None,
) -> AsyncIterator[AppContext]:
    """Create one credential-free HTTP connection pool for the MCP process."""
    validate_gateway_origin(gateway_url)
    if (
        not math.isfinite(request_timeout_seconds)
        or request_timeout_seconds <= 0
        or request_timeout_seconds > 60
    ):
        raise ValueError(
            'Gateway request timeout must be greater than 0 and at most 60 seconds.')
    async with httpx.AsyncClient(
        base_url=gateway_url,
        follow_redirects=False,
        limits=_HTTP_LIMITS,
        timeout=httpx.Timeout(request_timeout_seconds),
        transport=transport,
        trust_env=False,
        verify=True,
    ) as client:
        yield AppContext(
            gateway=GatewayClient(
                client,
                request_timeout_seconds=request_timeout_seconds,
            ),
        )


def validate_gateway_origin(gateway_url: str) -> None:
    """Reject any Gateway base URL that is not one fixed HTTPS origin."""
    try:
        parsed_url = parse.urlsplit(gateway_url)
        _ = parsed_url.port
    except ValueError:
        raise ValueError(
            'gateway_url must be a valid HTTPS origin.') from None

    if (
        any(ord(character) <= 0x20 or ord(character) == 0x7F
            for character in gateway_url)
        or '\\' in gateway_url
        or '%' in parsed_url.netloc
        or parsed_url.scheme != 'https'
        or not parsed_url.hostname
        or parsed_url.username is not None
        or parsed_url.password is not None
        or parsed_url.path not in ('', '/')
        or parsed_url.query
        or parsed_url.fragment
    ):
        raise ValueError(
            'gateway_url must be an HTTPS origin without credentials, '
            'path, query, or fragment.')


def _validate_api_path(path: str) -> None:
    parsed_path = parse.urlsplit(path)
    if (
        any(ord(character) < 0x20 or ord(character) == 0x7F for character in path)
        or parsed_path.scheme
        or parsed_path.netloc
        or parsed_path.query
        or parsed_path.fragment
        or not parsed_path.path.startswith('/api/')
        or '//' in parsed_path.path
    ):
        raise ValueError('Gateway requests require a relative OSMO API path.')

    decoded_path = parsed_path.path
    while True:
        next_decoded_path = parse.unquote(decoded_path)
        if next_decoded_path == decoded_path:
            break
        decoded_path = next_decoded_path
    if (
        not decoded_path.startswith('/api/')
        or '//' in decoded_path
        or '\\' in decoded_path
        or any(
            ord(character) < 0x20 or ord(character) == 0x7F
            for character in decoded_path
        )
        or any(segment in ('.', '..') for segment in decoded_path.split('/'))
    ):
        raise ValueError('Gateway requests require a relative OSMO API path.')


def _validate_content_length(
    response: httpx.Response,
    max_response_bytes: int,
) -> None:
    content_length_header = response.headers.get('content-length')
    if content_length_header is None:
        return
    try:
        content_length = int(content_length_header)
    except ValueError:
        raise GatewayClientError(
            'OSMO Gateway returned an invalid response.') from None
    if content_length < 0:
        raise GatewayClientError('OSMO Gateway returned an invalid response.')
    if content_length > max_response_bytes:
        raise GatewayClientError(
            'OSMO Gateway response exceeds the size limit.')


def _contains_relayed_credentials(
    response_body: bytes,
    credentials: request_context.RequestCredentials,
) -> bool:
    authorization_header = credentials.authorization_header.encode('ascii')
    _, _, bearer_token = authorization_header.partition(b' ')
    return (
        authorization_header in response_body
        or (
            len(bearer_token)
            >= request_context.MIN_BEARER_TOKEN_SUBSTRING_BYTES
            and bearer_token in response_body
        )
    )
