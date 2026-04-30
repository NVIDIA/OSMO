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
from typing import Any, List
from unittest import mock

from src.lib.utils import common, osmo_errors
from src.tests.common import fixtures
from src.utils import connectors
from src.utils.connectors import postgres
from src.utils.job import jobs, task, workflow
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
            (WORKFLOW_ID, group_name, group_uuid, spec.model_dump_json(), status))

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


class BatchInsertGroupsAndTasksDbTest(TaskDbFixture):
    """DB-backed tests for TaskGroup.batch_insert_groups_and_tasks."""

    def test_batch_insert_creates_all_groups(self):
        self._insert_workflow()

        spec = task.TaskGroupSpec(
            name='g1',
            ignoreNonleadStatus=True,
            tasks=[task.TaskSpec(name='lead', image='img', command=['cmd'], lead=True)],
        )
        group_entries = []
        for name in ['group1', 'group2', 'group3']:
            group_entries.append((
                WORKFLOW_ID, name, common.generate_unique_id(),
                spec.model_dump_json(), 'SUBMITTING', None, '', '', None, '[]',
            ))

        task.TaskGroup.batch_insert_groups_and_tasks(
            self._get_db(), group_entries, [])

        rows = self._get_db().execute_fetch_command(
            'SELECT name FROM groups WHERE workflow_id = %s ORDER BY name',
            (WORKFLOW_ID,), True)
        names = [row['name'] for row in rows]
        self.assertEqual(names, ['group1', 'group2', 'group3'])

    def test_batch_insert_empty_lists_is_noop(self):
        self._insert_workflow()
        task.TaskGroup.batch_insert_groups_and_tasks(
            self._get_db(), [], [])

        rows = self._get_db().execute_fetch_command(
            'SELECT name FROM groups WHERE workflow_id = %s',
            (WORKFLOW_ID,), True)
        self.assertEqual(rows, [])

    def test_batch_insert_skips_duplicate_groups(self):
        self._insert_workflow()
        self._insert_group('group1')

        spec = task.TaskGroupSpec(
            name='g1',
            ignoreNonleadStatus=True,
            tasks=[task.TaskSpec(name='lead', image='img', command=['cmd'], lead=True)],
        )
        group_entries = [
            (WORKFLOW_ID, 'group1', common.generate_unique_id(),
             spec.model_dump_json(), 'SUBMITTING', None, '', '', None, '[]'),
            (WORKFLOW_ID, 'group2', common.generate_unique_id(),
             spec.model_dump_json(), 'SUBMITTING', None, '', '', None, '[]'),
        ]
        task.TaskGroup.batch_insert_groups_and_tasks(
            self._get_db(), group_entries, [])

        rows = self._get_db().execute_fetch_command(
            'SELECT name FROM groups WHERE workflow_id = %s ORDER BY name',
            (WORKFLOW_ID,), True)
        names = [row['name'] for row in rows]
        self.assertEqual(names, ['group1', 'group2'])

    def test_batch_insert_creates_groups_and_tasks_atomically(self):
        self._insert_workflow()

        spec = task.TaskGroupSpec(
            name='g1',
            ignoreNonleadStatus=True,
            tasks=[task.TaskSpec(name='lead', image='img', command=['cmd'], lead=True)],
        )
        group_uuid = common.generate_unique_id()
        group_entries = [
            (WORKFLOW_ID, 'group1', group_uuid,
             spec.json(), 'SUBMITTING', None, '', '', None, '[]'),
        ]
        task_db_key = common.generate_unique_id()
        task_uuid = common.generate_unique_id()
        task_entries = [
            (WORKFLOW_ID, 'task1', 'group1', task_db_key, 0, task_uuid,
             'WAITING', 'pod-task1', None, 0, 1, 0, 1, json.dumps({}), True),
        ]

        task.TaskGroup.batch_insert_groups_and_tasks(
            self._get_db(), group_entries, task_entries)

        group_rows = self._get_db().execute_fetch_command(
            'SELECT name, status FROM groups WHERE workflow_id = %s',
            (WORKFLOW_ID,), True)
        self.assertEqual(len(group_rows), 1)
        self.assertEqual(group_rows[0]['name'], 'group1')
        self.assertEqual(group_rows[0]['status'], 'SUBMITTING')

        task_rows = self._get_db().execute_fetch_command(
            'SELECT name, group_name, status FROM tasks WHERE workflow_id = %s',
            (WORKFLOW_ID,), True)
        self.assertEqual(len(task_rows), 1)
        self.assertEqual(task_rows[0]['name'], 'task1')
        self.assertEqual(task_rows[0]['group_name'], 'group1')
        self.assertEqual(task_rows[0]['status'], 'WAITING')


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


