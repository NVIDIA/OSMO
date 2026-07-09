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

import time
from typing import Any, Dict, List, Optional
from unittest import mock

import jwt  # type: ignore
from src.lib.utils import common, login
from src.service.core.auth import objects
from src.service.core.tests import fixture
from src.tests.common import runner
from src.utils import auth, connectors

TEST_DELEGATOR = 'svc-mcp'


class AuthServiceTestCase(fixture.ServiceTestFixture):
    """Integration tests for auth service user and role management."""

    TEST_USER = 'test@nvidia.com'
    TEST_ADMIN = 'admin@nvidia.com'

    def setUp(self):
        super().setUp()
        # Set default auth header to TEST_USER
        self.client.headers['x-osmo-user'] = self.TEST_USER
        # Clean up test users from previous tests to ensure isolation
        self._cleanup_test_users()
        # Create test roles for use in tests
        self._create_test_role('osmo-user', 'Default user role')
        self._create_test_role('osmo-admin', 'Admin role')
        self._create_test_role('osmo-ml-team', 'ML team role')
        self._create_test_role('osmo-dev-team', 'Dev team role')

    def _cleanup_test_users(self):
        """Clean up test users to ensure test isolation."""
        postgres = connectors.PostgresConnector.get_instance()
        # Delete users (CASCADE will handle user_roles, access_token_roles, access_token)
        postgres.execute_commit_command(
            'DELETE FROM users WHERE id = %s OR id = %s;',
            (self.TEST_USER, self.TEST_ADMIN)
        )
        postgres.execute_commit_command(
            'DELETE FROM users WHERE id LIKE %s;', ('%@example.com',)
        )

    def _create_test_role(self, role_name: str, description: str = ''):
        """Helper to create a role in the database."""
        postgres = connectors.PostgresConnector.get_instance()
        insert_cmd = '''
            INSERT INTO roles (name, description, policies, immutable, sync_mode)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (name) DO NOTHING;
        '''
        postgres.execute_commit_command(
            insert_cmd, (role_name, description, [], False, 'import'))

    def _create_user(self, user_id: str, roles: Optional[List[str]] = None) -> Dict:
        """Helper to create a user via API.

        First deletes any existing user with the same ID to ensure a clean state.
        For TEST_USER, uses direct DB access since the auth service auto-creates
        users from the x-osmo-user header.
        """
        # Delete user first if it exists to ensure clean test state
        postgres = connectors.PostgresConnector.get_instance()
        postgres.execute_commit_command(
            'DELETE FROM users WHERE id = %s;', (user_id,))

        # For TEST_USER (used in x-osmo-user header), the API auto-creates the user,
        # so we need to use direct DB access to set up the test state
        if user_id == self.TEST_USER:
            # Create user directly in DB
            postgres.execute_commit_command(
                'INSERT INTO users (id, created_by) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING;',
                (user_id, 'test'))
            # Add roles if specified
            if roles:
                for role_name in roles:
                    postgres.execute_commit_command('''
                        INSERT INTO user_roles (user_id, role_name, assigned_by)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (user_id, role_name) DO NOTHING;
                    ''', (user_id, role_name, 'test'))
            # Return user data in the expected format
            return {'id': user_id, 'created_at': None, 'roles': roles or []}

        payload: Dict[str, Any] = {'id': user_id}
        if roles:
            payload['roles'] = roles

        response = self.client.post('/api/auth/user', json=payload)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def _get_user(self, user_id: str) -> Dict:
        """Helper to get a user via API."""
        response = self.client.get(f'/api/auth/user/{user_id}')
        self.assertEqual(response.status_code, 200)
        return response.json()

    def _assign_role(self, user_id: str, role_name: str) -> Dict:
        """Helper to assign a role to a user."""
        response = self.client.post(
            f'/api/auth/user/{user_id}/roles',
            json={'role_name': role_name}
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def _create_access_token(self, token_name: str, expires_at: str = '2027-01-01',
                             description: str = '', roles: Optional[List[str]] = None) -> str:
        """Helper to create an access token for the authenticated user."""
        params: Dict[str, Any] = {'expires_at': expires_at}
        if description:
            params['description'] = description
        if roles:
            params['roles'] = roles

        response = self.client.post(
            f'/api/auth/access_token/{token_name}',
            params=params
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def _get_access_token_roles(self, user_name: str, token_name: str) -> List[str]:
        """Helper to get access token roles directly from the database."""
        postgres = connectors.PostgresConnector.get_instance()
        fetch_cmd = '''
            SELECT ur.role_name FROM access_token_roles pr
            JOIN user_roles ur ON pr.user_role_id = ur.id
            WHERE pr.user_name = %s AND pr.token_name = %s
            ORDER BY ur.role_name;
        '''
        rows = postgres.execute_fetch_command(fetch_cmd, (user_name, token_name), True)
        return [row['role_name'] for row in rows]

    def _create_service_jwt(
        self,
        username: str = TEST_DELEGATOR,
        roles: Optional[List[str]] = None,
        token_name: Optional[str] = 'mcp-test-token',
        claim_overrides: Optional[Dict[str, Any]] = None,
        claim_removals: Optional[List[str]] = None,
        authentication_config: Optional[auth.AuthenticationConfig] = None,
    ) -> str:
        """Create a service JWT with optional malformed claims for denial tests."""
        service_auth = authentication_config or (
            connectors.PostgresConnector.get_instance()
            .get_service_configs().service_auth
        )
        now = int(time.time())
        claims: Dict[str, Any] = {
            'iss': service_auth.issuer,
            'aud': service_auth.audience,
            'iat': now,
            'nbf': now,
            'exp': now + common.ACCESS_TOKEN_TIMEOUT,
            'unique_name': username,
            'roles': roles if roles is not None else [auth.MCP_DELEGATOR_ROLE],
        }
        if token_name is not None:
            claims['osmo_token_name'] = token_name
        if claim_overrides:
            claims.update(claim_overrides)
        for claim_name in claim_removals or []:
            claims.pop(claim_name, None)
        return service_auth.get_current_key().create_jwt(claims)

    def _post_delegation(
        self,
        subject_user: str,
        encoded_token: Optional[str],
        gateway_user: Optional[str] = TEST_DELEGATOR,
        payload_overrides: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = 'delegation-test-request',
    ):
        payload: Dict[str, Any] = {'subject_user': subject_user}
        if payload_overrides:
            payload.update(payload_overrides)
        headers = {}
        if gateway_user is not None:
            headers[login.OSMO_USER_HEADER] = gateway_user
        if request_id is not None:
            headers['x-request-id'] = request_id
        if encoded_token is not None:
            headers[login.OSMO_AUTH_HEADER] = f'Bearer {encoded_token}'
        return self.client.post(
            '/api/auth/jwt/delegated_access_token',
            json=payload,
            headers=headers,
        )

    def _decode_jwt(self, encoded_token: str) -> Dict[str, Any]:
        service_auth = (
            connectors.PostgresConnector.get_instance()
            .get_service_configs().service_auth
        )
        public_key = jwt.PyJWK.from_json(
            service_auth.get_current_key().public_key).key
        return jwt.decode(
            encoded_token,
            key=public_key,
            algorithms=['RS256'],
            audience=service_auth.audience,
            issuer=service_auth.issuer,
        )

    # =========================================================================
    # Delegated Access Token Tests
    # =========================================================================

    def test_create_delegated_access_token(self):
        """Delegated tokens contain current, sorted roles and bounded claims."""
        subject = 'delegated@example.com'
        self._create_user(subject, roles=['osmo-user', 'osmo-admin'])
        issued_at = int(time.time())
        parent_expires_at = issued_at + 2 * common.ACCESS_TOKEN_TIMEOUT
        service_token = self._create_service_jwt(claim_overrides={
            'iat': issued_at,
            'nbf': issued_at,
            'exp': parent_expires_at,
        })

        with mock.patch(
            'src.service.core.auth.auth_service.time.time',
            return_value=issued_at,
        ):
            response = self._post_delegation(subject, service_token)

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(sorted(result), ['expires_at', 'token'])
        claims = self._decode_jwt(result['token'])
        self.assertEqual(claims['unique_name'], subject)
        self.assertEqual(claims['roles'], ['osmo-admin', 'osmo-user'])
        self.assertEqual(claims['osmo_token_name'], auth.DELEGATED_TOKEN_NAME)
        self.assertEqual(claims['act'], {'sub': TEST_DELEGATOR})
        self.assertEqual(claims['exp'], result['expires_at'])
        self.assertEqual(
            claims['exp'] - claims['iat'], common.ACCESS_TOKEN_TIMEOUT)
        self.assertLess(claims['exp'], parent_expires_at)

    def test_delegated_access_token_is_capped_by_parent_expiration(self):
        subject = 'short-parent@example.com'
        self._create_user(subject, roles=['osmo-user'])
        issued_at = int(time.time())
        parent_expires_at = issued_at + 60
        service_token = self._create_service_jwt(claim_overrides={
            'iat': issued_at,
            'nbf': issued_at,
            'exp': parent_expires_at,
        })

        with mock.patch(
            'src.service.core.auth.auth_service.time.time',
            return_value=issued_at,
        ):
            response = self._post_delegation(subject, service_token)

        self.assertEqual(response.status_code, 200)
        claims = self._decode_jwt(response.json()['token'])
        self.assertEqual(response.json()['expires_at'], parent_expires_at)
        self.assertEqual(claims['exp'], parent_expires_at)
        self.assertEqual(claims['iat'], issued_at)

    def test_delegation_does_not_mint_after_parent_expires_during_request(self):
        subject = 'expired-parent@example.com'
        self._create_user(subject, roles=['osmo-user'])
        parent_issued_at = int(time.time())
        parent_expires_at = parent_issued_at + 120
        service_token = self._create_service_jwt(claim_overrides={
            'iat': parent_issued_at,
            'nbf': parent_issued_at,
            'exp': parent_expires_at,
        })

        with (
            mock.patch(
                'src.service.core.auth.auth_service.time.time',
                return_value=parent_expires_at,
            ),
            self.assertLogs(
                'src.service.core.auth.auth_service', level='INFO') as captured,
        ):
            response = self._post_delegation(subject, service_token)

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers['www-authenticate'], 'Bearer')
        audit_record = captured.records[-1]
        self.assertEqual(getattr(audit_record, 'outcome'), 'unauthorized')
        self.assertIsNone(getattr(audit_record, 'expires_at'))

    def test_delegated_access_token_rejects_non_integer_parent_expiration(self):
        service_token = self._create_service_jwt(claim_overrides={
            'exp': str(int(time.time()) + common.ACCESS_TOKEN_TIMEOUT),
        })

        response = self._post_delegation(
            'delegated@example.com', service_token)

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers['www-authenticate'], 'Bearer')

    def test_delegation_endpoint_is_not_in_public_openapi(self):
        response = self.client.get('/api/openapi.json')
        self.assertEqual(response.status_code, 200)
        openapi_paths = response.json()['paths']

        self.assertNotIn(
            '/api/auth/jwt/delegated_access_token',
            openapi_paths,
        )

    def test_delegated_access_token_request_is_strict(self):
        """Unknown and missing body fields are rejected by the request model."""
        service_token = self._create_service_jwt()
        response = self._post_delegation(
            'delegated@example.com', service_token,
            payload_overrides={'unexpected': True})
        self.assertEqual(response.status_code, 422)

        response = self.client.post(
            '/api/auth/jwt/delegated_access_token',
            json={},
            headers={login.OSMO_AUTH_HEADER: f'Bearer {service_token}'},
        )
        self.assertEqual(response.status_code, 422)

        invalid_subjects = [' ', ' bad-user', 'bad-user ', 'bad\nname', 'a' * 257]
        for invalid_subject in invalid_subjects:
            with self.subTest(subject_user=invalid_subject):
                response = self._post_delegation(
                    invalid_subject, service_token)
                self.assertEqual(response.status_code, 422)

        # IdP-provisioned identities are not limited to CLI username syntax.
        response = self._post_delegation(
            'alice+tag#EXT#@example.com', service_token)
        self.assertEqual(response.status_code, 404)

    def test_delegated_access_token_requires_valid_bearer(self):
        """Missing and malformed bearer credentials return 401."""
        response = self._post_delegation('delegated@example.com', None)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers['www-authenticate'], 'Bearer')

        response = self.client.post(
            '/api/auth/jwt/delegated_access_token',
            json={'subject_user': 'delegated@example.com'},
            headers={
                login.OSMO_AUTH_HEADER: 'Basic credentials',
                login.OSMO_USER_HEADER: TEST_DELEGATOR,
            },
        )
        self.assertEqual(response.status_code, 401)

    def test_delegated_access_token_bearer_parser_is_strict(self):
        subject = 'bearer-parser@example.com'
        self._create_user(subject, roles=['osmo-user'])
        service_token = self._create_service_jwt()
        headers = {
            login.OSMO_USER_HEADER: TEST_DELEGATOR,
            login.OSMO_AUTH_HEADER: f'bEaReR {service_token}',
        }

        accepted = self.client.post(
            '/api/auth/jwt/delegated_access_token',
            json={'subject_user': subject},
            headers=headers,
        )
        self.assertEqual(accepted.status_code, 200)

        malformed_headers = (
            '',
            'Bearer',
            'Bearer token extra',
            f'Basic {service_token}',
            'Bearer not-a-jwt',
        )
        for authorization in malformed_headers:
            with self.subTest(authorization=authorization):
                denied = self.client.post(
                    '/api/auth/jwt/delegated_access_token',
                    json={'subject_user': subject},
                    headers={
                        login.OSMO_USER_HEADER: TEST_DELEGATOR,
                        login.OSMO_AUTH_HEADER: authorization,
                    },
                )
                self.assertEqual(denied.status_code, 401)
                self.assertEqual(denied.headers['www-authenticate'], 'Bearer')

    def test_delegated_access_token_rejects_invalid_jwt(self):
        """Signature, audience, issuer, and expiration are validated locally."""
        now = int(time.time())
        other_auth = auth.AuthenticationConfig.generate_default()
        valid_claims = jwt.decode(
            self._create_service_jwt(),
            options={'verify_signature': False},
        )
        invalid_tokens = {
            'signature': self._create_service_jwt(authentication_config=other_auth),
            'hs256_algorithm': jwt.encode(
                valid_claims, key='attacker-secret', algorithm='HS256'),
            'none_algorithm': jwt.encode(
                valid_claims, key='', algorithm='none'),
            'audience': self._create_service_jwt(claim_overrides={'aud': 'other-audience'}),
            'issuer': self._create_service_jwt(claim_overrides={'iss': 'other-issuer'}),
            'expiration': self._create_service_jwt(claim_overrides={
                'iat': now - 10,
                'nbf': now - 10,
                'exp': now - 1,
            }),
            'issued_at': self._create_service_jwt(
                claim_overrides={'iat': now + 60}),
            'not_before': self._create_service_jwt(
                claim_overrides={'nbf': now + 60}),
        }
        for label, encoded_token in invalid_tokens.items():
            with self.subTest(label=label):
                response = self._post_delegation(
                    'delegated@example.com', encoded_token)
                self.assertEqual(response.status_code, 401)

    def test_delegated_access_token_accepts_configured_previous_signing_key(self):
        subject = 'key-rotation@example.com'
        self._create_user(subject, roles=['osmo-user'])
        postgres = connectors.PostgresConnector.get_instance()
        service_config = postgres.get_service_configs().model_copy(deep=True)
        previous_key = auth.AuthenticationConfig.generate_default().get_current_key()
        service_config.service_auth.keys['previous'] = previous_key
        now = int(time.time())
        previous_key_token = previous_key.create_jwt({
            'iss': service_config.service_auth.issuer,
            'aud': service_config.service_auth.audience,
            'iat': now,
            'nbf': now,
            'exp': now + common.ACCESS_TOKEN_TIMEOUT,
            'unique_name': TEST_DELEGATOR,
            'roles': [auth.MCP_DELEGATOR_ROLE],
            'osmo_token_name': 'mcp-previous-key',
        })

        with mock.patch.object(
            postgres,
            'get_service_configs',
            return_value=service_config,
        ):
            response = self._post_delegation(subject, previous_key_token)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self._decode_jwt(response.json()['token'])['unique_name'],
            subject,
        )

    def test_delegated_access_token_requires_standard_jwt_claims(self):
        for required_claim in ('aud', 'exp', 'iat', 'iss', 'nbf'):
            with self.subTest(required_claim=required_claim):
                encoded_token = self._create_service_jwt(
                    claim_removals=[required_claim])
                response = self._post_delegation(
                    'delegated@example.com', encoded_token)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers['www-authenticate'], 'Bearer')

    def test_delegated_access_token_uses_gateway_authorized_actor(self):
        """Core preserves the actor authorized by Gateway policy evaluation."""
        subject = 'dynamic-actor@example.com'
        actor = 'alternate-mcp-service'
        self._create_user(subject, roles=['osmo-user'])
        service_token = self._create_service_jwt(
            username=actor,
            roles=['custom-delegator', 'osmo-user'],
            token_name=None,
        )

        with self.assertLogs(
                'src.service.core.auth.auth_service', level='INFO') as captured:
            response = self._post_delegation(
                subject,
                service_token,
                gateway_user=actor,
            )

        self.assertEqual(response.status_code, 200)
        claims = self._decode_jwt(response.json()['token'])
        self.assertEqual(claims['act'], {'sub': actor})
        audit_record = next(
            record for record in captured.records
            if getattr(record, 'outcome', None) == 'success')
        self.assertEqual(getattr(audit_record, 'actor'), actor)

    def test_delegated_access_token_rejects_delegated_caller(self):
        delegated_caller = self._create_service_jwt(
            claim_overrides={'act': {'sub': TEST_DELEGATOR}})

        response = self._post_delegation(
            'delegated@example.com', delegated_caller)

        self.assertEqual(response.status_code, 403)

    def test_delegated_access_token_rejects_invalid_actor_claims(self):
        malformed_claims: Dict[str, tuple[Dict[str, Any], List[str]]] = {
            'missing_actor': ({}, ['unique_name']),
            'numeric_actor': ({'unique_name': 123}, []),
            'empty_actor': ({'unique_name': ''}, []),
            'blank_actor': ({'unique_name': ' \t '}, []),
        }

        for label, (claim_overrides, claim_removals) in malformed_claims.items():
            with self.subTest(label=label):
                encoded_token = self._create_service_jwt(
                    claim_overrides=claim_overrides,
                    claim_removals=claim_removals,
                )
                response = self._post_delegation(
                    'delegated@example.com', encoded_token)
                self.assertEqual(response.status_code, 403)

    def test_delegated_access_token_rejects_gateway_identity_mismatch(self):
        service_token = self._create_service_jwt()
        response = self._post_delegation(
            'delegated@example.com', service_token, gateway_user=self.TEST_ADMIN)
        self.assertEqual(response.status_code, 403)

    def test_delegated_access_token_requires_gateway_identity(self):
        service_token = self._create_service_jwt()
        default_gateway_user = self.client.headers.pop(login.OSMO_USER_HEADER)
        try:
            response = self._post_delegation(
                'delegated@example.com', service_token, gateway_user=None)
        finally:
            self.client.headers[login.OSMO_USER_HEADER] = default_gateway_user
        self.assertEqual(response.status_code, 403)

    def test_delegated_access_token_rejects_unknown_or_roleless_subject(self):
        service_token = self._create_service_jwt()

        response = self._post_delegation(
            'unknown@example.com', service_token)
        self.assertEqual(response.status_code, 404)
        self.assertIn('not found', response.json()['detail'])

        self._create_user('roleless@example.com')
        response = self._post_delegation(
            'roleless@example.com', service_token)
        self.assertEqual(response.status_code, 403)
        self.assertIn('no roles', response.json()['detail'])

    def test_delegation_resolves_current_roles_for_every_token(self):
        subject = 'changing-roles@example.com'
        self._create_user(subject, roles=['osmo-user'])
        service_token = self._create_service_jwt()

        first = self._post_delegation(subject, service_token)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(self._decode_jwt(first.json()['token'])['roles'], ['osmo-user'])

        self._assign_role(subject, 'osmo-admin')
        second = self._post_delegation(subject, service_token)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(
            self._decode_jwt(second.json()['token'])['roles'],
            ['osmo-admin', 'osmo-user'],
        )

        postgres = connectors.PostgresConnector.get_instance()
        postgres.execute_commit_command(
            'DELETE FROM user_roles WHERE user_id = %s AND role_name = %s;',
            (subject, 'osmo-user'),
        )
        third = self._post_delegation(subject, service_token)
        self.assertEqual(third.status_code, 200)
        self.assertEqual(self._decode_jwt(third.json()['token'])['roles'], ['osmo-admin'])

    def test_delegation_logs_exclude_tokens(self):
        """Audit logging records metadata without either credential."""
        subject = 'logged-delegation@example.com'
        self._create_user(subject, roles=['osmo-user'])
        service_token = self._create_service_jwt()

        with self.assertLogs(
                'src.service.core.auth.auth_service', level='INFO') as captured:
            response = self._post_delegation(subject, service_token)

        self.assertEqual(response.status_code, 200)
        delegated_token = response.json()['token']
        serialized_records = '\n'.join(
            str(record.__dict__) for record in captured.records)
        self.assertNotIn(service_token, serialized_records)
        self.assertNotIn(delegated_token, serialized_records)
        audit_record = next(
            record for record in captured.records
            if record.getMessage().startswith('Delegated access token request '))
        self.assertEqual(getattr(audit_record, 'actor'), TEST_DELEGATOR)
        self.assertEqual(getattr(audit_record, 'subject'), subject)
        self.assertEqual(
            getattr(audit_record, 'request_id'), 'delegation-test-request')
        self.assertEqual(getattr(audit_record, 'outcome'), 'success')
        self.assertEqual(
            getattr(audit_record, 'expires_at'), response.json()['expires_at'])

    def test_delegation_drops_invalid_request_id_from_logs(self):
        subject = 'sanitized-log@example.com'
        self._create_user(subject, roles=['osmo-user'])
        service_token = self._create_service_jwt()
        invalid_request_ids = [
            'request id must not reach logs',
            'a' * 129,
        ]

        for invalid_request_id in invalid_request_ids:
            with self.subTest(request_id=invalid_request_id):
                with self.assertLogs(
                        'src.service.core.auth.auth_service', level='INFO') as captured:
                    response = self._post_delegation(
                        subject, service_token, request_id=invalid_request_id)

                self.assertEqual(response.status_code, 200)
                serialized_records = '\n'.join(
                    str(record.__dict__) for record in captured.records)
                self.assertNotIn(invalid_request_id, serialized_records)
        self.assertIsNone(getattr(captured.records[0], 'request_id'))

    # =========================================================================
    # User Management Tests
    # =========================================================================

    def test_create_user(self):
        """Test creating a new user without roles."""
        user = self._create_user('newuser@example.com')

        self.assertEqual(user['id'], 'newuser@example.com')
        self.assertIsNotNone(user['created_at'])

    def test_create_user_with_roles(self):
        """Test creating a user with initial roles."""
        user = self._create_user('roleuser@example.com', roles=['osmo-user', 'osmo-ml-team'])

        self.assertEqual(user['id'], 'roleuser@example.com')

        # Verify roles were assigned
        user_details = self._get_user('roleuser@example.com')
        role_names = [r['role_name'] for r in user_details['roles']]
        self.assertIn('osmo-user', role_names)
        self.assertIn('osmo-ml-team', role_names)

    def test_create_user_duplicate_fails(self):
        """Test that creating a duplicate user fails."""
        self._create_user('duplicate@example.com')

        response = self.client.post(
            '/api/auth/user',
            json={'id': 'duplicate@example.com'}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('already exists', response.json()['message'])

    def test_create_user_with_invalid_role_fails(self):
        """Test that creating a user with a non-existent role fails."""
        response = self.client.post(
            '/api/auth/user',
            json={'id': 'baduser@example.com', 'roles': ['nonexistent-role']}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('does not exist', response.json()['message'])

    def test_get_user(self):
        """Test getting user details."""
        self._create_user('getuser@example.com', roles=['osmo-user'])

        user = self._get_user('getuser@example.com')

        self.assertEqual(user['id'], 'getuser@example.com')
        self.assertIn('roles', user)
        self.assertEqual(len(user['roles']), 1)
        self.assertEqual(user['roles'][0]['role_name'], 'osmo-user')

    def test_get_user_not_found(self):
        """Test getting a non-existent user returns 400."""
        response = self.client.get('/api/auth/user/nonexistent@example.com')
        self.assertEqual(response.status_code, 400)
        self.assertIn('not found', response.json()['message'])

    def test_list_users(self):
        """Test listing users."""
        self._create_user('list1@example.com')
        self._create_user('list2@example.com')
        self._create_user('list3@example.com')

        response = self.client.get('/api/auth/user')
        self.assertEqual(response.status_code, 200)

        result = response.json()
        self.assertIn('users', result)
        self.assertIn('total_results', result)
        self.assertGreaterEqual(result['total_results'], 3)

        user_ids = [u['id'] for u in result['users']]
        self.assertIn('list1@example.com', user_ids)
        self.assertIn('list2@example.com', user_ids)
        self.assertIn('list3@example.com', user_ids)

    def test_list_users_with_id_prefix(self):
        """Test listing users with id_prefix filter."""
        self._create_user('prefix-user1@example.com')
        self._create_user('prefix-user2@example.com')
        self._create_user('other@example.com')

        response = self.client.get('/api/auth/user', params={'id_prefix': 'prefix-'})
        self.assertEqual(response.status_code, 200)

        result = response.json()
        user_ids = [u['id'] for u in result['users']]
        self.assertIn('prefix-user1@example.com', user_ids)
        self.assertIn('prefix-user2@example.com', user_ids)
        self.assertNotIn('other@example.com', user_ids)

    def test_list_users_with_roles_filter(self):
        """Test listing users filtered by roles."""
        self._create_user('admin1@example.com', roles=['osmo-admin'])
        self._create_user('admin2@example.com', roles=['osmo-admin', 'osmo-user'])
        self._create_user('regular@example.com', roles=['osmo-user'])

        response = self.client.get('/api/auth/user', params={'roles': ['osmo-admin']})
        self.assertEqual(response.status_code, 200)

        result = response.json()
        user_ids = [u['id'] for u in result['users']]
        self.assertIn('admin1@example.com', user_ids)
        self.assertIn('admin2@example.com', user_ids)
        self.assertNotIn('regular@example.com', user_ids)

    def test_list_users_pagination(self):
        """Test listing users with pagination."""
        for i in range(5):
            self._create_user(f'page-user{i}@example.com')

        response = self.client.get('/api/auth/user', params={'count': 2, 'start_index': 1})
        self.assertEqual(response.status_code, 200)

        result = response.json()
        self.assertEqual(result['items_per_page'], 2)
        self.assertEqual(result['start_index'], 1)
        self.assertGreaterEqual(result['total_results'], 5)

    def test_delete_user(self):
        """Test deleting a user."""
        self._create_user('deleteuser@example.com', roles=['osmo-user'])

        response = self.client.delete('/api/auth/user/deleteuser@example.com')
        self.assertEqual(response.status_code, 200)

        # Verify user is gone
        response = self.client.get('/api/auth/user/deleteuser@example.com')
        self.assertEqual(response.status_code, 400)

    def test_delete_user_cascades_to_roles(self):
        """Test that deleting a user removes their role assignments."""
        self._create_user('cascade-user@example.com', roles=['osmo-user', 'osmo-admin'])

        # Verify roles exist
        postgres = connectors.PostgresConnector.get_instance()
        fetch_cmd = 'SELECT COUNT(*) as cnt FROM user_roles WHERE user_id = %s;'
        result = postgres.execute_fetch_command(fetch_cmd, ('cascade-user@example.com',), True)
        self.assertEqual(result[0]['cnt'], 2)

        # Delete user
        response = self.client.delete('/api/auth/user/cascade-user@example.com')
        self.assertEqual(response.status_code, 200)

        # Verify roles are gone (cascaded)
        result = postgres.execute_fetch_command(fetch_cmd, ('cascade-user@example.com',), True)
        self.assertEqual(result[0]['cnt'], 0)

    def test_delete_user_not_found(self):
        """Test deleting a non-existent user returns 400."""
        response = self.client.delete('/api/auth/user/nonexistent@example.com')
        self.assertEqual(response.status_code, 400)

    # =========================================================================
    # Role Assignment Tests
    # =========================================================================

    def test_assign_role_to_user(self):
        """Test assigning a role to a user."""
        self._create_user('roleassign@example.com')

        result = self._assign_role('roleassign@example.com', 'osmo-user')

        self.assertEqual(result['user_id'], 'roleassign@example.com')
        self.assertEqual(result['role_name'], 'osmo-user')
        self.assertIn('assigned_by', result)
        self.assertIn('assigned_at', result)

    def test_assign_role_idempotent(self):
        """Test that assigning the same role twice is idempotent."""
        self._create_user('idempotent@example.com')
        self._assign_role('idempotent@example.com', 'osmo-user')

        # Assign again - should not fail
        response = self.client.post(
            '/api/auth/user/idempotent@example.com/roles',
            json={'role_name': 'osmo-user'}
        )
        self.assertEqual(response.status_code, 200)

        # Verify only one assignment exists
        user = self._get_user('idempotent@example.com')
        role_names = [r['role_name'] for r in user['roles']]
        self.assertEqual(role_names.count('osmo-user'), 1)

    def test_assign_nonexistent_role_fails(self):
        """Test that assigning a non-existent role fails."""
        self._create_user('badrole@example.com')

        response = self.client.post(
            '/api/auth/user/badrole@example.com/roles',
            json={'role_name': 'fake-role'}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('does not exist', response.json()['message'])

    def test_assign_role_to_nonexistent_user_fails(self):
        """Test that assigning a role to a non-existent user fails."""
        response = self.client.post(
            '/api/auth/user/nobody@example.com/roles',
            json={'role_name': 'osmo-user'}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('not found', response.json()['message'])

    def test_remove_role_from_user(self):
        """Test removing a role from a user."""
        self._create_user('removerole@example.com', roles=['osmo-user', 'osmo-admin'])

        response = self.client.delete('/api/auth/user/removerole@example.com/roles/osmo-admin')
        self.assertEqual(response.status_code, 200)

        # Verify role is removed
        user = self._get_user('removerole@example.com')
        role_names = [r['role_name'] for r in user['roles']]
        self.assertNotIn('osmo-admin', role_names)
        self.assertIn('osmo-user', role_names)

    def test_remove_role_cascades_to_access_tokens(self):
        """Test that removing a role from a user also removes it from their access tokens."""
        # Create user with roles
        self._create_user(self.TEST_USER, roles=['osmo-user', 'osmo-admin', 'osmo-ml-team'])

        # Create an access token that inherits all roles
        self._create_access_token('test-token')

        # Verify access token has all roles
        token_roles = self._get_access_token_roles(self.TEST_USER, 'test-token')
        self.assertIn('osmo-user', token_roles)
        self.assertIn('osmo-admin', token_roles)
        self.assertIn('osmo-ml-team', token_roles)

        # Remove a role from the user
        response = self.client.delete(f'/api/auth/user/{self.TEST_USER}/roles/osmo-admin')
        self.assertEqual(response.status_code, 200)

        # Verify role is removed from both user and access token
        user = self._get_user(self.TEST_USER)
        user_role_names = [r['role_name'] for r in user['roles']]
        self.assertNotIn('osmo-admin', user_role_names)

        token_roles = self._get_access_token_roles(self.TEST_USER, 'test-token')
        self.assertNotIn('osmo-admin', token_roles)
        self.assertIn('osmo-user', token_roles)
        self.assertIn('osmo-ml-team', token_roles)

    def test_remove_role_cascades_to_multiple_access_tokens(self):
        """Test that removing a role cascades to all of user's access tokens."""
        self._create_user(self.TEST_USER, roles=['osmo-user', 'osmo-admin'])

        # Create multiple access tokens
        self._create_access_token('token1')
        self._create_access_token('token2')
        self._create_access_token('token3')

        # Verify all access tokens have the role
        for token_name in ['token1', 'token2', 'token3']:
            token_roles = self._get_access_token_roles(self.TEST_USER, token_name)
            self.assertIn('osmo-admin', token_roles)

        # Remove role from user
        response = self.client.delete(f'/api/auth/user/{self.TEST_USER}/roles/osmo-admin')
        self.assertEqual(response.status_code, 200)

        # Verify role is removed from all access tokens
        for token_name in ['token1', 'token2', 'token3']:
            token_roles = self._get_access_token_roles(self.TEST_USER, token_name)
            self.assertNotIn('osmo-admin', token_roles)
            self.assertIn('osmo-user', token_roles)

    def test_list_user_roles(self):
        """Test listing roles for a user."""
        self._create_user('listroles@example.com', roles=['osmo-user', 'osmo-admin'])

        response = self.client.get('/api/auth/user/listroles@example.com/roles')
        self.assertEqual(response.status_code, 200)

        result = response.json()
        self.assertEqual(result['user_id'], 'listroles@example.com')
        role_names = [r['role_name'] for r in result['roles']]
        self.assertIn('osmo-user', role_names)
        self.assertIn('osmo-admin', role_names)

    def test_list_users_with_role(self):
        """Test listing all users who have a specific role."""
        self._create_user('rolelist1@example.com', roles=['osmo-ml-team'])
        self._create_user('rolelist2@example.com', roles=['osmo-ml-team'])
        self._create_user('rolelist3@example.com', roles=['osmo-dev-team'])

        response = self.client.get('/api/auth/roles/osmo-ml-team/users')
        self.assertEqual(response.status_code, 200)

        result = response.json()
        self.assertEqual(result['role_name'], 'osmo-ml-team')
        user_ids = [u['user_id'] for u in result['users']]
        self.assertIn('rolelist1@example.com', user_ids)
        self.assertIn('rolelist2@example.com', user_ids)
        self.assertNotIn('rolelist3@example.com', user_ids)

    def test_bulk_assign_role(self):
        """Test bulk assigning a role to multiple users."""
        self._create_user('bulk1@example.com')
        self._create_user('bulk2@example.com')
        self._create_user('bulk3@example.com', roles=['osmo-dev-team'])  # Already has it

        response = self.client.post(
            '/api/auth/roles/osmo-dev-team/users',
            json={'user_ids': ['bulk1@example.com', 'bulk2@example.com', 'bulk3@example.com',
                               'nonexistent@example.com']}
        )
        self.assertEqual(response.status_code, 200)

        result = response.json()
        self.assertEqual(result['role_name'], 'osmo-dev-team')
        self.assertIn('bulk1@example.com', result['assigned'])
        self.assertIn('bulk2@example.com', result['assigned'])
        self.assertIn('bulk3@example.com', result['already_assigned'])
        self.assertIn('nonexistent@example.com', result['failed'])

    # =========================================================================
    # Access Token Tests
    # =========================================================================

    def test_create_access_token_inherits_all_roles(self):
        """Test that creating an access token without specifying roles inherits all user roles."""
        self._create_user(self.TEST_USER, roles=['osmo-user', 'osmo-admin', 'osmo-ml-team'])

        token = self._create_access_token('inherit-all-token')
        self.assertIsNotNone(token)

        # Verify access token has all user roles
        token_roles = self._get_access_token_roles(self.TEST_USER, 'inherit-all-token')
        self.assertEqual(sorted(token_roles), ['osmo-admin', 'osmo-ml-team', 'osmo-user'])

    def test_create_access_token_with_subset_of_roles(self):
        """Test creating an access token with a specific subset of user's roles."""
        self._create_user(self.TEST_USER, roles=['osmo-user', 'osmo-admin', 'osmo-ml-team'])

        params = {
            'expires_at': '2027-01-01',
            'roles': ['osmo-user', 'osmo-ml-team']  # Subset of user's roles
        }
        response = self.client.post('/api/auth/access_token/subset-token', params=params)
        self.assertEqual(response.status_code, 200)

        # Verify access token has only the specified roles
        token_roles = self._get_access_token_roles(self.TEST_USER, 'subset-token')
        self.assertEqual(sorted(token_roles), ['osmo-ml-team', 'osmo-user'])
        self.assertNotIn('osmo-admin', token_roles)

    def test_create_access_token_with_unassigned_role_fails(self):
        """Test that creating an access token with roles not assigned to user fails."""
        self._create_user(self.TEST_USER, roles=['osmo-user'])

        params = {
            'expires_at': '2027-01-01',
            'roles': ['osmo-user', 'osmo-admin']  # osmo-admin not assigned to user
        }
        response = self.client.post('/api/auth/access_token/bad-token', params=params)
        self.assertEqual(response.status_code, 400)
        self.assertIn('does not have all the requested roles', response.json()['message'])

    def test_create_access_token_user_with_no_roles_fails(self):
        """Test that creating an access token for a user with no roles fails."""
        self._create_user(self.TEST_USER)  # No roles

        response = self.client.post(
            '/api/auth/access_token/no-roles-token',
            params={'expires_at': '2027-01-01'}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('At least one role', response.json()['message'])

    def test_create_access_token_duplicate_name_fails(self):
        """Test that creating an access token with duplicate name fails."""
        self._create_user(self.TEST_USER, roles=['osmo-user'])
        self._create_access_token('duplicate-token')

        response = self.client.post(
            '/api/auth/access_token/duplicate-token',
            params={'expires_at': '2027-01-01'}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('already exists', response.json()['message'])

    def test_list_access_tokens(self):
        """Test listing access tokens for a user."""
        self._create_user(self.TEST_USER, roles=['osmo-user'])
        self._create_access_token('token1', description='First token')
        self._create_access_token('token2', description='Second token')

        response = self.client.get('/api/auth/access_token')
        self.assertEqual(response.status_code, 200)

        tokens = response.json()
        token_names = [t['token_name'] for t in tokens]
        self.assertIn('token1', token_names)
        self.assertIn('token2', token_names)

    def test_delete_access_token(self):
        """Test deleting an access token."""
        self._create_user(self.TEST_USER, roles=['osmo-user'])
        self._create_access_token('delete-me-token')

        response = self.client.delete('/api/auth/access_token/delete-me-token')
        self.assertEqual(response.status_code, 200)

        # Verify token is gone
        response = self.client.get('/api/auth/access_token')
        token_names = [t['token_name'] for t in response.json()]
        self.assertNotIn('delete-me-token', token_names)

    def test_delete_access_token_cascades_access_token_roles(self):
        """Test that deleting an access token removes its access_token_roles entries."""
        self._create_user(self.TEST_USER, roles=['osmo-user', 'osmo-admin'])
        self._create_access_token('cascade-delete-token')

        # Verify access_token_roles exist
        postgres = connectors.PostgresConnector.get_instance()
        fetch_cmd = '''
            SELECT COUNT(*) as cnt FROM access_token_roles
            WHERE user_name = %s AND token_name = %s;
        '''
        result = postgres.execute_fetch_command(
            fetch_cmd, (self.TEST_USER, 'cascade-delete-token'), True)
        self.assertEqual(result[0]['cnt'], 2)

        # Delete token
        response = self.client.delete('/api/auth/access_token/cascade-delete-token')
        self.assertEqual(response.status_code, 200)

        # Verify access_token_roles are gone
        result = postgres.execute_fetch_command(
            fetch_cmd, (self.TEST_USER, 'cascade-delete-token'), True)
        self.assertEqual(result[0]['cnt'], 0)

    def test_list_access_token_roles(self):
        """Test listing roles for a specific access token."""
        self._create_user(self.TEST_USER, roles=['osmo-user', 'osmo-admin'])
        self._create_access_token('roles-token')

        response = self.client.get('/api/auth/access_token/roles-token/roles')
        self.assertEqual(response.status_code, 200)

        result = response.json()
        self.assertEqual(result['token_name'], 'roles-token')
        role_names = [r['role_name'] for r in result['roles']]
        self.assertIn('osmo-user', role_names)
        self.assertIn('osmo-admin', role_names)

    # =========================================================================
    # Admin API Tests
    # =========================================================================

    def test_admin_create_access_token_for_user(self):
        """Test admin creating an access token for another user."""
        self._create_user('target-user@example.com', roles=['osmo-user', 'osmo-ml-team'])

        response = self.client.post(
            '/api/auth/user/target-user@example.com/access_token/admin-created-token',
            params={'expires_at': '2027-01-01', 'description': 'Admin created token'}
        )
        self.assertEqual(response.status_code, 200)

        # Verify token was created with correct roles
        token_roles = self._get_access_token_roles('target-user@example.com', 'admin-created-token')
        self.assertEqual(sorted(token_roles), ['osmo-ml-team', 'osmo-user'])

    def test_admin_create_access_token_for_nonexistent_user_fails(self):
        """Test that admin creating access token for non-existent user fails."""
        response = self.client.post(
            '/api/auth/user/nobody@example.com/access_token/admin-token',
            params={'expires_at': '2027-01-01'}
        )
        self.assertEqual(response.status_code, 400)
        # Service returns role error because user has no roles (doesn't exist)
        # Either 'not found' or 'role' error message is acceptable
        message = response.json()['message'].lower()
        self.assertTrue(
            'not found' in message or 'role' in message,
            f"Expected 'not found' or 'role' in message, got: {message}"
        )

    def test_admin_list_access_tokens_for_user(self):
        """Test admin listing access tokens for another user."""
        self._create_user('list-target@example.com', roles=['osmo-user'])

        # Create tokens for the target user via API
        response = self.client.post(
            '/api/auth/user/list-target@example.com/access_token/user-token-1',
            params={'expires_at': '2027-01-01', 'description': 'Token 1'}
        )
        self.assertEqual(response.status_code, 200)

        response = self.client.post(
            '/api/auth/user/list-target@example.com/access_token/user-token-2',
            params={'expires_at': '2027-01-01', 'description': 'Token 2'}
        )
        self.assertEqual(response.status_code, 200)

        response = self.client.get('/api/auth/user/list-target@example.com/access_token')
        self.assertEqual(response.status_code, 200)

        tokens = response.json()
        token_names = [t['token_name'] for t in tokens]
        self.assertIn('user-token-1', token_names)
        self.assertIn('user-token-2', token_names)

    def test_admin_delete_access_token_for_user(self):
        """Test admin deleting another user's access token."""
        self._create_user('delete-target@example.com', roles=['osmo-user'])

        # Create token for target user via API
        response = self.client.post(
            '/api/auth/user/delete-target@example.com/access_token/target-token',
            params={'expires_at': '2027-01-01', 'description': 'To be deleted'}
        )
        self.assertEqual(response.status_code, 200)

        response = self.client.delete(
            '/api/auth/user/delete-target@example.com/access_token/target-token'
        )
        self.assertEqual(response.status_code, 200)

        # Verify token is gone
        postgres = connectors.PostgresConnector.get_instance()
        tokens = objects.AccessToken.list_from_db(postgres, 'delete-target@example.com')
        token_names = [t.token_name for t in tokens]
        self.assertNotIn('target-token', token_names)

    # =========================================================================
    # Edge Case Tests
    # =========================================================================

    def test_remove_nonexistent_role_from_user_succeeds(self):
        """Test that removing a role the user doesn't have succeeds silently."""
        self._create_user('norole@example.com', roles=['osmo-user'])

        # osmo-admin was never assigned
        response = self.client.delete('/api/auth/user/norole@example.com/roles/osmo-admin')
        self.assertEqual(response.status_code, 200)

    def test_user_deletion_cascades_to_access_tokens(self):
        """Test that deleting a user cascades to their access tokens."""
        self._create_user('token-cascade@example.com', roles=['osmo-user'])

        # Create token for target user via API
        response = self.client.post(
            '/api/auth/user/token-cascade@example.com/access_token/cascade-token',
            params={'expires_at': '2027-01-01', 'description': 'Cascade test'}
        )
        self.assertEqual(response.status_code, 200)

        # Verify access token exists
        postgres = connectors.PostgresConnector.get_instance()
        tokens = objects.AccessToken.list_from_db(postgres, 'token-cascade@example.com')
        self.assertEqual(len(tokens), 1)

        # Delete user
        response = self.client.delete('/api/auth/user/token-cascade@example.com')
        self.assertEqual(response.status_code, 200)

        # Verify access token is gone (explicit deletion in delete_user handles this)
        fetch_cmd = '''
            SELECT COUNT(*) as cnt FROM access_token WHERE user_name = %s;
        '''
        result = postgres.execute_fetch_command(fetch_cmd, ('token-cascade@example.com',), True)
        self.assertEqual(result[0]['cnt'], 0)

    def test_access_token_expiration_validation(self):
        """Test that access token expiration date must be in the future."""
        self._create_user(self.TEST_USER, roles=['osmo-user'])

        response = self.client.post(
            '/api/auth/access_token/expired-token',
            params={'expires_at': '2020-01-01'}  # Past date
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('past the current date', response.json()['message'])

    def test_access_token_name_validation(self):
        """Test that access token name must match valid regex."""
        self._create_user(self.TEST_USER, roles=['osmo-user'])

        response = self.client.post(
            '/api/auth/access_token/invalid name with spaces',
            params={'expires_at': '2027-01-01'}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('must match regex', response.json()['message'])


if __name__ == '__main__':
    runner.run_test()
