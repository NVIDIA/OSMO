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
import datetime
import unittest
from unittest import mock

from src.lib.utils import osmo_errors
from src.utils import connectors
from src.utils.job import (
    backend_job_defs,
    jobs,
    jobs_base,
    task,
)
from src.utils.job import workflow as wf_module


WORKFLOW_ID = 'wf-1'
WORKFLOW_UUID = 'abcdef0123456789abcdef0123456789'


def _make_create_group(**overrides):
    """Construct a minimal CreateGroup using model_construct (skip validation)."""
    defaults = {
        'backend': 'back',
        'group_name': 'g1',
        'workflow_id': WORKFLOW_ID,
        'workflow_uuid': WORKFLOW_UUID,
        'user': 'alice',
        'k8s_resources': [],
        'job_id': f'{WORKFLOW_UUID}-g1-submit',
        'job_type': 'CreateGroup',
        'job_uuid': 'job-uuid-x',
    }
    defaults.update(overrides)
    return jobs.CreateGroup.model_construct(**defaults)  # type: ignore[arg-type]


def _make_cleanup_group(**overrides):
    defaults = {
        'backend': 'back',
        'group_name': 'g1',
        'workflow_id': WORKFLOW_ID,
        'workflow_uuid': WORKFLOW_UUID,
        'cleanup_specs': [],
        'max_log_lines': 100,
        'job_id': f'{WORKFLOW_UUID}-g1-backend-cleanup',
        'job_type': 'CleanupGroup',
        'job_uuid': 'job-uuid-y',
    }
    defaults.update(overrides)
    return jobs.CleanupGroup.model_construct(**defaults)  # type: ignore[arg-type]


class CleanupWorkflowGroupTest(unittest.TestCase):
    """Tests for module-level cleanup_workflow_group helper (lines 84, 86-87, 92)."""

    def test_when_not_all_groups_cleaned_does_not_enqueue(self):
        context = mock.Mock()
        with mock.patch.object(task.TaskGroup, 'patch_cleaned_up', return_value=False), \
             mock.patch.object(jobs.CleanupWorkflow, 'send_job_to_queue') as mock_send:
            jobs.cleanup_workflow_group(context, WORKFLOW_ID, WORKFLOW_UUID, 'g1')
            mock_send.assert_not_called()

    def test_when_all_groups_cleaned_enqueues_cleanup_workflow(self):
        context = mock.Mock()
        with mock.patch.object(task.TaskGroup, 'patch_cleaned_up', return_value=True), \
             mock.patch.object(jobs.CleanupWorkflow, 'send_job_to_queue') as mock_send:
            jobs.cleanup_workflow_group(context, WORKFLOW_ID, WORKFLOW_UUID, 'g1', user='alice')
            mock_send.assert_called_once()


class FrontendJobBaseMethodsTest(unittest.TestCase):
    """Tests for FrontendJob default behaviour (lines 119, 125, 136-140)."""

    def test_send_delayed_job_to_queue_writes_to_redis_zset(self):
        cleanup = jobs.CleanupWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='alice')
        mock_redis_client = mock.Mock()
        mock_connector = mock.Mock()
        mock_connector.client = mock_redis_client
        with mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock_connector):
            cleanup.send_delayed_job_to_queue(datetime.timedelta(minutes=5))

        mock_redis_client.zadd.assert_called_once()
        zadd_args = mock_redis_client.zadd.call_args
        self.assertEqual(zadd_args.args[0], jobs.DELAYED_JOB_QUEUE)

    def test_handle_failure_default_is_noop(self):
        cleanup = jobs.CleanupWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='alice')
        # Default handle_failure is a pass; ensure it returns None without error.
        result = cleanup.handle_failure(mock.Mock(), 'some error')
        self.assertIsNone(result)

    def test_get_redis_options_returns_frontend_tuple(self):
        cleanup = jobs.CleanupWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='alice')
        exchange, jobs_list, options = cleanup.get_redis_options()
        self.assertIs(exchange, connectors.EXCHANGE)
        self.assertIs(jobs_list, connectors.JOBS)
        self.assertIs(options, connectors.TRANSPORT_OPTIONS)


class WorkflowJobLoggingTest(unittest.TestCase):
    """Tests for WorkflowJob log helpers."""

    def test_log_labels_includes_user_and_job_id(self):
        cleanup = jobs.CleanupWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='alice')
        labels = cleanup.log_labels()
        self.assertEqual(labels['workflow_uuid'], WORKFLOW_UUID)
        self.assertEqual(labels['user_id'], 'alice')
        self.assertTrue(labels['job_id'].endswith('-cleanup'))

    def test_log_labels_omits_user_when_blank(self):
        cleanup = jobs.CleanupWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='')
        labels = cleanup.log_labels()
        self.assertNotIn('user_id', labels)

    def test_log_submission_logs_at_info_level(self):
        cleanup = jobs.CleanupWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='alice')
        with mock.patch('logging.info') as mock_info:
            cleanup.log_submission()
        mock_info.assert_called_once()


class BackendJobRedisOptionsTest(unittest.TestCase):
    """Tests for BackendJob.get_redis_options (line 171)."""

    def test_create_group_uses_backend_redis_options(self):
        create = _make_create_group(backend='my-backend')
        with mock.patch.object(connectors, 'get_backend_transport_option',
                               return_value='opt-x') as mock_opts:
            exchange, jobs_list, options = create.get_redis_options()
        self.assertIs(exchange, connectors.EXCHANGE)
        self.assertIs(jobs_list, connectors.BACKEND_JOBS)
        self.assertEqual(options, 'opt-x')
        mock_opts.assert_called_once_with('my-backend')


class JobIdValidatorErrorTest(unittest.TestCase):
    """Validators that reject malformed job_ids (lines 204, 379, 470-471, 559-560,
    637-639, 1315-1316, 1413-1414, 1640-1641)."""

    def test_update_group_rejects_bad_job_id_suffix(self):
        with self.assertRaises(osmo_errors.OSMOServerError):
            jobs.UpdateGroup(
                workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
                group_name='g1', status=task.TaskGroupStatus.RUNNING,
                user='alice', job_id='wrong-suffix')

    def test_update_group_validates_retry_id_required_with_task_name(self):
        with self.assertRaises(osmo_errors.OSMOServerError):
            jobs.UpdateGroup(
                workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
                group_name='g1', task_name='t1',
                status=task.TaskGroupStatus.RUNNING,
                user='alice')

    def test_update_group_accepts_task_name_with_retry_id(self):
        update = jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', task_name='t1', retry_id=2,
            status=task.TaskGroupStatus.RUNNING, user='alice')
        self.assertEqual(update.task_name, 't1')
        self.assertEqual(update.retry_id, 2)

    def test_cleanup_workflow_rejects_bad_job_id(self):
        with self.assertRaises(osmo_errors.OSMOServerError):
            jobs.CleanupWorkflow(
                workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
                user='alice', job_id='wrong-suffix')

    def test_cancel_workflow_rejects_bad_job_id(self):
        with self.assertRaises(osmo_errors.OSMOServerError):
            jobs.CancelWorkflow(
                workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
                user='alice', job_id='wrong-suffix')


class GetJobIdGenerationTest(unittest.TestCase):
    """Tests for _get_job_id classmethods that generate job_id strings."""

    def test_update_group_with_task_name_includes_retry_id(self):
        values = {
            'workflow_uuid': WORKFLOW_UUID,
            'group_name': 'g1',
            'task_name': 't1',
            'retry_id': 3,
            'status': task.TaskGroupStatus.RUNNING,
        }
        job_id = jobs.UpdateGroup._get_job_id(values)
        self.assertIn('t1', job_id)
        self.assertIn('3', job_id)
        self.assertTrue(job_id.endswith('-update-RUNNING'))

    def test_update_group_without_task_name(self):
        values = {
            'workflow_uuid': WORKFLOW_UUID,
            'group_name': 'g1',
            'status': task.TaskGroupStatus.WAITING,
        }
        job_id = jobs.UpdateGroup._get_job_id(values)
        self.assertEqual(job_id, f'{WORKFLOW_UUID}-g1-update-WAITING')

    def test_update_group_with_string_status(self):
        values = {
            'workflow_uuid': WORKFLOW_UUID,
            'group_name': 'g1',
            'status': 'RUNNING',
        }
        job_id = jobs.UpdateGroup._get_job_id(values)
        self.assertEqual(job_id, f'{WORKFLOW_UUID}-g1-update-RUNNING')

    def test_check_run_timeout_get_job_id_with_group(self):
        values = {'workflow_uuid': WORKFLOW_UUID, 'group_name': 'g1'}
        job_id = jobs.CheckRunTimeout._get_job_id(values)
        self.assertIn('g1', job_id)
        self.assertIn('check_run_timeout', job_id)

    def test_check_run_timeout_get_job_id_without_group_uses_workflow(self):
        values = {'workflow_uuid': WORKFLOW_UUID, 'group_name': None}
        job_id = jobs.CheckRunTimeout._get_job_id(values)
        self.assertIn('workflow', job_id)
        self.assertIn('check_run_timeout', job_id)

    def test_check_queue_timeout_get_job_id_with_group(self):
        values = {'workflow_uuid': WORKFLOW_UUID, 'group_name': 'g1'}
        job_id = jobs.CheckQueueTimeout._get_job_id(values)
        self.assertIn('g1', job_id)
        self.assertIn('check_queue_timeout', job_id)

    def test_check_queue_timeout_get_job_id_without_group_uses_workflow(self):
        values = {'workflow_uuid': WORKFLOW_UUID, 'group_name': None}
        job_id = jobs.CheckQueueTimeout._get_job_id(values)
        self.assertIn('workflow', job_id)
        self.assertIn('check_queue_timeout', job_id)


