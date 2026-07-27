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

import pathlib
import tempfile
import types
from typing import cast
import unittest
from unittest import mock

from src.service.core import service
from src.service.core.workflow import objects
from src.utils import auth
from src.utils.job import task as task_lib


class BootstrapPrincipalTests(unittest.TestCase):
    """Tests for declarative bootstrap identities backed by mounted Secrets."""

    def setUp(self):
        self.database = mock.Mock()
        self.principal = objects.BootstrapPrincipal(
            username='osmo-backend',
            token_name='backend-token',
            token_file='/etc/osmo/bootstrap/osmo-backend/token',
            roles=['osmo-admin'],
        )
        self.access_token = 'a' * task_lib.REFRESH_TOKEN_STR_LENGTH

    @mock.patch.object(service.auth_objects.AccessToken, 'insert_into_db')
    @mock.patch.object(service.connectors, 'upsert_user')
    def test_reconciles_principal(self, upsert_user, insert_token):
        self.database.execute_fetch_command.return_value = []

        service.setup_bootstrap_principal(
            self.database, self.principal, self.access_token)

        upsert_user.assert_called_once_with(self.database, 'osmo-backend')
        self.database.execute_commit_command.assert_called_once()
        insert_token.assert_called_once()
        call_args = insert_token.call_args.kwargs
        self.assertEqual(call_args['access_token'], self.access_token)
        self.assertEqual(call_args['roles'], ['osmo-admin'])

    @mock.patch.object(service.auth_objects.AccessToken, 'insert_into_db')
    @mock.patch.object(service.connectors, 'upsert_user')
    def test_matching_principal_is_unchanged(self, _upsert_user, insert_token):
        self.database.execute_fetch_command.return_value = [{
            'access_token': auth.hash_access_token(self.access_token),
            'roles': ['osmo-admin'],
        }]

        service.setup_bootstrap_principal(
            self.database, self.principal, self.access_token)

        insert_token.assert_not_called()

    @mock.patch.object(service.auth_objects.AccessToken, 'insert_into_db')
    @mock.patch.object(service.connectors, 'upsert_user')
    def test_accepts_matching_concurrent_reconciliation(
            self, _upsert_user, insert_token):
        matching_token = {
            'access_token': auth.hash_access_token(self.access_token),
            'roles': ['osmo-admin'],
        }
        self.database.execute_fetch_command.side_effect = [[], [matching_token]]
        insert_token.side_effect = service.osmo_errors.OSMOUserError(
            'Token name backend-token already exists.')

        service.setup_bootstrap_principal(
            self.database, self.principal, self.access_token)

        self.assertEqual(self.database.execute_fetch_command.call_count, 2)

    @mock.patch.object(service, 'setup_bootstrap_principal')
    def test_loads_metadata_and_token_from_separate_files(self, setup_principal):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = pathlib.Path(temporary_directory)
            token_path = root / 'token'
            config_path = root / 'principals.yaml'
            token_path.write_text(self.access_token, encoding='utf-8')
            config_path.write_text(
                'principals:\n'
                '  - username: osmo-backend\n'
                '    token_name: backend-token\n'
                f'    token_file: {token_path}\n'
                '    roles:\n'
                '      - osmo-admin\n',
                encoding='utf-8')
            config = cast(
                objects.WorkflowServiceConfig,
                types.SimpleNamespace(bootstrap_principals_file=str(config_path)))

            service.setup_bootstrap_principals(self.database, config)

        loaded_principal, loaded_token = setup_principal.call_args.args[1:]
        self.assertEqual(loaded_principal.username, 'osmo-backend')
        self.assertEqual(loaded_token, self.access_token)

    def test_requires_absolute_secret_path(self):
        with self.assertRaisesRegex(ValueError, 'absolute path'):
            objects.BootstrapPrincipal(
                username='osmo-backend',
                token_file='relative/token')


if __name__ == '__main__':
    unittest.main()