class ListAllTaskRowsByWorkflowDbTest(TaskDbFixture):
    """DB-backed tests for Task.list_all_task_rows_by_workflow."""

    def test_returns_tasks_grouped_by_group_name(self):
        self._insert_workflow()
        group2_uuid = common.generate_unique_id()
        self._insert_group('group1')
        self._insert_group('group2', group_uuid=group2_uuid)
        self._insert_task('task1', group_name='group1', lead=True)
        self._insert_task('task2', group_name='group1')
        self._insert_task('task3', group_name='group2', lead=True)
        self._insert_task('task4', group_name='group2')

        result = task.Task.list_all_task_rows_by_workflow(
            self._get_db(), WORKFLOW_ID)

        self.assertEqual(len(result), 2)
        self.assertEqual(len(result['group1']), 2)
        self.assertEqual(len(result['group2']), 2)
        group1_names = {row['name'] for row in result['group1']}
        group2_names = {row['name'] for row in result['group2']}
        self.assertEqual(group1_names, {'task1', 'task2'})
        self.assertEqual(group2_names, {'task3', 'task4'})

    def test_returns_empty_dict_for_no_tasks(self):
        self._insert_workflow()
        self._insert_group()

        result = task.Task.list_all_task_rows_by_workflow(
            self._get_db(), WORKFLOW_ID)

        self.assertEqual(result, {})

    def test_only_returns_latest_retry_non_verbose(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', retry_id=0, lead=True)
        self._insert_task('task1', retry_id=1, lead=True)

        result = task.Task.list_all_task_rows_by_workflow(
            self._get_db(), WORKFLOW_ID, verbose=False)

        self.assertEqual(len(result[GROUP_NAME]), 1)
        self.assertEqual(result[GROUP_NAME][0]['retry_id'], 1)

    def test_verbose_returns_all_retries(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', retry_id=0, lead=True)
        self._insert_task('task1', retry_id=1, lead=True)

        result = task.Task.list_all_task_rows_by_workflow(
            self._get_db(), WORKFLOW_ID, verbose=True)

        self.assertEqual(len(result[GROUP_NAME]), 2)
        retry_ids = {row['retry_id'] for row in result[GROUP_NAME]}
        self.assertEqual(retry_ids, {0, 1})

    def test_multiple_groups_partitioned_correctly(self):
        self._insert_workflow()
        self._insert_group('g1')
        self._insert_group('g2', group_uuid=common.generate_unique_id())
        self._insert_group('g3', group_uuid=common.generate_unique_id())
        self._insert_task('t1', group_name='g1', lead=True)
        self._insert_task('t2', group_name='g2', lead=True)
        self._insert_task('t3', group_name='g2')
        self._insert_task('t4', group_name='g3', lead=True)
        self._insert_task('t5', group_name='g3')
        self._insert_task('t6', group_name='g3')

        result = task.Task.list_all_task_rows_by_workflow(
            self._get_db(), WORKFLOW_ID)

        self.assertEqual(len(result), 3)
        self.assertEqual(len(result['g1']), 1)
        self.assertEqual(len(result['g2']), 2)
        self.assertEqual(len(result['g3']), 3)


class PreloadedTasksDbTest(TaskDbFixture):
    """DB-backed tests for TaskGroup.from_db_row with preloaded_tasks."""

    def test_from_db_row_uses_preloaded_tasks(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', lead=True)
        self._insert_task('task2')

        group_rows = self._get_db().execute_fetch_command(
            'SELECT * FROM groups WHERE workflow_id = %s AND name = %s',
            (WORKFLOW_ID, GROUP_NAME))
        group = task.TaskGroup.from_db_row(
            group_rows[0], self._get_db(), preloaded_tasks=[])

        self.assertEqual(group.name, GROUP_NAME)
        self.assertEqual(group.tasks, [])

    def test_from_db_row_preloaded_overrides_load_tasks(self):
        self._insert_workflow()
        self._insert_group()
        self._insert_task('task1', lead=True)
        self._insert_task('task2')

        group_rows = self._get_db().execute_fetch_command(
            'SELECT * FROM groups WHERE workflow_id = %s AND name = %s',
            (WORKFLOW_ID, GROUP_NAME))
        group = task.TaskGroup.from_db_row(
            group_rows[0], self._get_db(), load_tasks=True, preloaded_tasks=[])

        self.assertEqual(group.tasks, [])


class CheckRunTimeoutDbTest(TaskDbFixture):
    """DB-backed integration tests for CheckRunTimeout per-group exec_timeout enforcement.

    Redis is mocked: these tests exercise the real Postgres queries used to fetch
    Workflow/TaskGroup state, but capture the jobs CheckRunTimeout dispatches in
    memory rather than enqueuing them.
    """

    EXEC_TIMEOUT_SECONDS = 100

    def setUp(self):
        super().setUp()
        self.dispatched: list = []
        self.delayed: list = []

        def _capture_send(captured_self):
            self.dispatched.append(captured_self)

        def _capture_delayed(captured_self, delay):
            self.delayed.append((captured_self, delay))

        self._patches: List[Any] = [
            mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue', _capture_send),
            mock.patch.object(jobs.CancelWorkflow, 'send_job_to_queue', _capture_send),
            mock.patch.object(
                jobs.CheckRunTimeout, 'send_delayed_job_to_queue', _capture_delayed),
        ]
        for patcher in self._patches:
            patcher.start()
        self.addCleanup(self._stop_patches)

    def _stop_patches(self):
        for patcher in self._patches:
            patcher.stop()

    def _insert_workflow_running(self, exec_timeout_seconds: int = EXEC_TIMEOUT_SECONDS,
                                 start_time: datetime.datetime | None = None,
                                 status: str = 'RUNNING') -> None:
        submit_time = start_time or datetime.datetime.now()
        self._get_db().execute_commit_command(
            '''INSERT INTO workflows
               (workflow_id, workflow_name, workflow_uuid, submitted_by,
                backend, logs, exec_timeout, queue_timeout, plugins, status,
                start_time, submit_time, outputs, priority)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
            (WORKFLOW_ID, 'test-wf', WORKFLOW_UUID, 'user@nvidia.com',
             'default', '', exec_timeout_seconds, 100, '{}', status,
             start_time, submit_time, '', 'NORMAL'))

    def _insert_group_running(self, group_name: str,
                              start_time: datetime.datetime,
                              status: str = 'RUNNING') -> None:
        group_uuid = common.generate_unique_id()
        self._insert_group(group_name=group_name, group_uuid=group_uuid, status=status)
        # TaskGroup.fetch_from_db loads tasks by group name and raises if none exist.
        self._insert_task(f'{group_name}-lead', group_name=group_name, lead=True, status=status)
        self._get_db().execute_commit_command(
            'UPDATE groups SET start_time = %s WHERE workflow_id = %s AND name = %s',
            (start_time, WORKFLOW_ID, group_name))

    def _make_context(self) -> jobs.JobExecutionContext:
        return jobs.JobExecutionContext(
            postgres=self._get_db(), redis=connectors.RedisConfig())

    def _run_check(self, group_name: str | None = None) -> None:
        check = jobs.CheckRunTimeout(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, group_name=group_name)
        check.execute(self._make_context(), mock.Mock())

    def test_per_group_expiry_marks_only_that_group(self):
        """A group whose elapsed time exceeds exec_timeout enqueues an UpdateGroup
        with FAILED_EXEC_TIMEOUT for that group only — sibling groups are untouched.
        """
        now = datetime.datetime.now()
        self._insert_workflow_running(start_time=now - datetime.timedelta(seconds=400))
        self._insert_group_running('group1', start_time=now - datetime.timedelta(seconds=300))
        self._insert_group_running('group2', start_time=now - datetime.timedelta(seconds=10))

        self._run_check(group_name='group1')

        self.assertEqual(len(self.dispatched), 1)
        update = self.dispatched[0]
        self.assertIsInstance(update, jobs.UpdateGroup)
        self.assertEqual(update.group_name, 'group1')
        self.assertEqual(update.status, task.TaskGroupStatus.FAILED_EXEC_TIMEOUT)
        self.assertIn(str(self.EXEC_TIMEOUT_SECONDS), update.message)
        self.assertEqual(self.delayed, [])

    def test_per_group_within_window_reschedules(self):
        """A group within the timeout window reschedules a fresh CheckRunTimeout
        with the remaining delta and does not enqueue any UpdateGroup.
        """
        now = datetime.datetime.now()
        self._insert_workflow_running(start_time=now - datetime.timedelta(seconds=20))
        self._insert_group_running('group1', start_time=now - datetime.timedelta(seconds=10))

        self._run_check(group_name='group1')

        self.assertEqual(self.dispatched, [])
        self.assertEqual(len(self.delayed), 1)
        rescheduled, delta = self.delayed[0]
        self.assertIsInstance(rescheduled, jobs.CheckRunTimeout)
        self.assertEqual(rescheduled.group_name, 'group1')
        self.assertGreater(delta.total_seconds(), 0)
        self.assertLess(delta.total_seconds(), self.EXEC_TIMEOUT_SECONDS)

    def test_per_group_skips_already_finished_group(self):
        """If the target group has already reached a terminal status (e.g. COMPLETED),
        CheckRunTimeout is a no-op even if start_time would otherwise be expired.
        """
        now = datetime.datetime.now()
        self._insert_workflow_running(start_time=now - datetime.timedelta(seconds=400))
        self._insert_group_running(
            'group1', start_time=now - datetime.timedelta(seconds=300), status='COMPLETED')

        self._run_check(group_name='group1')

        self.assertEqual(self.dispatched, [])
        self.assertEqual(self.delayed, [])

    def test_per_group_skips_group_without_start_time(self):
        """If the group has no start_time yet (still in queue), CheckRunTimeout is a no-op.
        Belt-and-suspenders against scheduling timing.
        """
        self._insert_workflow_running()
        self._insert_group(group_name='group1', status='SCHEDULING')
        self._insert_task('group1-lead', group_name='group1', lead=True, status='SCHEDULING')

        self._run_check(group_name='group1')

        self.assertEqual(self.dispatched, [])
        self.assertEqual(self.delayed, [])

    def test_legacy_payload_without_group_name_falls_back_to_workflow_cancel(self):
        """Delayed jobs serialized before group_name was added deserialize with
        group_name=None; they must still trigger workflow-level cancellation when expired.
        """
        now = datetime.datetime.now()
        self._insert_workflow_running(start_time=now - datetime.timedelta(seconds=400))
        self._insert_group_running('group1', start_time=now - datetime.timedelta(seconds=300))

        self._run_check(group_name=None)

        self.assertEqual(len(self.dispatched), 1)
        cancel = self.dispatched[0]
        self.assertIsInstance(cancel, jobs.CancelWorkflow)
        self.assertEqual(cancel.workflow_status, workflow.WorkflowStatus.FAILED_EXEC_TIMEOUT)
        self.assertEqual(cancel.task_status, task.TaskGroupStatus.FAILED_EXEC_TIMEOUT)
        self.assertEqual(self.delayed, [])

    def test_legacy_payload_within_window_reschedules_workflow_level(self):
        """Legacy payload (no group_name) within the window reschedules itself without
        a group_name, preserving the legacy enforcement path until the queue drains.
        """
        now = datetime.datetime.now()
        self._insert_workflow_running(start_time=now - datetime.timedelta(seconds=20))
        self._insert_group_running('group1', start_time=now - datetime.timedelta(seconds=10))

        self._run_check(group_name=None)

        self.assertEqual(self.dispatched, [])
        self.assertEqual(len(self.delayed), 1)
        rescheduled, _ = self.delayed[0]
        self.assertIsInstance(rescheduled, jobs.CheckRunTimeout)
        self.assertIsNone(rescheduled.group_name)


class CheckQueueTimeoutDbTest(TaskDbFixture):
    """DB-backed integration tests for CheckQueueTimeout per-group queue_timeout enforcement.

    Per-group semantics: the clock starts when a group enters SCHEDULING and stops when the
    group is assigned a node and enters INITIALIZING. If the group is still in SCHEDULING
    after queue_timeout, just that group is marked FAILED_QUEUE_TIMEOUT. Once the group has
    progressed to INITIALIZING (or beyond) the queue clock has stopped — image-pull and
    preflight time is governed separately by the start timeout.
    """

    QUEUE_TIMEOUT_SECONDS = 100

    def setUp(self):
        super().setUp()
        self.dispatched: list = []
        self.delayed: list = []

        def _capture_send(captured_self):
            self.dispatched.append(captured_self)

        def _capture_delayed(captured_self, delay):
            self.delayed.append((captured_self, delay))

        self._patches: List[Any] = [
            mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue', _capture_send),
            mock.patch.object(jobs.CancelWorkflow, 'send_job_to_queue', _capture_send),
            mock.patch.object(
                jobs.CheckQueueTimeout, 'send_delayed_job_to_queue', _capture_delayed),
        ]
        for patcher in self._patches:
            patcher.start()
        self.addCleanup(self._stop_patches)

    def _stop_patches(self):
        for patcher in self._patches:
            patcher.stop()

    def _insert_workflow(self, queue_timeout_seconds: int = QUEUE_TIMEOUT_SECONDS,
                         submit_time: datetime.datetime | None = None,
                         status: str = 'PENDING') -> None:
        # Override TaskDbFixture's helper so we control queue_timeout, status, submit_time.
        if submit_time is None:
            submit_time = datetime.datetime.now()
        self._get_db().execute_commit_command(
            '''INSERT INTO workflows
               (workflow_id, workflow_name, workflow_uuid, submitted_by,
                backend, logs, exec_timeout, queue_timeout, plugins, status,
                submit_time, outputs, priority)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
            (WORKFLOW_ID, 'test-wf', WORKFLOW_UUID, 'user@nvidia.com',
             'default', '', 100, queue_timeout_seconds, '{}', status, submit_time,
             '', 'NORMAL'))

    def _insert_group_scheduling(self, group_name: str,
                                 scheduling_start_time: datetime.datetime,
                                 status: str = 'SCHEDULING') -> None:
        group_uuid = common.generate_unique_id()
        self._insert_group(group_name=group_name, group_uuid=group_uuid, status=status)
        # TaskGroup.fetch_from_db loads tasks by group name and raises if none exist.
        self._insert_task(f'{group_name}-lead', group_name=group_name, lead=True, status=status)
        self._get_db().execute_commit_command(
            'UPDATE groups SET scheduling_start_time = %s '
            'WHERE workflow_id = %s AND name = %s',
            (scheduling_start_time, WORKFLOW_ID, group_name))

    def _make_context(self) -> jobs.JobExecutionContext:
        return jobs.JobExecutionContext(
            postgres=self._get_db(), redis=connectors.RedisConfig())

    def _run_check(self, group_name: str | None = None) -> None:
        check = jobs.CheckQueueTimeout(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, group_name=group_name)
        check.execute(self._make_context(), mock.Mock())

    def test_per_group_queue_expiry_marks_only_that_group(self):
        """When a group has been queueing longer than queue_timeout, an UpdateGroup
        with FAILED_QUEUE_TIMEOUT is enqueued for just that group.
        """
        now = datetime.datetime.now()
        self._insert_workflow()
        self._insert_group_scheduling(
            'group1', scheduling_start_time=now - datetime.timedelta(seconds=300))
        self._insert_group_scheduling(
            'group2', scheduling_start_time=now - datetime.timedelta(seconds=10))

        self._run_check(group_name='group1')

        self.assertEqual(len(self.dispatched), 1)
        update = self.dispatched[0]
        self.assertIsInstance(update, jobs.UpdateGroup)
        self.assertEqual(update.group_name, 'group1')
        self.assertEqual(update.status, task.TaskGroupStatus.FAILED_QUEUE_TIMEOUT)
        self.assertIn(str(self.QUEUE_TIMEOUT_SECONDS), update.message)
        self.assertEqual(self.delayed, [])

    def test_per_group_queue_within_window_reschedules(self):
        """A group within the queue_timeout window reschedules a fresh CheckQueueTimeout
        with the remaining delta, preserving dynamic-timeout-update support.
        """
        now = datetime.datetime.now()
        self._insert_workflow()
        self._insert_group_scheduling(
            'group1', scheduling_start_time=now - datetime.timedelta(seconds=10))

        self._run_check(group_name='group1')

        self.assertEqual(self.dispatched, [])
        self.assertEqual(len(self.delayed), 1)
        rescheduled, delta = self.delayed[0]
        self.assertIsInstance(rescheduled, jobs.CheckQueueTimeout)
        self.assertEqual(rescheduled.group_name, 'group1')
        self.assertGreater(delta.total_seconds(), 0)
        self.assertLess(delta.total_seconds(), self.QUEUE_TIMEOUT_SECONDS)

    def test_per_group_queue_skips_running_group(self):
        """If the group has reached RUNNING, the queue clock has already stopped — no-op."""
        now = datetime.datetime.now()
        self._insert_workflow()
        self._insert_group_scheduling(
            'group1', scheduling_start_time=now - datetime.timedelta(seconds=300),
            status='RUNNING')

        self._run_check(group_name='group1')

        self.assertEqual(self.dispatched, [])
        self.assertEqual(self.delayed, [])

    def test_per_group_queue_skips_finished_group(self):
        """If the group is already finished, CheckQueueTimeout is a no-op."""
        now = datetime.datetime.now()
        self._insert_workflow()
        self._insert_group_scheduling(
            'group1', scheduling_start_time=now - datetime.timedelta(seconds=300),
            status='COMPLETED')

        self._run_check(group_name='group1')

        self.assertEqual(self.dispatched, [])
        self.assertEqual(self.delayed, [])

    def test_per_group_queue_skips_initializing_group(self):
        """The queue_timeout window stops once the group is assigned a node and enters
        INITIALIZING. Even if the group sat in SCHEDULING + INITIALIZING longer than
        queue_timeout, the queue clock has stopped and CheckQueueTimeout is a no-op.
        """
        now = datetime.datetime.now()
        self._insert_workflow()
        self._insert_group_scheduling(
            'group1', scheduling_start_time=now - datetime.timedelta(seconds=300),
            status='INITIALIZING')

        self._run_check(group_name='group1')

        self.assertEqual(self.dispatched, [])
        self.assertEqual(self.delayed, [])

    def test_legacy_queue_payload_falls_back_to_workflow_cancel(self):
        """A legacy CheckQueueTimeout (no group_name) on a workflow stuck in PENDING
        beyond queue_timeout still triggers CancelWorkflow with FAILED_QUEUE_TIMEOUT.
        """
        now = datetime.datetime.now()
        self._insert_workflow(submit_time=now - datetime.timedelta(seconds=300))
        self._insert_group_scheduling(
            'group1', scheduling_start_time=now - datetime.timedelta(seconds=10))

        self._run_check(group_name=None)

        self.assertEqual(len(self.dispatched), 1)
        cancel = self.dispatched[0]
        self.assertIsInstance(cancel, jobs.CancelWorkflow)
        self.assertEqual(cancel.workflow_status, workflow.WorkflowStatus.FAILED_QUEUE_TIMEOUT)
        self.assertEqual(cancel.task_status, task.TaskGroupStatus.FAILED_QUEUE_TIMEOUT)
        self.assertEqual(self.delayed, [])

    def test_legacy_queue_payload_no_op_when_workflow_no_longer_pending(self):
        """A legacy CheckQueueTimeout fires only if the workflow is still PENDING; once
        any group has reached RUNNING the workflow is past PENDING and the legacy path
        is a no-op.
        """
        now = datetime.datetime.now()
        self._insert_workflow(submit_time=now - datetime.timedelta(seconds=300),
                              status='RUNNING')
        self._insert_group_scheduling(
            'group1', scheduling_start_time=now - datetime.timedelta(seconds=10),
            status='RUNNING')

        self._run_check(group_name=None)

        self.assertEqual(self.dispatched, [])
        self.assertEqual(self.delayed, [])


if __name__ == '__main__':
    runner.run_test()
