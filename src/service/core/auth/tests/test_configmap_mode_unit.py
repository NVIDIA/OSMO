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

# Unit tests for the ConfigMap-mode branches in the auth code paths.
# These don't need a real database — they mock the postgres connector
# and the configmap_state module so each branch is exercised in
# isolation. The DB-mode integration tests live in test_auth_service.py
# and run against a testcontainers Postgres.

import datetime
import unittest
from unittest import mock

from src.lib.utils import osmo_errors
from src.service.core.auth import objects
from src.utils import configmap_state


def _set_snapshot(users: dict | None = None, roles: dict | None = None) -> None:
    """Install a ConfigMap snapshot with the given users:/roles: blocks
    and activate ConfigMap mode for the test."""
    snapshot: dict = {}
    if users is not None:
        snapshot['users'] = [
            {'name': name, 'roles': user_roles}
            for name, user_roles in users.items()
        ]
    if roles is not None:
        snapshot['roles'] = roles
    configmap_state.set_parsed_configs(snapshot)
    configmap_state.set_configmap_mode(True)


class ConfigMapModeTestBase(unittest.TestCase):
    """Shared setUp/tearDown that resets ConfigMap state between tests."""

    def setUp(self) -> None:
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)

    def tearDown(self) -> None:
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)


class TestConfigmapStateUserIndex(ConfigMapModeTestBase):
    """The name -> roles index rebuilt at set_parsed_configs time."""

    def test_lookup_returns_declared_roles(self):
        _set_snapshot(users={'admin': ['osmo-admin'], 'bot': ['osmo-user']})
        self.assertEqual(
            configmap_state.get_declarative_user_roles('admin'),
            ['osmo-admin'])
        self.assertEqual(
            configmap_state.get_declarative_user_roles('bot'),
            ['osmo-user'])

    def test_lookup_returns_none_for_undeclared_user(self):
        _set_snapshot(users={'admin': ['osmo-admin']})
        self.assertIsNone(
            configmap_state.get_declarative_user_roles('vivianp@nvidia.com'))

    def test_lookup_returns_none_when_snapshot_unset(self):
        # No set_parsed_configs call — snapshot is None.
        self.assertIsNone(
            configmap_state.get_declarative_user_roles('admin'))

    def test_index_rebuilt_on_swap(self):
        _set_snapshot(users={'admin': ['osmo-admin']})
        self.assertEqual(
            configmap_state.get_declarative_user_roles('admin'),
            ['osmo-admin'])
        # Swap snapshot — index must reflect the new users: block.
        _set_snapshot(users={'bot': ['osmo-user']})
        self.assertIsNone(
            configmap_state.get_declarative_user_roles('admin'))
        self.assertEqual(
            configmap_state.get_declarative_user_roles('bot'),
            ['osmo-user'])

    def test_invalid_entries_skipped(self):
        # Bad entries (non-dict, missing name) shouldn't crash the index.
        configmap_state.set_parsed_configs({
            'users': [
                'not-a-dict',
                {'name': '', 'roles': []},      # empty name
                {'roles': ['osmo-admin']},      # missing name
                {'name': 'admin', 'roles': ['osmo-admin']},
            ],
        })
        self.assertEqual(
            configmap_state.get_declarative_user_roles('admin'),
            ['osmo-admin'])


class TestValidateAccessTokenConfigMapMode(ConfigMapModeTestBase):
    """validate_access_token rejects tokens whose owner isn't in users:."""

    def _patch_db_with_token(self, user_name: str) -> mock.MagicMock:
        database = mock.MagicMock()
        database.execute_fetch_command.return_value = [{
            'user_name': user_name,
            'token_name': 'my-token',
            'expires_at': datetime.datetime(2099, 1, 1),
            'description': '',
        }]
        return database

    def test_token_for_declarative_user_is_valid(self):
        _set_snapshot(users={'svc-admin': ['osmo-admin']})
        database = self._patch_db_with_token('svc-admin')
        token = objects.AccessToken.validate_access_token(
            database, 'some-access-token')
        assert token is not None  # narrow for mypy
        self.assertEqual(token.user_name, 'svc-admin')

    def test_token_for_idp_user_rejected(self):
        # User authenticates but isn't in the ConfigMap users: block —
        # tokens for them must not validate even if the row exists in DB.
        _set_snapshot(users={'svc-admin': ['osmo-admin']})
        database = self._patch_db_with_token('vivianp@nvidia.com')
        token = objects.AccessToken.validate_access_token(
            database, 'some-access-token')
        self.assertIsNone(token)

    def test_db_mode_unaffected(self):
        # ConfigMap mode is False — the ConfigMap-only check is skipped
        # entirely and validation succeeds based on the DB row.
        configmap_state.set_configmap_mode(False)
        database = self._patch_db_with_token('vivianp@nvidia.com')
        token = objects.AccessToken.validate_access_token(
            database, 'some-access-token')
        self.assertIsNotNone(token)

    def test_invalid_hash_returns_none_in_both_modes(self):
        _set_snapshot(users={'svc-admin': ['osmo-admin']})
        database = mock.MagicMock()
        database.execute_fetch_command.return_value = []
        self.assertIsNone(
            objects.AccessToken.validate_access_token(
                database, 'wrong-token'))