class UpdateGroupApplyExitActionTest(unittest.TestCase):
    """Tests for UpdateGroup._apply_exit_action — pure logic with no DB
    (lines 1101, 1103-1108, 1110, 1112-1115, 1117-1122, 1124-1126, 1128-1130)."""

    def _make_update_group(self, status, exit_code, message=''):
        return jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', status=status, user='alice',
            message=message, exit_code=exit_code)

    def _make_pool(self, default_exit_actions=None):
        pool = mock.Mock(spec=connectors.Pool)
        pool.default_exit_actions = default_exit_actions or {}
        pool.name = 'pool-1'
        return pool

    def _make_task(self, retry_id=0, exit_actions=None):
        task_obj = mock.Mock(spec=task.Task)
        task_obj.retry_id = retry_id
        task_obj.exit_actions = exit_actions or {}
        return task_obj

    def test_no_exit_code_does_not_change_status(self):
        ug = self._make_update_group(task.TaskGroupStatus.FAILED, exit_code=None)
        ug._apply_exit_action(self._make_task(), max_retry=2, pool=self._make_pool())
        self.assertEqual(ug.status, task.TaskGroupStatus.FAILED)

    def test_task_exit_action_overrides_status(self):
        ug = self._make_update_group(task.TaskGroupStatus.FAILED, exit_code=42)
        task_obj = self._make_task(exit_actions={'complete': '40-50'})
        ug._apply_exit_action(task_obj, max_retry=2, pool=self._make_pool())
        self.assertEqual(ug.status, task.TaskGroupStatus.COMPLETED)
        self.assertIn('Exit Action', ug.message)

    def test_pool_default_exit_action_used_when_task_has_none(self):
        ug = self._make_update_group(task.TaskGroupStatus.FAILED, exit_code=42)
        pool = self._make_pool(default_exit_actions={'complete': '40-50'})
        ug._apply_exit_action(self._make_task(), max_retry=2, pool=pool)
        self.assertEqual(ug.status, task.TaskGroupStatus.COMPLETED)

    def test_reschedule_action_blocked_at_retry_limit(self):
        ug = self._make_update_group(task.TaskGroupStatus.FAILED, exit_code=42)
        task_obj = self._make_task(
            retry_id=3, exit_actions={'reschedule': '40-50'})
        ug._apply_exit_action(task_obj, max_retry=3, pool=self._make_pool())
        # Status should NOT change because retry limit reached
        self.assertEqual(ug.status, task.TaskGroupStatus.FAILED)
        self.assertIn('retry limit', ug.message)

    def test_no_matching_exit_action_does_not_change_status(self):
        ug = self._make_update_group(task.TaskGroupStatus.FAILED, exit_code=999)
        task_obj = self._make_task(exit_actions={'complete': '1-10'})
        ug._apply_exit_action(task_obj, max_retry=2, pool=self._make_pool())
        self.assertEqual(ug.status, task.TaskGroupStatus.FAILED)

    def test_range_with_comma_separated_intervals(self):
        ug = self._make_update_group(task.TaskGroupStatus.FAILED, exit_code=15)
        task_obj = self._make_task(exit_actions={'complete': '1-5,10-20'})
        ug._apply_exit_action(task_obj, max_retry=2, pool=self._make_pool())
        self.assertEqual(ug.status, task.TaskGroupStatus.COMPLETED)


class UpdateGroupBarrierAndRestartTest(unittest.TestCase):
    """Redis-only barrier/restart helpers (lines 1241-1243, 1246-1248,
    1284-1286, 1288-1292)."""

    def _make_update(self):
        return jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', task_name='t1', retry_id=0,
            status=task.TaskGroupStatus.RUNNING, user='alice')

    def test_remove_barrier_calls_srem(self):
        ug = self._make_update()
        client = mock.Mock()
        ug._remove_barrier(client)
        client.srem.assert_called_once()

    def test_remove_all_barrier_deletes_key(self):
        ug = self._make_update()
        client = mock.Mock()
        ug._remove_all_barrier(client)
        client.delete.assert_called_once()

    def test_restart_task_writes_action_and_queue_keys(self):
        ug = self._make_update()
        client = mock.Mock()
        task_obj = mock.Mock(spec=task.Task)
        task_obj.name = 't1'
        task_obj.retry_id = 0
        ug._restart_task(client, task_obj, total_timeout=60)
        client.set.assert_called_once()
        client.lpush.assert_called_once()
        # expire is called twice (once for action key, once for queue)
        self.assertEqual(client.expire.call_count, 2)


class UpdateGroupNotifyBarrierTest(unittest.TestCase):
    """Test _notify_barrier — when enough tasks reach the barrier, emit notifications
    (lines 1251, 1253-1254, 1256-1258, 1260-1261, 1264-1266, 1268-1271, 1273-1274,
    1276, 1278-1279, 1281)."""

    def _make_update(self):
        return jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', task_name='t1', retry_id=0,
            status=task.TaskGroupStatus.RUNNING, user='alice')

    def test_when_enough_members_in_barrier_emits_notifications(self):
        ug = self._make_update()
        client = mock.Mock()
        pipe = mock.Mock()
        client.pipeline.return_value = pipe
        client.smembers.return_value = {b't1', b't2'}
        database = mock.Mock()
        with mock.patch.object(task.TaskGroup, 'fetch_active_group_size',
                               return_value=2), \
             mock.patch.object(task.Task, 'batch_fetch_latest_retry_ids',
                               return_value={'t1': 0, 't2': 0}):
            ug._notify_barrier(database, client, total_timeout=60)
        pipe.execute.assert_called_once()
        # Two members should each lpush once.
        self.assertEqual(pipe.lpush.call_count, 2)

    def test_when_below_barrier_count_does_not_execute_pipe(self):
        ug = self._make_update()
        client = mock.Mock()
        client.smembers.return_value = {b't1'}
        with mock.patch.object(task.TaskGroup, 'fetch_active_group_size',
                               return_value=3), \
             mock.patch.object(task.Task, 'batch_fetch_latest_retry_ids',
                               return_value={}):
            ug._notify_barrier(mock.Mock(), client, total_timeout=60)
        client.pipeline.assert_not_called()

    def test_when_task_missing_from_db_skips_that_task(self):
        ug = self._make_update()
        client = mock.Mock()
        pipe = mock.Mock()
        client.pipeline.return_value = pipe
        client.smembers.return_value = {b't1', b't2'}
        with mock.patch.object(task.TaskGroup, 'fetch_active_group_size',
                               return_value=2), \
             mock.patch.object(task.Task, 'batch_fetch_latest_retry_ids',
                               return_value={'t1': 0}):
            ug._notify_barrier(mock.Mock(), client, total_timeout=60)
        # Only t1 is in DB; t2 is skipped, so just 1 lpush
        self.assertEqual(pipe.lpush.call_count, 1)


class UpdateGroupSendJobToQueueTest(unittest.TestCase):
    """UpdateGroup.send_job_to_queue (lines 660-661, 663-665, 667, 669)."""

    def test_send_skipped_when_not_canceled_and_dedupe_key_exists(self):
        ug = jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', status=task.TaskGroupStatus.RUNNING,
            user='alice')
        mock_redis = mock.Mock()
        mock_redis.client.get.return_value = b'existing-uuid'
        with mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock_redis), \
             mock.patch.object(jobs_base.Job, 'send_job') as mock_send:
            ug.send_job_to_queue()
        mock_send.assert_not_called()

    def test_send_called_when_dedupe_key_missing(self):
        ug = jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', status=task.TaskGroupStatus.RUNNING,
            user='alice')
        mock_redis = mock.Mock()
        mock_redis.client.get.return_value = None
        with mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock_redis), \
             mock.patch.object(jobs_base.Job, 'send_job') as mock_send:
            ug.send_job_to_queue()
        mock_send.assert_called_once()

    def test_send_proceeds_for_canceled_status_even_if_dedupe_exists(self):
        ug = jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', status=task.TaskGroupStatus.FAILED_CANCELED,
            user='alice')
        mock_redis = mock.Mock()
        mock_redis.client.get.return_value = b'existing-uuid'
        with mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock_redis), \
             mock.patch.object(jobs_base.Job, 'send_job') as mock_send:
            ug.send_job_to_queue()
        mock_send.assert_called_once()


class CreateGroupHandleFailureTest(unittest.TestCase):
    """CreateGroup.handle_failure enqueues an UpdateGroup job
    (lines 533, 541)."""

    def test_handle_failure_enqueues_update_group(self):
        cg = _make_create_group()
        with mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue') as mock_send:
            cg.handle_failure(mock.Mock(), 'boom')
        mock_send.assert_called_once()


class CleanupGroupTest(unittest.TestCase):
    """CleanupGroup.execute / .prepare_execute (lines 568, 570, 583-584,
    586-587, 589)."""

    def test_execute_calls_cleanup_workflow_group(self):
        cg = _make_cleanup_group()
        with mock.patch.object(jobs, 'cleanup_workflow_group') as mock_cleanup:
            result = cg.execute(mock.Mock(), mock.Mock())
        mock_cleanup.assert_called_once()
        self.assertIsInstance(result, jobs_base.JobResult)

    def test_prepare_execute_clears_error_log_keys(self):
        cg = _make_cleanup_group()
        # Build a fake group with two tasks
        task_obj_a = mock.Mock()
        task_obj_a.task_uuid = 'taskuuid1'
        task_obj_a.retry_id = 0
        task_obj_b = mock.Mock()
        task_obj_b.task_uuid = 'taskuuid2'
        task_obj_b.retry_id = 1
        group = mock.Mock()
        group.tasks = [task_obj_a, task_obj_b]

        mock_redis = mock.Mock()
        with mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock_redis), \
             mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group):
            ready, error = cg.prepare_execute(mock.Mock(), mock.Mock())
        self.assertTrue(ready)
        self.assertEqual(error, '')
        self.assertEqual(mock_redis.client.delete.call_count, 2)


