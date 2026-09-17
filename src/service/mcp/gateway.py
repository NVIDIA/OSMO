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
from collections.abc import AsyncIterator, Mapping, Sequence
import contextlib
import dataclasses
import json
import math
import re
import time
from typing import TypeAlias
from urllib import parse

import httpx

from src.lib.utils import login
from src.service.mcp import request_context, telemetry


_ALLOWED_METHODS = frozenset(('GET', 'POST', 'PATCH', 'DELETE'))
_USER_AGENT = 'osmo-mcp'
_IDENTITY_ENCODING = 'identity'
_QUERY_KEY = re.compile(r'[A-Za-z][A-Za-z0-9_]*')
_MAX_QUERY_BYTES = 16 * 1024
_MAX_JSON_REQUEST_BYTES = 1024 * 1024
_MAX_ERROR_RESPONSE_BYTES = 16 * 1024
_HTTP_LIMITS = httpx.Limits(
    max_connections=100,
    max_keepalive_connections=20,
    keepalive_expiry=30,
)


QueryScalar: TypeAlias = str | int | bool
QueryValue: TypeAlias = QueryScalar | Sequence[QueryScalar]
QueryParams: TypeAlias = Mapping[str, QueryValue]
JsonRequestBody: TypeAlias = Mapping[str, object] | str


class GatewayClientError(RuntimeError):
    """A sanitized failure while calling the configured OSMO Gateway."""


class GatewayUncertainWriteError(GatewayClientError):
    """A write may have reached OSMO, but no authoritative result was received."""


@dataclasses.dataclass(frozen=True, slots=True)
class GatewayResponse:
    """A bounded Gateway response safe for tool-specific validation."""

    status_code: int
    body: bytes = dataclasses.field(repr=False)
    body_truncated: bool = False
    truncation_reason: str | None = None


