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
import json
import logging
import secrets
import time
from typing import Any
from urllib import parse

import httpx
import jwt  # type: ignore
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response

from src.service.mcp_auth import config, entra, models, store, tokens, validation


logger = logging.getLogger(__name__)
_MAX_REQUEST_BODY_BYTES = 64 * 1024
_SUPPORTED_GRANT_TYPES = frozenset({'authorization_code', 'refresh_token'})


class OAuthError(Exception):
    """Protocol error safe to return to an OAuth client."""

    def __init__(
        self,
        error: str,
        description: str,
        *,
        status_code: int = 400,
    ) -> None:
        super().__init__(description)
        self.error = error
        self.description = description
        self.status_code = status_code


class OAuthAuthorizationServer:
    """Starlette route handlers for the OSMO MCP authorization server."""

    def __init__(
        self,
        *,
        broker_config: config.OAuthBrokerConfig,
        broker_store: store.BrokerStore,
        upstream_provider: entra.UpstreamOIDCProvider,
        access_token_issuer: tokens.AccessTokenIssuer,
    ) -> None:
        self._config = broker_config
        self._store = broker_store
        self._upstream = upstream_provider
        self._tokens = access_token_issuer

    async def metadata(self, request: Request) -> JSONResponse:  # pylint: disable=unused-argument
        """Serve RFC 8414 metadata with public-client support."""
        issuer = self._config.issuer_url
        return _json_response({
            'issuer': issuer,
            'authorization_endpoint': f'{issuer}/oauth/authorize',
            'token_endpoint': f'{issuer}/oauth/token',
            'registration_endpoint': f'{issuer}/oauth/register',
            'revocation_endpoint': f'{issuer}/oauth/revoke',
            'jwks_uri': f'{issuer}/oauth/jwks.json',
            'response_types_supported': ['code'],
            'response_modes_supported': ['query'],
            'grant_types_supported': ['authorization_code', 'refresh_token'],
            'token_endpoint_auth_methods_supported': ['none'],
            'revocation_endpoint_auth_methods_supported': ['none'],
            'code_challenge_methods_supported': ['S256'],
            'scopes_supported': [self._config.scope],
        })

    async def jwks(self, request: Request) -> JSONResponse:  # pylint: disable=unused-argument
        """Expose broker public signing keys for Gateway validation."""
        return _json_response(self._tokens.jwks())

    async def register(self, request: Request) -> JSONResponse:
        """Register a short-lived OAuth public client without issuing a secret."""
        document = await _json_body(request)
        redirect_uris = document.get('redirect_uris')
        if (
            not isinstance(redirect_uris, list)
            or not redirect_uris
            or len(redirect_uris) > 10
            or not all(isinstance(uri, str) for uri in redirect_uris)
        ):
            raise OAuthError(
                'invalid_client_metadata',
                'redirect_uris must be an array containing 1 to 10 URIs',
            )
        if len(set(redirect_uris)) != len(redirect_uris):
            raise OAuthError('invalid_client_metadata', 'redirect_uris must be unique')
        try:
            validated_redirects = tuple(
                validation.validate_redirect_uri(
                    uri,
                    trusted_https_origins=self._config.trusted_redirect_origins,
                )
                for uri in redirect_uris
            )
        except ValueError as error:
            raise OAuthError('invalid_redirect_uri', str(error)) from error

        authentication_method = document.get('token_endpoint_auth_method', 'none')
        if authentication_method != 'none':
            raise OAuthError(
                'invalid_client_metadata',
                'token_endpoint_auth_method must be none',
            )
        response_types = document.get('response_types', ['code'])
        if response_types != ['code']:
            raise OAuthError(
                'invalid_client_metadata',
                'response_types must contain only code',
            )
        grant_types = document.get(
            'grant_types',
            ['authorization_code', 'refresh_token'],
        )
        if (
            not isinstance(grant_types, list)
            or 'authorization_code' not in grant_types
            or len(grant_types) != len(set(grant_types))
            or not set(grant_types).issubset(_SUPPORTED_GRANT_TYPES)
        ):
            raise OAuthError(
                'invalid_client_metadata',
                'grant_types must include authorization_code and may include refresh_token',
            )

        client_name = document.get('client_name', 'OSMO MCP client')
        if (
            not isinstance(client_name, str)
            or not client_name.strip()
            or len(client_name) > 128
            or any(ord(character) < 0x20 for character in client_name)
        ):
            raise OAuthError(
                'invalid_client_metadata',
                'client_name must contain 1 to 128 printable characters',
            )

        now = int(time.time())
        client_id = secrets.token_urlsafe(32)
        registration = models.ClientRegistration(
            client_id=client_id,
            client_name=client_name.strip(),
            redirect_uris=validated_redirects,
            grant_types=tuple(grant_types),
            created_at=now,
            expires_at=now + self._config.client_registration_ttl_seconds,
        )
        await self._store.put_client(
            registration,
            self._config.client_registration_ttl_seconds,
        )
        return _json_response(
            {
                'client_id': registration.client_id,
                'client_id_issued_at': registration.created_at,
                'client_id_expires_at': registration.expires_at,
                'client_name': registration.client_name,
                'redirect_uris': list(registration.redirect_uris),
                'grant_types': list(registration.grant_types),
                'response_types': ['code'],
                'token_endpoint_auth_method': 'none',
            },
            status_code=201,
        )

    async def authorize(self, request: Request) -> RedirectResponse:
        """Validate the MCP request before redirecting the browser to Entra."""
        response_type = _query_parameter(request, 'response_type')
        client_id = _query_parameter(request, 'client_id')
        redirect_uri = _query_parameter(request, 'redirect_uri')
        requested_scope = _query_parameter(request, 'scope')
        resource = _query_parameter(request, 'resource')
        client_state = _query_parameter(request, 'state')
        code_challenge = _query_parameter(request, 'code_challenge')
        code_challenge_method = _query_parameter(request, 'code_challenge_method')

        if response_type != 'code':
            raise OAuthError('unsupported_response_type', 'response_type must be code')
        registration = await self._active_client(client_id)
        if redirect_uri not in registration.redirect_uris:
            raise OAuthError('invalid_request', 'redirect_uri is not registered for this client')
        _validate_scope_resource(
            requested_scope,
            resource,
            expected_scope=self._config.scope,
            expected_resource=self._config.resource_url,
        )
        if not client_state or len(client_state) > 1024:
            raise OAuthError('invalid_request', 'state must contain 1 to 1024 characters')
        try:
            validation.validate_code_challenge(
                code_challenge,
                code_challenge_method,
            )
        except ValueError as error:
            raise OAuthError('invalid_request', str(error)) from error

        upstream_code_verifier, upstream_code_challenge = validation.create_pkce_pair()
        transaction_id = secrets.token_urlsafe(32)
        upstream_nonce = secrets.token_urlsafe(32)
        transaction = models.AuthorizationTransaction(
            client_id=client_id,
            redirect_uri=redirect_uri,
            client_state=client_state,
            code_challenge=code_challenge,
            scope=requested_scope,
            resource=resource,
            upstream_nonce=upstream_nonce,
            upstream_code_verifier=upstream_code_verifier,
            created_at=int(time.time()),
        )
        await self._store.put_transaction(
            transaction_id,
            transaction,
            self._config.authorization_transaction_ttl_seconds,
        )
        upstream_url = await self._upstream.authorization_url(
            entra.UpstreamAuthorization(
                state=transaction_id,
                nonce=upstream_nonce,
                code_challenge=upstream_code_challenge,
            )
        )
        return RedirectResponse(upstream_url, status_code=302)

    async def callback(self, request: Request) -> RedirectResponse:
        """Complete upstream login and return a one-use code to the MCP client."""
        transaction_id = _query_parameter(request, 'state')
        transaction = await self._store.consume_transaction(transaction_id)
        if transaction is None:
            raise OAuthError('invalid_request', 'authorization transaction is invalid or expired')

        upstream_error = request.query_params.get('error')
        if upstream_error is not None:
            return self._client_error_redirect(
                transaction,
                'access_denied',
                'Upstream authentication was not completed',
            )
        code = request.query_params.get('code')
        if not code or len(code) > 4096:
            return self._client_error_redirect(
                transaction,
                'server_error',
                'Upstream authorization code is missing',
            )
        try:
            identity = await self._upstream.exchange_authorization_code(
                code=code,
                nonce=transaction.upstream_nonce,
                code_verifier=transaction.upstream_code_verifier,
            )
        except (httpx.HTTPError, jwt.PyJWTError, ValueError):
            logger.warning('Upstream OIDC code exchange failed')
            return self._client_error_redirect(
                transaction,
                'server_error',
                'Upstream authentication could not be validated',
            )

        authorization_code_value = secrets.token_urlsafe(48)
        now = int(time.time())
        authorization_code = models.AuthorizationCode(
            client_id=transaction.client_id,
            redirect_uri=transaction.redirect_uri,
            code_challenge=transaction.code_challenge,
            scope=transaction.scope,
            resource=transaction.resource,
            identity=identity,
            expires_at=now + self._config.authorization_code_ttl_seconds,
        )
        await self._store.put_authorization_code(
            store.hash_token(authorization_code_value),
            authorization_code,
            self._config.authorization_code_ttl_seconds,
        )
        redirect_url = validation.add_query_parameters(
            transaction.redirect_uri,
            {'code': authorization_code_value, 'state': transaction.client_state},
        )
        return RedirectResponse(redirect_url, status_code=302)

    def _client_error_redirect(
        self,
        transaction: models.AuthorizationTransaction,
        error: str,
        description: str,
    ) -> RedirectResponse:
        redirect_url = validation.add_query_parameters(
            transaction.redirect_uri,
            {
                'error': error,
                'error_description': description,
                'state': transaction.client_state,
            },
        )
        return RedirectResponse(redirect_url, status_code=302)

    async def token(self, request: Request) -> JSONResponse:
        """Exchange a code or rotate a refresh token for a broker JWT."""
        if request.headers.get('Authorization'):
            raise OAuthError(
                'invalid_client',
                'public clients must use token_endpoint_auth_method none',
                status_code=401,
            )
        form = await _form_body(request)
        grant_type = _form_parameter(form, 'grant_type')
        if grant_type == 'authorization_code':
            return await self._exchange_authorization_code(form)
        if grant_type == 'refresh_token':
            return await self._exchange_refresh_token(form)
        raise OAuthError('unsupported_grant_type', 'grant_type is not supported')

    async def _exchange_authorization_code(
        self,
        form: dict[str, str],
    ) -> JSONResponse:
        client_id = _form_parameter(form, 'client_id')
        registration = await self._active_client(client_id)
        raw_code = _form_parameter(form, 'code')
        redirect_uri = _form_parameter(form, 'redirect_uri')
        code_verifier = _form_parameter(form, 'code_verifier')
        resource = _form_parameter(form, 'resource')

        authorization_code = await self._store.consume_authorization_code(
            store.hash_token(raw_code)
        )
        if authorization_code is None or authorization_code.expires_at <= int(time.time()):
            raise OAuthError('invalid_grant', 'authorization code is invalid or expired')
        if (
            authorization_code.client_id != client_id
            or authorization_code.redirect_uri != redirect_uri
            or authorization_code.resource != resource
            or resource != self._config.resource_url
            or not validation.verify_pkce(
                code_verifier,
                authorization_code.code_challenge,
            )
        ):
            raise OAuthError('invalid_grant', 'authorization code binding is invalid')

        refresh_token: str | None = None
        if 'refresh_token' in registration.grant_types:
            refresh_token = secrets.token_urlsafe(48)
            now = int(time.time())
            session = models.RefreshSession(
                family_id=secrets.token_urlsafe(24),
                client_id=client_id,
                scope=authorization_code.scope,
                resource=authorization_code.resource,
                identity=authorization_code.identity,
                expires_at=now + self._config.refresh_token_ttl_seconds,
            )
            await self._store.put_refresh_session(
                store.hash_token(refresh_token),
                session,
                self._config.refresh_token_ttl_seconds,
            )
        return self._token_response(
            authorization_code.identity,
            client_id=client_id,
            scope=authorization_code.scope,
            refresh_token=refresh_token,
        )

    async def _exchange_refresh_token(self, form: dict[str, str]) -> JSONResponse:
        client_id = _form_parameter(form, 'client_id')
        registration = await self._active_client(client_id)
        if 'refresh_token' not in registration.grant_types:
            raise OAuthError('unauthorized_client', 'client is not registered for refresh tokens')
        old_refresh_token = _form_parameter(form, 'refresh_token')
        requested_resource = _form_parameter(form, 'resource')
        if requested_resource != self._config.resource_url:
            raise OAuthError('invalid_target', 'resource does not match the MCP resource')

        new_refresh_token = secrets.token_urlsafe(48)
        session = await self._store.rotate_refresh_session(
            store.hash_token(old_refresh_token),
            store.hash_token(new_refresh_token),
        )
        if session is None:
            raise OAuthError('invalid_grant', 'refresh token is invalid, reused, or expired')
        if (
            session.client_id != client_id
            or session.resource != requested_resource
            or session.resource != self._config.resource_url
            or session.expires_at <= int(time.time())
        ):
            await self._store.revoke_refresh_session(store.hash_token(new_refresh_token))
            raise OAuthError('invalid_grant', 'refresh token binding is invalid or expired')
        return self._token_response(
            session.identity,
            client_id=client_id,
            scope=session.scope,
            refresh_token=new_refresh_token,
        )

    def _token_response(
        self,
        identity: models.BrokerIdentity,
        *,
        client_id: str,
        scope: str,
        refresh_token: str | None,
    ) -> JSONResponse:
        response: dict[str, Any] = {
            'access_token': self._tokens.issue(
                identity,
                client_id=client_id,
                scope=scope,
            ),
            'token_type': 'Bearer',
            'expires_in': self._tokens.access_token_ttl_seconds,
            'scope': scope,
        }
        if refresh_token is not None:
            response['refresh_token'] = refresh_token
        return _json_response(response)

    async def revoke(self, request: Request) -> Response:
        """Revoke a refresh family without revealing whether a token existed."""
        if request.headers.get('Authorization'):
            raise OAuthError(
                'invalid_client',
                'public clients must use revocation_endpoint_auth_method none',
                status_code=401,
            )
        form = await _form_body(request)
        client_id = _form_parameter(form, 'client_id')
        await self._active_client(client_id)
        token = _form_parameter(form, 'token')
        await self._store.revoke_refresh_session(store.hash_token(token))
        return Response(status_code=200, headers={'Cache-Control': 'no-store'})

    async def health_live(self, request: Request) -> JSONResponse:  # pylint: disable=unused-argument
        return _json_response({'status': 'ok'})

    async def health_ready(self, request: Request) -> JSONResponse:  # pylint: disable=unused-argument
        try:
            store_ready, upstream_ready = await asyncio.gather(
                self._store.ping(),
                self._upstream.ready(),
            )
        except Exception:  # pylint: disable=broad-exception-caught
            logger.warning('OAuth broker readiness dependency check failed')
            store_ready = False
            upstream_ready = False
        ready = store_ready and upstream_ready
        return _json_response(
            {
                'status': 'ok' if ready else 'unavailable',
                'redis': store_ready,
                'upstream_oidc': upstream_ready,
            },
            status_code=200 if ready else 503,
        )

    async def _active_client(self, client_id: str) -> models.ClientRegistration:
        if not client_id or len(client_id) > 256:
            raise OAuthError('invalid_client', 'client_id is invalid', status_code=401)
        registration = await self._store.get_client(client_id)
        if registration is None or registration.expires_at <= int(time.time()):
            raise OAuthError('invalid_client', 'client is invalid or expired', status_code=401)
        return registration


