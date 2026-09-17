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
import asyncio
import collections
import datetime
import json
import typing
import unittest
from unittest import mock

import fastapi

from src.lib.utils import osmo_errors
from src.service.logger import ctrl_websocket
from src.utils import connectors
from src.utils.job import task, workflow


WORKFLOW_ID = 'wf-1'
WORKFLOW_UUID = '11111111-1111-1111-1111-111111111111'
GROUP_NAME = 'group-a'
TASK_NAME = 'task-a'
RETRY_ID = 0
SECRET_VALUE = 's3cr3t'
BARRIER_KEY = f'client-connections:{WORKFLOW_ID}:{GROUP_NAME}:barrier-sync-1'
ACTION_QUEUE = f'client-connections:{WORKFLOW_ID}:{TASK_NAME}:{RETRY_ID}'


class _StubTimeout:
    """Stands in for workflow.TimeoutSpec."""

    def __init__(self):
        self.queue_timeout = datetime.timedelta(minutes=5)
        self.exec_timeout = datetime.timedelta(minutes=30)


class _StubWorkflow:
    """Only the workflow attributes ctrl_websocket.run_websocket reads."""

    def __init__(self):
        self.workflow_id = WORKFLOW_ID
        self.workflow_uuid = WORKFLOW_UUID
        self.user = 'alice'
        self.logs = 'redis://localhost:6379'
        self.timeout = _StubTimeout()


class _StubWorkflowConfig:
    """Stands in for the WORKFLOW config row returned by get_workflow_configs."""

    def __init__(self, task_heartbeat_frequency: str = '10m'):
        self.task_heartbeat_frequency = task_heartbeat_frequency
        self.max_log_lines = 100
        self.max_task_log_lines = 50


class _StubTask:
    """Stands in for task.Task rows fetched while notifying barrier members."""

    def __init__(self, name: str):
        self.name = name
        self.retry_id = RETRY_ID


class _FakeRedisClient:
    """Records every Redis call run_websocket and update_barrier make."""

    def __init__(self, smembers_result=None, brpop_results=None, get_result='{}'):
        self.smembers_result = set(smembers_result or [])
        self.brpop_results = collections.deque(brpop_results or [])
        self.get_result = get_result
        self.sadd_calls = []
        self.expire_calls = []
        self.smembers_keys = []
        self.set_calls = []
        self.lpush_calls = []
        self.xadd_calls = []
        self.brpop_queues = []
        self.get_keys = []

    async def sadd(self, key, member):
        self.sadd_calls.append((key, member))
        self.smembers_result.add(member.encode())

    async def expire(self, key, timeout, nx=False):
        self.expire_calls.append((key, timeout, nx))

    async def smembers(self, key):
        self.smembers_keys.append(key)
        return self.smembers_result

    async def set(self, key, value):
        self.set_calls.append((key, value))

    async def lpush(self, queue_name, key):
        self.lpush_calls.append((queue_name, key))

    async def xadd(self, name, fields, maxlen=None):
        self.xadd_calls.append((name, fields, maxlen))

    async def brpop(self, queue_name):
        self.brpop_queues.append(queue_name)
        if self.brpop_results:
            return (queue_name, self.brpop_results.popleft())
        await asyncio.get_running_loop().create_future()
        raise AssertionError('brpop future must never resolve')

    async def get(self, key):
        self.get_keys.append(key)
        return self.get_result


class _FakeRedisConnection:
    """Async context manager returned in place of redis.asyncio.from_url."""

    def __init__(self, client):
        self.client = client

    async def __aenter__(self):
        return self.client

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


class _FakeWebSocket:
    """Replays scripted messages, then reports a client disconnect."""

    def __init__(self, messages=None):
        self.messages = collections.deque(messages or [])
        self.accepted = False
        self.sent_texts = []
        self.closed_with = None

    async def accept(self):
        self.accepted = True

    async def receive_json(self):
        if self.messages:
            return self.messages.popleft()
        raise fastapi.WebSocketDisconnect(1000)

    async def send_text(self, text):
        self.sent_texts.append(text)

    async def close(self, code=1000, reason=''):
        self.closed_with = (code, reason)


