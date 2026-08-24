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

import unittest

from src.service.core.tests import fixture
from src.utils import connectors


CURRENT_USERS = ('ecolter', 'ecolter@nvidia.com')
HISTORICAL_USER = 'historical@nvidia.com'
RECREATED_USER = 'recreated@nvidia.com'


class UserFiltersDatabaseTest(fixture.ServiceTestFixture):
    """HTTP-level user filter coverage backed by PostgreSQL."""

    def setUp(self):
        super().setUp()
        self.database = connectors.PostgresConnector.get_instance()
        for user_name in CURRENT_USERS:
            connectors.upsert_user(self.database, user_name)
        for index, user_name in enumerate((*CURRENT_USERS, HISTORICAL_USER), start=1):
            self._insert_resources(index, user_name)

    def _insert_resources(self, index: int, user_name: str):
        workflow_id = f'user-filter-{index}'
        workflow_uuid = f'user-filter-uuid-{index}'
        app_uuid = f'user-filter-app-uuid-{index}'
        self.database.execute_commit_command(
            '''
            INSERT INTO workflows (
                workflow_name, job_id, workflow_id, workflow_uuid, submitted_by,
                submit_time, start_time, end_time, backend, pool, status, logs,
                priority, labels
            ) VALUES (
                %s, 1, %s, %s, %s, NOW(), NOW(), NOW(), 'backend', 'pool',
                'COMPLETED', '', 'NORMAL', '{}'::jsonb
            );
            INSERT INTO tasks (
                workflow_id, name, retry_id, task_db_key, task_uuid, group_name,
                status, start_time, end_time, node_name, gpu_count, cpu_count,
                disk_count, memory_count
            ) VALUES (
                %s, 'task', 0, %s, %s, 'group', 'COMPLETED', NOW(), NOW(),
                'node', 1, 1, 1, 1
            );
            INSERT INTO apps (uuid, name, owner, created_date, description)
            VALUES (%s, %s, %s, NOW(), 'description');
            INSERT INTO app_versions (
                uuid, version, created_by, created_date, status, uri
            ) VALUES (%s, 1, %s, NOW(), 'READY', 's3://app');
            ''',
            (
                workflow_id,
                workflow_id,
                workflow_uuid,
                user_name,
                workflow_id,
                f'user-filter-task-key-{index}',
                f'user-filter-task-uuid-{index}',
                app_uuid,
                f'user-filter-app-{index}',
                user_name,
                app_uuid,
                user_name,
            ),
        )

    def _get_filtered_resources(self, user_name: str) -> dict[str, set[str]]:
        common_parameters = [
            ('users', user_name),
            ('all_users', 'true'),
            ('all_pools', 'true'),
        ]
        workflow_response = self.client.get(
            '/api/workflow', params=common_parameters)
        task_response = self.client.get('/api/task', params=common_parameters)
        app_response = self.client.get(
            '/api/app',
            params=[('users', user_name), ('all_users', 'true')],
        )
        self.assertEqual(workflow_response.status_code, 200, workflow_response.text)
        self.assertEqual(task_response.status_code, 200, task_response.text)
        self.assertEqual(app_response.status_code, 200, app_response.text)
        return {
            'workflows': {
                entry['user'] for entry in workflow_response.json()['workflows']
            },
            'tasks': {
                entry['user'] for entry in task_response.json()['tasks']
            },
            'apps': {
                entry['owner'] for entry in app_response.json()['apps']
            },
        }

    def test_base_user_expands_across_workflow_task_and_app_filters(self):
        filtered_resources = self._get_filtered_resources('ecolter')

        for resource_type, owners in filtered_resources.items():
            with self.subTest(resource_type=resource_type):
                self.assertEqual(owners, set(CURRENT_USERS))

    def test_qualified_user_remains_exact_across_all_filters(self):
        filtered_resources = self._get_filtered_resources('ecolter@nvidia.com')

        for resource_type, owners in filtered_resources.items():
            with self.subTest(resource_type=resource_type):
                self.assertEqual(owners, {'ecolter@nvidia.com'})

    def test_historical_user_is_rejected_across_all_filters(self):
        cases = (
            ('/api/workflow', [('all_users', 'true'), ('all_pools', 'true')]),
            ('/api/task', [('all_users', 'true'), ('all_pools', 'true')]),
            ('/api/app', [('all_users', 'true')]),
        )
        for path, extra_parameters in cases:
            with self.subTest(path=path):
                response = self.client.get(
                    path,
                    params=[('users', HISTORICAL_USER), *extra_parameters],
                )
                self.assertEqual(response.status_code, 400, response.text)
                self.assertIn(
                    f'Invalid user(s): {HISTORICAL_USER} not found',
                    response.json()['message'],
                )

    def test_deleted_user_history_is_filterable_after_recreation(self):
        connectors.upsert_user(self.database, RECREATED_USER)
        self._insert_resources(4, RECREATED_USER)

        self.database.execute_commit_command(
            'DELETE FROM users WHERE id = %s', (RECREATED_USER,))

        cases = (
            ('/api/workflow', [('all_users', 'true'), ('all_pools', 'true')]),
            ('/api/task', [('all_users', 'true'), ('all_pools', 'true')]),
            ('/api/app', [('all_users', 'true')]),
        )
        for path, extra_parameters in cases:
            with self.subTest(path=path, state='deleted'):
                response = self.client.get(
                    path,
                    params=[('users', RECREATED_USER), *extra_parameters],
                )
                self.assertEqual(response.status_code, 400, response.text)
                self.assertIn(
                    f'Invalid user(s): {RECREATED_USER} not found',
                    response.json()['message'],
                )

        workflow_response = self.client.get(
            '/api/workflow',
            params=[('all_users', 'true'), ('all_pools', 'true')],
        )
        task_response = self.client.get(
            '/api/task',
            params=[('all_users', 'true'), ('all_pools', 'true')],
        )
        app_response = self.client.get(
            '/api/app', params=[('all_users', 'true')])
        self.assertEqual(workflow_response.status_code, 200)
        self.assertEqual(task_response.status_code, 200)
        self.assertEqual(app_response.status_code, 200)
        self.assertIn(
            RECREATED_USER,
            {entry['user'] for entry in workflow_response.json()['workflows']},
        )
        self.assertIn(
            RECREATED_USER,
            {entry['user'] for entry in task_response.json()['tasks']},
        )
        self.assertIn(
            RECREATED_USER,
            {entry['owner'] for entry in app_response.json()['apps']},
        )

        connectors.upsert_user(self.database, RECREATED_USER)
        recreated_resources = self._get_filtered_resources(RECREATED_USER)
        for resource_type, owners in recreated_resources.items():
            with self.subTest(resource_type=resource_type, state='recreated'):
                self.assertEqual(owners, {RECREATED_USER})


if __name__ == '__main__':
    unittest.main()
