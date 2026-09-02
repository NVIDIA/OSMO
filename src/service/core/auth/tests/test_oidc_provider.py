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

import base64
import datetime
import hashlib
import json
import os
from types import SimpleNamespace
import secrets
import tempfile
import unittest

import fastapi
from fastapi.testclient import TestClient
import jwt  # type: ignore

from src.service.core.auth import oidc_provider
from src.service.core.workflow import objects as workflow_objects
from src.utils import auth, connectors


class FakeRedis:
    """Small synchronous Redis subset used by the OIDC provider."""

    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}

    def setex(self, key: str, _ttl: int, value: str) -> None:
        self.values[key] = value.encode()

    def get(self, key: str) -> bytes | None:
        return self.values.get(key)

    def getdel(self, key: str) -> bytes | None:
        return self.values.pop(key, None)

    def delete(self, key: str) -> None:
        self.values.pop(key, None)


class FakeDatabase(connectors.PostgresConnector):
    """Database fixture that exposes one PAT and its scoped roles."""

    def __init__(self, plaintext_token: str, service_auth: auth.AuthenticationConfig) -> None:
        self.digest = auth.hash_access_token(plaintext_token)
        self.service_auth = service_auth

    def execute_fetch_command(self, command, parameters, _return_raw):
        if 'FROM access_token_roles' in command:
            return [{'role_name': 'osmo-admin'}, {'role_name': 'team-a'}]
        if 'FROM access_token' in command and bytes(parameters[0]) == self.digest:
            return [{
                'user_name': 'admin@example.com',
                'token_name': 'browser-login',
                'expires_at': datetime.datetime.now(datetime.timezone.utc)
                + datetime.timedelta(days=1),
                'description': 'test',
            }]
        return []

    def get_service_configs(self):
        return SimpleNamespace(service_auth=self.service_auth)