class _ActionRelayWebSocket(_FakeWebSocket):
    """Stays open until the action relay has pushed one payload to the client."""

    def __init__(self):
        super().__init__()
        self.action_relayed = asyncio.Event()

    async def receive_json(self):
        await self.action_relayed.wait()
        raise fastapi.WebSocketDisconnect(1000)

    async def send_text(self, text):
        self.sent_texts.append(text)
        self.action_relayed.set()


async def _run_ingest(websocket) -> None:
    """Runs the ingest loop against a fake websocket the type checker would reject."""
    await asyncio.wait_for(ctrl_websocket.run_websocket(
        typing.cast(fastapi.WebSocket, websocket), WORKFLOW_ID, TASK_NAME, RETRY_ID),
        timeout=5)


def _log_message(text: str, io_type: str = 'STDOUT') -> str:
    """One osmo-ctrl log frame, exactly as it arrives over the websocket."""
    return json.dumps({
        'IOType': io_type,
        'Source': TASK_NAME,
        'Time': '2026-01-01T00:00:00',
        'Text': text,
    })


class TestMetricsOptionsValidation(unittest.TestCase):
    """Covers MetricsOptions.validate_single_field."""

    def test_metrics_options_with_only_group_metrics_keeps_field_set(self):
        options = ctrl_websocket.MetricsOptions(group_metrics={
            'retry_id': RETRY_ID,
            'type_of_metrics': 'input_download',
            'start_time': '2026-01-01T00:00:00',
            'end_time': '2026-01-01T00:01:00',
        })

        self.assertEqual(options.model_fields_set, {'group_metrics'})
        self.assertIsNone(options.task_io_metrics)

    def test_metrics_options_with_no_fields_raises_user_error(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            ctrl_websocket.MetricsOptions()

        self.assertIn('Exactly one of the following must be set', str(raised.exception))

    def test_metrics_options_with_both_fields_raises_user_error(self):
        both_fields = {
            'group_metrics': {
                'retry_id': RETRY_ID,
                'type_of_metrics': 'input_download',
                'start_time': '2026-01-01T00:00:00',
                'end_time': '2026-01-01T00:01:00',
            },
            'task_io_metrics': {
                'group_name': GROUP_NAME,
                'task_name': TASK_NAME,
                'retry_id': RETRY_ID,
                'url': '',
                'type': 'input',
                'start_time': '2026-01-01T00:00:00',
                'end_time': '2026-01-01T00:01:00',
                'size_in_bytes': 1024,
                'operation_type': 'download',
                'download_type': 'download',
            },
        }

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            ctrl_websocket.MetricsOptions(**both_fields)

        self.assertIn('Exactly one of the following must be set', str(raised.exception))


class TestUpdateMetrics(unittest.TestCase):
    """Covers both dispatch branches of ctrl_websocket.update_metrics."""

    def setUp(self):
        self.database = mock.MagicMock(spec=connectors.PostgresConnector)
        patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance', return_value=self.database)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_update_metrics_with_group_metrics_updates_input_download_columns(self):
        options = ctrl_websocket.MetricsOptions(group_metrics={
            'retry_id': RETRY_ID,
            'type_of_metrics': 'input_download',
            'start_time': '2026-01-01T00:00:00',
            'end_time': '2026-01-01T00:01:00',
        })

        ctrl_websocket.update_metrics(WORKFLOW_ID, TASK_NAME, options)

        command = self.database.execute_commit_command.call_args.args[0]
        parameters = self.database.execute_commit_command.call_args.args[1]
        self.assertIn('input_download_start_time', command)
        self.database.execute_commit_command.assert_called_once()
        self.assertEqual(parameters, (
            datetime.datetime(2026, 1, 1), datetime.datetime(2026, 1, 1, 0, 1),
            WORKFLOW_ID, TASK_NAME, RETRY_ID))

    def test_update_metrics_with_task_io_metrics_inserts_task_io_row(self):
        options = ctrl_websocket.MetricsOptions(task_io_metrics={
            'group_name': GROUP_NAME,
            'task_name': TASK_NAME,
            'retry_id': RETRY_ID,
            'url': '',
            'type': 'input',
            'start_time': '2026-01-01T00:00:00',
            'end_time': '2026-01-01T00:01:00',
            'size_in_bytes': 1024,
            'operation_type': 'download',
            'number_of_files': 3,
            'download_type': 'download',
        })

        ctrl_websocket.update_metrics(WORKFLOW_ID, TASK_NAME, options)

        command = self.database.execute_commit_command.call_args.args[0]
        parameters = self.database.execute_commit_command.call_args.args[1]
        self.assertIn('INSERT INTO task_io', command)
        self.database.execute_commit_command.assert_called_once()
        self.assertEqual(parameters[:4], (WORKFLOW_ID, GROUP_NAME, TASK_NAME, RETRY_ID))
        self.assertTrue(parameters[4])
        self.assertEqual(parameters[5:], (
            '', 'input', '', datetime.datetime(2026, 1, 1),
            datetime.datetime(2026, 1, 1, 0, 1), 1024 / 1024 ** 3,
            'download', 'download', 3))

    def test_update_metrics_with_unknown_group_metrics_type_raises(self):
        options = ctrl_websocket.MetricsOptions(group_metrics={
            'retry_id': RETRY_ID,
            'type_of_metrics': 'not-a-real-phase',
            'start_time': '2026-01-01T00:00:00',
            'end_time': '2026-01-01T00:01:00',
        })

        with self.assertRaises(osmo_errors.OSMOError) as raised:
            ctrl_websocket.update_metrics(WORKFLOW_ID, TASK_NAME, options)

        self.assertIn('Invalid metrics type', str(raised.exception))
        self.database.execute_commit_command.assert_not_called()


class TestUpdateBarrier(unittest.IsolatedAsyncioTestCase):
    """Covers barrier quorum accounting in ctrl_websocket.update_barrier."""

    def setUp(self):
        self.database = mock.MagicMock(spec=connectors.PostgresConnector)

    async def test_update_barrier_below_quorum_does_not_notify_members(self):
        redis_client = _FakeRedisClient(smembers_result=[b'task-a'])

        await ctrl_websocket.update_barrier(
            self.database, redis_client, WORKFLOW_ID, GROUP_NAME, TASK_NAME, 'sync-1',
            count=3, total_timeout=900)

        self.assertEqual(redis_client.sadd_calls, [(BARRIER_KEY, TASK_NAME)])
        self.assertEqual(redis_client.lpush_calls, [])
        self.assertEqual(redis_client.set_calls, [])

    async def test_update_barrier_at_quorum_notifies_every_member(self):
        redis_client = _FakeRedisClient(smembers_result=[b'task-a', b'task-b'])
        with mock.patch.object(task.Task, 'fetch_from_db',
                               side_effect=lambda _db, _wf, name: _StubTask(name)):
            await ctrl_websocket.update_barrier(
                self.database, redis_client, WORKFLOW_ID, GROUP_NAME, TASK_NAME, 'sync-1',
                count=2, total_timeout=900)

        notified_queues = [queue for queue, ignored_key in redis_client.lpush_calls]
        self.assertCountEqual(notified_queues, [
            f'client-connections:{WORKFLOW_ID}:task-a:{RETRY_ID}',
            f'client-connections:{WORKFLOW_ID}:task-b:{RETRY_ID}',
        ])
        self.assertEqual(len(redis_client.set_calls), 1)
        self.assertEqual(json.loads(redis_client.set_calls[0][1]), {'action': 'barrier'})
        action_key = redis_client.set_calls[0][0]
        self.assertEqual([key for ignored_queue, key in redis_client.lpush_calls],
                         [action_key, action_key])
        self.assertEqual(redis_client.expire_calls, [
            (BARRIER_KEY, 900, True), (action_key, 900, True)])

    async def test_update_barrier_nonpositive_count_waits_for_distinct_active_members(self):
        for count in (0, -1):
            with self.subTest(count=count):
                redis_client = _FakeRedisClient()
                with mock.patch.object(task.TaskGroup, 'fetch_active_group_size',
                                       return_value=2) as fetch_size, \
                     mock.patch.object(task.Task, 'fetch_from_db',
                                       side_effect=lambda _db, _wf, name: _StubTask(name)):
                    for member in (TASK_NAME, TASK_NAME):
                        await ctrl_websocket.update_barrier(
                            self.database, redis_client, WORKFLOW_ID, GROUP_NAME, member,
                            'sync-1', count=count, total_timeout=900)
                        self.assertEqual(redis_client.lpush_calls, [])
                    await ctrl_websocket.update_barrier(
                        self.database, redis_client, WORKFLOW_ID, GROUP_NAME, 'task-b',
                        'sync-1', count=count, total_timeout=900)

                self.assertEqual(fetch_size.call_args_list, [
                    mock.call(self.database, WORKFLOW_ID, GROUP_NAME)] * 3)
                self.assertCountEqual(
                    [queue for queue, ignored_key in redis_client.lpush_calls],
                    [ACTION_QUEUE, f'client-connections:{WORKFLOW_ID}:task-b:{RETRY_ID}'])


class TestRunWebSocket(unittest.IsolatedAsyncioTestCase):
    """Covers the osmo-ctrl ingest loop and the reverse action relay."""

    def setUp(self):
        self.database = mock.MagicMock(spec=connectors.PostgresConnector)
        self.workflow_config = _StubWorkflowConfig()
        self.database.get_workflow_configs.return_value = self.workflow_config
        self.redis_client = _FakeRedisClient()

        patchers = [
            mock.patch.object(
                connectors.PostgresConnector, 'get_instance', return_value=self.database),
            mock.patch.object(
                workflow.Workflow, 'fetch_from_db', return_value=_StubWorkflow()),
            mock.patch.object(task.Task, 'fetch_group_name', return_value=GROUP_NAME),
            mock.patch.object(
                task.TaskGroup, 'fetch_task_secrets', return_value={SECRET_VALUE}),
            mock.patch('redis.asyncio.from_url',
                       side_effect=lambda _url: _FakeRedisConnection(self.redis_client)),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    async def test_run_websocket_accepts_connection_and_handles_client_disconnect(self):
        websocket = _FakeWebSocket()

        await _run_ingest(websocket)

        self.assertTrue(websocket.accepted)
        self.assertIsNone(websocket.closed_with)

    async def test_run_websocket_masks_task_secrets_in_streamed_log_text(self):
        websocket = _FakeWebSocket([_log_message(f'token={SECRET_VALUE} accepted')])

        await _run_ingest(websocket)

        streamed_texts = [fields['text']
                          for ignored_name, fields, ignored_maxlen
                          in self.redis_client.xadd_calls]
        self.assertEqual(streamed_texts, ['token=[MASKED] accepted', 'token=[MASKED] accepted'])

    async def test_run_websocket_writes_log_to_workflow_and_task_streams(self):
        websocket = _FakeWebSocket([_log_message('hello world')])

        await _run_ingest(websocket)

        self.assertEqual(
            [(name, maxlen) for name, ignored_fields, maxlen in self.redis_client.xadd_calls],
            [(f'{WORKFLOW_ID}-logs', 100),
             (f'{WORKFLOW_ID}-{TASK_NAME}-{RETRY_ID}-logs', 50)])

    async def test_run_websocket_sets_log_stream_ttl_on_first_message(self):
        websocket = _FakeWebSocket([_log_message('first'), _log_message('second')])

        await _run_ingest(websocket)

        self.assertEqual(len(self.redis_client.xadd_calls), 4)
        self.assertEqual(self.redis_client.expire_calls, [
            (f'{WORKFLOW_ID}-logs', connectors.MAX_LOG_TTL, False),
            (f'{WORKFLOW_ID}-{TASK_NAME}-{RETRY_ID}-logs', connectors.MAX_LOG_TTL, False),
        ])

    async def test_run_websocket_records_heartbeat_for_workflow_log(self):
        websocket = _FakeWebSocket([_log_message('hello world')])

        await _run_ingest(websocket)

        command = self.database.execute_commit_command.call_args.args[0]
        parameters = self.database.execute_commit_command.call_args.args[1]
        self.assertIn('SET last_heartbeat', command)
        self.assertEqual(parameters[1:], (TASK_NAME, WORKFLOW_ID, RETRY_ID))

    async def test_run_websocket_throttles_heartbeats_until_frequency_elapses(self):
        websocket = _FakeWebSocket([_log_message('first'), _log_message('second'),
                                    _log_message('third')])
        started = datetime.datetime(2026, 1, 1)
        before_interval = started + datetime.timedelta(minutes=5)
        after_interval = started + datetime.timedelta(minutes=11)
        with mock.patch.object(ctrl_websocket, 'datetime', wraps=datetime) as clock:
            clock.datetime.now.side_effect = [
                started, started, before_interval, after_interval, after_interval]
            await _run_ingest(websocket)

        self.assertEqual(
            [call.args[1] for call in self.database.execute_commit_command.call_args_list],
            [(started, TASK_NAME, WORKFLOW_ID, RETRY_ID),
             (after_interval, TASK_NAME, WORKFLOW_ID, RETRY_ID)])
        self.assertEqual(len(self.redis_client.xadd_calls), 6)

    async def test_run_websocket_skips_heartbeat_for_ctrl_only_log(self):
        websocket = _FakeWebSocket([_log_message('starting', io_type='OSMO_CTRL')])

        await _run_ingest(websocket)

        self.database.execute_commit_command.assert_not_called()
        self.assertEqual(len(self.redis_client.xadd_calls), 2)

    async def test_run_websocket_with_invalid_heartbeat_frequency_still_streams_log(self):
        self.database.get_workflow_configs.return_value = _StubWorkflowConfig('not-a-duration')
        websocket = _FakeWebSocket([_log_message('hello world')])

        with self.assertLogs(level='ERROR') as captured:
            await _run_ingest(websocket)

        self.assertIn('Task heartbeat frequency has invalid value', '\n'.join(captured.output))
        self.assertEqual(len(self.redis_client.xadd_calls), 2)

    async def test_run_websocket_log_done_replies_with_log_done_action(self):
        websocket = _FakeWebSocket([json.dumps({'IOType': 'LOG_DONE'})])

        await _run_ingest(websocket)

        self.assertEqual(websocket.sent_texts, [json.dumps({'action': 'log_done'})])
        self.assertEqual(self.redis_client.xadd_calls, [])

    async def test_run_websocket_barrier_message_joins_barrier_set(self):
        websocket = _FakeWebSocket([
            json.dumps({'IOType': 'BARRIER', 'Name': 'sync-1', 'Count': 3})])

        await _run_ingest(websocket)

        self.assertEqual(self.redis_client.sadd_calls, [(BARRIER_KEY, TASK_NAME)])
        self.assertEqual(self.redis_client.lpush_calls, [])

    async def test_run_websocket_metrics_message_persists_group_metrics(self):
        metrics_message = json.dumps({
            'IOType': 'METRICS',
            'MetricType': 'group_metrics',
            'Metric': {
                'retry_id': RETRY_ID,
                'type_of_metrics': 'output_upload',
                'start_time': '2026-01-01T00:00:00',
                'end_time': '2026-01-01T00:01:00',
            },
        })
        websocket = _FakeWebSocket([metrics_message])

        await _run_ingest(websocket)

        command = self.database.execute_commit_command.call_args.args[0]
        self.assertIn('output_upload_start_time', command)
        self.assertEqual(self.redis_client.xadd_calls, [])

    async def test_run_websocket_malformed_metrics_message_logs_error(self):
        metrics_message = json.dumps({
            'IOType': 'METRICS',
            'MetricType': 'group_metrics',
            'Metric': {'type_of_metrics': 'output_upload'},
        })
        websocket = _FakeWebSocket([metrics_message])

        with self.assertLogs(level='ERROR') as captured:
            await _run_ingest(websocket)

        self.assertIn('Error updating metrics', '\n'.join(captured.output))
        self.database.execute_commit_command.assert_not_called()

    async def test_run_websocket_relays_queued_action_to_client(self):
        self.redis_client.brpop_results.append('barrier-key-1')
        self.redis_client.get_result = json.dumps({'action': 'exec'})
        websocket = _ActionRelayWebSocket()

        await _run_ingest(websocket)

        self.assertEqual(websocket.sent_texts, [json.dumps({'action': 'exec'})])
        self.assertEqual(self.redis_client.brpop_queues[0], ACTION_QUEUE)
        self.assertEqual(self.redis_client.get_keys, ['barrier-key-1'])

    async def test_run_websocket_database_error_closes_with_code_4000(self):
        websocket = _FakeWebSocket()
        with mock.patch.object(
                workflow.Workflow, 'fetch_from_db',
                side_effect=osmo_errors.OSMODatabaseError('workflow wf-1 not found')):
            await _run_ingest(websocket)

        self.assertEqual(websocket.closed_with, (4000, 'workflow wf-1 not found'))


if __name__ == '__main__':
    unittest.main()