async def oauth_error_response(request: Request, error: Exception) -> JSONResponse:
    """Render a protocol error without reflecting request secrets."""
    del request
    if not isinstance(error, OAuthError):
        raise error
    return _json_response(
        {'error': error.error, 'error_description': error.description},
        status_code=error.status_code,
    )


def _validate_scope_resource(
    scope: str,
    resource: str,
    *,
    expected_scope: str,
    expected_resource: str,
) -> None:
    requested_scopes = scope.split()
    if requested_scopes != [expected_scope]:
        raise OAuthError('invalid_scope', 'scope must match the advertised MCP scope')
    if resource != expected_resource:
        raise OAuthError('invalid_target', 'resource must match the exact MCP resource URL')


def _query_parameter(request: Request, name: str) -> str:
    values = request.query_params.getlist(name)
    if len(values) != 1 or not values[0]:
        raise OAuthError('invalid_request', f'{name} must be provided exactly once')
    if len(values[0]) > 4096:
        raise OAuthError('invalid_request', f'{name} is too long')
    return values[0]


async def _json_body(request: Request) -> dict[str, Any]:
    body = await _bounded_body(request)
    content_type = request.headers.get('Content-Type', '').partition(';')[0].strip().lower()
    if content_type != 'application/json':
        raise OAuthError('invalid_client_metadata', 'Content-Type must be application/json')
    try:
        document = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise OAuthError('invalid_client_metadata', 'request body must be valid JSON') from error
    if not isinstance(document, dict):
        raise OAuthError('invalid_client_metadata', 'request body must be a JSON object')
    return document


