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
import tempfile
import time
import unittest
from unittest import mock
from urllib import parse

import httpx
from jwcrypto import jwk  # type: ignore
import jwt  # type: ignore

from src.service.mcp_auth import config, entra, models, server, store, tokens, validation


class _FakeUpstream:
    """Deterministic upstream provider used by protocol tests."""

    def __init__(self) -> None:
        self.authorization: entra.UpstreamAuthorization | None = None
        self.ready_result = True

    async def authorization_url(self, request: entra.UpstreamAuthorization) -> str:
        self.authorization = request
        return f'https://login.example/authorize?state={request.state}'

    async def exchange_authorization_code(
        self,
        *,
        code: str,
        nonce: str,
        code_verifier: str,
    ) -> models.BrokerIdentity:
        if code != 'upstream-code' or not nonce or not code_verifier:
            raise ValueError('invalid fake upstream exchange')
        return models.BrokerIdentity(
            subject='tenant:user-id',
            username='user@example.com',
            roles=('osmo-user',),
        )

    async def ready(self) -> bool:
        return self.ready_result

    async def close(self) -> None:
        return None


class OAuthProviderTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.config = config.OAuthBrokerConfig(
            issuer_url='https://osmo.example',
            resource_url='https://osmo.example/mcp',
            redis_url='redis://redis.example:6379/7',
            entra_issuer_url='https://login.example/tenant/v2.0',
            entra_client_id='entra-client',
            entra_client_secret_file='/not-read-in-unit-test',
            entra_redirect_url='https://osmo.example/oauth/callback/entra',
            signing_private_jwk_file='/not-read-in-unit-test',
            allowed_upstream_roles='osmo-user,osmo-admin',
        )
        self.store = store.InMemoryBrokerStore()
        self.upstream = _FakeUpstream()
        signing_key = jwk.JWK.generate(kty='RSA', kid='test-key', size=2048)
        self.token_issuer = tokens.AccessTokenIssuer(
            issuer=self.config.issuer_url,
            audience=self.config.resource_url,
            active_kid='test-key',
            keys={'test-key': signing_key},
            access_token_ttl_seconds=600,
        )
        self.application = server.create_application(
            self.config,
            broker_store=self.store,
            upstream_provider=self.upstream,
            access_token_issuer=self.token_issuer,
        )
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.application),
            base_url='https://osmo.example',
            follow_redirects=False,
        )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()

    async def _register(self, redirect_uri: str = 'http://localhost:53682/callback') -> str:
        response = await self.client.post(
            '/oauth/register',
            json={
                'client_name': 'Codex',
                'redirect_uris': [redirect_uri],
                'grant_types': ['authorization_code', 'refresh_token'],
                'response_types': ['code'],
                'token_endpoint_auth_method': 'none',
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['client_id']

    async def _authorization_code(
        self,
        client_id: str,
        *,
        redirect_uri: str = 'http://localhost:53682/callback',
        resource: str = 'https://osmo.example/mcp',
    ) -> tuple[str, str]:
        verifier = 'v' * 64
        response = await self.client.get(
            '/oauth/authorize',
            params={
                'response_type': 'code',
                'client_id': client_id,
                'redirect_uri': redirect_uri,
                'scope': 'mcp:access',
                'resource': resource,
                'state': 'client-state',
                'code_challenge': validation.pkce_challenge(verifier),
                'code_challenge_method': 'S256',
            },
        )
        self.assertEqual(response.status_code, 302, response.text)
        self.assertIsNotNone(self.upstream.authorization)
        upstream_state = parse.parse_qs(
            parse.urlsplit(response.headers['Location']).query
        )['state'][0]
        callback = await self.client.get(
            '/oauth/callback/entra',
            params={'state': upstream_state, 'code': 'upstream-code'},
        )
        self.assertEqual(callback.status_code, 302, callback.text)
        callback_query = parse.parse_qs(parse.urlsplit(callback.headers['Location']).query)
        self.assertEqual(callback_query['state'], ['client-state'])
        return callback_query['code'][0], verifier

    async def _initial_tokens(self, client_id: str) -> dict[str, str | int]:
        authorization_code, verifier = await self._authorization_code(client_id)
        response = await self.client.post(
            '/oauth/token',
            data={
                'grant_type': 'authorization_code',
                'client_id': client_id,
                'code': authorization_code,
                'redirect_uri': 'http://localhost:53682/callback',
                'code_verifier': verifier,
                'resource': self.config.resource_url,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def test_metadata_dcr_and_cors_are_public_client_compatible(self) -> None:
        metadata = await self.client.get('/.well-known/oauth-authorization-server')
        self.assertEqual(metadata.status_code, 200)
        self.assertEqual(metadata.json()['token_endpoint_auth_methods_supported'], ['none'])
        self.assertEqual(metadata.json()['scopes_supported'], ['mcp:access'])

        preflight = await self.client.options(
            '/oauth/register',
            headers={
                'Origin': 'http://localhost:6274',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type',
            },
        )
        self.assertEqual(preflight.status_code, 200)
        self.assertEqual(preflight.headers['access-control-allow-origin'], '*')

        client_id = await self._register()
        self.assertTrue(client_id)

    async def test_dcr_rejects_untrusted_remote_https_redirect(self) -> None:
        response = await self.client.post(
            '/oauth/register',
            json={'redirect_uris': ['https://attacker.example/callback']},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'invalid_redirect_uri')

    async def test_explicit_trusted_https_origin_allows_remote_redirect(self) -> None:
        trusted_config = self.config.model_copy(
            update={'trusted_https_redirect_origins': 'https://client.example'}
        )
        trusted_application = server.create_application(
            trusted_config,
            broker_store=store.InMemoryBrokerStore(),
            upstream_provider=self.upstream,
            access_token_issuer=self.token_issuer,
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=trusted_application),
            base_url='https://osmo.example',
        ) as trusted_client:
            response = await trusted_client.post(
                '/oauth/register',
                json={'redirect_uris': ['https://client.example/callback']},
            )
        self.assertEqual(response.status_code, 201, response.text)

    async def test_authorization_code_flow_issues_signed_osmo_token_once(self) -> None:
        client_id = await self._register()
        authorization_code, verifier = await self._authorization_code(client_id)
        form = {
            'grant_type': 'authorization_code',
            'client_id': client_id,
            'code': authorization_code,
            'redirect_uri': 'http://localhost:53682/callback',
            'code_verifier': verifier,
            'resource': self.config.resource_url,
        }
        response = await self.client.post('/oauth/token', data=form)
        self.assertEqual(response.status_code, 200, response.text)
        token_response = response.json()
        self.assertIn('refresh_token', token_response)
        public_key = jwt.PyJWK.from_dict(self.token_issuer.jwks()['keys'][0]).key
        claims = jwt.decode(
            token_response['access_token'],
            public_key,
            algorithms=['RS256'],
            audience=self.config.resource_url,
            issuer=self.config.issuer_url,
        )
        self.assertEqual(claims['preferred_username'], 'user@example.com')
        self.assertEqual(claims['roles'], ['osmo-user'])
        self.assertEqual(claims['scope'], 'mcp:access')
        self.assertEqual(claims['azp'], client_id)

        replay = await self.client.post('/oauth/token', data=form)
        self.assertEqual(replay.status_code, 400)
        self.assertEqual(replay.json()['error'], 'invalid_grant')

    async def test_wrong_pkce_verifier_rejects_and_consumes_code(self) -> None:
        client_id = await self._register()
        authorization_code, verifier = await self._authorization_code(client_id)
        form = {
            'grant_type': 'authorization_code',
            'client_id': client_id,
            'code': authorization_code,
            'redirect_uri': 'http://localhost:53682/callback',
            'code_verifier': 'w' * 64,
            'resource': self.config.resource_url,
        }
        wrong_verifier = await self.client.post('/oauth/token', data=form)
        self.assertEqual(wrong_verifier.status_code, 400)
        self.assertEqual(wrong_verifier.json()['error'], 'invalid_grant')

        correct_after_failure = await self.client.post(
            '/oauth/token',
            data={**form, 'code_verifier': verifier},
        )
        self.assertEqual(correct_after_failure.status_code, 400)
        self.assertEqual(correct_after_failure.json()['error'], 'invalid_grant')

    async def test_plain_pkce_and_unregistered_redirect_are_rejected(self) -> None:
        client_id = await self._register()
        common_parameters = {
            'response_type': 'code',
            'client_id': client_id,
            'redirect_uri': 'http://localhost:53682/callback',
            'scope': 'mcp:access',
            'resource': self.config.resource_url,
            'state': 'state',
            'code_challenge': 'c' * 43,
            'code_challenge_method': 'plain',
        }
        plain = await self.client.get('/oauth/authorize', params=common_parameters)
        self.assertEqual(plain.status_code, 400)
        self.assertEqual(plain.json()['error'], 'invalid_request')

        wrong_redirect = await self.client.get(
            '/oauth/authorize',
            params={
                **common_parameters,
                'redirect_uri': 'http://localhost:9999/callback',
                'code_challenge_method': 'S256',
            },
        )
        self.assertEqual(wrong_redirect.status_code, 400)
        self.assertEqual(wrong_redirect.json()['error'], 'invalid_request')

    async def test_refresh_rotation_reuse_revokes_active_family(self) -> None:
        client_id = await self._register()
        initial = await self._initial_tokens(client_id)
        refresh_form = {
            'grant_type': 'refresh_token',
            'client_id': client_id,
            'refresh_token': str(initial['refresh_token']),
            'resource': self.config.resource_url,
        }
        rotated = await self.client.post('/oauth/token', data=refresh_form)
        self.assertEqual(rotated.status_code, 200, rotated.text)

        reuse = await self.client.post('/oauth/token', data=refresh_form)
        self.assertEqual(reuse.status_code, 400)
        self.assertEqual(reuse.json()['error'], 'invalid_grant')

        active_after_reuse = await self.client.post(
            '/oauth/token',
            data={**refresh_form, 'refresh_token': rotated.json()['refresh_token']},
        )
        self.assertEqual(active_after_reuse.status_code, 400)
        self.assertEqual(active_after_reuse.json()['error'], 'invalid_grant')

    async def test_refresh_revoke_racing_rotation_cannot_leave_successor(self) -> None:
        broker_store = store.InMemoryBrokerStore()
        session = models.RefreshSession(
            family_id='concurrent-family',
            client_id='client',
            scope=self.config.scope,
            resource=self.config.resource_url,
            identity=models.BrokerIdentity(
                subject='subject',
                username='user@example.com',
                roles=(),
            ),
            expires_at=int(time.time()) + 300,
        )
        old_digest = store.hash_token('old-refresh')
        successor_digest = store.hash_token('successor-refresh')
        await broker_store.put_refresh_session(old_digest, session, 300)
        await asyncio.gather(
            broker_store.rotate_refresh_session(old_digest, successor_digest),
            broker_store.revoke_refresh_session(old_digest),
        )

        after_race = await broker_store.rotate_refresh_session(
            successor_digest,
            store.hash_token('third-refresh'),
        )
        self.assertIsNone(after_race)

    async def test_refresh_requires_exact_current_resource(self) -> None:
        client_id = await self._register()
        initial = await self._initial_tokens(client_id)
        missing_resource = await self.client.post(
            '/oauth/token',
            data={
                'grant_type': 'refresh_token',
                'client_id': client_id,
                'refresh_token': initial['refresh_token'],
            },
        )
        self.assertEqual(missing_resource.status_code, 400)
        self.assertEqual(missing_resource.json()['error'], 'invalid_request')

        stale_refresh_token = 'stale-resource-refresh-token'
        stale_session = models.RefreshSession(
            family_id='stale-family',
            client_id=client_id,
            scope=self.config.scope,
            resource='https://old-osmo.example/mcp',
            identity=models.BrokerIdentity(
                subject='tenant:user-id',
                username='user@example.com',
                roles=(),
            ),
            expires_at=int(time.time()) + 300,
        )
        await self.store.put_refresh_session(
            store.hash_token(stale_refresh_token),
            stale_session,
            300,
        )
        stale_resource = await self.client.post(
            '/oauth/token',
            data={
                'grant_type': 'refresh_token',
                'client_id': client_id,
                'refresh_token': stale_refresh_token,
                'resource': self.config.resource_url,
            },
        )
        self.assertEqual(stale_resource.status_code, 400)
        self.assertEqual(stale_resource.json()['error'], 'invalid_grant')

    async def test_revoke_invalidates_refresh_family(self) -> None:
        client_id = await self._register()
        initial = await self._initial_tokens(client_id)
        revoke = await self.client.post(
            '/oauth/revoke',
            data={
                'client_id': client_id,
                'token': initial['refresh_token'],
                'token_type_hint': 'refresh_token',
            },
        )
        self.assertEqual(revoke.status_code, 200)
        refresh = await self.client.post(
            '/oauth/token',
            data={
                'grant_type': 'refresh_token',
                'client_id': client_id,
                'refresh_token': initial['refresh_token'],
                'resource': self.config.resource_url,
            },
        )
        self.assertEqual(refresh.status_code, 400)
        self.assertEqual(refresh.json()['error'], 'invalid_grant')

    async def test_wrong_resource_is_rejected_before_upstream_redirect(self) -> None:
        client_id = await self._register()
        verifier = 'v' * 64
        response = await self.client.get(
            '/oauth/authorize',
            params={
                'response_type': 'code',
                'client_id': client_id,
                'redirect_uri': 'http://localhost:53682/callback',
                'scope': 'mcp:access',
                'resource': 'https://other.example/mcp',
                'state': 'state',
                'code_challenge': validation.pkce_challenge(verifier),
                'code_challenge_method': 'S256',
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'invalid_target')

    async def test_chunked_oversized_dcr_body_is_rejected_without_buffering(self) -> None:
        async def chunks() -> AsyncIterator[bytes]:
            for _ in range(65):
                yield b'x' * 1024

        response = await self.client.post(
            '/oauth/register',
            content=chunks(),
            headers={'Content-Type': 'application/json'},
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()['error'], 'invalid_request')

    async def test_health_ready_checks_store_and_upstream(self) -> None:
        ready = await self.client.get('/health/ready')
        self.assertEqual(ready.status_code, 200)
        self.upstream.ready_result = False
        unavailable = await self.client.get('/health/ready')
        self.assertEqual(unavailable.status_code, 503)
        self.assertEqual(unavailable.json()['status'], 'unavailable')

    def test_config_rejects_inconsistent_resource_and_callback(self) -> None:
        with self.assertRaisesRegex(ValueError, 'resource_url'):
            config.OAuthBrokerConfig(**{
                **self.config.model_dump(),
                'resource_url': 'https://osmo.example/other',
            })

    def test_access_token_expiry_is_short_lived(self) -> None:
        identity = models.BrokerIdentity(
            subject='subject',
            username='user@example.com',
            roles=(),
        )
        encoded = self.token_issuer.issue(
            identity,
            client_id='client',
            scope='mcp:access',
            now=int(time.time()),
        )
        claims = jwt.decode(encoded, options={'verify_signature': False})
        self.assertEqual(claims['exp'] - claims['iat'], 600)

    def test_weak_signing_key_is_rejected(self) -> None:
        weak_key = jwk.JWK.generate(kty='RSA', kid='weak', size=1024)
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8') as key_file:
            key_file.write(weak_key.export(private_key=True))
            key_file.flush()
            with self.assertRaisesRegex(ValueError, 'at least 2048 bits'):
                tokens.AccessTokenIssuer.from_jwk_file(
                    key_file.name,
                    issuer=self.config.issuer_url,
                    audience=self.config.resource_url,
                    access_token_ttl_seconds=600,
                )

    def test_redis_client_has_bounded_network_timeouts(self) -> None:
        redis_client = mock.Mock()
        with mock.patch.object(
            store.redis_asyncio,
            'from_url',
            return_value=redis_client,
        ) as from_url:
            store.RedisBrokerStore.from_url(
                'redis://redis.example:6379/7',
                password=None,
                key_prefix='osmo:mcp-auth',
                connect_timeout_seconds=3,
                operation_timeout_seconds=5,
            )
        from_url.assert_called_once_with(
            'redis://redis.example:6379/7',
            password=None,
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=5,
            retry_on_timeout=False,
        )

    async def test_redis_revoke_is_one_atomic_script_without_prereads(self) -> None:
        redis_client = mock.Mock()
        redis_client.eval = mock.AsyncMock(return_value=1)
        redis_client.get = mock.AsyncMock()
        broker_store = store.RedisBrokerStore(redis_client, 'osmo:mcp-auth')

        digest = store.hash_token('refresh-token')
        await broker_store.revoke_refresh_session(digest)

        redis_client.get.assert_not_awaited()
        redis_client.eval.assert_awaited_once()
        arguments = redis_client.eval.await_args.args
        self.assertEqual(arguments[1], 2)
        self.assertEqual(arguments[2], f'{{osmo:mcp-auth}}:refresh:{digest}')
        self.assertEqual(arguments[3], f'{{osmo:mcp-auth}}:spent:{digest}')
        self.assertEqual(arguments[4], '{osmo:mcp-auth}')