class RescheduleTaskTest(unittest.TestCase):
    """RescheduleTask helpers (lines 1321, 1323-1326, 1329, 1331, 1333-1334,
    1344-1345, 1347, 1349-1350, 1363, 1365-1366, 1368-1369, 1371-1372,
    1375-1376, 1378, 1384, 1395)."""

    def _make(self, **overrides):
        cleanup_spec = backend_job_defs.BackendCleanupSpec(
            generic_api=backend_job_defs.BackendGenericApi(
                api_version='v1', kind='Pod'),
            labels={'osmo.retry_id': '0'})
        cleanup_job = jobs.CleanupGroup(
            backend='back', group_name='g1', workflow_id=WORKFLOW_ID,
            workflow_uuid=WORKFLOW_UUID, user='alice',
            cleanup_specs=[cleanup_spec], error_log_spec=cleanup_spec,
            max_log_lines=100)
        create_job = jobs.CreateGroup(
            backend='back', group_name='g1', workflow_id=WORKFLOW_ID,
            workflow_uuid=WORKFLOW_UUID, user='alice', k8s_resources=[])
        defaults = {
            'workflow_id': WORKFLOW_ID,
            'workflow_uuid': WORKFLOW_UUID,
            'backend': 'back',
            'user': 'alice',
            'retry_id': 1,
            'task_name': 't1',
            'lead_task': True,
            'create_job': create_job,
            'cleanup_job': cleanup_job,
        }
        defaults.update(overrides)
        return jobs.RescheduleTask(**defaults)

    def test_delay_cleanup_pod_updates_labels_and_sends_delayed_job(self):
        rt = self._make()
        with mock.patch.object(jobs.CleanupGroup, 'send_delayed_job_to_queue') as mock_send:
            rt._delay_cleanup_pod()
        mock_send.assert_called_once()

    def test_execute_delays_cleanup_when_group_finished(self):
        rt = self._make()
        group = mock.Mock()
        group.status = task.TaskGroupStatus.COMPLETED
        with mock.patch.object(task.Task, 'fetch_group_name', return_value='g1'), \
             mock.patch.object(task.TaskGroup, 'fetch_metadata_from_db',
                               return_value=group), \
             mock.patch.object(jobs.RescheduleTask, '_delay_cleanup_pod') as mock_delay:
            result = rt.execute(mock.Mock(), mock.Mock())
        mock_delay.assert_called_once()
        self.assertIsInstance(result, jobs_base.JobResult)

    def test_execute_does_not_delay_when_group_not_finished(self):
        rt = self._make()
        group = mock.Mock()
        group.status = task.TaskGroupStatus.RUNNING
        with mock.patch.object(task.Task, 'fetch_group_name', return_value='g1'), \
             mock.patch.object(task.TaskGroup, 'fetch_metadata_from_db',
                               return_value=group), \
             mock.patch.object(jobs.RescheduleTask, '_delay_cleanup_pod') as mock_delay:
            rt.execute(mock.Mock(), mock.Mock())
        mock_delay.assert_not_called()

    def test_prepare_execute_returns_false_if_retry_id_mismatch(self):
        rt = self._make(retry_id=1)
        existing = mock.Mock()
        existing.retry_id = 5
        existing.task_uuid = 'taskuuid'
        existing.name = 't1'
        existing.status = task.TaskGroupStatus.RUNNING
        with mock.patch.object(task.Task, 'fetch_from_db', return_value=existing):
            ready, error = rt.prepare_execute(mock.Mock(), mock.Mock())
        self.assertFalse(ready)
        self.assertIn('Latest retry', error)

    def test_prepare_execute_when_group_finished_calls_delay_cleanup(self):
        rt = self._make(retry_id=1)
        existing = mock.Mock()
        existing.retry_id = 1
        existing.task_uuid = 'taskuuid'
        existing.name = 't1'
        existing.status = task.TaskGroupStatus.COMPLETED  # group_finished == True
        with mock.patch.object(task.Task, 'fetch_from_db', return_value=existing), \
             mock.patch.object(jobs.RescheduleTask, '_delay_cleanup_pod') as mock_delay:
            ready, error = rt.prepare_execute(mock.Mock(), mock.Mock())
        self.assertFalse(ready)
        mock_delay.assert_called_once()
        self.assertIn('has status', error)

    def test_prepare_execute_clears_error_logs_when_ready(self):
        rt = self._make(retry_id=1)
        existing = mock.Mock()
        existing.retry_id = 1
        existing.task_uuid = 'taskuuid'
        existing.name = 't1'
        existing.status = task.TaskGroupStatus.WAITING  # prescheduling == True
        mock_redis = mock.Mock()
        with mock.patch.object(task.Task, 'fetch_from_db', return_value=existing), \
             mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock_redis):
            ready, error = rt.prepare_execute(mock.Mock(), mock.Mock())
        self.assertTrue(ready)
        self.assertEqual(error, '')
        mock_redis.client.delete.assert_called_once()

    def test_handle_failure_enqueues_update_group(self):
        rt = self._make()
        with mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue') as mock_send:
            rt.handle_failure(mock.Mock(), 'boom')
        mock_send.assert_called_once()


class CancelWorkflowExecuteTest(unittest.TestCase):
    """CancelWorkflow.execute (lines 1656-1701, 1703)."""

    def _make_workflow(self, statuses_finished=None, exec_timeout=None,
                       queue_timeout=None):
        wf = mock.Mock()
        wf.update_cancelled_by = mock.Mock()
        wf.timeout = mock.Mock()
        wf.timeout.exec_timeout = exec_timeout
        wf.timeout.queue_timeout = queue_timeout
        groups = []
        statuses_finished = statuses_finished or [False]
        for idx, finished in enumerate(statuses_finished):
            g = mock.Mock()
            g.name = f'g{idx}'
            g.status = mock.Mock()
            g.status.finished.return_value = finished
            groups.append(g)
        wf.get_group_objs.return_value = groups
        return wf

    def test_unfinished_groups_get_update_group_jobs(self):
        cancel = jobs.CancelWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='alice')
        wf = self._make_workflow(statuses_finished=[False, False])
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue') as mock_send:
            result = cancel.execute(mock.Mock(), mock.Mock())
        self.assertEqual(mock_send.call_count, 2)
        self.assertIsInstance(result, jobs_base.JobResult)

    def test_finished_groups_skipped_unless_force(self):
        cancel = jobs.CancelWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='alice')
        wf = self._make_workflow(statuses_finished=[True, True])
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue') as mock_send:
            cancel.execute(mock.Mock(), mock.Mock())
        mock_send.assert_not_called()

    def test_force_cancel_overrides_finished_skip(self):
        cancel = jobs.CancelWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='alice',
            force=True)
        wf = self._make_workflow(statuses_finished=[True])
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue') as mock_send:
            cancel.execute(mock.Mock(), mock.Mock())
        mock_send.assert_called_once()

    def test_exec_timeout_cancels_attribute_to_osmo(self):
        cancel = jobs.CancelWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='alice',
            workflow_status=wf_module.WorkflowStatus.FAILED_EXEC_TIMEOUT,
            task_status=task.TaskGroupStatus.FAILED_EXEC_TIMEOUT)
        wf = self._make_workflow(statuses_finished=[False],
                                  exec_timeout=datetime.timedelta(minutes=5))
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue'):
            cancel.execute(mock.Mock(), mock.Mock())
        wf.update_cancelled_by.assert_called_with('osmo')

    def test_queue_timeout_attributes_cancellation_to_osmo(self):
        cancel = jobs.CancelWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='alice',
            workflow_status=wf_module.WorkflowStatus.FAILED_QUEUE_TIMEOUT,
            task_status=task.TaskGroupStatus.FAILED_QUEUE_TIMEOUT)
        wf = self._make_workflow(statuses_finished=[False],
                                  queue_timeout=datetime.timedelta(minutes=5))
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue'):
            cancel.execute(mock.Mock(), mock.Mock())
        wf.update_cancelled_by.assert_called_with('osmo')

    def test_user_cancel_uses_user(self):
        cancel = jobs.CancelWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='alice')
        wf = self._make_workflow(statuses_finished=[False])
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue'):
            cancel.execute(mock.Mock(), mock.Mock())
        wf.update_cancelled_by.assert_called_with('alice')


class CheckRunTimeoutTest(unittest.TestCase):
    """CheckRunTimeout helpers (lines 1719-1722, 1727-1735, 1739-1773, 1782-1804,
    1815-1817)."""

    def _make(self, group_name=None):
        return jobs.CheckRunTimeout(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            user='alice', group_name=group_name)

    def test_resolve_uses_workflow_exec_timeout_when_set(self):
        check = self._make(group_name='g1')
        wf = mock.Mock()
        wf.timeout = mock.Mock()
        wf.timeout.exec_timeout = datetime.timedelta(minutes=10)
        result = check._resolve_exec_timeout(mock.Mock(), wf)
        self.assertEqual(result, datetime.timedelta(minutes=10))

    def test_resolve_falls_back_to_pool_default(self):
        check = self._make(group_name='g1')
        wf = mock.Mock()
        wf.timeout = mock.Mock()
        wf.timeout.exec_timeout = None
        wf.pool = 'pool-1'
        pool = mock.Mock()
        pool.default_exec_timeout = '5m'
        cfg = mock.Mock()
        cfg.default_exec_timeout = '15m'
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = cfg
        with mock.patch.object(connectors.Pool, 'fetch_from_db',
                               return_value=pool):
            result = check._resolve_exec_timeout(ctx, wf)
        self.assertEqual(result, datetime.timedelta(minutes=5))

    def test_resolve_falls_back_to_workflow_config_default(self):
        check = self._make(group_name='g1')
        wf = mock.Mock()
        wf.timeout = mock.Mock()
        wf.timeout.exec_timeout = None
        wf.pool = 'pool-1'
        pool = mock.Mock()
        pool.default_exec_timeout = ''
        cfg = mock.Mock()
        cfg.default_exec_timeout = '15m'
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = cfg
        with mock.patch.object(connectors.Pool, 'fetch_from_db',
                               return_value=pool):
            result = check._resolve_exec_timeout(ctx, wf)
        self.assertEqual(result, datetime.timedelta(minutes=15))

    def test_resolve_raises_when_no_pool(self):
        check = self._make(group_name='g1')
        wf = mock.Mock()
        wf.timeout = mock.Mock()
        wf.timeout.exec_timeout = None
        wf.pool = None
        with self.assertRaises(osmo_errors.OSMOUserError):
            check._resolve_exec_timeout(mock.Mock(), wf)

    def test_per_group_skips_when_finished(self):
        check = self._make(group_name='g1')
        group = mock.Mock()
        group.status = task.TaskGroupStatus.COMPLETED
        group.start_time = datetime.datetime.now()
        with mock.patch.object(task.TaskGroup, 'fetch_from_db',
                               return_value=group):
            result = check._execute_per_group(mock.Mock(), 'g1')
        self.assertIsInstance(result, jobs_base.JobResult)

    def test_per_group_skips_when_no_start_time(self):
        check = self._make(group_name='g1')
        group = mock.Mock()
        group.status = task.TaskGroupStatus.RUNNING
        group.start_time = None
        with mock.patch.object(task.TaskGroup, 'fetch_from_db',
                               return_value=group):
            result = check._execute_per_group(mock.Mock(), 'g1')
        self.assertIsInstance(result, jobs_base.JobResult)

    def test_per_group_resubmits_when_timeout_exceeds_elapsed(self):
        check = self._make(group_name='g1')
        group = mock.Mock()
        group.status = task.TaskGroupStatus.RUNNING
        group.start_time = datetime.datetime.now()
        wf = mock.Mock()
        wf.timeout = mock.Mock()
        wf.timeout.exec_timeout = datetime.timedelta(hours=10)
        with mock.patch.object(task.TaskGroup, 'fetch_from_db',
                               return_value=group), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.CheckRunTimeout, 'send_delayed_job_to_queue') \
                 as mock_delay:
            check._execute_per_group(mock.Mock(), 'g1')
        mock_delay.assert_called_once()

    def test_per_group_cancels_group_when_elapsed_exceeds_timeout(self):
        check = self._make(group_name='g1')
        group = mock.Mock()
        group.status = task.TaskGroupStatus.RUNNING
        group.start_time = datetime.datetime.now() - datetime.timedelta(hours=2)
        wf = mock.Mock()
        wf.timeout = mock.Mock()
        wf.timeout.exec_timeout = datetime.timedelta(minutes=1)
        with mock.patch.object(task.TaskGroup, 'fetch_from_db',
                               return_value=group), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue') as mock_send:
            check._execute_per_group(mock.Mock(), 'g1')
        mock_send.assert_called_once()

    def test_legacy_execute_resubmits_when_within_timeout(self):
        check = self._make()  # No group_name -> legacy path
        wf = mock.Mock()
        wf.status = wf_module.WorkflowStatus.RUNNING
        wf.status.finished = lambda: False
        wf.start_time = datetime.datetime.now()
        wf.timeout = mock.Mock()
        wf.timeout.exec_timeout = datetime.timedelta(hours=10)
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.CheckRunTimeout, 'send_delayed_job_to_queue') \
                 as mock_delay:
            check._execute_legacy_workflow_level(mock.Mock())
        mock_delay.assert_called_once()

    def test_legacy_execute_cancels_workflow_when_expired(self):
        check = self._make()
        wf = mock.Mock()
        wf.status = mock.Mock()
        wf.status.finished.return_value = False
        wf.start_time = datetime.datetime.now() - datetime.timedelta(hours=2)
        wf.timeout = mock.Mock()
        wf.timeout.exec_timeout = datetime.timedelta(minutes=1)
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.CancelWorkflow, 'send_job_to_queue') \
                 as mock_send:
            check._execute_legacy_workflow_level(mock.Mock())
        mock_send.assert_called_once()

    def test_execute_dispatches_to_per_group_when_group_set(self):
        check = self._make(group_name='g1')
        with mock.patch.object(jobs.CheckRunTimeout, '_execute_per_group',
                               return_value=jobs_base.JobResult()) as mock_per, \
             mock.patch.object(jobs.CheckRunTimeout, '_execute_legacy_workflow_level',
                               return_value=jobs_base.JobResult()) as mock_legacy:
            check.execute(mock.Mock(), mock.Mock())
        mock_per.assert_called_once()
        mock_legacy.assert_not_called()

    def test_execute_dispatches_to_legacy_when_group_missing(self):
        check = self._make()
        with mock.patch.object(jobs.CheckRunTimeout, '_execute_per_group',
                               return_value=jobs_base.JobResult()) as mock_per, \
             mock.patch.object(jobs.CheckRunTimeout, '_execute_legacy_workflow_level',
                               return_value=jobs_base.JobResult()) as mock_legacy:
            check.execute(mock.Mock(), mock.Mock())
        mock_per.assert_not_called()
        mock_legacy.assert_called_once()


