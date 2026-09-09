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

import types
from typing import Any
import unittest
from unittest import mock

from jwcrypto import jwk

from src.lib.utils import osmo_errors
from src.utils import auth, configmap_state, connectors


def _authentication_config() -> auth.AuthenticationConfig:
    key_name = 'installation-key'
    key = jwk.JWK.generate(kty='RSA', kid=key_name, size=2048)
    return auth.AuthenticationConfig(
        keys={
            key_name: auth.AsymmetricKeyPair(
                public_key=key.export_public(),
                private_key=key.export_private(),
            ),
        },
        active_key=key_name,
        issuer='osmo',
        audience='osmo',
    )


def _connector(
    service_auth: auth.AuthenticationConfig | None,
) -> connectors.PostgresConnector:
    postgres = connectors.PostgresConnector.__new__(connectors.PostgresConnector)
    untyped_postgres: Any = postgres
    untyped_postgres.config = types.SimpleNamespace(
        service_auth_file='mounted-secret.json' if service_auth else None,
    )
    untyped_postgres.secret_manager = mock.MagicMock()
    untyped_postgres._service_auth = service_auth
    untyped_postgres._runtime_service_auth_login_info = None
    return postgres


class ServiceAuthConnectorTest(unittest.TestCase):

    def setUp(self):
        configmap_state.set_parsed_configs(None)

    def tearDown(self):
        configmap_state.set_parsed_configs(None)

    def test_missing_secret_identity_fails_without_database_access(self):
        postgres = _connector(None)
        postgres.execute_fetch_command = mock.Mock()

        with self.assertRaisesRegex(
                osmo_errors.OSMOUserError, 'Secret mount is required'):
            postgres.get_service_auth()

        postgres.execute_fetch_command.assert_not_called()

    def test_secret_backed_service_read_excludes_legacy_database_row(self):
        service_auth = _authentication_config()
        postgres = _connector(service_auth)
        postgres.execute_fetch_command = mock.Mock()
        configmap_state.set_parsed_configs({
            'service': {
                'service_base_url': 'https://osmo.example.com',
                'service_auth': service_auth.plaintext_dict(),
            },
        })

        with mock.patch.object(
            auth.AuthenticationConfig,
            'generate_default',
            side_effect=AssertionError('must not generate a key'),
        ) as generate_default:
            service_config = postgres.get_service_configs()

        generate_default.assert_not_called()
        postgres.execute_fetch_command.assert_not_called()
        self.assertEqual(service_config.service_auth.active_key, service_auth.active_key)
        self.assertEqual(service_config.service_base_url, 'https://osmo.example.com')

    def test_login_info_is_overlaid_without_changing_stable_identity(self):
        service_auth = _authentication_config()
        postgres = _connector(service_auth)
        login_info = auth.LoginInfo(
            device_endpoint='https://login.example.com/device')

        postgres.set_runtime_service_auth_login_info(login_info)
        loaded = postgres.get_service_auth()

        self.assertEqual(loaded.login_info, login_info)
        self.assertEqual(
            loaded.canonical_json(include_login_info=False),
            service_auth.canonical_json(include_login_info=False),
        )

    def test_service_auth_database_write_is_rejected(self):
        postgres = _connector(_authentication_config())
        postgres.execute_commit_command = mock.Mock()

        with self.assertRaisesRegex(
                osmo_errors.OSMOUserError, 'ConfigMap-owned') as context:
            postgres.set_config(
                'service_auth', '{}', connectors.ConfigType.SERVICE)

        self.assertEqual(context.exception.status_code, 409)
        postgres.execute_commit_command.assert_not_called()

    def test_all_database_config_writes_are_rejected(self):
        postgres = _connector(None)
        postgres.execute_commit_command = mock.Mock()

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-owned'):
            postgres.set_config(
                'service_base_url', 'https://osmo.example.com',
                connectors.ConfigType.SERVICE)
        postgres.execute_commit_command.assert_not_called()

    def test_non_role_history_is_rejected_before_sql(self):
        service_auth = _authentication_config()
        postgres = _connector(service_auth)
        postgres.execute_commit_command = mock.Mock()

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            postgres.create_config_history_entry(
                config_type=connectors.ConfigHistoryType.SERVICE,
                name='',
                username='operator',
                data={'service_auth': service_auth.plaintext_dict()},
                description='must not persist',
            )
        postgres.execute_commit_command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
