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
import json

from src.lib.utils import common, osmo_errors
from src.tests.common import fixtures
from src.utils.connectors import postgres
from src.utils.job import task
from src.tests.common import runner


WORKFLOW_ID = 'test-wf-1'
WORKFLOW_UUID = common.generate_unique_id()
GROUP_NAME = 'test-group'
GROUP_UUID = common.generate_unique_id()


class TaskDbFixture(
    fixtures.PostgresFixture,
    fixtures.PostgresTestIsolationFixture,
    fixtures.OsmoTestFixture,
):
    """Postgres-only fixture for testing Task/TaskGroup DB operations."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        # Initialize PostgresConnector singleton with the testcontainer
        postgres.PostgresConnector(
            postgres.PostgresConfig(
                postgres_host=cls.postgres_container.get_container_host_ip(),
                postgres_port=cls.postgres_container.get_database_port(),
                postgres_password=cls.postgres_container.password,
                postgres_database_name=cls.postgres_container.dbname,
                postgres_user=cls.postgres_container.username,
                method='dev',
            )
        )

    @classmethod
    def tearDownClass(cls):
        try:
            if postgres.PostgresConnector._instance:  # pylint: disable=protected-access
                postgres.PostgresConnector._instance.close()  # pylint: disable=protected-access
                postgres.PostgresConnector._instance = None  # pylint: disable=protected-access
        finally:
            super().tearDownClass()

    def _get_db(self) -> postgres.PostgresConnector:
        return postgres.PostgresConnector.get_instance()

    def _insert_workflow(self) -> None:
        self._get_db().execute_commit_command(
            '''INSERT INTO workflows
               (workflow_id, workflow_name, workflow_uuid, submitted_by,
                backend, logs, exec_timeout, queue_timeout, plugins, status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
            (WORKFLOW_ID, 'test-wf', WORKFLOW_UUID, 'user@nvidia.com',
             'default', '', 100, 100, '{}', 'PENDING'))

    def _insert_group(self, group_name: str = GROUP_NAME,
                      group_uuid: str = GROUP_UUID,
                      status: str = 'RUNNING') -> None:
        spec = task.TaskGroupSpec(
            name=group_name,
            ignoreNonleadStatus=True,
            tasks=[task.TaskSpec(name='lead', image='img', command=['cmd'], lead=True)],
        )
        self._get_db().execute_commit_command(
            '''INSERT INTO groups
               (workflow_id, name, group_uuid, spec, status, cleaned_up,
                remaining_upstream_groups, downstream_groups)
               VALUES (%s, %s, %s, %s, %s, FALSE, NULL, NULL)''',
            (WORKFLOW_ID, group_name, group_uuid, spec.json(), status))

    def _insert_task(self, task_name: str, retry_id: int = 0,
                     status: str = 'RUNNING', lead: bool = False,
                     group_name: str = GROUP_NAME) -> str:
        task_db_key = common.generate_unique_id()
        task_uuid = common.generate_unique_id()
        self._get_db().execute_commit_command(
            '''INSERT INTO tasks
               (workflow_id, name, group_name, task_db_key, retry_id, task_uuid,
                status, pod_name, failure_message, gpu_count, cpu_count,
                disk_count, memory_count, exit_actions, lead)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
            (WORKFLOW_ID, task_name, group_name, task_db_key, retry_id, task_uuid,
             status, f'pod-{task_name}', None, 0, 1, 0, 1,
             json.dumps({}), lead))
        return task_db_key

    def _fetch_task_status(self, task_name: str, retry_id: int = 0,
                           group_name: str = GROUP_NAME) -> dict:
        fetch_cmd = '''
            SELECT status, end_time, failure_message, exit_code FROM tasks
            WHERE workflow_id = %s AND group_name = %s AND name = %s AND retry_id = %s
        '''
        rows = self._get_db().execute_fetch_command(
            fetch_cmd, (WORKFLOW_ID, group_name, task_name, retry_id), True)
        return rows[0]


class BatchUpdateStatusDbTest(TaskDbFixture):
    """DB-backed tests for Task.batch_update_status_to_db."""

    def test_batch_update_sets_all_tasks_to_terminal(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', lead=True)
        self._insert_task('task2')
        self._insert_task('task3')

        now = datetime.datetime.now()
        task.Task.batch_update_status_to_db(
            database=self._get_db(),
            workflow_id=WORKFLOW_ID,
            group_name=GROUP_NAME,
            update_time=now,
            status=task.TaskGroupStatus.FAILED,
            message='group failed',
            exit_code=1,
        )

        for name in ['task1', 'task2', 'task3']:
            row = self._fetch_task_status(name)
            self.assertEqual(row['status'], 'FAILED')
            self.assertIsNotNone(row['end_time'])
            self.assertEqual(row['failure_message'], 'group failed')
            self.assertEqual(row['exit_code'], 1)

    def test_batch_update_excludes_named_task(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', lead=True)
        self._insert_task('task2')
        self._insert_task('task3')

        now = datetime.datetime.now()
        task.Task.batch_update_status_to_db(
            database=self._get_db(),
            workflow_id=WORKFLOW_ID,
            group_name=GROUP_NAME,
            update_time=now,
            status=task.TaskGroupStatus.FAILED,
            message='sibling failed',
            lead_task_name='task1',
        )

        row1 = self._fetch_task_status('task1')
        self.assertEqual(row1['status'], 'RUNNING')
        self.assertIsNone(row1['end_time'])

        for name in ['task2', 'task3']:
            row = self._fetch_task_status(name)
            self.assertEqual(row['status'], 'FAILED')

    def test_batch_update_skips_already_finished_tasks(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', lead=True, status='RUNNING')
        self._insert_task('task2', status='RUNNING')
        self._insert_task('task3', status='COMPLETED')

        mark_finished_cmd = '''
            UPDATE tasks SET end_time = NOW()
            WHERE name = 'task3' AND workflow_id = %s
        '''
        self._get_db().execute_commit_command(mark_finished_cmd, (WORKFLOW_ID,))

        now = datetime.datetime.now()
        task.Task.batch_update_status_to_db(
            database=self._get_db(),
            workflow_id=WORKFLOW_ID,
            group_name=GROUP_NAME,
            update_time=now,
            status=task.TaskGroupStatus.FAILED_CANCELED,
            message='canceled',
        )

        for name in ['task1', 'task2']:
            row = self._fetch_task_status(name)
            self.assertEqual(row['status'], 'FAILED_CANCELED')

        row3 = self._fetch_task_status('task3')
        self.assertEqual(row3['status'], 'COMPLETED')

    def test_batch_update_only_updates_latest_retry(self):
        self._insert_workflow()
        self._insert_group()

        self._insert_task('task1', retry_id=0, status='COMPLETED', lead=True)
        mark_finished_cmd = '''
            UPDATE tasks SET end_time = NOW()
            WHERE name = 'task1' AND retry_id = 0 AND workflow_id = %s
        '''
        self._get_db().execute_commit_command(mark_finished_cmd, (WORKFLOW_ID,))

        self._insert_task('task1', retry_id=1, status='RUNNING', lead=True)

        now = datetime.datetime.now()
        task.Task.batch_update_status_to_db(
            database=self._get_db(),
            workflow_id=WORKFLOW_ID,
            group_name=GROUP_NAME,
            update_time=now,
            status=task.TaskGroupStatus.FAILED,
            message='retry failed',
        )

        row0 = self._fetch_task_status('task1', retry_id=0)
        self.assertEqual(row0['status'], 'COMPLETED')

        row1 = self._fetch_task_status('task1', retry_id=1)
        self.assertEqual(row1['status'], 'FAILED')


class FetchStatusSummaryDbTest(TaskDbFixture):
    """DB-backed tests for TaskGroup._fetch_status_summary."""

    def test_fetch_status_summary_groups_correctly(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', lead=True, status='RUNNING')
        self._insert_task('task2', status='RUNNING')
        self._insert_task('task3', status='COMPLETED')

        mark_finished_cmd = '''
            UPDATE tasks SET end_time = NOW()
            WHERE name = 'task3' AND workflow_id = %s
        '''
        self._get_db().execute_commit_command(mark_finished_cmd, (WORKFLOW_ID,))

        # pylint: disable=protected-access
        summary = task.TaskGroup._fetch_status_summary(
            self._get_db(), WORKFLOW_ID, GROUP_NAME)

        status_map = {(row['status'], row['lead']): row['count'] for row in summary}

        self.assertEqual(status_map[('RUNNING', True)], 1)
        self.assertEqual(status_map[('RUNNING', False)], 1)
        self.assertEqual(status_map[('COMPLETED', False)], 1)

    def test_fetch_status_summary_empty_group_raises(self):
        self._insert_workflow()
        self._insert_group()

        with self.assertRaises(osmo_errors.OSMODatabaseError):
            # pylint: disable=protected-access
            task.TaskGroup._fetch_status_summary(
                self._get_db(), WORKFLOW_ID, GROUP_NAME)


class FetchMetadataDbTest(TaskDbFixture):
    """DB-backed tests for TaskGroup.fetch_metadata_from_db."""

    def test_fetch_metadata_returns_empty_tasks(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', lead=True)
        self._insert_task('task2')

        group = task.TaskGroup.fetch_metadata_from_db(
            self._get_db(), WORKFLOW_ID, GROUP_NAME)

        self.assertEqual(group.name, GROUP_NAME)
        self.assertEqual(group.group_uuid, GROUP_UUID)
        self.assertIsNotNone(group.spec)
        self.assertEqual(group.status, task.TaskGroupStatus.RUNNING)
        self.assertEqual(group.tasks, [])

    def test_fetch_from_db_returns_tasks(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', lead=True)
        self._insert_task('task2')

        group = task.TaskGroup.fetch_from_db(
            self._get_db(), WORKFLOW_ID, GROUP_NAME)

        self.assertEqual(group.name, GROUP_NAME)
        self.assertEqual(len(group.tasks), 2)
        task_names = {t.name for t in group.tasks}
        self.assertEqual(task_names, {'task1', 'task2'})


class BatchFetchLatestRetryIdsDbTest(TaskDbFixture):
    """DB-backed tests for Task.batch_fetch_latest_retry_ids."""

    def test_batch_fetch_returns_latest_retry_ids(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', lead=True)
        self._insert_task('task2')
        self._insert_task('task3')

        result = task.Task.batch_fetch_latest_retry_ids(
            self._get_db(), WORKFLOW_ID, ['task1', 'task2', 'task3'])

        self.assertEqual(result, {'task1': 0, 'task2': 0, 'task3': 0})

    def test_batch_fetch_picks_max_retry_id(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', retry_id=0, lead=True)
        self._insert_task('task1', retry_id=1, lead=True)
        self._insert_task('task2', retry_id=0)

        result = task.Task.batch_fetch_latest_retry_ids(
            self._get_db(), WORKFLOW_ID, ['task1', 'task2'])

        self.assertEqual(result['task1'], 1)
        self.assertEqual(result['task2'], 0)

    def test_batch_fetch_empty_list_returns_empty_dict(self):
        self._insert_workflow()
        self._insert_group()

        result = task.Task.batch_fetch_latest_retry_ids(
            self._get_db(), WORKFLOW_ID, [])

        self.assertEqual(result, {})

    def test_batch_fetch_missing_task_omitted(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', lead=True)

        result = task.Task.batch_fetch_latest_retry_ids(
            self._get_db(), WORKFLOW_ID, ['task1', 'nonexistent'])

        self.assertEqual(result, {'task1': 0})


class BatchInsertGroupDbTest(TaskDbFixture):
    """DB-backed tests for TaskGroup.batch_insert_to_db."""

    def test_batch_insert_creates_all_groups(self):
        self._insert_workflow()

        spec = task.TaskGroupSpec(
            name='g1',
            ignoreNonleadStatus=True,
            tasks=[task.TaskSpec(name='lead', image='img', command=['cmd'], lead=True)],
        )
        entries = []
        for name in ['group1', 'group2', 'group3']:
            entries.append((
                WORKFLOW_ID, name, common.generate_unique_id(),
                spec.json(), 'SUBMITTING', None, '', '', None, '[]',
            ))

        task.TaskGroup.batch_insert_to_db(self._get_db(), entries)

        rows = self._get_db().execute_fetch_command(
            'SELECT name FROM groups WHERE workflow_id = %s ORDER BY name',
            (WORKFLOW_ID,), True)
        names = [row['name'] for row in rows]
        self.assertEqual(names, ['group1', 'group2', 'group3'])

    def test_batch_insert_empty_list_is_noop(self):
        self._insert_workflow()
        task.TaskGroup.batch_insert_to_db(self._get_db(), [])

        rows = self._get_db().execute_fetch_command(
            'SELECT name FROM groups WHERE workflow_id = %s',
            (WORKFLOW_ID,), True)
        self.assertEqual(rows, [])

    def test_batch_insert_skips_duplicates(self):
        self._insert_workflow()
        self._insert_group('group1')

        spec = task.TaskGroupSpec(
            name='g1',
            ignoreNonleadStatus=True,
            tasks=[task.TaskSpec(name='lead', image='img', command=['cmd'], lead=True)],
        )
        entries = [
            (WORKFLOW_ID, 'group1', common.generate_unique_id(),
             spec.json(), 'SUBMITTING', None, '', '', None, '[]'),
            (WORKFLOW_ID, 'group2', common.generate_unique_id(),
             spec.json(), 'SUBMITTING', None, '', '', None, '[]'),
        ]
        task.TaskGroup.batch_insert_to_db(self._get_db(), entries)

        rows = self._get_db().execute_fetch_command(
            'SELECT name FROM groups WHERE workflow_id = %s ORDER BY name',
            (WORKFLOW_ID,), True)
        names = [row['name'] for row in rows]
        self.assertEqual(names, ['group1', 'group2'])


class BatchSetGroupsToProcessingDbTest(TaskDbFixture):
    """DB-backed tests for TaskGroup.batch_set_groups_to_processing."""

    def test_batch_transitions_tasks_and_groups(self):
        self._insert_workflow()
        self._insert_group('group1', status='WAITING')
        self._insert_group('group2', group_uuid=common.generate_unique_id(),
                           status='WAITING')
        self._insert_task('task1', group_name='group1', status='WAITING', lead=True)
        self._insert_task('task2', group_name='group2', status='WAITING', lead=True)

        now = datetime.datetime.now()
        result = task.TaskGroup.batch_set_groups_to_processing(
            self._get_db(), WORKFLOW_ID, ['group1', 'group2'], now,
            {'group1': '{"key": "val1"}', 'group2': '{"key": "val2"}'})

        self.assertEqual(sorted(result), ['group1', 'group2'])

        row1 = self._fetch_task_status('task1', group_name='group1')
        self.assertEqual(row1['status'], 'PROCESSING')
        row2 = self._fetch_task_status('task2', group_name='group2')
        self.assertEqual(row2['status'], 'PROCESSING')

        group_rows = self._get_db().execute_fetch_command(
            '''SELECT name, status, scheduler_settings
               FROM groups WHERE workflow_id = %s ORDER BY name''',
            (WORKFLOW_ID,), True)
        for row in group_rows:
            self.assertEqual(row['status'], 'PROCESSING')
            self.assertIsNotNone(row['scheduler_settings'])

    def test_batch_empty_list_is_noop(self):
        self._insert_workflow()
        self._insert_group('group1', status='WAITING')
        self._insert_task('task1', group_name='group1', status='WAITING', lead=True)

        now = datetime.datetime.now()
        result = task.TaskGroup.batch_set_groups_to_processing(
            self._get_db(), WORKFLOW_ID, [], now, {})

        self.assertEqual(result, [])
        row = self._fetch_task_status('task1', group_name='group1')
        self.assertEqual(row['status'], 'WAITING')

    def test_batch_only_updates_waiting_tasks(self):
        self._insert_workflow()
        self._insert_group('group1', status='WAITING')
        self._insert_task('task1', group_name='group1', status='WAITING', lead=True)
        self._insert_task('task2', group_name='group1', status='RUNNING')

        now = datetime.datetime.now()
        result = task.TaskGroup.batch_set_groups_to_processing(
            self._get_db(), WORKFLOW_ID, ['group1'], now, {})

        self.assertEqual(result, ['group1'])
        row1 = self._fetch_task_status('task1', group_name='group1')
        self.assertEqual(row1['status'], 'PROCESSING')

        row2 = self._fetch_task_status('task2', group_name='group1')
        self.assertEqual(row2['status'], 'RUNNING')

    def test_batch_skips_ineligible_groups(self):
        self._insert_workflow()
        self._insert_group('group1', status='WAITING')
        self._insert_group('group2', group_uuid=common.generate_unique_id(),
                           status='RUNNING')
        self._insert_task('task1', group_name='group1', status='WAITING', lead=True)
        self._insert_task('task2', group_name='group2', status='WAITING', lead=True)

        now = datetime.datetime.now()
        result = task.TaskGroup.batch_set_groups_to_processing(
            self._get_db(), WORKFLOW_ID, ['group1', 'group2'], now, {})

        self.assertEqual(result, ['group1'])

        row1 = self._fetch_task_status('task1', group_name='group1')
        self.assertEqual(row1['status'], 'PROCESSING')

        row2 = self._fetch_task_status('task2', group_name='group2')
        self.assertEqual(row2['status'], 'WAITING')


if __name__ == '__main__':
    runner.run_test()
