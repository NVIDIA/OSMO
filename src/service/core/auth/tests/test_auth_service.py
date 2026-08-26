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

# pylint: disable=protected-access

import threading
import time
from typing import Any, Dict, List, Optional
from unittest import mock

from src.lib.utils import osmo_errors
from src.service.core.auth import auth_service, objects
from src.service.core.tests import fixture
from src.utils import configmap_state, connectors
from src.tests.common import runner


class AuthServiceTestCase(fixture.ServiceTestFixture):
    """Integration tests for auth service user and role management."""

    TEST_USER = 'test@nvidia.com'
    TEST_ADMIN = 'admin@nvidia.com'

    def setUp(self):
        super().setUp()
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)
        # Set default auth header to TEST_USER
        self.client.headers['x-osmo-user'] = self.TEST_USER
        # Clean up test users from previous tests to ensure isolation
        self._cleanup_test_users()
        # Create test roles for use in tests
        self._create_test_role('osmo-user', 'Default user role')
        self._create_test_role('osmo-admin', 'Admin role')
        self._create_test_role('osmo-ml-team', 'ML team role')
        self._create_test_role('osmo-dev-team', 'Dev team role')

    def tearDown(self):
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)
        super().tearDown()

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
            connectors.upsert_user(postgres, user_id)
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

    # =========================================================================
    # User Management Tests
    # =========================================================================

    def test_create_user(self):
        """Test creating a new user without roles."""
        user = self._create_user('newuser@example.com')

        self.assertEqual(user['id'], 'newuser@example.com')
        self.assertIsNotNone(user['created_at'])

    def test_create_user_uses_single_users_table(self):
        """Creating a current user requires no separate identity record."""
        user_id = 'single-table@example.com'

        self._create_user(user_id)

        postgres = connectors.PostgresConnector.get_instance()
        row = postgres.execute_fetch_command(
            '''
            SELECT
                (SELECT COUNT(*) FROM users WHERE id = %s) AS users,
                to_regclass('public.user_identities') AS user_identities
            ''',
            (user_id,),
            True,
        )[0]
        self.assertEqual(dict(row), {'users': 1, 'user_identities': None})

    def test_create_user_with_roles(self):
        """Test creating a user with initial roles."""
        user = self._create_user('roleuser@example.com', roles=['osmo-user', 'osmo-ml-team'])

        self.assertEqual(user['id'], 'roleuser@example.com')

        # Verify roles were assigned
        user_details = self._get_user('roleuser@example.com')
        role_names = [r['role_name'] for r in user_details['roles']]
        self.assertIn('osmo-user', role_names)
        self.assertIn('osmo-ml-team', role_names)

    def test_create_user_with_configmap_only_role(self):
        postgres = connectors.PostgresConnector.get_instance()
        postgres.execute_commit_command(
            'DELETE FROM roles WHERE name = %s;', ('configmap-only-role',))
        configmap_state.set_parsed_configs({
            'roles': {
                'configmap-only-role': {
                    'description': 'ConfigMap-only role',
                    'policies': [],
                },
            },
        })
        configmap_state.set_configmap_mode(True)

        self._create_user(
            'configmap-role-user@example.com', roles=['configmap-only-role'])

        user_details = self._get_user('configmap-role-user@example.com')
        self.assertEqual(
            [role['role_name'] for role in user_details['roles']],
            ['configmap-only-role'],
        )

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

    def test_delete_retains_history_and_recreation_starts_clean(self):
        """Deletion retains historical text while recreation starts clean."""
        user_id = 'historical-user@example.com'
        self._create_user(user_id, roles=['osmo-user'])
        postgres = connectors.PostgresConnector.get_instance()
        postgres.execute_commit_command(
            'INSERT INTO profile (user_name) VALUES (%s)', (user_id,))
        postgres.execute_commit_command(
            'INSERT INTO ueks (uid) VALUES (%s)', (user_id,))
        postgres.execute_commit_command(
            '''
            INSERT INTO credential (user_name, cred_name, cred_type, payload)
            VALUES (%s, 'credential', 'GENERIC', ''::hstore)
            ''',
            (user_id,),
        )
        postgres.execute_commit_command(
            '''
            INSERT INTO workflows
                (workflow_name, job_id, workflow_id, workflow_uuid, submitted_by)
            VALUES ('historical', 1, 'historical-1', 'historical-uuid', %s)
            ''',
            (user_id,),
        )
        postgres.execute_commit_command(
            '''
            INSERT INTO apps (uuid, name, owner)
            VALUES ('historical-app-uuid', 'historical-app', %s);
            INSERT INTO app_versions (uuid, version, created_by)
            VALUES ('historical-app-uuid', 1, %s);
            ''',
            (user_id, user_id),
        )
        response = self.client.post(
            f'/api/auth/user/{user_id}/access_token/historical-token',
            params={'expires_at': '2027-01-01'},
        )
        self.assertEqual(response.status_code, 200)

        response = self.client.delete(f'/api/auth/user/{user_id}')
        self.assertEqual(response.status_code, 200)

        counts = postgres.execute_fetch_command(
            '''
            SELECT
                (SELECT COUNT(*) FROM users WHERE id = %s) AS users,
                (SELECT COUNT(*) FROM profile WHERE user_name = %s) AS profiles,
                (SELECT COUNT(*) FROM ueks WHERE uid = %s) AS ueks,
                (SELECT COUNT(*) FROM user_roles WHERE user_id = %s) AS roles,
                (SELECT COUNT(*) FROM access_token WHERE user_name = %s) AS tokens,
                (SELECT COUNT(*) FROM access_token_roles WHERE user_name = %s) AS token_roles,
                (SELECT COUNT(*) FROM credential WHERE user_name = %s) AS credentials,
                (SELECT COUNT(*) FROM workflows WHERE submitted_by = %s) AS workflows,
                (SELECT COUNT(*) FROM apps WHERE owner = %s) AS apps,
                (SELECT COUNT(*) FROM app_versions WHERE created_by = %s) AS app_versions
            ''',
            (user_id,) * 10,
            True,
        )[0]
        self.assertEqual(
            dict(counts),
            {
                'users': 0,
                'profiles': 0,
                'ueks': 0,
                'roles': 0,
                'tokens': 0,
                'token_roles': 0,
                'credentials': 0,
                'workflows': 1,
                'apps': 1,
                'app_versions': 1,
            },
        )

        recreated = self._create_user(user_id)
        self.assertEqual(recreated['id'], user_id)
        clean_counts = postgres.execute_fetch_command(
            '''
            SELECT
                (SELECT COUNT(*) FROM users WHERE id = %s) AS users,
                (SELECT COUNT(*) FROM profile WHERE user_name = %s) AS profiles,
                (SELECT COUNT(*) FROM ueks WHERE uid = %s) AS ueks,
                (SELECT COUNT(*) FROM user_roles WHERE user_id = %s) AS roles,
                (SELECT COUNT(*) FROM access_token WHERE user_name = %s) AS tokens,
                (SELECT COUNT(*) FROM access_token_roles WHERE user_name = %s) AS token_roles,
                (SELECT COUNT(*) FROM credential WHERE user_name = %s) AS credentials,
                (SELECT COUNT(*) FROM workflows WHERE submitted_by = %s) AS workflows,
                (SELECT COUNT(*) FROM apps WHERE owner = %s) AS apps,
                (SELECT COUNT(*) FROM app_versions WHERE created_by = %s) AS app_versions
            ''',
            (user_id,) * 10,
            True,
        )[0]
        self.assertEqual(
            dict(clean_counts),
            {
                'users': 1,
                'profiles': 0,
                'ueks': 0,
                'roles': 0,
                'tokens': 0,
                'token_roles': 0,
                'credentials': 0,
                'workflows': 1,
                'apps': 1,
                'app_versions': 1,
            },
        )

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

    def test_delete_role_removes_assignments_and_access_token_grants(self):
        self._create_user(self.TEST_USER, roles=['osmo-admin'])
        self._create_access_token('deleted-role-token')
        postgres = connectors.PostgresConnector.get_instance()

        connectors.Role.delete_from_db(postgres, 'osmo-admin')

        self.assertNotIn(
            'osmo-admin',
            [role['role_name'] for role in self._get_user(self.TEST_USER)['roles']])
        self.assertNotIn(
            'osmo-admin',
            self._get_access_token_roles(self.TEST_USER, 'deleted-role-token'))

        self._create_test_role('osmo-admin', 'Recreated admin role')

        self.assertNotIn(
            'osmo-admin',
            [role['role_name'] for role in self._get_user(self.TEST_USER)['roles']])
        self.assertNotIn(
            'osmo-admin',
            self._get_access_token_roles(self.TEST_USER, 'deleted-role-token'))

    def test_role_deletion_waits_for_assignment_before_cleanup(self):
        user_id = 'race@example.com'
        self._create_user(user_id)
        postgres = connectors.PostgresConnector.get_instance()
        deletion_outcome: List[Any] = []

        def delete_role():
            try:
                connectors.Role.delete_from_db(postgres, 'osmo-admin')
            except Exception as error:  # pylint: disable=broad-except
                deletion_outcome.append(error)

        with postgres._get_connection() as connection:
            cursor = connection.cursor()
            cursor.execute(
                'SELECT name FROM roles WHERE name = %s FOR KEY SHARE;', ('osmo-admin',))
            deletion_thread = threading.Thread(target=delete_role)
            deletion_thread.start()
            time.sleep(0.2)
            self.assertTrue(deletion_thread.is_alive())

            cursor.execute('''
                INSERT INTO user_roles (user_id, role_name, assigned_by)
                VALUES (%s, %s, %s);
            ''', (user_id, 'osmo-admin', 'test'))
            connection.commit()

        deletion_thread.join(timeout=5)
        self.assertFalse(deletion_thread.is_alive())
        self.assertEqual(deletion_outcome, [])
        rows = postgres.execute_fetch_command(
            'SELECT 1 FROM user_roles WHERE role_name = %s;', ('osmo-admin',), True)
        self.assertEqual(rows, [])

    def test_assignment_waits_for_role_deletion(self):
        user_id = 'race@example.com'
        self._create_user(user_id)
        postgres = connectors.PostgresConnector.get_instance()
        assignment_outcome: List[Any] = []
        delete_commands = postgres.execute_commit_commands

        def delete_with_pause(commands):
            commands.insert(1, ('SELECT pg_sleep(0.5);', ()))
            return delete_commands(commands)

        def assign_role():
            try:
                assignment_outcome.append(auth_service.assign_role_to_user(
                    user_id, objects.AssignRoleRequest(role_name='osmo-admin'), 'test'))
            except Exception as error:  # pylint: disable=broad-except
                assignment_outcome.append(error)

        with mock.patch.object(
                postgres, 'execute_commit_commands', side_effect=delete_with_pause):
            deletion_thread = threading.Thread(
                target=connectors.Role.delete_from_db,
                args=(postgres, 'osmo-admin'))
            deletion_thread.start()
            time.sleep(0.2)
            assignment_thread = threading.Thread(target=assign_role)
            assignment_thread.start()
            deletion_thread.join(timeout=5)
            assignment_thread.join(timeout=5)

        self.assertFalse(deletion_thread.is_alive())
        self.assertFalse(assignment_thread.is_alive())
        self.assertEqual(len(assignment_outcome), 1)
        self.assertIsInstance(assignment_outcome[0], osmo_errors.OSMOUserError)
        rows = postgres.execute_fetch_command(
            'SELECT 1 FROM user_roles WHERE role_name = %s;', ('osmo-admin',), True)
        self.assertEqual(rows, [])

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
