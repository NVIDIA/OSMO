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
import collections
from collections.abc import AsyncIterator, Callable
import contextlib
import dataclasses
import pathlib
import ssl
import time

import httpx
import pydantic

from src.lib.utils import common, login
from src.service.mcp import identity


_ACCESS_TOKEN_PATH = '/api/auth/jwt/access_token'
_DELEGATED_TOKEN_PATH = '/api/auth/jwt/delegated_access_token'
_MAX_CREDENTIAL_BYTES = 16 * 1024
_MAX_TOKEN_RESPONSE_BYTES = 128 * 1024


class TokenProviderError(RuntimeError):
    """Base class for sanitized token provider failures."""


class CredentialError(TokenProviderError):
    """The mounted service credential could not be read safely."""


class GatewayUnavailableError(TokenProviderError):
    """The Gateway could not be reached within the configured limits."""


class GatewayTLSConfigurationError(TokenProviderError):
    """The configured Gateway trust roots could not be loaded."""


class GatewayResponseError(TokenProviderError):
    """The Gateway returned a non-success status without exposing its body."""

    def __init__(self, operation: str, status_code: int) -> None:
        self.operation = operation
        self.status_code = status_code
        super().__init__(
            f'Gateway {operation} failed with HTTP status {status_code}.')


class InvalidGatewayResponseError(TokenProviderError):
    """The Gateway response did not match the strict token contract."""


def _is_visible_ascii(value: str) -> bool:
    return bool(value) and all(0x21 <= ord(character) <= 0x7e for character in value)


class _TokenResponse(pydantic.BaseModel):
    """Strict token response accepted from Gateway endpoints."""

    model_config = pydantic.ConfigDict(extra='forbid', strict=True)

    token: str = pydantic.Field(min_length=1, max_length=65536)
    expires_at: int = pydantic.Field(gt=0, le=2**63 - 1)

    @pydantic.field_validator('token')
    @classmethod
    def _validate_token(cls, token: str) -> str:
        if not _is_visible_ascii(token):
            raise ValueError('Token must contain visible ASCII characters only.')
        return token


@dataclasses.dataclass(frozen=True)
class _CachedToken:
    token: str
    expires_at: int
    cache_deadline: float

    def is_valid(self, monotonic_time: float) -> bool:
        return monotonic_time < self.cache_deadline