async def _form_body(request: Request) -> dict[str, str]:
    body = await _bounded_body(request)
    content_type = (
        request.headers.get('Content-Type', '').partition(';')[0].strip().lower()
    )
    if content_type != 'application/x-www-form-urlencoded':
        raise OAuthError(
            'invalid_request',
            'Content-Type must be application/x-www-form-urlencoded',
        )
    try:
        pairs = parse.parse_qsl(
            body.decode('utf-8'),
            keep_blank_values=True,
            strict_parsing=True,
            max_num_fields=32,
        )
    except (UnicodeDecodeError, ValueError) as error:
        raise OAuthError('invalid_request', 'request body is not valid form data') from error
    form: dict[str, str] = {}
    for name, value in pairs:
        if name in form:
            raise OAuthError('invalid_request', f'{name} must be provided at most once')
        form[name] = value
    return form


async def _bounded_body(request: Request) -> bytes:
    content_length = request.headers.get('Content-Length')
    if content_length is not None:
        try:
            parsed_content_length = int(content_length)
            if parsed_content_length < 0:
                raise OAuthError('invalid_request', 'Content-Length is invalid')
            if parsed_content_length > _MAX_REQUEST_BODY_BYTES:
                raise OAuthError('invalid_request', 'request body is too large', status_code=413)
        except ValueError as error:
            raise OAuthError('invalid_request', 'Content-Length is invalid') from error
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > _MAX_REQUEST_BODY_BYTES:
            raise OAuthError('invalid_request', 'request body is too large', status_code=413)
    return bytes(body)


def _form_parameter(form: dict[str, str], name: str) -> str:
    value = form.get(name)
    if not value:
        raise OAuthError('invalid_request', f'{name} is required')
    if len(value) > 4096:
        raise OAuthError('invalid_request', f'{name} is too long')
    return value


def _json_response(content: Any, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        content,
        status_code=status_code,
        headers={
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache',
        },
    )