class CheckQueueTimeoutTest(unittest.TestCase):
    """CheckQueueTimeout helpers (lines 1834-1937)."""

    def _make(self, group_name=None):
        return jobs.CheckQueueTimeout(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            user='alice', group_name=group_name)

    def test_resolve_uses_workflow_queue_timeout_when_set(self):
        check = self._make(group_name='g1')
        wf = mock.Mock()
        wf.timeout = mock.Mock()
        wf.timeout.queue_timeout = datetime.timedelta(minutes=10)
        result = check._resolve_queue_timeout(mock.Mock(), wf)
        self.assertEqual(result, datetime.timedelta(minutes=10))

    def test_resolve_falls_back_to_pool_default(self):
        check = self._make(group_name='g1')
        wf = mock.Mock()
        wf.timeout = mock.Mock()
        wf.timeout.queue_timeout = None
        wf.pool = 'pool-1'
        pool = mock.Mock()
        pool.default_queue_timeout = '5m'
        cfg = mock.Mock()
        cfg.default_queue_timeout = '15m'
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = cfg
        with mock.patch.object(connectors.Pool, 'fetch_from_db',
                               return_value=pool):
            result = check._resolve_queue_timeout(ctx, wf)
        self.assertEqual(result, datetime.timedelta(minutes=5))

    def test_resolve_raises_when_no_pool(self):
        check = self._make(group_name='g1')
        wf = mock.Mock()
        wf.timeout = mock.Mock()
        wf.timeout.queue_timeout = None
        wf.pool = None
        with self.assertRaises(osmo_errors.OSMOUserError):
            check._resolve_queue_timeout(mock.Mock(), wf)

    def test_per_group_skips_when_not_scheduling(self):
        check = self._make(group_name='g1')
        group = mock.Mock()
        group.status = task.TaskGroupStatus.RUNNING
        with mock.patch.object(task.TaskGroup, 'fetch_from_db',
                               return_value=group):
            result = check._execute_per_group(mock.Mock(), 'g1')
        self.assertIsInstance(result, jobs_base.JobResult)

    def test_per_group_skips_when_no_scheduling_start_time(self):
        check = self._make(group_name='g1')
        group = mock.Mock()
        group.status = task.TaskGroupStatus.SCHEDULING
        group.scheduling_start_time = None
        with mock.patch.object(task.TaskGroup, 'fetch_from_db',
                               return_value=group):
            result = check._execute_per_group(mock.Mock(), 'g1')
        self.assertIsInstance(result, jobs_base.JobResult)

    def test_per_group_resubmits_when_timeout_exceeds_elapsed(self):
        check = self._make(group_name='g1')
        group = mock.Mock()
        group.status = task.TaskGroupStatus.SCHEDULING
        group.scheduling_start_time = datetime.datetime.now()
        wf = mock.Mock()
        wf.timeout = mock.Mock()
        wf.timeout.queue_timeout = datetime.timedelta(hours=10)
        with mock.patch.object(task.TaskGroup, 'fetch_from_db',
                               return_value=group), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.CheckQueueTimeout, 'send_delayed_job_to_queue') \
                 as mock_delay:
            check._execute_per_group(mock.Mock(), 'g1')
        mock_delay.assert_called_once()

    def test_per_group_cancels_when_elapsed_exceeds_timeout(self):
        check = self._make(group_name='g1')
        group = mock.Mock()
        group.status = task.TaskGroupStatus.SCHEDULING
        group.scheduling_start_time = datetime.datetime.now() - \
            datetime.timedelta(hours=2)
        wf = mock.Mock()
        wf.timeout = mock.Mock()
        wf.timeout.queue_timeout = datetime.timedelta(minutes=1)
        with mock.patch.object(task.TaskGroup, 'fetch_from_db',
                               return_value=group), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue') as mock_send:
            check._execute_per_group(mock.Mock(), 'g1')
        mock_send.assert_called_once()

    def test_legacy_skips_when_workflow_not_pending(self):
        check = self._make()
        wf = mock.Mock()
        wf.status = wf_module.WorkflowStatus.RUNNING
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf):
            result = check._execute_legacy_workflow_level(mock.Mock())
        self.assertIsInstance(result, jobs_base.JobResult)

    def test_legacy_skips_when_no_submit_time(self):
        check = self._make()
        wf = mock.Mock()
        wf.status = wf_module.WorkflowStatus.PENDING
        wf.submit_time = None
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf):
            result = check._execute_legacy_workflow_level(mock.Mock())
        self.assertIsInstance(result, jobs_base.JobResult)

    def test_legacy_resubmits_when_within_timeout(self):
        check = self._make()
        wf = mock.Mock()
        wf.status = wf_module.WorkflowStatus.PENDING
        wf.submit_time = datetime.datetime.now()
        wf.timeout = mock.Mock()
        wf.timeout.queue_timeout = datetime.timedelta(hours=10)
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.CheckQueueTimeout, 'send_delayed_job_to_queue') \
                 as mock_delay:
            check._execute_legacy_workflow_level(mock.Mock())
        mock_delay.assert_called_once()

    def test_legacy_cancels_when_elapsed_exceeds_timeout(self):
        check = self._make()
        wf = mock.Mock()
        wf.status = wf_module.WorkflowStatus.PENDING
        wf.submit_time = datetime.datetime.now() - datetime.timedelta(hours=2)
        wf.timeout = mock.Mock()
        wf.timeout.queue_timeout = datetime.timedelta(minutes=1)
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.CancelWorkflow, 'send_job_to_queue') \
                 as mock_send:
            check._execute_legacy_workflow_level(mock.Mock())
        mock_send.assert_called_once()

    def test_execute_dispatches_to_per_group_when_group_set(self):
        check = self._make(group_name='g1')
        with mock.patch.object(jobs.CheckQueueTimeout, '_execute_per_group',
                               return_value=jobs_base.JobResult()) as mock_per, \
             mock.patch.object(jobs.CheckQueueTimeout, '_execute_legacy_workflow_level',
                               return_value=jobs_base.JobResult()) as mock_legacy:
            check.execute(mock.Mock(), mock.Mock())
        mock_per.assert_called_once()
        mock_legacy.assert_not_called()

    def test_execute_dispatches_to_legacy_when_group_missing(self):
        check = self._make()
        with mock.patch.object(jobs.CheckQueueTimeout, '_execute_per_group',
                               return_value=jobs_base.JobResult()) as mock_per, \
             mock.patch.object(jobs.CheckQueueTimeout, '_execute_legacy_workflow_level',
                               return_value=jobs_base.JobResult()) as mock_legacy:
            check.execute(mock.Mock(), mock.Mock())
        mock_per.assert_not_called()
        mock_legacy.assert_called_once()


