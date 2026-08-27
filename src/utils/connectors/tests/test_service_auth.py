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

import json
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

    def test_missing_legacy_database_identity_fails(self):
        postgres = _connector(None)
        postgres.execute_fetch_command = mock.Mock(return_value=[])

        with self.assertRaisesRegex(
                osmo_errors.OSMODatabaseError, 'Service auth is not found'):
            postgres.get_service_auth()

        postgres.execute_fetch_command.assert_called_once()

    def test_legacy_chart_identity_is_read_from_database(self):
        service_auth = _authentication_config()
        postgres = _connector(None)
        postgres.execute_fetch_command = mock.Mock(return_value=[{
            'value': service_auth.canonical_json(include_login_info=False),
        }])

        with mock.patch.object(
            connectors.ServiceConfig, 'deserialize',
            return_value=types.SimpleNamespace(service_auth=service_auth),
        ) as deserialize:
            loaded = postgres.get_service_auth()

        self.assertEqual(
            loaded.canonical_json(include_login_info=False),
            service_auth.canonical_json(include_login_info=False))
        deserialize.assert_called_once()

    def test_secret_backed_service_read_excludes_legacy_database_row(self):
        service_auth = _authentication_config()
        postgres = _connector(service_auth)
        postgres.execute_fetch_command = mock.Mock(return_value=[
            types.SimpleNamespace(
                key='service_base_url', value='https://osmo.example.com',
                type='SERVICE'),
        ])

        with mock.patch.object(
            auth.AuthenticationConfig,
            'generate_default',
            side_effect=AssertionError('must not generate a key'),
        ) as generate_default:
            service_config = postgres.get_service_configs()

        generate_default.assert_not_called()
        query = postgres.execute_fetch_command.call_args.args[0]
        self.assertIn("key != 'service_auth'", query)
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

    def test_external_service_auth_database_write_is_rejected(self):
        postgres = _connector(_authentication_config())
        postgres.execute_commit_command = mock.Mock()

        with self.assertRaisesRegex(
                osmo_errors.OSMOUserError, 'managed outside PostgreSQL') as context:
            postgres.set_config(
                'service_auth', '{}', connectors.ConfigType.SERVICE)

        self.assertEqual(context.exception.status_code, 409)
        postgres.execute_commit_command.assert_not_called()

    def test_legacy_chart_database_write_remains_available(self):
        postgres = _connector(None)
        postgres.execute_commit_command = mock.Mock(return_value=1)

        self.assertEqual(postgres.set_config(
            'service_auth', '{}', connectors.ConfigType.SERVICE), 1)

        postgres.execute_commit_command.assert_called_once()

    def test_service_history_always_omits_service_auth(self):
        service_auth = _authentication_config()
        postgres = _connector(service_auth)
        postgres.execute_commit_command = mock.Mock()

        postgres.create_config_history_entry(
            config_type=connectors.ConfigHistoryType.SERVICE,
            name='',
            username='operator',
            data={
                'service_auth': service_auth.plaintext_dict(),
                'service_base_url': 'https://osmo.example.com',
            },
            description='Secret-native snapshot',
        )

        parameters = postgres.execute_commit_command.call_args.args[1]
        persisted_data = json.loads(parameters[6])
        self.assertNotIn('service_auth', persisted_data)
        self.assertEqual(
            persisted_data['service_base_url'], 'https://osmo.example.com')

    def test_initial_service_history_omits_service_auth(self):
        service_auth = _authentication_config()
        postgres = _connector(service_auth)
        postgres.execute_fetch_command = mock.Mock(return_value=[])
        postgres.execute_commit_command = mock.Mock()
        service_configs = types.SimpleNamespace(
            plaintext_dict=mock.Mock(return_value={
                'service_auth': service_auth.plaintext_dict(),
                'service_base_url': 'https://osmo.example.com',
            }))
        workflow_configs = types.SimpleNamespace(
            plaintext_dict=mock.Mock(return_value={}))

        with (
            mock.patch.object(postgres, '_init_default_configs'),
            mock.patch.object(postgres, 'create_default_roles'),
            mock.patch.object(
                postgres, 'get_service_configs', return_value=service_configs),
            mock.patch.object(
                postgres, 'get_workflow_configs', return_value=workflow_configs),
            mock.patch.object(connectors.Backend, 'list_from_db', return_value=[]),
            mock.patch.object(connectors.PodTemplate, 'list_from_db', return_value=[]),
            mock.patch.object(connectors.GroupTemplate, 'list_from_db', return_value=[]),
            mock.patch.object(connectors.ResourceValidation, 'list_from_db', return_value=[]),
            mock.patch.object(connectors.BackendTests, 'list_from_db', return_value=[]),
            mock.patch.object(connectors.Role, 'list_from_db', return_value=[]),
            mock.patch(
                'src.utils.connectors.postgres.fetch_editable_pool_config',
                return_value=[],
            ),
        ):
            postgres._init_configs()  # pylint: disable=protected-access

        service_parameters = postgres.execute_commit_command.call_args_list[0].args[1]
        persisted_data = json.loads(service_parameters[5])
        self.assertNotIn('service_auth', persisted_data)
        self.assertEqual(
            persisted_data['service_base_url'], 'https://osmo.example.com')


if __name__ == '__main__':
    unittest.main()
