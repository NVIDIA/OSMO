"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

from src.lib.utils import common
from src.tests.common import fixtures, runner
from src.utils.connectors import postgres
from src.utils.job import task, workflow as workflow_module


WORKFLOW_ID = 'test-log-count-wf-1'
WORKFLOW_UUID = common.generate_unique_id()
GROUP_NAME = 'test-group'
GROUP_UUID = common.generate_unique_id()


class LogLineCountFixture(
    fixtures.PostgresFixture,
    fixtures.PostgresTestIsolationFixture,
    fixtures.OsmoTestFixture,
):
    """Postgres fixture for log_line_count tests."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
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

    def _insert_workflow(self, workflow_id: str = WORKFLOW_ID,
                         workflow_uuid: str = WORKFLOW_UUID) -> None:
        self._get_db().execute_commit_command(
            '''INSERT INTO workflows
               (workflow_id, workflow_name, workflow_uuid, submitted_by,
                backend, logs, exec_timeout, queue_timeout, plugins, status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
            (workflow_id, 'test-wf', workflow_uuid, 'user@nvidia.com',
             'default', '', 100, 100, '{}', 'PENDING'))

    def _insert_workflow_with_sentinel(self, workflow_id: str = WORKFLOW_ID,
                                       workflow_uuid: str = WORKFLOW_UUID) -> None:
        """Insert a workflow with log_line_count = -1 (as insert_to_db now does)."""
        self._get_db().execute_commit_command(
            '''INSERT INTO workflows
               (workflow_id, workflow_name, workflow_uuid, submitted_by,
                backend, logs, exec_timeout, queue_timeout, plugins, status, log_line_count)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
            (workflow_id, 'test-wf', workflow_uuid, 'user@nvidia.com',
             'default', '', 100, 100, '{}', 'PENDING', -1))

    def _insert_group(self) -> None:
        spec = task.TaskGroupSpec(
            name=GROUP_NAME,
            ignoreNonleadStatus=True,
            tasks=[task.TaskSpec(name='lead', image='img', command=['cmd'], lead=True)],
        )
        self._get_db().execute_commit_command(
            '''INSERT INTO groups
               (workflow_id, name, group_uuid, spec, status, cleaned_up,
                remaining_upstream_groups, downstream_groups)
               VALUES (%s, %s, %s, %s, %s, FALSE, NULL, NULL)''',
            (WORKFLOW_ID, GROUP_NAME, GROUP_UUID, spec.json(), 'RUNNING'))

    def _insert_task(self, task_name: str, retry_id: int = 0,
                     lead: bool = False) -> str:
        """Insert a task without log_line_count (simulating pre-change row)."""
        task_db_key = common.generate_unique_id()
        task_uuid = common.generate_unique_id()
        self._get_db().execute_commit_command(
            '''INSERT INTO tasks
               (workflow_id, name, group_name, task_db_key, retry_id, task_uuid,
                status, pod_name, failure_message, gpu_count, cpu_count,
                disk_count, memory_count, exit_actions, lead)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
            (WORKFLOW_ID, task_name, GROUP_NAME, task_db_key, retry_id, task_uuid,
             'RUNNING', f'pod-{task_name}', None, 0, 1, 0, 1,
             json.dumps({}), lead))
        return task_db_key

    def _insert_task_with_sentinel(self, task_name: str, retry_id: int = 0,
                                   lead: bool = False) -> str:
        """Insert a task with log_line_count = -1 (as batch_insert_to_db now does)."""
        task_db_key = common.generate_unique_id()
        task_uuid = common.generate_unique_id()
        self._get_db().execute_commit_command(
            '''INSERT INTO tasks
               (workflow_id, name, group_name, task_db_key, retry_id, task_uuid,
                status, pod_name, failure_message, gpu_count, cpu_count,
                disk_count, memory_count, exit_actions, lead, log_line_count)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
            (WORKFLOW_ID, task_name, GROUP_NAME, task_db_key, retry_id, task_uuid,
             'RUNNING', f'pod-{task_name}', None, 0, 1, 0, 1,
             json.dumps({}), lead, -1))
        return task_db_key

    def _fetch_workflow_log_line_count(self, workflow_id: str = WORKFLOW_ID):
        rows = self._get_db().execute_fetch_command(
            'SELECT log_line_count FROM workflows WHERE workflow_id = %s',
            (workflow_id,), True)
        return rows[0]['log_line_count']

    def _fetch_task_log_line_count(self, task_db_key: str):
        rows = self._get_db().execute_fetch_command(
            'SELECT log_line_count FROM tasks WHERE task_db_key = %s',
            (task_db_key,), True)
        return rows[0]['log_line_count']

    def _make_workflow_obj(self, workflow_id: str = WORKFLOW_ID,
                           log_line_count: int | None = -1) -> workflow_module.Workflow:
        """Construct a minimal Workflow object pointing at the test DB."""
        return workflow_module.Workflow(
            workflow_name='test-wf',
            workflow_uuid=WORKFLOW_UUID,
            workflow_id_internal=workflow_id,
            groups=[],
            user='user@nvidia.com',
            logs='',
            database=self._get_db(),
            status=workflow_module.WorkflowStatus.PENDING,
            cancelled_by=None,
            backend='default',
            pool=None,
            priority=workflow_module.wf_priority.WorkflowPriority.NORMAL,
            log_line_count=log_line_count,
        )

    def _make_task_obj(self, task_db_key: str,
                       log_line_count: int | None = -1) -> task.Task:
        """Construct a minimal Task object pointing at the test DB."""
        return task.Task(
            workflow_uuid=WORKFLOW_UUID,
            name='task1',
            group_name=GROUP_NAME,
            task_uuid=common.generate_unique_id(),
            task_db_key=task_db_key,
            database=self._get_db(),
            exit_actions={},
            node_name=None,
            pod_ip=None,
            lead=True,
            log_line_count=log_line_count,
        )


class WorkflowLogLineCountTest(LogLineCountFixture):
    """Tests for workflow log_line_count sentinel and update behaviour."""

    def test_new_workflow_insert_sets_sentinel(self):
        """Workflows inserted by new code have log_line_count = -1."""
        self._insert_workflow_with_sentinel()
        self.assertEqual(self._fetch_workflow_log_line_count(), -1)

    def test_pre_change_workflow_has_null(self):
        """Workflows inserted before this change have log_line_count = NULL."""
        self._insert_workflow()
        self.assertIsNone(self._fetch_workflow_log_line_count())

    def test_update_writes_count_when_sentinel_present(self):
        """update_log_line_count_to_db writes the count when sentinel -1 is present."""
        self._insert_workflow_with_sentinel()
        wf = self._make_workflow_obj()
        wf.update_log_line_count_to_db(4200)
        self.assertEqual(self._fetch_workflow_log_line_count(), 4200)

    def test_update_writes_zero_when_no_logs(self):
        """update_log_line_count_to_db correctly writes 0 for workflows with no logs."""
        self._insert_workflow_with_sentinel()
        wf = self._make_workflow_obj()
        wf.update_log_line_count_to_db(0)
        self.assertEqual(self._fetch_workflow_log_line_count(), 0)

    def test_update_does_not_overwrite_finalized_count(self):
        """update_log_line_count_to_db is idempotent: does not overwrite an already-set count."""
        self._insert_workflow_with_sentinel()
        wf = self._make_workflow_obj()
        wf.update_log_line_count_to_db(4200)
        wf.update_log_line_count_to_db(9999)
        self.assertEqual(self._fetch_workflow_log_line_count(), 4200)

    def test_update_does_not_touch_null_row(self):
        """update_log_line_count_to_db does not write to pre-change rows (NULL)."""
        self._insert_workflow()
        wf = self._make_workflow_obj(log_line_count=None)
        wf.update_log_line_count_to_db(4200)
        self.assertIsNone(self._fetch_workflow_log_line_count())


class TaskLogLineCountTest(LogLineCountFixture):
    """Tests for task log_line_count sentinel and update behaviour."""

    def test_new_task_insert_sets_sentinel(self):
        """Tasks inserted by new code have log_line_count = -1."""
        task_db_key = self._insert_task_with_sentinel('task1', lead=True)
        self.assertEqual(self._fetch_task_log_line_count(task_db_key), -1)

    def test_pre_change_task_has_null(self):
        """Tasks inserted before this change have log_line_count = NULL."""
        task_db_key = self._insert_task('task1', lead=True)
        self.assertIsNone(self._fetch_task_log_line_count(task_db_key))

    def test_update_writes_count_when_sentinel_present(self):
        """update_log_line_count_to_db writes the count when sentinel -1 is present."""
        task_db_key = self._insert_task_with_sentinel('task1', lead=True)
        t = self._make_task_obj(task_db_key)
        t.update_log_line_count_to_db(1500)
        self.assertEqual(self._fetch_task_log_line_count(task_db_key), 1500)

    def test_update_writes_zero_when_no_logs(self):
        """update_log_line_count_to_db correctly writes 0 for tasks with no logs."""
        task_db_key = self._insert_task_with_sentinel('task1', lead=True)
        t = self._make_task_obj(task_db_key)
        t.update_log_line_count_to_db(0)
        self.assertEqual(self._fetch_task_log_line_count(task_db_key), 0)

    def test_update_does_not_overwrite_finalized_count(self):
        """update_log_line_count_to_db is idempotent: does not overwrite an already-set count."""
        task_db_key = self._insert_task_with_sentinel('task1', lead=True)
        t = self._make_task_obj(task_db_key)
        t.update_log_line_count_to_db(1500)
        t.update_log_line_count_to_db(9999)
        self.assertEqual(self._fetch_task_log_line_count(task_db_key), 1500)

    def test_update_does_not_touch_null_row(self):
        """update_log_line_count_to_db does not write to pre-change rows (NULL)."""
        task_db_key = self._insert_task('task1', lead=True)
        t = self._make_task_obj(task_db_key, log_line_count=None)
        t.update_log_line_count_to_db(1500)
        self.assertIsNone(self._fetch_task_log_line_count(task_db_key))

    def test_batch_insert_sets_sentinel_for_all_tasks(self):
        """batch_insert_to_db sets log_line_count = -1 for every task in the batch."""
        self._insert_workflow()
        self._insert_group()
        task_db_key_1 = common.generate_unique_id()
        task_db_key_2 = common.generate_unique_id()
        entries = [
            (WORKFLOW_ID, 'task1', GROUP_NAME, task_db_key_1, 0,
             common.generate_unique_id(), 'WAITING', 'pod-task1', None,
             0, 1, 0, 1, json.dumps({}), True, -1),
            (WORKFLOW_ID, 'task2', GROUP_NAME, task_db_key_2, 0,
             common.generate_unique_id(), 'WAITING', 'pod-task2', None,
             0, 1, 0, 1, json.dumps({}), False, -1),
        ]
        task.Task.batch_insert_to_db(self._get_db(), entries)
        self.assertEqual(self._fetch_task_log_line_count(task_db_key_1), -1)
        self.assertEqual(self._fetch_task_log_line_count(task_db_key_2), -1)


if __name__ == '__main__':
    runner.run_test()