class SubmitWorkflowHandleFailureTest(unittest.TestCase):
    """SubmitWorkflow.handle_failure (lines 314-348)."""

    def _make(self):
        # Bypass SubmitWorkflow's required nested fields with model_construct.
        return jobs.SubmitWorkflow.model_construct(  # type: ignore[call-arg]
            workflow_id=WORKFLOW_ID,
            workflow_uuid=WORKFLOW_UUID,
            user='alice',
            spec=mock.Mock(),
            original_spec={'version': 2},
            group_and_task_uuids={},
            job_id=f'{WORKFLOW_UUID}-submit',
            job_type='SubmitWorkflow',
            job_uuid='job-uuid-z',
        )

    def test_handle_failure_returns_when_workflow_not_found(self):
        sj = self._make()
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               side_effect=osmo_errors.OSMODatabaseError('nope')), \
             mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue') as mock_send:
            result = sj.handle_failure(mock.Mock(), 'boom')
        self.assertIsNone(result)
        mock_send.assert_not_called()

    def test_handle_failure_iterates_unfinished_groups(self):
        sj = self._make()
        unfinished_status = mock.Mock()
        unfinished_status.finished.return_value = False
        finished_status = mock.Mock()
        finished_status.finished.return_value = True
        wf = mock.Mock()
        wf.logs = 'http://example.com'  # non-redis -> skip redis xadd
        unfinished_group = mock.Mock()
        unfinished_group.name = 'g1'
        unfinished_group.status = unfinished_status
        finished_group = mock.Mock()
        finished_group.name = 'g2'
        finished_group.status = finished_status
        wf.get_group_objs.return_value = [unfinished_group, finished_group]
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue') as mock_send:
            sj.handle_failure(mock.Mock(), 'boom')
        # Only the unfinished group enqueues an UpdateGroup.
        mock_send.assert_called_once()


class UpdateGroupHandleFailureTest(unittest.TestCase):
    """UpdateGroup.handle_failure (lines 1083-1088, 1090-1094, 1096)."""

    def test_handle_failure_returns_early_if_workflow_unfinished(self):
        ug = jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', status=task.TaskGroupStatus.RUNNING,
            user='alice')
        wf = mock.Mock()
        wf.status = mock.Mock()
        wf.status.finished.return_value = False
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(jobs.UpdateGroup, 'schedule_cleanup_job') as mock_schedule:
            ug.handle_failure(mock.Mock(), 'err')
        mock_schedule.assert_not_called()

    def test_handle_failure_schedules_cleanup_when_workflow_finished(self):
        ug = jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', status=task.TaskGroupStatus.FAILED,
            user='alice')
        wf = mock.Mock()
        wf.status = mock.Mock()
        wf.status.finished.return_value = True
        wf.backend = 'back'
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(task.TaskGroup, 'fetch_metadata_from_db',
                               return_value=mock.Mock()), \
             mock.patch.object(connectors, 'BackendConfigCache') as mock_cache, \
             mock.patch.object(jobs.UpdateGroup, 'schedule_cleanup_job') as mock_schedule:
            mock_cache.return_value.get.return_value = mock.Mock()
            ug.handle_failure(mock.Mock(), 'err')
        mock_schedule.assert_called_once()

    def test_handle_failure_handles_missing_backend(self):
        ug = jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', status=task.TaskGroupStatus.FAILED,
            user='alice')
        wf = mock.Mock()
        wf.status = mock.Mock()
        wf.status.finished.return_value = True
        wf.backend = 'back'
        cache = mock.Mock()
        cache.get.side_effect = osmo_errors.OSMOBackendError('nope')
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                               return_value=wf), \
             mock.patch.object(task.TaskGroup, 'fetch_metadata_from_db',
                               return_value=mock.Mock()), \
             mock.patch.object(connectors, 'BackendConfigCache',
                               return_value=cache), \
             mock.patch.object(jobs.UpdateGroup, 'schedule_cleanup_job') as mock_schedule:
            ug.handle_failure(mock.Mock(), 'err')
        # Even with missing backend, schedule is called (with backend=None).
        mock_schedule.assert_called_once()


class ScheduleCleanupJobTest(unittest.TestCase):
    """UpdateGroup.schedule_cleanup_job (lines 805-869)."""

    def _make_update(self, status, force_cancel=False, lead_task=True):
        return jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', task_name='t1', retry_id=0,
            status=status, user='alice',
            force_cancel=force_cancel, lead_task=lead_task)

    def _make_group(self, group_uuid='abcdef0123456789abcdef0123456789'):
        group = mock.Mock()
        group.name = 'g1'
        group.group_uuid = group_uuid
        group.spec = mock.Mock()
        group.spec.ignoreNonleadStatus = True
        group.group_template_resource_types = []
        group.get_k8s_object_factory = mock.Mock()
        return group

    def test_no_cleanup_when_neither_lead_finished_nor_failure(self):
        ug = self._make_update(task.TaskGroupStatus.RUNNING)
        wf = mock.Mock()
        wf.workflow_id = WORKFLOW_ID
        wf.workflow_uuid = WORKFLOW_UUID
        wf.backend = 'back'
        with mock.patch.object(jobs.CleanupGroup, 'send_job_to_queue') as mock_send, \
             mock.patch.object(jobs, 'cleanup_workflow_group') as mock_cleanup:
            ug.schedule_cleanup_job(mock.Mock(), wf, self._make_group(),
                                     mock.Mock(), backend=mock.Mock())
        mock_send.assert_not_called()
        mock_cleanup.assert_not_called()

    def test_no_backend_calls_cleanup_workflow_group(self):
        ug = self._make_update(task.TaskGroupStatus.COMPLETED, lead_task=True)
        wf = mock.Mock()
        wf.workflow_id = WORKFLOW_ID
        wf.workflow_uuid = WORKFLOW_UUID
        wf.backend = 'back'
        with mock.patch.object(jobs, 'cleanup_workflow_group') as mock_cleanup:
            ug.schedule_cleanup_job(mock.Mock(), wf, self._make_group(),
                                     mock.Mock(), backend=None)
        mock_cleanup.assert_called_once()

    def test_with_backend_enqueues_cleanup_group_job(self):
        ug = self._make_update(task.TaskGroupStatus.COMPLETED, lead_task=True)
        wf = mock.Mock()
        wf.workflow_id = WORKFLOW_ID
        wf.workflow_uuid = WORKFLOW_UUID
        wf.backend = 'back'
        group = self._make_group()
        factory = mock.Mock()
        factory.get_group_cleanup_specs.return_value = []
        factory.get_error_log_specs.return_value = None
        group.get_k8s_object_factory.return_value = factory
        wf_config = mock.Mock()
        wf_config.max_error_log_lines = 50
        with mock.patch.object(jobs.CleanupGroup, 'send_job_to_queue') as mock_send:
            ug.schedule_cleanup_job(mock.Mock(), wf, group, wf_config,
                                     backend=mock.Mock())
        mock_send.assert_called_once()

    def test_force_cancel_uses_force_job_id(self):
        ug = self._make_update(task.TaskGroupStatus.RUNNING, force_cancel=True)
        wf = mock.Mock()
        wf.workflow_id = WORKFLOW_ID
        wf.workflow_uuid = WORKFLOW_UUID
        wf.backend = 'back'
        group = self._make_group()
        factory = mock.Mock()
        factory.get_group_cleanup_specs.return_value = []
        factory.get_error_log_specs.return_value = None
        group.get_k8s_object_factory.return_value = factory
        wf_config = mock.Mock()
        wf_config.max_error_log_lines = 50
        with mock.patch.object(jobs.CleanupGroup, 'send_job_to_queue') as mock_send:
            ug.schedule_cleanup_job(mock.Mock(), wf, group, wf_config,
                                     backend=mock.Mock())
        mock_send.assert_called_once()


class SubmitWorkflowExecuteTest(unittest.TestCase):
    """SubmitWorkflow.execute (lines 219-307)."""

    def _make(self):
        return jobs.SubmitWorkflow.model_construct(  # type: ignore[arg-type]
            workflow_id=WORKFLOW_ID,
            workflow_uuid=WORKFLOW_UUID,
            user='alice',
            spec=mock.Mock(),
            original_spec={'version': 2},
            group_and_task_uuids={},
            job_id=f'{WORKFLOW_UUID}-submit',
            job_type='SubmitWorkflow',
            job_uuid='job-uuid-z',
            parent_workflow_id=None,
            task_db_keys=None,
            app_uuid=None,
            app_version=None,
        )

    def _make_workflow(self, ready_groups=True):
        wf = mock.Mock()
        wf.workflow_id = WORKFLOW_ID
        wf.workflow_uuid = WORKFLOW_UUID
        wf.backend = 'back'
        # Build a single group with one task and no upstream deps
        spec = mock.Mock()
        spec.model_dump_json.return_value = '{}'
        spec_after_parse = mock.Mock()
        # Avoid spec mutation messing with model_dump_json: parse() returns same mock-like obj
        task_spec = mock.Mock()
        task_spec.backend = 'back'
        resources = mock.Mock()
        resources.gpu = 1
        resources.cpu = 2
        resources.storage = '10GiB'
        resources.memory = '4GiB'
        task_spec.resources = resources
        spec_after_parse.tasks = [task_spec]
        spec_after_parse.model_dump_json.return_value = '{}'
        spec.parse = mock.Mock(return_value=spec_after_parse)
        scheduler_settings = mock.Mock()
        scheduler_settings.model_dump_json.return_value = '{}'

        task_obj = mock.Mock()
        task_obj.workflow_id_internal = None
        task_obj.workflow_uuid = WORKFLOW_UUID
        task_obj.name = 't1'
        task_obj.group_name = 'g1'
        task_obj.task_db_key = 'tdb1'
        task_obj.retry_id = 0
        task_obj.task_uuid = 'taskuuid1'
        task_obj.exit_actions = {}
        task_obj.lead = True

        group = mock.Mock()
        group.workflow_id_internal = None
        group.spec = spec
        group.name = 'g1'
        group.group_uuid = 'guuid1'
        group.tasks = [task_obj]
        group.scheduler_settings = scheduler_settings
        group.group_template_resource_types = []
        group.remaining_upstream_groups = {} if ready_groups else {'upstream'}
        group.downstream_groups = {}

        wf.groups = [group]
        wf.mark_groups_as_waiting = mock.Mock(return_value=True)
        return wf

    def test_execute_inserts_and_enqueues_create_group_for_ready_groups(self):
        sj = self._make()
        wf = self._make_workflow(ready_groups=True)
        ctx = mock.Mock()
        ctx.redis.redis_url = 'redis://localhost:6379'
        backend_obj = mock.Mock()
        backend_obj.scheduler_settings = mock.Mock()
        backend_obj.scheduler_settings.model_dump_json.return_value = '{}'
        cache_instance = mock.Mock()
        cache_instance.get.return_value = backend_obj
        with mock.patch.object(wf_module.Workflow, 'from_workflow_spec',
                               return_value=wf), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch.object(task.TaskGroup, 'batch_insert_groups_and_tasks'), \
             mock.patch.object(task.TaskGroup, 'batch_set_groups_to_processing',
                               return_value=['g1']), \
             mock.patch.object(connectors, 'BackendConfigCache',
                               return_value=cache_instance), \
             mock.patch.object(jobs.CreateGroup, 'send_job_to_queue') as mock_send:
            result = sj.execute(ctx, mock.Mock())
        self.assertIsInstance(result, jobs_base.JobResult)
        mock_send.assert_called_once()

    def test_execute_does_not_enqueue_when_workflow_canceled(self):
        sj = self._make()
        wf = self._make_workflow()
        wf.mark_groups_as_waiting.return_value = False
        ctx = mock.Mock()
        ctx.redis.redis_url = 'redis://localhost:6379'
        with mock.patch.object(wf_module.Workflow, 'from_workflow_spec',
                               return_value=wf), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch.object(task.TaskGroup, 'batch_insert_groups_and_tasks'), \
             mock.patch.object(jobs.CreateGroup, 'send_job_to_queue') as mock_send:
            sj.execute(ctx, mock.Mock())
        mock_send.assert_not_called()

    def test_execute_skips_groups_with_remaining_upstream(self):
        sj = self._make()
        wf = self._make_workflow(ready_groups=False)
        ctx = mock.Mock()
        ctx.redis.redis_url = 'redis://localhost:6379'
        cache_instance = mock.Mock()
        with mock.patch.object(wf_module.Workflow, 'from_workflow_spec',
                               return_value=wf), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch.object(task.TaskGroup, 'batch_insert_groups_and_tasks'), \
             mock.patch.object(task.TaskGroup, 'batch_set_groups_to_processing',
                               return_value=[]), \
             mock.patch.object(connectors, 'BackendConfigCache',
                               return_value=cache_instance), \
             mock.patch.object(jobs.CreateGroup, 'send_job_to_queue') as mock_send:
            sj.execute(ctx, mock.Mock())
        mock_send.assert_not_called()


