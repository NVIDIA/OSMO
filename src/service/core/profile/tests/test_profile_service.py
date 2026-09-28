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
import unittest
from unittest import mock

import fastapi
from fastapi import testclient

from src.lib.api import profile as profile_contract
from src.lib.utils import osmo_errors
from src.service.core.profile import profile_service


class TestProfileService(unittest.TestCase):
    """Exercise token provenance and backwards-compatible HTTP responses."""

    def setUp(self):
        app = fastapi.FastAPI()
        app.include_router(profile_service.router)
        self.client = testclient.TestClient(app)
        self.addCleanup(self.client.close)
        self.enterContext(mock.patch.object(
            profile_service.connectors.PostgresConnector, 'get_instance'))
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

    def get_token(self, *, extended=True):
        response = self.client.get('/api/profile/settings', headers=self.headers,
                                   params={'include_token_expiration': str(extended).lower()})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['roles'], ['osmo-admin'])
        return response.json()['token']

    def test_bootstrap_is_non_expiring_despite_same_named_database_token(self):
        self.headers['x-osmo-token-source'] = 'bootstrap'
        self.assertEqual(self.get_token(), {
            'name': 'bootstrap-admin-primary', 'expires_at': None,
            'expiration_status': 'never',
        })
        self.fetch_token.assert_not_called()

    def test_database_and_legacy_tokens_use_registered_expiry(self):
        for source in ('database', '', 'unrecognized'):
            with self.subTest(source=source):
                self.headers['x-osmo-token-source'] = source
                token = self.get_token()
                self.assertEqual(token['expiration_status'], 'scheduled')
                self.assertEqual(token['expires_at'], '2026-12-01T00:00:00Z')

    def test_missing_registration_does_not_imply_non_expiring(self):
        self.fetch_token.side_effect = osmo_errors.OSMOUserError('Token not found')
        for source in ('database', '', 'unrecognized'):
            with self.subTest(source=source):
                self.headers['x-osmo-token-source'] = source
                self.assertEqual(self.get_token(), {
                    'name': 'bootstrap-admin-primary', 'expires_at': None,
                    'expiration_status': 'unknown',
                })

    def test_no_token_identity_without_token_name(self):
        del self.headers['x-osmo-token-name']
        self.headers['x-osmo-token-source'] = 'bootstrap'
        self.assertIsNone(self.get_token())
        self.fetch_token.assert_not_called()

    def test_legacy_response_omits_new_field_even_for_bootstrap(self):
        self.headers['x-osmo-token-source'] = 'bootstrap'
        self.assertEqual(self.get_token(extended=False), {
            'name': 'bootstrap-admin-primary', 'expires_at': None,
        })
        response = self.client.get('/api/profile/settings', headers=self.headers)
        self.assertEqual(response.json()['token'], {
            'name': 'bootstrap-admin-primary', 'expires_at': None,
        })

    def test_database_failure_is_not_reported_as_unknown(self):
        self.fetch_token.side_effect = RuntimeError('Database unavailable')
        with self.assertRaisesRegex(RuntimeError, 'Database unavailable'):
            self.get_token()


if __name__ == '__main__':
    unittest.main()