class ServiceTokenProvider:
    """Exchange a mounted PAT for a short-lived service JWT."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        credential_file: pathlib.Path,
        cache_skew_seconds: float,
        *,
        wall_time: Callable[[], float] = time.time,
        monotonic_time: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._credential_file = credential_file
        self._cache_skew_seconds = cache_skew_seconds
        self._wall_time = wall_time
        self._monotonic_time = monotonic_time
        self._lock = asyncio.Lock()
        self._cached_token: _CachedToken | None = None
        self._refresh_task: asyncio.Task[_CachedToken] | None = None

    async def get_token(self, request_id: str | None = None) -> str:
        """Return a cached service JWT, refreshing it at most once concurrently."""
        if request_id is None:
            request_id = identity.get_request_id()
        async with self._lock:
            if (self._cached_token is not None and
                    self._cached_token.is_valid(self._monotonic_time())):
                return self._cached_token.token
            self._cached_token = None

            if self._refresh_task is None:
                self._refresh_task = asyncio.create_task(
                    self._refresh(request_id), name='mcp-service-token-refresh')
                self._refresh_task.add_done_callback(_consume_task_exception)
            refresh_task = self._refresh_task

        return (await asyncio.shield(refresh_task)).token

    async def invalidate(self, token: str) -> bool:
        """Delete the cache only when it still contains the rejected JWT."""
        async with self._lock:
            if self._cached_token is None or self._cached_token.token != token:
                return False
            self._cached_token = None
            return True

    async def _refresh(self, request_id: str | None) -> _CachedToken:
        current_task = asyncio.current_task()
        try:
            credential = await asyncio.to_thread(self._read_credential)
            response = await _request_token(
                self._client,
                operation='service token exchange',
                path=_ACCESS_TOKEN_PATH,
                json_body={'token': credential},
                request_id=request_id,
            )
            cached_token = _to_cached_token(
                response,
                cache_skew_seconds=self._cache_skew_seconds,
                wall_time=self._wall_time,
                monotonic_time=self._monotonic_time,
            )
            async with self._lock:
                self._cached_token = cached_token
            return cached_token
        finally:
            async with self._lock:
                if self._refresh_task is current_task:
                    self._refresh_task = None

    def _read_credential(self) -> str:
        try:
            with self._credential_file.open('rb') as credential_file:
                credential_bytes = credential_file.read(_MAX_CREDENTIAL_BYTES + 1)
        except OSError:
            raise CredentialError('Service credential is unavailable.') from None

        if len(credential_bytes) > _MAX_CREDENTIAL_BYTES:
            raise CredentialError('Service credential exceeds the size limit.')
        try:
            credential = credential_bytes.decode('utf-8').strip()
        except UnicodeDecodeError:
            raise CredentialError('Service credential is not valid UTF-8.') from None
        if not _is_visible_ascii(credential):
            raise CredentialError('Service credential has an invalid format.')
        return credential


class DelegatedTokenProvider:
    """Mint and cache bounded per-user delegated JWTs."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        service_tokens: ServiceTokenProvider,
        cache_max_size: int,
        cache_skew_seconds: float,
        *,
        identity_resolver: Callable[[], identity.RequestIdentity] = (
            identity.get_request_identity),
        wall_time: Callable[[], float] = time.time,
        monotonic_time: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._service_tokens = service_tokens
        self._cache_max_size = cache_max_size
        self._cache_skew_seconds = cache_skew_seconds
        self._identity_resolver = identity_resolver
        self._wall_time = wall_time
        self._monotonic_time = monotonic_time
        self._lock = asyncio.Lock()
        self._cache: collections.OrderedDict[str, _CachedToken] = (
            collections.OrderedDict())
        self._mint_tasks: dict[str, asyncio.Task[_CachedToken]] = {}

    async def get_token(self) -> str:
        """Return the exact user's delegated JWT with per-user single-flight."""
        request_identity = self._identity_resolver()
        subject_user = request_identity.user_name
        request_id = request_identity.request_id
        _validate_subject_user(subject_user)
        async with self._lock:
            cached_token = self._cache.get(subject_user)
            if cached_token is not None:
                if cached_token.is_valid(self._monotonic_time()):
                    self._cache.move_to_end(subject_user)
                    return cached_token.token
                del self._cache[subject_user]

            mint_task = self._mint_tasks.get(subject_user)
            if mint_task is None:
                mint_task = asyncio.create_task(
                    self._mint_and_store(subject_user, request_id),
                    name='mcp-delegated-token-mint',
                )
                mint_task.add_done_callback(_consume_task_exception)
                self._mint_tasks[subject_user] = mint_task

        return (await asyncio.shield(mint_task)).token

    async def invalidate(self, token: str) -> bool:
        """Delete only the exact user's exact rejected delegated JWT."""
        request_identity = self._identity_resolver()
        subject_user = request_identity.user_name
        _validate_subject_user(subject_user)
        async with self._lock:
            cached_token = self._cache.get(subject_user)
            if cached_token is None or cached_token.token != token:
                return False
            del self._cache[subject_user]
            return True

    async def _mint_and_store(
        self,
        subject_user: str,
        request_id: str | None,
    ) -> _CachedToken:
        current_task = asyncio.current_task()
        try:
            cached_token = await self._mint(subject_user, request_id)
            async with self._lock:
                self._cache[subject_user] = cached_token
                self._cache.move_to_end(subject_user)
                while len(self._cache) > self._cache_max_size:
                    self._cache.popitem(last=False)
            return cached_token
        finally:
            async with self._lock:
                if self._mint_tasks.get(subject_user) is current_task:
                    del self._mint_tasks[subject_user]

    async def _mint(
        self,
        subject_user: str,
        request_id: str | None,
    ) -> _CachedToken:
        service_token = await self._service_tokens.get_token(request_id)
        try:
            response = await self._request_delegated_token(
                subject_user, service_token, request_id)
        except GatewayResponseError as error:
            if error.status_code != 401:
                raise
            await self._service_tokens.invalidate(service_token)
            service_token = await self._service_tokens.get_token(request_id)
            response = await self._request_delegated_token(
                subject_user, service_token, request_id)

        return _to_cached_token(
            response,
            cache_skew_seconds=self._cache_skew_seconds,
            wall_time=self._wall_time,
            monotonic_time=self._monotonic_time,
        )

    async def _request_delegated_token(
        self,
        subject_user: str,
        service_token: str,
        request_id: str | None,
    ) -> _TokenResponse:
        return await _request_token(
            self._client,
            operation='delegated token exchange',
            path=_DELEGATED_TOKEN_PATH,
            json_body={'subject_user': subject_user},
            request_id=request_id,
            authorization=f'Bearer {service_token}',
        )