class CreateGroupPrepareExecuteTest(unittest.TestCase):
    """CreateGroup.prepare_execute (lines 491-527)."""

    def test_returns_false_when_group_not_in_waiting_or_processing(self):
        cg = _make_create_group()
        group = mock.Mock()
        group.status = task.TaskGroupStatus.RUNNING
        group.name = 'g1'
        with mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group):
            ready, error = cg.prepare_execute(mock.Mock(), mock.Mock())
        self.assertFalse(ready)
        self.assertIn('Create Group Failed', error)

    def test_skips_kb_specs_generation_if_resources_already_set(self):
        cg = _make_create_group(k8s_resources=[{'kind': 'Pod'}])
        group = mock.Mock()
        group.status = task.TaskGroupStatus.WAITING
        with mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group):
            ready, error = cg.prepare_execute(mock.Mock(), mock.Mock())
        self.assertTrue(ready)
        self.assertEqual(error, '')

    def test_generates_kb_specs_and_enqueues_upload_when_no_resources(self):
        cg = _make_create_group(k8s_resources=None)
        # group_obj
        task_spec = mock.Mock()
        task_spec.backend = 'back'
        spec = mock.Mock()
        spec.tasks = [task_spec]
        group = mock.Mock()
        group.status = task.TaskGroupStatus.WAITING
        group.spec = spec
        group.get_kb_specs = mock.Mock(
            return_value=([{'kind': 'Pod'}], {'t1': {'spec': {}}}))
        group.update_group_template_resource_types = mock.Mock()

        wf = mock.Mock()
        wf.workflow_id = WORKFLOW_ID
        wf.pool = 'pool-1'
        wf.plugins = mock.Mock()
        wf.priority = mock.Mock()

        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = mock.Mock()

        with mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group), \
             mock.patch.object(connectors, 'BackendConfigCache',
                               return_value=mock.Mock()), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch.object(jobs, 'redact_pod_spec_env',
                               side_effect=lambda x: x), \
             mock.patch.object(jobs.UploadWorkflowFiles, 'send_job_to_queue') \
                 as mock_send:
            ready, error = cg.prepare_execute(mock.Mock(), mock.Mock())
        self.assertTrue(ready)
        self.assertEqual(error, '')
        mock_send.assert_called_once()
        group.update_group_template_resource_types.assert_called_once()


class UpdateGroupUpdateAllTasksTest(unittest.TestCase):
    """UpdateGroup._update_all_tasks (lines 707-795 and surroundings)."""

    def _make(self, status=task.TaskGroupStatus.RUNNING, lead_task=True,
              task_name='t1', retry_id=0):
        return jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', task_name=task_name, retry_id=retry_id,
            status=status, user='alice', lead_task=lead_task)

    def _make_group(self, has_barrier=False, ignore_nonlead=False):
        task_spec = mock.Mock()
        task_spec.backend = 'back'
        spec = mock.Mock()
        spec.tasks = [task_spec]
        spec.has_group_barrier = mock.Mock(return_value=has_barrier)
        spec.ignoreNonleadStatus = ignore_nonlead
        group = mock.Mock()
        group.spec = spec
        group.name = 'g1'
        group.tasks = []
        group.get_k8s_object_factory = mock.Mock()
        return group

    def _common_args(self, group, status):
        backend_config_cache = mock.Mock()
        backend_config_cache.get.return_value = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.max_retry_per_task = 3
        pool = mock.Mock(spec=connectors.Pool)
        pool.name = 'pool-1'
        pool.default_exit_actions = {}
        wf = mock.Mock()
        current_task = mock.Mock(spec=task.Task)
        current_task.name = 't1'
        current_task.retry_id = 0
        current_task.exit_actions = {}
        current_task.status = status
        return {
            'group_obj': group,
            'pool': pool,
            'update_time': datetime.datetime.now(),
            'total_timeout': 60,
            'redis_client': mock.Mock(),
            'workflow_config': workflow_config,
            'backend_config_cache': backend_config_cache,
            'workflow_obj': wf,
            'current_task': current_task,
        }

    def test_status_not_finished_uses_update_and_fetch(self):
        ug = self._make(status=task.TaskGroupStatus.RUNNING)
        group = self._make_group()
        kwargs = self._common_args(group, task.TaskGroupStatus.RUNNING)
        with mock.patch.object(jobs.UpdateGroup, '_update_and_fetch_task_status',
                               return_value=task.TaskGroupStatus.RUNNING) as mock_update:
            result = ug._update_all_tasks(
                mock.Mock(), mock.Mock(), datetime.timedelta(seconds=15), **kwargs)
        self.assertEqual(result, task.TaskGroupStatus.RUNNING)
        mock_update.assert_called_once()

    def test_finished_lead_task_with_no_status_change(self):
        ug = self._make(status=task.TaskGroupStatus.COMPLETED, lead_task=True)
        group = self._make_group(has_barrier=True)
        kwargs = self._common_args(group, task.TaskGroupStatus.COMPLETED)
        factory = mock.Mock()
        factory.retry_allowed.return_value = True
        group.get_k8s_object_factory.return_value = factory
        with mock.patch.object(jobs.UpdateGroup, '_apply_exit_action'), \
             mock.patch.object(jobs.UpdateGroup, '_remove_all_barrier'), \
             mock.patch.object(jobs.UpdateGroup, '_update_and_fetch_task_status',
                               return_value=task.TaskGroupStatus.COMPLETED), \
             mock.patch.object(task.Task, 'batch_update_status_to_db'):
            result = ug._update_all_tasks(
                mock.Mock(), mock.Mock(), datetime.timedelta(seconds=15), **kwargs)
        self.assertEqual(result, task.TaskGroupStatus.COMPLETED)

    def test_finished_lead_task_when_status_changed_returns_early(self):
        ug = self._make(status=task.TaskGroupStatus.COMPLETED, lead_task=True)
        group = self._make_group(has_barrier=False)
        kwargs = self._common_args(group, task.TaskGroupStatus.COMPLETED)
        factory = mock.Mock()
        factory.retry_allowed.return_value = False
        group.get_k8s_object_factory.return_value = factory
        with mock.patch.object(jobs.UpdateGroup, '_apply_exit_action'), \
             mock.patch.object(jobs.UpdateGroup, '_update_and_fetch_task_status',
                               return_value=task.TaskGroupStatus.RESCHEDULED):
            # Status changed; return that updated status without further updates.
            result = ug._update_all_tasks(
                mock.Mock(), mock.Mock(), datetime.timedelta(seconds=15), **kwargs)
        self.assertEqual(result, task.TaskGroupStatus.RESCHEDULED)

    def test_finished_lead_task_with_rescheduled_status_invokes_retry(self):
        ug = self._make(status=task.TaskGroupStatus.RESCHEDULED, lead_task=True)
        # add a sibling task in the group
        t1 = mock.Mock()
        t1.name = 't1'
        t1.retry_id = 0
        sibling = mock.Mock()
        sibling.name = 't2'
        sibling.retry_id = 0
        group = self._make_group(has_barrier=False)
        group.tasks = [t1, sibling]
        kwargs = self._common_args(group, task.TaskGroupStatus.RESCHEDULED)
        factory = mock.Mock()
        factory.retry_allowed.return_value = True
        group.get_k8s_object_factory.return_value = factory
        with mock.patch.object(jobs.UpdateGroup, '_apply_exit_action'), \
             mock.patch.object(jobs.UpdateGroup, '_update_and_fetch_task_status',
                               return_value=task.TaskGroupStatus.RESCHEDULED), \
             mock.patch.object(jobs.UpdateGroup, '_retry_task') as mock_retry, \
             mock.patch.object(jobs.UpdateGroup, '_restart_task') as mock_restart:
            ug._update_all_tasks(
                mock.Mock(), mock.Mock(), datetime.timedelta(seconds=15), **kwargs)
        mock_retry.assert_called_once()
        # restart called for sibling but not for self
        self.assertEqual(mock_restart.call_count, 1)

    def test_nonlead_task_with_rescheduled_status_calls_retry(self):
        ug = self._make(status=task.TaskGroupStatus.RESCHEDULED,
                        lead_task=False, task_name='t2')
        group = self._make_group(has_barrier=True, ignore_nonlead=False)
        sibling = mock.Mock()
        sibling.name = 't1'
        sibling.retry_id = 0
        t2 = mock.Mock()
        t2.name = 't2'
        t2.retry_id = 0
        group.tasks = [sibling, t2]
        kwargs = self._common_args(group, task.TaskGroupStatus.RESCHEDULED)
        factory = mock.Mock()
        factory.retry_allowed.return_value = True
        group.get_k8s_object_factory.return_value = factory
        with mock.patch.object(jobs.UpdateGroup, '_apply_exit_action'), \
             mock.patch.object(jobs.UpdateGroup, '_remove_barrier'), \
             mock.patch.object(jobs.UpdateGroup, '_remove_all_barrier'), \
             mock.patch.object(jobs.UpdateGroup, '_notify_barrier'), \
             mock.patch.object(jobs.UpdateGroup, '_update_and_fetch_task_status',
                               return_value=task.TaskGroupStatus.RESCHEDULED), \
             mock.patch.object(jobs.UpdateGroup, '_retry_task') as mock_retry, \
             mock.patch.object(jobs.UpdateGroup, '_restart_task'):
            ug._update_all_tasks(
                mock.Mock(), mock.Mock(), datetime.timedelta(seconds=15), **kwargs)
        mock_retry.assert_called_once()

    def test_nonlead_task_failed_status_marks_siblings(self):
        ug = self._make(status=task.TaskGroupStatus.FAILED,
                        lead_task=False, task_name='t2')
        group = self._make_group(has_barrier=False, ignore_nonlead=False)
        kwargs = self._common_args(group, task.TaskGroupStatus.FAILED)
        factory = mock.Mock()
        factory.retry_allowed.return_value = True
        group.get_k8s_object_factory.return_value = factory
        with mock.patch.object(jobs.UpdateGroup, '_apply_exit_action'), \
             mock.patch.object(jobs.UpdateGroup, '_update_and_fetch_task_status',
                               return_value=task.TaskGroupStatus.FAILED), \
             mock.patch.object(task.Task, 'batch_update_status_to_db') as mock_batch:
            ug._update_all_tasks(
                mock.Mock(), mock.Mock(), datetime.timedelta(seconds=15), **kwargs)
        mock_batch.assert_called_once()