class OidcProviderTest(unittest.TestCase):

    def setUp(self) -> None:
        self.client_secret_file = tempfile.NamedTemporaryFile(mode='w', delete=False)
        self.client_secret_file.write('test-client-secret')
        self.client_secret_file.close()
        self.pat = secrets.token_urlsafe(32)
        self.service_auth = auth.AuthenticationConfig.generate_default()
        config = workflow_objects.WorkflowServiceConfig(
            postgres_password='test-password',
            token_oidc_provider_enabled=True,
            token_oidc_issuer='https://osmo.example/api/auth/oidc',
            token_oidc_client_id='osmo-ui',
            token_oidc_client_secret_file=self.client_secret_file.name,
            token_oidc_redirect_uri='https://osmo.example/oauth2/callback',
            token_oidc_login_page_url='/auth/token-login',
        )
        workflow_objects.WorkflowServiceContext.set(
            workflow_objects.WorkflowServiceContext(
                config=config,
                database=FakeDatabase(self.pat, self.service_auth),  # type: ignore[arg-type]
            ))
        self.redis = FakeRedis()
        self.previous_redis = connectors.RedisConnector._instance  # pylint: disable=protected-access
        redis_connector = object.__new__(connectors.RedisConnector)
        redis_connector.__dict__['client'] = self.redis
        connectors.RedisConnector._instance = redis_connector  # pylint: disable=protected-access
        app = fastapi.FastAPI()
        app.include_router(oidc_provider.router)
        self.app = app
        self.client = TestClient(app, base_url='https://osmo.example')

    def tearDown(self) -> None:
        connectors.RedisConnector._instance = self.previous_redis  # pylint: disable=protected-access
        workflow_objects.WorkflowServiceContext._instance = None  # pylint: disable=protected-access
        os.unlink(self.client_secret_file.name)

    def _authorize(self, verifier: str) -> str:
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
        response = self.client.get('/api/auth/oidc/authorize', params={
            'response_type': 'code',
            'client_id': 'osmo-ui',
            'redirect_uri': 'https://osmo.example/oauth2/callback',
            'scope': 'openid profile roles offline_access',
            'state': 'state-value',
            'nonce': 'nonce-value',
            'code_challenge': challenge,
            'code_challenge_method': 'S256',
        }, follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertNotIn('state-value', response.headers['location'])
        return response.headers['location'].split('transaction_id=', 1)[1]

    def _login_and_complete(self, transaction_id: str) -> str:
        context_response = self.client.get(
            '/api/auth/oidc/login-context', params={'transaction_id': transaction_id})
        self.assertEqual(context_response.status_code, 200)
        csrf_token = context_response.json()['csrf_token']
        login_response = self.client.post('/api/auth/oidc/login', json={
            'transaction_id': transaction_id,
            'csrf_token': csrf_token,
            'token': self.pat,
        }, headers={'Origin': 'https://osmo.example'})
        self.assertEqual(login_response.status_code, 200)
        complete_response = self.client.get(
            login_response.json()['continue_url'], follow_redirects=False)
        self.assertEqual(complete_response.status_code, 303)
        location = complete_response.headers['location']
        self.assertIn('state=state-value', location)
        return location.split('code=', 1)[1].split('&', 1)[0]

    def test_discovery_and_code_refresh_flow(self) -> None:
        discovery = self.client.get('/api/auth/oidc/.well-known/openid-configuration')
        self.assertEqual(discovery.status_code, 200)
        self.assertEqual(discovery.json()['issuer'], 'https://osmo.example/api/auth/oidc')
        self.assertEqual(discovery.json()['code_challenge_methods_supported'], ['S256'])

        verifier = 'v' * 43
        code = self._login_and_complete(self._authorize(verifier))
        basic = base64.b64encode(b'osmo-ui:test-client-secret').decode()
        exchange = self.client.post('/api/auth/oidc/token', data={
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': 'https://osmo.example/oauth2/callback',
            'code_verifier': verifier,
        }, headers={'Authorization': f'Basic {basic}'})
        self.assertEqual(exchange.status_code, 200)
        token_response = exchange.json()
        public_key = jwt.PyJWK.from_json(
            self.service_auth.get_current_key().public_key).key
        claims = jwt.decode(
            token_response['id_token'],
            key=public_key,
            algorithms=['RS256'],
            audience='osmo-ui',
            issuer='https://osmo.example/api/auth/oidc',
        )
        self.assertEqual(claims['iss'], 'https://osmo.example/api/auth/oidc')
        self.assertEqual(claims['aud'], 'osmo-ui')
        self.assertEqual(claims['preferred_username'], 'admin@example.com')
        self.assertEqual(claims['roles'], ['osmo-admin', 'team-a'])
        self.assertEqual(claims['osmo_token_name'], 'browser-login')
        self.assertEqual(claims['nonce'], 'nonce-value')
        self.assertIn('kid', jwt.get_unverified_header(token_response['id_token']))

        refresh = self.client.post('/api/auth/oidc/token', data={
            'grant_type': 'refresh_token',
            'refresh_token': token_response['refresh_token'],
        }, headers={'Authorization': f'Basic {basic}'})
        self.assertEqual(refresh.status_code, 200)
        self.assertNotEqual(
            refresh.json()['refresh_token'], token_response['refresh_token'])
        replay = self.client.post('/api/auth/oidc/token', data={
            'grant_type': 'refresh_token',
            'refresh_token': token_response['refresh_token'],
        }, headers={'Authorization': f'Basic {basic}'})
        self.assertEqual(replay.status_code, 400)
        self.assertEqual(replay.json()['error'], 'invalid_grant')

        serialized_redis = json.dumps({
            key: value.decode() for key, value in self.redis.values.items()
        })
        self.assertNotIn(self.pat, serialized_redis)

    def test_code_is_single_use_and_pat_errors_are_generic(self) -> None:
        verifier = 'x' * 43
        transaction_id = self._authorize(verifier)
        context_response = self.client.get(
            '/api/auth/oidc/login-context', params={'transaction_id': transaction_id})
        response = self.client.post('/api/auth/oidc/login', json={
            'transaction_id': transaction_id,
            'csrf_token': context_response.json()['csrf_token'],
            'token': 'not-a-token',
        }, headers={'Origin': 'https://osmo.example'})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['error'], 'invalid_credentials')

        code = self._login_and_complete(transaction_id)
        basic = base64.b64encode(b'osmo-ui:test-client-secret').decode()
        payload = {
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': 'https://osmo.example/oauth2/callback',
            'code_verifier': verifier,
        }
        self.assertEqual(self.client.post(
            '/api/auth/oidc/token', data=payload,
            headers={'Authorization': f'Basic {basic}'}).status_code, 200)
        replay = self.client.post(
            '/api/auth/oidc/token', data=payload,
            headers={'Authorization': f'Basic {basic}'})
        self.assertEqual(replay.status_code, 400)
        self.assertEqual(replay.json()['error'], 'invalid_grant')

    def test_browser_binding_origin_csrf_and_pkce_are_enforced(self) -> None:
        verifier = 'y' * 43
        transaction_id = self._authorize(verifier)
        other_browser = TestClient(self.app, base_url='https://osmo.example')
        self.assertEqual(other_browser.get(
            '/api/auth/oidc/login-context',
            params={'transaction_id': transaction_id},
        ).status_code, 400)

        context_response = self.client.get(
            '/api/auth/oidc/login-context', params={'transaction_id': transaction_id})
        csrf_token = context_response.json()['csrf_token']
        payload = {
            'transaction_id': transaction_id,
            'csrf_token': csrf_token,
            'token': self.pat,
        }
        self.assertEqual(self.client.post(
            '/api/auth/oidc/login', json=payload,
            headers={'Origin': 'https://evil.example'}).status_code, 403)
        self.assertEqual(self.client.post(
            '/api/auth/oidc/login', json={**payload, 'csrf_token': 'z' * 43},
            headers={'Origin': 'https://osmo.example'}).status_code, 400)

        login_response = self.client.post(
            '/api/auth/oidc/login', json=payload,
            headers={'Origin': 'https://osmo.example'})
        complete_response = self.client.get(
            login_response.json()['continue_url'], follow_redirects=False)
        code = complete_response.headers['location'].split('code=', 1)[1].split('&', 1)[0]
        basic = base64.b64encode(b'osmo-ui:test-client-secret').decode()
        exchange_payload = {
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': 'https://osmo.example/oauth2/callback',
            'code_verifier': 'q' * 43,
        }
        failed_exchange = self.client.post(
            '/api/auth/oidc/token', data=exchange_payload,
            headers={'Authorization': f'Basic {basic}'})
        self.assertEqual(failed_exchange.status_code, 400)
        self.assertEqual(failed_exchange.json()['error'], 'invalid_grant')
        exchange_payload['code_verifier'] = verifier
        self.assertEqual(self.client.post(
            '/api/auth/oidc/token', data=exchange_payload,
            headers={'Authorization': f'Basic {basic}'}).status_code, 400)

    def test_config_rejects_scheme_relative_login_page(self) -> None:
        with self.assertRaisesRegex(ValueError, 'same-origin absolute path'):
            workflow_objects.WorkflowServiceConfig(
                postgres_password='test-password',
                token_oidc_provider_enabled=True,
                token_oidc_issuer='https://osmo.example/api/auth/oidc',
                token_oidc_client_secret_file=self.client_secret_file.name,
                token_oidc_redirect_uri='https://osmo.example/oauth2/callback',
                token_oidc_login_page_url='//evil.example/login',
            )


if __name__ == '__main__':
    unittest.main()
