"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import dataclasses
import time
from typing import Any, Protocol
from urllib import parse

import httpx
import jwt  # type: ignore

from src.service.mcp_auth import models


@dataclasses.dataclass(frozen=True)
class UpstreamAuthorization:
    """Parameters the broker binds to one upstream authorization request."""

    state: str
    nonce: str
    code_challenge: str


class UpstreamOIDCProvider(Protocol):
    """Identity-provider boundary used by the broker HTTP handlers."""

    async def authorization_url(self, request: UpstreamAuthorization) -> str:
        """Build the upstream browser authorization URL."""

    async def exchange_authorization_code(
        self,
        *,
        code: str,
        nonce: str,
        code_verifier: str,
    ) -> models.BrokerIdentity:
        """Exchange and validate one upstream authorization response."""

    async def ready(self) -> bool:
        """Return whether upstream discovery can be loaded and validated."""

    async def close(self) -> None:
        """Release provider resources."""


@dataclasses.dataclass(frozen=True)
class _Discovery:
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str


class EntraOIDCProvider:
    """Confidential OIDC client for Microsoft Entra authorization code login."""

    _SCOPES = ('openid', 'profile', 'email')
    _JWKS_CACHE_SECONDS = 300

    def __init__(
        self,
        *,
        issuer: str,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        http_client: httpx.AsyncClient,
    ) -> None:
        self._issuer = issuer.rstrip('/')
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._http_client = http_client
        self._discovery: _Discovery | None = None
        self._discovery_lock = asyncio.Lock()
        self._jwks: list[dict[str, Any]] = []
        self._jwks_expires_at = 0.0
        self._jwks_lock = asyncio.Lock()

    async def _load_discovery(self) -> _Discovery:
        if self._discovery is not None:
            return self._discovery
        async with self._discovery_lock:
            if self._discovery is not None:
                return self._discovery
            response = await self._http_client.get(
                f'{self._issuer}/.well-known/openid-configuration'
            )
            response.raise_for_status()
            document = response.json()
            if not isinstance(document, dict):
                raise ValueError('upstream discovery response must be a JSON object')
            discovered_issuer = document.get('issuer')
            if not isinstance(discovered_issuer, str):
                raise ValueError('upstream discovery response is missing issuer')
            if discovered_issuer.rstrip('/') != self._issuer:
                raise ValueError('upstream discovery issuer does not match configuration')
            discovery = _Discovery(
                authorization_endpoint=self._https_endpoint(
                    document,
                    'authorization_endpoint',
                ),
                token_endpoint=self._https_endpoint(document, 'token_endpoint'),
                jwks_uri=self._https_endpoint(document, 'jwks_uri'),
            )
            self._discovery = discovery
            return discovery

    @staticmethod
    def _https_endpoint(document: dict[str, Any], name: str) -> str:
        value = document.get(name)
        if not isinstance(value, str):
            raise ValueError(f'upstream discovery response is missing {name}')
        parsed = parse.urlsplit(value)
        if parsed.scheme != 'https' or not parsed.netloc or parsed.fragment:
            raise ValueError(f'upstream {name} must be an absolute HTTPS URL')
        return value

    async def authorization_url(self, request: UpstreamAuthorization) -> str:
        discovery = await self._load_discovery()
        query = parse.urlencode({
            'response_type': 'code',
            'response_mode': 'query',
            'client_id': self._client_id,
            'redirect_uri': self._redirect_uri,
            'scope': ' '.join(self._SCOPES),
            'state': request.state,
            'nonce': request.nonce,
            'code_challenge': request.code_challenge,
            'code_challenge_method': 'S256',
        })
        separator = '&' if parse.urlsplit(discovery.authorization_endpoint).query else '?'
        return f'{discovery.authorization_endpoint}{separator}{query}'

    async def exchange_authorization_code(
        self,
        *,
        code: str,
        nonce: str,
        code_verifier: str,
    ) -> models.BrokerIdentity:
        discovery = await self._load_discovery()
        response = await self._http_client.post(
            discovery.token_endpoint,
            data={
                'grant_type': 'authorization_code',
                'client_id': self._client_id,
                'client_secret': self._client_secret,
                'redirect_uri': self._redirect_uri,
                'code': code,
                'code_verifier': code_verifier,
            },
            headers={'Accept': 'application/json'},
        )
        response.raise_for_status()
        token_response = response.json()
        if not isinstance(token_response, dict):
            raise ValueError('upstream token response must be a JSON object')
        encoded_id_token = token_response.get('id_token')
        if not isinstance(encoded_id_token, str):
            raise ValueError('upstream token response is missing id_token')
        claims = await self._validate_id_token(encoded_id_token, nonce, discovery)
        return self._identity_from_claims(claims)

    async def _validate_id_token(
        self,
        encoded_id_token: str,
        nonce: str,
        discovery: _Discovery,
    ) -> dict[str, Any]:
        header = jwt.get_unverified_header(encoded_id_token)
        if header.get('alg') != 'RS256' or not isinstance(header.get('kid'), str):
            raise ValueError('upstream ID token uses an unsupported signing key')
        kid = header['kid']
        signing_key = await self._signing_key(kid, discovery, force_refresh=False)
        if signing_key is None:
            signing_key = await self._signing_key(kid, discovery, force_refresh=True)
        if signing_key is None:
            raise ValueError('upstream ID token signing key was not found')

        claims = jwt.decode(
            encoded_id_token,
            key=jwt.PyJWK.from_dict(signing_key).key,
            algorithms=['RS256'],
            audience=self._client_id,
            issuer=self._issuer,
            options={
                'require': ['aud', 'exp', 'iat', 'iss', 'nonce', 'sub'],
            },
        )
        if not isinstance(claims, dict) or claims.get('nonce') != nonce:
            raise ValueError('upstream ID token nonce does not match')
        audience_claim = claims.get('aud')
        authorized_party = claims.get('azp')
        if authorized_party is not None and authorized_party != self._client_id:
            raise ValueError('upstream ID token authorized party does not match')
        if (
            isinstance(audience_claim, list)
            and len(audience_claim) > 1
            and authorized_party != self._client_id
        ):
            raise ValueError('multi-audience upstream ID token requires matching azp')
        return claims

    async def _signing_key(
        self,
        kid: str,
        discovery: _Discovery,
        *,
        force_refresh: bool,
    ) -> dict[str, Any] | None:
        await self._load_jwks(discovery, force_refresh=force_refresh)
        return next((key for key in self._jwks if key.get('kid') == kid), None)

    async def _load_jwks(self, discovery: _Discovery, *, force_refresh: bool) -> None:
        if not force_refresh and self._jwks and time.time() < self._jwks_expires_at:
            return
        async with self._jwks_lock:
            if not force_refresh and self._jwks and time.time() < self._jwks_expires_at:
                return
            response = await self._http_client.get(discovery.jwks_uri)
            response.raise_for_status()
            document = response.json()
            keys = document.get('keys') if isinstance(document, dict) else None
            if not isinstance(keys, list) or not all(isinstance(key, dict) for key in keys):
                raise ValueError('upstream JWKS response contains invalid keys')
            self._jwks = keys
            self._jwks_expires_at = time.time() + self._JWKS_CACHE_SECONDS

    def _identity_from_claims(self, claims: dict[str, Any]) -> models.BrokerIdentity:
        username = next((
            claims.get(name)
            for name in ('preferred_username', 'unique_name', 'email')
            if isinstance(claims.get(name), str) and claims[name]
        ), None)
        if not isinstance(username, str):
            raise ValueError('upstream ID token is missing a username claim')

        tenant_id = claims.get('tid')
        object_id = claims.get('oid')
        subject = claims.get('sub')
        if isinstance(tenant_id, str) and tenant_id and isinstance(object_id, str) and object_id:
            stable_subject = f'{tenant_id}:{object_id}'
        elif isinstance(subject, str) and subject:
            stable_subject = subject
        else:
            raise ValueError('upstream ID token is missing a stable subject')

        claimed_roles = claims.get('roles', [])
        if not isinstance(claimed_roles, list) or not all(
            isinstance(role, str) for role in claimed_roles
        ):
            raise ValueError('upstream ID token roles claim must be an array of strings')
        if len(claimed_roles) > 256 or any(
            not role
            or len(role) > 256
            or ',' in role
            or any(ord(character) < 32 or ord(character) == 127 for character in role)
            for role in claimed_roles
        ):
            raise ValueError(
                'upstream ID token roles claim contains unsupported role values'
            )
        roles = tuple(sorted(set(claimed_roles)))
        return models.BrokerIdentity(
            subject=stable_subject,
            username=username,
            roles=roles,
        )

    async def ready(self) -> bool:
        try:
            await self._load_discovery()
            return True
        except (httpx.HTTPError, ValueError):
            return False

    async def close(self) -> None:
        await self._http_client.aclose()