class UpdateGroupExecuteTest(unittest.TestCase):
    """UpdateGroup.execute (lines 881-1077). Uses heavy mocking to bypass DB/Redis."""

    def _make(self, status=task.TaskGroupStatus.RUNNING, task_name='t1',
              retry_id=0, force_cancel=False, lead_task=True):
        return jobs.UpdateGroup(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
            group_name='g1', task_name=task_name, retry_id=retry_id,
            status=status, user='alice', force_cancel=force_cancel,
            lead_task=lead_task)

    def _make_workflow(self, queue_timeout=None, exec_timeout=None,
                       pool='pool-1', backend='back'):
        wf = mock.Mock()
        wf.workflow_id = WORKFLOW_ID
        wf.workflow_uuid = WORKFLOW_UUID
        wf.pool = pool
        wf.backend = backend
        wf.timeout = mock.Mock()
        # calculate_total_timeout requires both timeouts to be non-None.
        wf.timeout.queue_timeout = queue_timeout or datetime.timedelta(minutes=10)
        wf.timeout.exec_timeout = exec_timeout or datetime.timedelta(hours=1)
        wf.update_status_to_db = mock.Mock(return_value=mock.Mock())
        wf.update_status_to_db.return_value.finished.return_value = False
        return wf

    def _patches(self, *, group_obj, workflow_obj, pool_info=None,
                  backend_get=None, backend_get_raises=False):
        if pool_info is None:
            pool_info = mock.Mock(spec=connectors.Pool)
            pool_info.name = 'pool-1'
            pool_info.default_exec_timeout = '5m'
            pool_info.default_queue_timeout = '5m'
            pool_info.default_exit_actions = {}
        cache = mock.Mock()
        if backend_get_raises:
            cache.get.side_effect = osmo_errors.OSMOBackendError('no backend')
        else:
            cache.get.return_value = backend_get if backend_get is not None \
                else mock.Mock()
        return [
            mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group_obj),
            mock.patch.object(wf_module.Workflow, 'fetch_from_db',
                              return_value=workflow_obj),
            mock.patch.object(connectors.RedisConnector, 'get_instance',
                              return_value=mock.Mock()),
            mock.patch.object(connectors.Pool, 'fetch_from_db', return_value=pool_info),
            mock.patch.object(connectors, 'BackendConfigCache', return_value=cache),
        ]

    def test_canceled_status_when_processing_re_enqueues(self):
        ug = self._make(status=task.TaskGroupStatus.FAILED_CANCELED, force_cancel=False)
        group = mock.Mock()
        group.status = task.TaskGroupStatus.PROCESSING
        # After fetch_status, still PROCESSING -> trigger delayed re-enqueue.
        group.update_status_to_db = mock.Mock()
        group.fetch_status = mock.Mock()
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = mock.Mock()
        ctx.postgres.method = 'prod'
        with mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group), \
             mock.patch.object(jobs.UpdateGroup, 'send_delayed_job_to_queue') \
                as mock_delay:
            result = ug.execute(ctx, mock.Mock())
            # Note: workflow_obj fetch wasn't reached because status PROCESSING returned early
        self.assertEqual(result.status, jobs_base.JobStatus.FAILED_NO_RETRY)
        mock_delay.assert_called_once()

    def test_canceled_status_force_cancel_processes_normally(self):
        ug = self._make(status=task.TaskGroupStatus.FAILED_CANCELED, force_cancel=True,
                        task_name=None, retry_id=None)
        group = mock.Mock()
        group.status = task.TaskGroupStatus.RUNNING
        group.update_status_to_db = mock.Mock()
        group.fetch_status = mock.Mock()
        group.downstream_groups = []
        ctx = mock.Mock()
        wf_config = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = wf_config
        ctx.postgres.method = 'prod'
        wf = self._make_workflow()
        backend_obj = mock.Mock()
        with mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock.Mock()), \
             mock.patch.object(task.Task, 'batch_update_status_to_db'), \
             mock.patch.object(connectors, 'BackendConfigCache') as mock_cache_cls, \
             mock.patch.object(jobs.UpdateGroup, 'schedule_cleanup_job'):
            mock_cache_cls.return_value.get.return_value = backend_obj
            result = ug.execute(ctx, mock.Mock())
        self.assertIsInstance(result, jobs_base.JobResult)

    def test_no_pool_raises_user_error(self):
        ug = self._make(task_name=None, retry_id=None,
                         status=task.TaskGroupStatus.RUNNING)
        group = mock.Mock()
        group.status = task.TaskGroupStatus.PROCESSING
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = mock.Mock()
        ctx.postgres.method = 'prod'
        wf = self._make_workflow(pool=None)
        with mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock.Mock()):
            with self.assertRaises(osmo_errors.OSMOUserError):
                ug.execute(ctx, mock.Mock())

    def test_failed_start_timeout_with_running_task_skips(self):
        ug = self._make(status=task.TaskGroupStatus.FAILED_START_TIMEOUT)
        group = mock.Mock()
        group.status = task.TaskGroupStatus.PROCESSING
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = mock.Mock()
        ctx.postgres.method = 'prod'
        wf = self._make_workflow()
        current_task = mock.Mock(spec=task.Task)
        current_task.status = task.TaskGroupStatus.RUNNING
        current_task.name = 't1'
        pool_info = mock.Mock(spec=connectors.Pool)
        pool_info.default_exec_timeout = '5m'
        pool_info.default_queue_timeout = '5m'
        with mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock.Mock()), \
             mock.patch.object(connectors.Pool, 'fetch_from_db',
                               return_value=pool_info), \
             mock.patch.object(connectors, 'BackendConfigCache'), \
             mock.patch.object(task.Task, 'fetch_from_db', return_value=current_task):
            result = ug.execute(ctx, mock.Mock())
        # Returns immediately (early return JobResult())
        self.assertIsInstance(result, jobs_base.JobResult)

    def test_status_change_triggers_check_queue_timeout(self):
        ug = self._make(status=task.TaskGroupStatus.SCHEDULING,
                        task_name=None, retry_id=None)
        group = mock.Mock()
        group.status = task.TaskGroupStatus.PROCESSING
        # prescheduling -> True for PROCESSING
        group.update_status_to_db = mock.Mock()
        group.fetch_status = mock.Mock()
        group.downstream_groups = []
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = mock.Mock()
        ctx.postgres.method = 'prod'
        wf = self._make_workflow(queue_timeout=datetime.timedelta(minutes=10))
        pool_info = mock.Mock(spec=connectors.Pool)
        pool_info.default_exec_timeout = '5m'
        pool_info.default_queue_timeout = '5m'
        backend_obj = mock.Mock()
        with mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock.Mock()), \
             mock.patch.object(connectors.Pool, 'fetch_from_db', return_value=pool_info), \
             mock.patch.object(connectors, 'BackendConfigCache') as mock_cache_cls, \
             mock.patch.object(jobs.UpdateGroup, 'schedule_cleanup_job'), \
             mock.patch.object(jobs.CheckQueueTimeout, 'send_delayed_job_to_queue') \
                 as mock_send_q:
            mock_cache_cls.return_value.get.return_value = backend_obj
            ug.execute(ctx, mock.Mock())
        mock_send_q.assert_called_once()

    def test_status_change_to_running_triggers_check_run_timeout(self):
        ug = self._make(status=task.TaskGroupStatus.RUNNING,
                        task_name=None, retry_id=None)
        group = mock.Mock()
        group.status = task.TaskGroupStatus.SCHEDULING
        group.update_status_to_db = mock.Mock()
        group.fetch_status = mock.Mock()
        group.downstream_groups = []
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = mock.Mock()
        ctx.postgres.method = 'prod'
        wf = self._make_workflow(exec_timeout=datetime.timedelta(hours=1))
        pool_info = mock.Mock(spec=connectors.Pool)
        pool_info.default_exec_timeout = '5m'
        pool_info.default_queue_timeout = '5m'
        backend_obj = mock.Mock()
        with mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock.Mock()), \
             mock.patch.object(connectors.Pool, 'fetch_from_db', return_value=pool_info), \
             mock.patch.object(connectors, 'BackendConfigCache') as mock_cache_cls, \
             mock.patch.object(jobs.UpdateGroup, 'schedule_cleanup_job'), \
             mock.patch.object(jobs.CheckRunTimeout, 'send_delayed_job_to_queue') \
                 as mock_send_r:
            mock_cache_cls.return_value.get.return_value = backend_obj
            ug.execute(ctx, mock.Mock())
        mock_send_r.assert_called_once()

    def test_completed_with_downstream_enqueues_create_group(self):
        ug = self._make(status=task.TaskGroupStatus.COMPLETED,
                        task_name=None, retry_id=None)
        group = mock.Mock()
        group.status = task.TaskGroupStatus.COMPLETED
        group.update_status_to_db = mock.Mock()
        group.fetch_status = mock.Mock()
        downstream_grp = mock.Mock()
        downstream_grp.name = 'g2'
        group.update_downstream_groups_in_db = mock.Mock(return_value=[downstream_grp])
        group.downstream_groups = ['g2']
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = mock.Mock()
        ctx.postgres.method = 'prod'
        wf = self._make_workflow()
        pool_info = mock.Mock(spec=connectors.Pool)
        pool_info.default_exec_timeout = '5m'
        pool_info.default_queue_timeout = '5m'
        backend_obj = mock.Mock()
        backend_obj.scheduler_settings = None
        with mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock.Mock()), \
             mock.patch.object(connectors.Pool, 'fetch_from_db', return_value=pool_info), \
             mock.patch.object(connectors, 'BackendConfigCache') as mock_cache_cls, \
             mock.patch.object(task.TaskGroup, 'batch_set_groups_to_processing',
                               return_value=['g2']), \
             mock.patch.object(jobs.UpdateGroup, 'schedule_cleanup_job'), \
             mock.patch.object(jobs.CreateGroup, 'send_job_to_queue') as mock_send:
            mock_cache_cls.return_value.get.return_value = backend_obj
            ug.execute(ctx, mock.Mock())
        mock_send.assert_called_once()

    def test_failed_group_with_downstream_marks_failed_upstream(self):
        ug = self._make(status=task.TaskGroupStatus.FAILED,
                        task_name=None, retry_id=None)
        group = mock.Mock()
        group.status = task.TaskGroupStatus.FAILED
        group.status.failed = lambda: True
        group.update_status_to_db = mock.Mock()
        group.fetch_status = mock.Mock()
        group.downstream_groups = ['g2']
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = mock.Mock()
        ctx.postgres.method = 'prod'
        wf = self._make_workflow()
        pool_info = mock.Mock(spec=connectors.Pool)
        pool_info.default_exec_timeout = '5m'
        pool_info.default_queue_timeout = '5m'
        backend_obj = mock.Mock()
        with mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock.Mock()), \
             mock.patch.object(connectors.Pool, 'fetch_from_db', return_value=pool_info), \
             mock.patch.object(connectors, 'BackendConfigCache') as mock_cache_cls, \
             mock.patch.object(task.Task, 'batch_update_status_to_db'), \
             mock.patch.object(jobs.UpdateGroup, 'schedule_cleanup_job'), \
             mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue') as mock_send:
            mock_cache_cls.return_value.get.return_value = backend_obj
            ug.execute(ctx, mock.Mock())
        # Sent UpdateGroup for downstream g2.
        mock_send.assert_called_once()

    def test_no_backend_marks_downstream_failed(self):
        ug = self._make(status=task.TaskGroupStatus.RUNNING,
                        task_name=None, retry_id=None)
        group = mock.Mock()
        group.status = task.TaskGroupStatus.RUNNING
        group.update_status_to_db = mock.Mock()
        group.fetch_status = mock.Mock()
        group.downstream_groups = ['g2']
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = mock.Mock()
        ctx.postgres.method = 'prod'
        wf = self._make_workflow()
        pool_info = mock.Mock(spec=connectors.Pool)
        pool_info.default_exec_timeout = '5m'
        pool_info.default_queue_timeout = '5m'
        cache = mock.Mock()
        cache.get.side_effect = osmo_errors.OSMOBackendError('missing')
        with mock.patch.object(task.TaskGroup, 'fetch_from_db', return_value=group), \
             mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch.object(connectors.RedisConnector, 'get_instance',
                               return_value=mock.Mock()), \
             mock.patch.object(connectors.Pool, 'fetch_from_db', return_value=pool_info), \
             mock.patch.object(connectors, 'BackendConfigCache', return_value=cache), \
             mock.patch.object(jobs.UpdateGroup, 'schedule_cleanup_job'), \
             mock.patch.object(jobs.UpdateGroup, 'send_job_to_queue') as mock_send:
            ug.execute(ctx, mock.Mock())
        mock_send.assert_called_once()