@dataclasses.dataclass(frozen=True)
class AppContext:
    """Shared MCP runtime exposed through FastMCP's lifespan context."""

    http_client: httpx.AsyncClient
    service_tokens: ServiceTokenProvider
    delegated_tokens: DelegatedTokenProvider


@contextlib.asynccontextmanager
async def create_app_context(
    *,
    api_url: str,
    service_token_file: pathlib.Path,
    request_timeout_seconds: float,
    token_cache_max_size: int,
    token_cache_skew_seconds: float,
    gateway_ca_file: pathlib.Path | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> AsyncIterator[AppContext]:
    """Create the process-lifetime HTTP client and token providers."""
    ssl_context = build_gateway_ssl_context(gateway_ca_file)
    async with httpx.AsyncClient(
        base_url=api_url,
        timeout=httpx.Timeout(request_timeout_seconds),
        follow_redirects=False,
        trust_env=False,
        verify=ssl_context,
        transport=transport,
    ) as client:
        service_tokens = ServiceTokenProvider(
            client,
            service_token_file,
            token_cache_skew_seconds,
        )
        delegated_tokens = DelegatedTokenProvider(
            client,
            service_tokens,
            token_cache_max_size,
            token_cache_skew_seconds,
        )
        yield AppContext(
            http_client=client,
            service_tokens=service_tokens,
            delegated_tokens=delegated_tokens,
        )


def build_gateway_ssl_context(
    gateway_ca_file: pathlib.Path | None,
) -> ssl.SSLContext:
    """Build explicit system trust, optionally augmented by a private CA."""
    try:
        ssl_context = ssl.create_default_context()
        if gateway_ca_file is not None:
            ssl_context.load_verify_locations(cafile=gateway_ca_file)
        return ssl_context
    except (OSError, ssl.SSLError):
        raise GatewayTLSConfigurationError(
            'Gateway TLS trust configuration is invalid.') from None


async def _request_token(
    client: httpx.AsyncClient,
    *,
    operation: str,
    path: str,
    json_body: dict[str, str],
    request_id: str | None,
    authorization: str | None = None,
) -> _TokenResponse:
    headers: dict[str, str] = {}
    if request_id is not None:
        headers[login.REQUEST_ID_HEADER] = request_id
    if authorization is not None:
        headers['Authorization'] = authorization

    try:
        async with client.stream(
            'POST', path, json=json_body, headers=headers,
        ) as response:
            if response.status_code != 200:
                raise GatewayResponseError(operation, response.status_code)

            response_body = bytearray()
            async for chunk in response.aiter_bytes():
                if len(response_body) + len(chunk) > _MAX_TOKEN_RESPONSE_BYTES:
                    raise InvalidGatewayResponseError(
                        f'Gateway {operation} response exceeds the size limit.')
                response_body.extend(chunk)
    except httpx.RequestError:
        raise GatewayUnavailableError(
            f'Gateway {operation} is unavailable.') from None

    try:
        return _TokenResponse.model_validate_json(response_body)
    except (ValueError, pydantic.ValidationError):
        raise InvalidGatewayResponseError(
            f'Gateway {operation} returned an invalid response.') from None


def _to_cached_token(
    response: _TokenResponse,
    *,
    cache_skew_seconds: float,
    wall_time: Callable[[], float],
    monotonic_time: Callable[[], float],
) -> _CachedToken:
    remaining_seconds = response.expires_at - wall_time()
    if remaining_seconds <= 0:
        raise InvalidGatewayResponseError(
            'Gateway token response is already expired.')
    return _CachedToken(
        token=response.token,
        expires_at=response.expires_at,
        cache_deadline=(
            monotonic_time() + max(0.0, remaining_seconds - cache_skew_seconds)),
    )


def _validate_subject_user(subject_user: str) -> None:
    if not common.is_valid_authenticated_user_id(subject_user):
        raise ValueError('Delegated token subject is invalid.')


def _consume_task_exception(task: asyncio.Task[_CachedToken]) -> None:
    if not task.cancelled():
        task.exception()