_RESPONSE_SIZE_LIMIT = 'response_size_limit'
_RESPONSE_TIMEOUT = 'response_timeout'


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
        query: QueryParams | None = None,
        json_body: JsonRequestBody | None = None,
    ) -> GatewayResponse:
        """Call a fixed API path and require its 2xx response body to fit."""
        return await self._request(
            method,
            path,
            credentials=credentials,
            max_response_bytes=max_response_bytes,
            query=query,
            json_body=json_body,
            truncate_success=False,
        )

    async def request_text_prefix(
        self,
        method: str,
        path: str,
        *,
        credentials: request_context.RequestCredentials,
        max_response_bytes: int,
        query: QueryParams | None = None,
    ) -> GatewayResponse:
        """Return a bounded prefix from one fixed API path's 2xx response."""
        return await self._request(
            method,
            path,
            credentials=credentials,
            max_response_bytes=max_response_bytes,
            query=query,
            json_body=None,
            truncate_success=True,
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        credentials: request_context.RequestCredentials,
        max_response_bytes: int,
        query: QueryParams | None,
        json_body: JsonRequestBody | None,
        truncate_success: bool,
    ) -> GatewayResponse:
        """Call a fixed API path with credentials from the active MCP request."""
        if method not in _ALLOWED_METHODS:
            raise ValueError('Gateway request method is not allowed.')
        _validate_api_path(path)
        if max_response_bytes < 1:
            raise ValueError('max_response_bytes must be positive.')
        if request_context.request_id_overlaps_bearer(
            credentials.authorization_header,
            credentials.request_id,
        ):
            raise ValueError('Gateway request credentials are invalid.')
        encoded_query = _encode_query_params(query)
        encoded_body = _encode_json_body(method, json_body)
        if (
            encoded_body is not None
            and _contains_relayed_credentials(encoded_body, credentials)
        ):
            raise ValueError('Gateway request body is invalid.')

        headers = {
            login.OSMO_AUTH_HEADER: credentials.authorization_header,
            'Accept-Encoding': _IDENTITY_ENCODING,
            'User-Agent': _USER_AGENT,
        }
        if credentials.request_id is not None:
            headers[request_context.REQUEST_ID_HEADER] = credentials.request_id
        if encoded_body is not None:
            headers['Content-Type'] = 'application/json'

        request = self._client.build_request(
            method,
            path,
            headers=headers,
            params=encoded_query,
            content=encoded_body,
        )
        # HTTPX stores response cookies on the process-wide client. Never let
        # that shared state become credentials on a later caller's request.
        request.headers.pop('cookie', None)

        start_time = time.monotonic()
        status_code: int | None = None
        outcome = 'transport_error'
        response: httpx.Response | None = None
        response_body = b''
        response_body_prefix = bytearray()
        body_truncated = False
        truncation_reason: str | None = None
        try:
            try:
                async with asyncio.timeout(self._request_timeout_seconds):
                    response = await self._client.send(request, stream=True)
                    status_code = response.status_code
                    outcome = 'invalid_response'
                    try:
                        if 300 <= response.status_code < 400:
                            raise GatewayClientError(
                                'OSMO Gateway returned an unsafe redirect.')
                        if response.headers.get(
                            'content-encoding', _IDENTITY_ENCODING
                        ).lower() != _IDENTITY_ENCODING:
                            raise GatewayClientError(
                                'OSMO Gateway returned an invalid response.')

                        if not response.is_success:
                            body_truncated = await _read_bounded_prefix(
                                response,
                                _MAX_ERROR_RESPONSE_BYTES,
                                response_body_prefix,
                            )
                            response_body = bytes(response_body_prefix)
                            if body_truncated:
                                truncation_reason = _RESPONSE_SIZE_LIMIT
                            outcome = 'upstream_error'
                        elif truncate_success:
                            body_truncated = await _read_bounded_prefix(
                                response,
                                max_response_bytes,
                                response_body_prefix,
                            )
                            response_body = bytes(response_body_prefix)
                            if body_truncated:
                                truncation_reason = _RESPONSE_SIZE_LIMIT
                            outcome = (
                                'response_truncated'
                                if body_truncated
                                else 'response_received'
                            )
                        else:
                            response_body = await _read_strict_body(
                                response,
                                max_response_bytes,
                            )
                            body_truncated = False
                            outcome = 'response_received'
                    finally:
                        await response.aclose()
            except (TimeoutError, httpx.TimeoutException):
                if (
                    not truncate_success
                    or response is None
                    or not response.is_success
                ):
                    outcome = 'transport_error'
                    raise _transport_error(method) from None
                response_body = bytes(response_body_prefix)
                body_truncated = True
                truncation_reason = _RESPONSE_TIMEOUT
                outcome = 'response_truncated'
            except httpx.RequestError:
                outcome = 'transport_error'
                raise _transport_error(method) from None

            if response is None:
                raise AssertionError('Gateway response state is unavailable.')
            if _contains_relayed_credentials(
                response_body,
                credentials,
                include_partial_suffix=body_truncated,
            ):
                outcome = 'invalid_response'
                raise GatewayClientError(
                    'OSMO Gateway returned an invalid response.')
            return GatewayResponse(
                response.status_code,
                response_body,
                body_truncated=body_truncated,
                truncation_reason=truncation_reason,
            )
        finally:
            # Set-Cookie is upstream response data, never caller-independent
            # client state. Clear it even when streaming or decoding fails.
            self._client.cookies.clear()
            telemetry.log_upstream_call(
                method=method,
                path=path,
                status_code=status_code,
                duration_ms=(time.monotonic() - start_time) * 1000,
                outcome=outcome,
                request_id=credentials.request_id,
            )


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
        or decoded_path.count('/') != parsed_path.path.count('/')
        or '\\' in decoded_path
        or any(
            ord(character) < 0x20 or ord(character) == 0x7F
            for character in decoded_path
        )
        or any(segment in ('.', '..') for segment in decoded_path.split('/'))
    ):
        raise ValueError('Gateway requests require a relative OSMO API path.')


def _encode_query_params(
    query: QueryParams | None,
) -> httpx.QueryParams | None:
    """Validate and encode caller-independent query names and typed values."""
    if query is None:
        return None
    if not isinstance(query, Mapping):
        raise ValueError('Gateway query parameters must be a mapping.')

    encoded: list[tuple[str, str | int | float | bool | None]] = []
    for key, raw_value in query.items():
        if not isinstance(key, str) or _QUERY_KEY.fullmatch(key) is None:
            raise ValueError('Gateway query parameter name is not allowed.')
        values: Sequence[QueryScalar]
        if isinstance(raw_value, (str, int, bool)):
            values = (raw_value,)
        elif isinstance(raw_value, Sequence) and not isinstance(
            raw_value, (bytes, bytearray)
        ):
            values = raw_value
        else:
            raise ValueError('Gateway query parameter value is not allowed.')

        for value in values:
            if not isinstance(value, (str, int, bool)):
                raise ValueError('Gateway query parameter value is not allowed.')
            normalized = str(value).lower() if isinstance(value, bool) else str(value)
            try:
                normalized.encode('utf-8')
            except UnicodeEncodeError:
                raise ValueError(
                    'Gateway query parameter value is not allowed.'
                ) from None
            if any(
                ord(character) < 0x20 or ord(character) == 0x7F
                for character in normalized
            ):
                raise ValueError('Gateway query parameter value is not allowed.')
            encoded.append((key, normalized))

    if len(parse.urlencode(encoded).encode('ascii')) > _MAX_QUERY_BYTES:
        raise ValueError('Gateway query parameters exceed the size limit.')
    return httpx.QueryParams(encoded)