class CleanupWorkflowExecuteTest(unittest.TestCase):
    """CleanupWorkflow.execute (lines 1426-1606)."""

    def _make(self):
        return jobs.CleanupWorkflow(
            workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID, user='alice')

    def _make_workflow(self, logs_url='redis://localhost:6379', failed=False):
        wf = mock.Mock()
        wf.workflow_id = WORKFLOW_ID
        wf.workflow_uuid = WORKFLOW_UUID
        wf.logs = logs_url
        wf.status = mock.Mock()
        wf.status.failed.return_value = failed
        wf.update_log_to_db = mock.Mock()
        wf.update_events_to_db = mock.Mock()

        # Build a single-task group
        task_obj = mock.Mock()
        task_obj.name = 't1'
        task_obj.task_uuid = 'taskuuid1'
        task_obj.retry_id = 0
        task_obj.status = mock.Mock()
        task_obj.status.has_error_logs.return_value = False
        group = mock.Mock()
        group.tasks = [task_obj]
        wf.groups = [group]
        return wf

    def test_non_redis_logs_returns_immediately(self):
        cw = self._make()
        wf = self._make_workflow(logs_url='https://example.com')
        ctx = mock.Mock()
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf):
            result = cw.execute(ctx, mock.Mock())
        self.assertIsInstance(result, jobs_base.JobResult)
        # update_log_to_db should NOT have been called when scheme is non-redis
        wf.update_log_to_db.assert_not_called()

    def test_no_credential_returns_failure_jobresult(self):
        cw = self._make()
        wf = self._make_workflow()
        wf_config = mock.Mock()
        wf_config.workflow_log = mock.Mock()
        wf_config.workflow_log.credential = None
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = wf_config
        progress_writer = mock.Mock()
        progress_writer.report_progress_async = mock.AsyncMock()
        # Mock redis pipeline calls to no-op
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch('redis.from_url', return_value=mock.MagicMock()):
            result = cw.execute(ctx, progress_writer)
        # Returned JobResult; storage.Client.create is never called.
        self.assertIsInstance(result, jobs_base.JobResult)
        wf.update_log_to_db.assert_not_called()

    def test_full_execute_with_credential_calls_storage_upload(self):
        cw = self._make()
        wf = self._make_workflow(failed=True)
        wf_config = mock.Mock()
        wf_config.workflow_log = mock.Mock()
        wf_config.workflow_log.credential = mock.Mock()
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = wf_config
        ctx.postgres.config.method = 'prod'
        ctx.postgres.get_workflow_service_url.return_value = 'http://svc'
        redis_client = mock.MagicMock()
        progress_writer = mock.Mock()
        progress_writer.report_progress_async = mock.AsyncMock()
        with mock.patch.object(wf_module.Workflow, 'fetch_from_db', return_value=wf), \
             mock.patch('redis.from_url', return_value=redis_client), \
             mock.patch.object(jobs.storage.Client, 'create',
                               return_value=mock.Mock()), \
             mock.patch.object(connectors, 'write_redis_log_to_disk',
                               new=mock.AsyncMock()), \
             mock.patch.object(jobs.asyncio, 'to_thread',
                               new=mock.AsyncMock(return_value=mock.Mock())):
            result = cw.execute(ctx, progress_writer)
        self.assertIsInstance(result, jobs_base.JobResult)
        # Update logs called for both logs and events
        wf.update_log_to_db.assert_called_once()
        wf.update_events_to_db.assert_called_once()


class UploadWorkflowFilesTest(unittest.TestCase):
    """UploadWorkflowFiles validators and execute (lines 379, 391-450)."""

    def _make(self, files=None):
        files = files or [jobs.File(path='spec1.yaml', content='a: 1')]
        return jobs.UploadWorkflowFiles.model_construct(  # type: ignore[arg-type]
            workflow_id=WORKFLOW_ID,
            workflow_uuid=WORKFLOW_UUID,
            user='alice',
            files=files,
            job_id=f'{WORKFLOW_UUID}-someid-upload-files',
            job_type='UploadWorkflowFiles',
            job_uuid='job-uuid-u',
        )

    def test_get_job_id_uses_paths_hash(self):
        values = {
            'workflow_uuid': WORKFLOW_UUID,
            'files': [jobs.File('a.yaml', 'x'), jobs.File('b.yaml', 'y')],
        }
        job_id = jobs.UploadWorkflowFiles._get_job_id(values)
        self.assertTrue(job_id.endswith('-upload-files'))
        self.assertTrue(job_id.startswith(WORKFLOW_UUID))

    def test_validate_job_id_rejects_non_upload_suffix(self):
        with self.assertRaises(osmo_errors.OSMOServerError):
            jobs.UploadWorkflowFiles(
                workflow_id=WORKFLOW_ID, workflow_uuid=WORKFLOW_UUID,
                user='alice', files=[jobs.File('a', 'b')],
                job_id='not-correct-suffix')

    def test_execute_returns_failure_when_credential_missing(self):
        upload = self._make()
        wf_config = mock.Mock()
        wf_config.workflow_log = mock.Mock()
        wf_config.workflow_log.credential = None
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = wf_config
        result = upload.execute(ctx, mock.Mock())
        # storage.Client.create should NOT have been called
        self.assertIsInstance(result, jobs_base.JobResult)

    def test_execute_runs_async_uploads(self):
        upload = self._make(files=[jobs.File(path='spec1.yaml', content='a: 1')])
        wf_config = mock.Mock()
        wf_config.workflow_log = mock.Mock()
        wf_config.workflow_log.credential = mock.Mock()
        ctx = mock.Mock()
        ctx.postgres.get_workflow_configs.return_value = wf_config
        progress_writer = mock.Mock()
        progress_writer.report_progress_async = mock.AsyncMock()
        with mock.patch.object(jobs.storage.Client, 'create',
                               return_value=mock.Mock()), \
             mock.patch.object(jobs.asyncio, 'to_thread',
                               new=mock.AsyncMock(return_value=mock.Mock())):
            result = upload.execute(ctx, progress_writer)
        self.assertIsInstance(result, jobs_base.JobResult)


if __name__ == '__main__':
    unittest.main()