class TestGetRolesForTokenConfigMapMode(ConfigMapModeTestBase):
    """get_roles_for_token: ConfigMap mode resolves from the snapshot."""

    def test_returns_user_roles_from_snapshot(self):
        _set_snapshot(users={'svc-admin': ['osmo-admin', 'osmo-user']})
        database = mock.MagicMock()
        roles = objects.AccessToken.get_roles_for_token(
            database, 'svc-admin', 'my-token')
        # token_name is intentionally ignored in ConfigMap mode — every
        # token of a declarative user carries the same role set.
        self.assertEqual(roles, ['osmo-admin', 'osmo-user'])
        # No DB queries should fire.
        database.execute_fetch_command.assert_not_called()

    def test_returns_empty_for_undeclared_user(self):
        _set_snapshot(users={'svc-admin': ['osmo-admin']})
        database = mock.MagicMock()
        roles = objects.AccessToken.get_roles_for_token(
            database, 'someone-else', 'my-token')
        self.assertEqual(roles, [])

    def test_db_mode_uses_join(self):
        configmap_state.set_configmap_mode(False)
        database = mock.MagicMock()
        database.execute_fetch_command.return_value = [
            {'role_name': 'osmo-user'},
        ]
        roles = objects.AccessToken.get_roles_for_token(
            database, 'someone', 'my-token')
        self.assertEqual(roles, ['osmo-user'])
        # SQL with a user_roles JOIN should have fired.
        database.execute_fetch_command.assert_called_once()
        sql = database.execute_fetch_command.call_args[0][0]
        self.assertIn('JOIN user_roles', sql)


class TestInsertIntoDbConfigMapMode(ConfigMapModeTestBase):
    """insert_into_db: ConfigMap mode validates against snapshot only,
    writes only to access_token (no access_token_roles row)."""

    @staticmethod
    def _future_date() -> str:
        return (datetime.date.today()
                + datetime.timedelta(days=30)).strftime('%Y-%m-%d')

    def test_succeeds_for_declarative_user_with_valid_role_subset(self):
        _set_snapshot(users={'svc-bot': ['osmo-admin', 'osmo-user']})
        database = mock.MagicMock()
        objects.AccessToken.insert_into_db(
            database, 'svc-bot', 'my-token', 'a-token-string',
            self._future_date(), 'desc', ['osmo-user'], 'system')
        # Single INSERT INTO access_token, NO access_token_roles INSERT.
        database.execute_commit_command.assert_called_once()
        sql = database.execute_commit_command.call_args[0][0]
        self.assertIn('INSERT INTO access_token', sql)
        self.assertNotIn('access_token_roles', sql)

    def test_409_for_undeclared_user(self):
        _set_snapshot(users={'svc-admin': ['osmo-admin']})
        database = mock.MagicMock()
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            objects.AccessToken.insert_into_db(
                database, 'vivianp@nvidia.com', 'my-token', 'a-token-string',
                self._future_date(), 'desc', ['osmo-admin'], 'system')
        # Error message should point operators at the right remediation —
        # IDP users use IDP auth, service accounts go in users:.
        self.assertIn('not declared', str(ctx.exception).lower())

    def test_rejects_role_not_in_users_block(self):
        # Declarative user exists but is asking for a role they don't
        # have in their ConfigMap entry — token creation must fail.
        _set_snapshot(users={'svc-bot': ['osmo-user']})
        database = mock.MagicMock()
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            objects.AccessToken.insert_into_db(
                database, 'svc-bot', 'my-token', 'a-token-string',
                self._future_date(), 'desc',
                ['osmo-admin'], 'system')
        self.assertIn('does not have role', str(ctx.exception).lower())
        database.execute_commit_command.assert_not_called()

    def test_duplicate_token_name_surfaces_user_error(self):
        _set_snapshot(users={'svc-bot': ['osmo-user']})
        database = mock.MagicMock()
        database.execute_commit_command.side_effect = (
            osmo_errors.OSMODatabaseError('duplicate key value'))
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            objects.AccessToken.insert_into_db(
                database, 'svc-bot', 'existing-token', 'a-token-string',
                self._future_date(), 'desc', ['osmo-user'], 'system')
        self.assertIn('already exists', str(ctx.exception).lower())


class TestListWithRolesConfigMapMode(ConfigMapModeTestBase):
    """list_with_roles_from_db: every token gets the user's snapshot roles
    in ConfigMap mode, with roles_source='per_user' so callers can tell."""

    def test_marks_response_as_per_user(self):
        _set_snapshot(users={'svc-bot': ['osmo-user']})
        database = mock.MagicMock()
        database.execute_fetch_command.return_value = [
            {
                'user_name': 'svc-bot',
                'token_name': 'token-1',
                'expires_at': datetime.datetime(2099, 1, 1),
                'description': '',
            },
            {
                'user_name': 'svc-bot',
                'token_name': 'token-2',
                'expires_at': datetime.datetime(2099, 1, 1),
                'description': '',
            },
        ]
        result = objects.AccessToken.list_with_roles_from_db(
            database, 'svc-bot')
        self.assertEqual(len(result), 2)
        for token in result:
            self.assertEqual(token.roles, ['osmo-user'])
            self.assertEqual(token.roles_source, 'per_user')

    def test_db_mode_default_marks_per_token(self):
        configmap_state.set_configmap_mode(False)
        database = mock.MagicMock()
        database.execute_fetch_command.return_value = [
            {
                'user_name': 'someone',
                'token_name': 'token-1',
                'expires_at': datetime.datetime(2099, 1, 1),
                'description': '',
                'roles': ['osmo-user'],
            },
        ]
        result = objects.AccessToken.list_with_roles_from_db(
            database, 'someone')
        self.assertEqual(len(result), 1)
        # Default value of roles_source is 'per_token' — DB-mode rows
        # come from access_token_roles JOIN, which IS per-token.
        self.assertEqual(result[0].roles_source, 'per_token')


if __name__ == '__main__':
    unittest.main()
