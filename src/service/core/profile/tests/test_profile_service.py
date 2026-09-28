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

import datetime
import time
import unittest
from unittest import mock

import fastapi
import jwt
from fastapi import testclient

from src.lib.api import profile as profile_contract
from src.lib.utils import osmo_errors
from src.service.core.profile import profile_service
from src.utils import auth


class TestProfileService(unittest.TestCase):
    """Exercise token provenance and backwards-compatible HTTP responses."""

    @classmethod
    def setUpClass(cls):
        cls.service_auth = auth.AuthenticationConfig.generate_default()
        cls.other_auth = auth.AuthenticationConfig.generate_default()

    def setUp(self):
        app = fastapi.FastAPI()
        app.include_router(profile_service.router)
        self.client = testclient.TestClient(app)
        self.addCleanup(self.client.close)
        postgres = self.enterContext(mock.patch.object(
            profile_service.connectors.PostgresConnector, 'get_instance'))
        postgres.return_value.get_service_configs.return_value.service_auth = self.service_auth
        self.enterContext(mock.patch.object(
            profile_service.connectors.UserProfile, 'fetch_from_db',
            return_value=profile_contract.UserProfile(username='admin')))
        self.fetch_token = self.enterContext(mock.patch.object(
            profile_service.auth_objects.AccessToken, 'fetch_from_db'))
        self.expiry = datetime.datetime(2026, 12, 1, tzinfo=datetime.timezone.utc)
        self.fetch_token.return_value.expires_at = self.expiry
        self.headers = {
            'x-osmo-user': 'admin', 'x-osmo-roles': 'osmo-admin',
            'x-osmo-token-name': 'bootstrap-admin-primary',
            'x-osmo-allowed-pools': 'default',
        }

    def signed_token(self, source='bootstrap', **overrides):
        now = int(time.time())
        claims = {
            'iss': self.service_auth.issuer, 'aud': self.service_auth.audience,
            'iat': now, 'nbf': now, 'exp': now + 300,
            'unique_name': 'admin', 'osmo_token_name': 'bootstrap-admin-primary',
            'osmo_token_source': source,
        }
        claims.update(overrides)
        return self.service_auth.get_current_key().create_jwt(claims)

    def use_token(self, source='bootstrap', **overrides):
        self.headers['Authorization'] = 'Bearer ' + self.signed_token(source, **overrides)

    def get_token(self, *, extended=True):
        response = self.client.get('/api/profile/settings', headers=self.headers,
                                   params={'include_token_expiration': str(extended).lower()})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['roles'], ['osmo-admin'])
        return response.json()['token']

    def test_bootstrap_is_non_expiring_despite_same_named_database_token(self):
        self.use_token()
        self.assertEqual(self.get_token(), {
            'name': 'bootstrap-admin-primary', 'expires_at': None,
            'expiration_status': 'never',
        })
        self.fetch_token.assert_not_called()

    def test_database_and_legacy_tokens_use_registered_expiry(self):
        for source in ('database', '', 'unrecognized'):
            with self.subTest(source=source):
                self.use_token(source)
                token = self.get_token()
                self.assertEqual(token['expiration_status'], 'scheduled')
                self.assertEqual(token['expires_at'], '2026-12-01T00:00:00Z')

    def test_missing_registration_does_not_imply_non_expiring(self):
        self.fetch_token.side_effect = osmo_errors.OSMOUserError('Token not found')
        for source in ('database', '', 'unrecognized'):
            with self.subTest(source=source):
                self.use_token(source)
                self.assertEqual(self.get_token(), {
                    'name': 'bootstrap-admin-primary', 'expires_at': None,
                    'expiration_status': 'unknown',
                })

    def test_no_token_identity_without_token_name(self):
        del self.headers['x-osmo-token-name']
        self.use_token()
        self.assertIsNone(self.get_token())
        self.fetch_token.assert_not_called()

    def test_legacy_response_omits_new_field_even_for_bootstrap(self):
        self.use_token()
        self.assertEqual(self.get_token(extended=False), {
            'name': 'bootstrap-admin-primary', 'expires_at': None,
        })
        response = self.client.get('/api/profile/settings', headers=self.headers)
        self.assertEqual(response.json()['token'], {
            'name': 'bootstrap-admin-primary', 'expires_at': None,
        })

    def test_alternate_header_supports_bootstrap(self):
        self.headers['x-osmo-auth'] = self.signed_token()
        self.assertEqual(self.get_token()['expiration_status'], 'never')
        self.fetch_token.assert_not_called()

    def test_retained_rotation_key_is_accepted(self):
        self.use_token()
        rotated = self.other_auth.model_copy(deep=True)
        rotated.keys.update(self.service_auth.keys)
        postgres = profile_service.connectors.PostgresConnector.get_instance()
        postgres.get_service_configs.return_value.service_auth = rotated
        self.assertEqual(self.get_token()['expiration_status'], 'never')
        self.fetch_token.assert_not_called()

    def test_invalid_provenance_cannot_claim_non_expiring(self):
        self.fetch_token.side_effect = osmo_errors.OSMOUserError('Token not found')
        now = int(time.time())
        cases = [
            {'iss': 'external'}, {'aud': 'external'},
            {'exp': now - 1}, {'iat': now + 300}, {'nbf': now + 300},
            {'unique_name': 'another-user'}, {'osmo_token_name': 'another-token'},
            {'osmo_token_source': ['bootstrap']},
        ]
        for overrides in cases:
            with self.subTest(overrides=overrides):
                self.use_token(**overrides)
                self.assertEqual(self.get_token()['expiration_status'], 'unknown')

    def test_missing_required_claims_cannot_claim_non_expiring(self):
        self.fetch_token.side_effect = osmo_errors.OSMOUserError('Token not found')
        claims = jwt.decode(self.signed_token(), options={'verify_signature': False})
        for name in ('exp', 'iat', 'nbf', 'iss', 'aud', 'unique_name',
                     'osmo_token_name', 'osmo_token_source'):
            with self.subTest(claim=name):
                incomplete = {key: value for key, value in claims.items() if key != name}
                self.headers['Authorization'] = 'Bearer ' + (
                    self.service_auth.get_current_key().create_jwt(incomplete))
                self.assertEqual(self.get_token()['expiration_status'], 'unknown')

    def test_untrusted_signatures_and_malformed_headers_use_database_fallback(self):
        claims = jwt.decode(self.signed_token(), options={'verify_signature': False})
        tokens = [
            '', 'malformed', self.other_auth.get_current_key().create_jwt(claims),
            jwt.encode(claims, key='', algorithm='none'),
            jwt.encode(claims, key='untrusted-secret-for-regression-test', algorithm='HS256'),
        ]
        for token in tokens:
            with self.subTest(token_case=tokens.index(token)):
                self.headers['Authorization'] = 'Bearer ' + token
                self.assertEqual(self.get_token()['expiration_status'], 'scheduled')
        for value in ('Basic credentials', 'Bearer', self.signed_token()):
            self.headers['Authorization'] = value
            self.assertEqual(self.get_token()['expiration_status'], 'scheduled')

    def test_legacy_jwt_and_absent_jwt_use_database_fallback(self):
        self.assertEqual(self.get_token()['expiration_status'], 'scheduled')
        self.headers['Authorization'] = 'Bearer ' + self.service_auth.create_idtoken_jwt(
            int(time.time()) + 300, 'admin', ['osmo-admin'],
            token_name='bootstrap-admin-primary')
        self.assertEqual(self.get_token()['expiration_status'], 'scheduled')

    def test_source_header_cannot_override_signed_source(self):
        self.headers['x-osmo-token-source'] = 'bootstrap'
        self.assertEqual(self.get_token()['expiration_status'], 'scheduled')
        self.use_token('database')
        self.assertEqual(self.get_token()['expiration_status'], 'scheduled')
        self.fetch_token.side_effect = osmo_errors.OSMOUserError('Token not found')
        self.assertEqual(self.get_token()['expiration_status'], 'unknown')

    def test_ambiguous_credentials_cannot_claim_non_expiring(self):
        bootstrap = self.signed_token()
        database = self.signed_token('database')
        cases = [
            [('Authorization', 'Bearer ' + bootstrap), ('x-osmo-auth', database)],
            [('Authorization', 'Bearer ' + database), ('x-osmo-auth', bootstrap)],
            [('Authorization', 'Bearer ' + bootstrap), ('Authorization', 'Bearer ' + database)],
            [('x-osmo-auth', bootstrap), ('x-osmo-auth', database)],
            [('Authorization', 'Bearer ' + bootstrap + ',Bearer ' + database)],
            [('x-osmo-auth', bootstrap + ',' + database)],
        ]
        self.fetch_token.side_effect = osmo_errors.OSMOUserError('Token not found')
        for credentials in cases:
            with self.subTest(header_names=[name for name, _ in credentials]):
                response = self.client.get(
                    '/api/profile/settings?include_token_expiration=true',
                    headers=[*self.headers.items(), *credentials])
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['token']['expiration_status'], 'unknown')

    def test_database_failure_is_not_reported_as_unknown(self):
        self.fetch_token.side_effect = RuntimeError('Database unavailable')
        with self.assertRaisesRegex(RuntimeError, 'Database unavailable'):
            self.get_token()


if __name__ == '__main__':
    unittest.main()