def _encode_json_body(
    method: str,
    json_body: JsonRequestBody | None,
) -> bytes | None:
    """Serialize one bounded JSON object or string for a write request."""
    if json_body is None:
        return None
    if (
        method == 'GET'
        or not isinstance(json_body, (Mapping, str))
    ):
        raise ValueError('Gateway request body is not allowed.')
    json_value = (
        dict(json_body)
        if isinstance(json_body, Mapping)
        else json_body
    )
    try:
        encoded_body = json.dumps(
            json_value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(',', ':'),
        ).encode('utf-8')
    except (TypeError, ValueError, UnicodeEncodeError):
        raise ValueError('Gateway request body is invalid.') from None
    if len(encoded_body) > _MAX_JSON_REQUEST_BYTES:
        raise ValueError('Gateway request body exceeds the size limit.')
    return encoded_body


def _transport_error(method: str) -> GatewayClientError:
    if method == 'GET':
        return GatewayClientError('OSMO Gateway is unavailable.')
    return GatewayUncertainWriteError(
        'OSMO Gateway write outcome is unknown.'
    )


def _validate_content_length(
    response: httpx.Response,
    max_response_bytes: int,
) -> None:
    content_length = _content_length(response)
    if content_length is not None and content_length > max_response_bytes:
        raise GatewayClientError(
            'OSMO Gateway response exceeds the size limit.')


def _content_length(response: httpx.Response) -> int | None:
    """Parse a Content-Length header without trusting it as the actual size."""
    content_length_header = response.headers.get('content-length')
    if content_length_header is None:
        return None
    try:
        content_length = int(content_length_header)
    except ValueError:
        raise GatewayClientError(
            'OSMO Gateway returned an invalid response.') from None
    if content_length < 0:
        raise GatewayClientError('OSMO Gateway returned an invalid response.')
    return content_length


async def _read_strict_body(
    response: httpx.Response,
    max_response_bytes: int,
) -> bytes:
    """Read a whole successful body or fail closed when it is oversized."""
    _validate_content_length(response, max_response_bytes)
    response_body = bytearray()
    async for chunk in response.aiter_bytes():
        if len(response_body) + len(chunk) > max_response_bytes:
            raise GatewayClientError(
                'OSMO Gateway response exceeds the size limit.')
        response_body.extend(chunk)
    return bytes(response_body)


async def _read_bounded_prefix(
    response: httpx.Response,
    max_response_bytes: int,
    response_body: bytearray,
) -> bool:
    """Read at most one prefix and report whether more response bytes exist."""
    content_length = _content_length(response)
    body_truncated = (
        content_length is not None and content_length > max_response_bytes
    )
    async for chunk in response.aiter_bytes():
        remaining = max_response_bytes - len(response_body)
        if len(chunk) > remaining:
            response_body.extend(chunk[:remaining])
            body_truncated = True
            break
        response_body.extend(chunk)
        if len(response_body) == max_response_bytes and body_truncated:
            break
    return body_truncated


def _contains_relayed_credentials(
    response_body: bytes,
    credentials: request_context.RequestCredentials,
    *,
    include_partial_suffix: bool = False,
) -> bool:
    authorization_header = credentials.authorization_header.encode('ascii')
    _, _, bearer_token = authorization_header.partition(b' ')
    if (
        authorization_header in response_body
        or (
            len(bearer_token)
            >= request_context.MIN_BEARER_TOKEN_SUBSTRING_BYTES
            and bearer_token in response_body
        )
    ):
        return True

    if not include_partial_suffix:
        return False
    # A size boundary can split a reflected credential. Reject a meaningful
    # prefix of either relayed secret instead of returning that partial secret to
    # the MCP caller. Checking one fixed prefix keeps this linear even when the
    # request contains the maximum-sized bearer token.
    for secret in (authorization_header, bearer_token):
        if (
            len(secret) >= request_context.MIN_BEARER_TOKEN_SUBSTRING_BYTES
            and secret[:request_context.MIN_BEARER_TOKEN_SUBSTRING_BYTES]
            in response_body
        ):
            return True
    return False
