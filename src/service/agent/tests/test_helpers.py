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
import datetime
import json
import types
import unittest
from typing import Any, Dict, List
from unittest import mock

import fastapi

from src.lib.utils import common
from src.lib.utils import logging as utils_logging
from src.lib.utils import osmo_errors
from src.service.agent import helpers as agent_helpers
from src.service.core.config import helpers as config_helpers
from src.service.core.workflow import objects as workflow_objects
from src.utils import backend_messages, connectors
from src.utils.job import backend_jobs, jobs, task
from src.utils.metrics import metrics


WORKFLOW_UUID = 'a7cce9b153fd4e33b0ad363eed207316'
BACKEND_NAME = 'test-backend'
EVENT_TIME = datetime.datetime(2026, 1, 2, 3, 4, 5)
INIT_BODY = {
    'k8s_uid': 'k8s-uid-1',
    'k8s_namespace': 'osmo',
    'version': '1.2.3',
    'node_condition_prefix': 'osmo.nvidia.com/',
}


class _FakePostgres:
    """PostgresConnector double that replays queued fetch results."""

    def __init__(self, fetch_results: List[Any] | None = None, service_hostname: str = ''):
        self.config = types.SimpleNamespace(service_hostname=service_hostname)
        self._fetch_results = list(fetch_results) if fetch_results else []
        self.fetch_calls: List[Any] = []
        self.commit_calls: List[Any] = []
        self.service_config = types.SimpleNamespace(agent_queue_size=16,
                                                    max_pod_restart_limit='5m')
        self.workflow_config = types.SimpleNamespace(max_event_log_lines=500)

    def execute_fetch_command(self, cmd, params=None, as_dict=False):
        """Records the query and returns the next queued result set."""
        self.fetch_calls.append((cmd, params, as_dict))
        if self._fetch_results:
            return self._fetch_results.pop(0)
        return []

    def execute_commit_command(self, cmd, params=None):
        """Records a write query."""
        self.commit_calls.append((cmd, params))

    @classmethod
    def encode_hstore(cls, key_val_data: Dict) -> str:
        """Mirrors PostgresConnector.encode_hstore with a stable ordering."""
        return ','.join(f'{key}=>{value}' for key, value in sorted(key_val_data.items()))

    def get_service_configs(self):
        """Returns the static service config double."""
        return self.service_config

    def get_workflow_configs(self):
        """Returns the static workflow config double."""
        return self.workflow_config


class _FakeRedisClient:
    """Synchronous redis client double recording stream and key operations."""

    def __init__(self):
        self._stored: Dict[str, Any] = {}
        self.xadds: List[Any] = []
        self.sets: List[Any] = []
        self.expires: List[Any] = []

    def get(self, key):
        """Returns a previously stored value or None."""
        return self._stored.get(key)

    def set(self, key, value):
        """Stores a value and records the write."""
        self._stored[key] = value
        self.sets.append((key, value))

    def xadd(self, name, fields, maxlen=None):
        """Records a stream append."""
        self.xadds.append((name, fields, maxlen))

    def expire(self, name, ttl, nx=False):
        """Records an expiry update."""
        self.expires.append((name, ttl, nx))


class _FakeMeter:
    """MetricCreator double recording counter and histogram submissions."""

    def __init__(self):
        self.counters: List[Any] = []
        self.histograms: List[Any] = []

    def send_counter(self, **kwargs):
        """Records a counter submission."""
        self.counters.append(kwargs)

    def send_histogram(self, **kwargs):
        """Records a histogram submission."""
        self.histograms.append(kwargs)


class _FakeWebsocket:
    """fastapi WebSocket double that replays queued receive_json payloads."""

    def __init__(self, messages: List[Any], receive_error: BaseException | None = None):
        self.accepted = False
        self.sent: List[str] = []
        self.closed: Any = None
        self.frame_sent = asyncio.Event()
        self.messages_drained = asyncio.Event()
        self._messages = list(messages)
        self._receive_error = receive_error

    async def accept(self):
        """Marks the connection as accepted."""
        self.accepted = True

    async def receive_json(self):
        """Pops the next queued payload, then raises or idles forever."""
        if self._messages:
            return self._messages.pop(0)
        self.messages_drained.set()
        if self._receive_error is not None:
            raise self._receive_error
        await asyncio.Event().wait()
        return {}

    async def send_text(self, text):
        """Records an outbound frame."""
        self.sent.append(text)
        self.frame_sent.set()

    async def close(self, code=1000, reason=''):
        """Records the close code and reason."""
        self.closed = (code, reason)


class _FakeAsyncRedis:
    """redis.asyncio client double that replays queued brpop outcomes."""

    def __init__(self, outcomes: List[Any]):
        self._outcomes = list(outcomes)
        self.brpop_calls: List[str] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def brpop(self, queue_name):
        """Returns the next queued outcome, raising it when it is an exception."""
        self.brpop_calls.append(queue_name)
        if not self._outcomes:
            raise fastapi.WebSocketDisconnect(code=1000)
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class _FakeNodeConditions:
    """Stands in for BackendNodeConditions on a fetched backend."""

    def __init__(self, rules: Dict[str, str]):
        self._rules = rules

    def model_dump(self):
        """Returns the serialized node conditions."""
        return {'rules': self._rules, 'prefix': 'osmo.nvidia.com/'}


def _postgres(fetch_results: List[Any] | None = None, service_hostname: str = '') -> Any:
    """Builds a PostgresConnector double."""
    return _FakePostgres(fetch_results=fetch_results, service_hostname=service_hostname)


def _websocket(messages: List[Any] | None = None,
               receive_error: BaseException | None = None) -> Any:
    """Builds a fastapi WebSocket double."""
    return _FakeWebsocket(messages if messages is not None else [],
                          receive_error=receive_error)


def _k8s_rows(k8s_uid: str = 'k8s-uid-1', is_new: bool = True) -> List[Any]:
    """Builds the row list returned by the backend upsert query."""
    return [types.SimpleNamespace(k8s_uid=k8s_uid, is_new=is_new)]


def _update_rows(did_update: bool = False) -> List[Any]:
    """Builds the row list returned by the backend update query."""
    return [types.SimpleNamespace(did_update=did_update)]


def _task_row(**overrides) -> Dict[str, Any]:
    """Builds a task row as returned by the task lookup queries."""
    row: Dict[str, Any] = {
        'task_db_key': 'task-db-key',
        'workflow_id': 'wf-1',
        'workflow_uuid': WORKFLOW_UUID,
        'group_name': 'group-a',
        'name': 'task-a',
        'retry_id': 0,
        'lead': True,
        'node_name': 'node-1',
        'pod_ip': '10.0.0.5',
        'submitted_by': 'alice',
    }
    row.update(overrides)
    return row


def _message(message_type: str, body: Dict[str, Any], uuid: str = 'msg-uuid') -> Dict[str, Any]:
    """Builds a raw backend listener message payload."""
    return {'type': message_type, 'body': body, 'uuid': uuid}


async def _run_until(coroutine, signal: asyncio.Event) -> None:
    """Runs coroutine as a task until signal fires, then cancels and awaits it."""
    running = asyncio.create_task(coroutine)
    await asyncio.wait_for(signal.wait(), timeout=15)
    running.cancel()
    await asyncio.gather(running, return_exceptions=True)


async def _run_listener_until_acked(websocket) -> None:
    """Runs backend_listener_impl until it acknowledges a dispatched message."""
    await _run_until(agent_helpers.backend_listener_impl(websocket, BACKEND_NAME),
                     websocket.frame_sent)


async def _run_listener_until_idle(websocket) -> None:
    """Runs backend_listener_impl until the connection runs out of messages."""
    await _run_until(agent_helpers.backend_listener_impl(websocket, BACKEND_NAME),
                     websocket.messages_drained)


class PatchingTestCase(unittest.TestCase):
    """Base class offering self-cleaning patch helpers."""

    def start_patch(self, target, attribute, replacement):
        """Replaces an attribute for the duration of the test."""
        patcher = mock.patch.object(target, attribute, replacement)
        mocked = patcher.start()
        self.addCleanup(patcher.stop)
        return mocked

    def start_method_patch(self, target, attribute):
        """Replaces a method, recording the instance as the first call argument."""
        patcher = mock.patch.object(target, attribute, autospec=True)
        mocked = patcher.start()
        self.addCleanup(patcher.stop)
        return mocked


class GetTaskInfoTest(PatchingTestCase):
    """Covers get_task_info row selection and the missing-task error."""

    def test_returns_first_row_for_the_requested_task(self):
        postgres = _postgres(fetch_results=[[_task_row(), _task_row(name='task-b')]])

        task_info = agent_helpers.get_task_info(postgres, WORKFLOW_UUID, 'task-uuid-1', 2)

        self.assertEqual(task_info['name'], 'task-a')
        self.assertEqual(postgres.fetch_calls[0][1], (WORKFLOW_UUID, 'task-uuid-1', 2))
        self.assertTrue(postgres.fetch_calls[0][2])

    def test_raises_database_error_when_the_task_is_missing(self):
        postgres = _postgres(fetch_results=[[]])

        with self.assertRaises(osmo_errors.OSMODatabaseError) as context:
            agent_helpers.get_task_info(postgres, WORKFLOW_UUID, 'task-uuid-1', 0)

        self.assertIn('No tasks were found for task uuid task-uuid-1', context.exception.message)


class CreateBackendTest(PatchingTestCase):
    """Covers create_backend router address derivation and history entries."""

    def setUp(self):
        self.fetched_backend = types.SimpleNamespace(name=BACKEND_NAME)
        self.start_patch(connectors.Backend, 'fetch_from_db',
                         mock.Mock(return_value=self.fetched_backend))
        self.update_queues = self.start_patch(config_helpers, 'update_backend_queues', mock.Mock())
        self.create_history = self.start_patch(
            config_helpers, 'create_backend_config_history_entry', mock.Mock())
        self.init_body = backend_messages.InitBody(**INIT_BODY)

    def test_derives_the_router_address_from_the_service_hostname_url(self):
        postgres = _postgres(fetch_results=[_k8s_rows(), _update_rows()],
                             service_hostname='https://osmo.example.com/api')

        agent_helpers.create_backend(postgres, BACKEND_NAME, self.init_body)

        self.assertEqual(postgres.fetch_calls[0][1][9], 'wss://osmo.example.com')

    def test_derives_the_router_address_from_a_bare_service_hostname(self):
        postgres = _postgres(fetch_results=[_k8s_rows(), _update_rows()],
                             service_hostname='osmo-internal')

        agent_helpers.create_backend(postgres, BACKEND_NAME, self.init_body)

        self.assertEqual(postgres.fetch_calls[0][1][9], 'wss://osmo-internal')

    def test_leaves_the_router_address_empty_without_a_service_hostname(self):
        postgres = _postgres(fetch_results=[_k8s_rows(), _update_rows()])

        agent_helpers.create_backend(postgres, BACKEND_NAME, self.init_body)

        self.assertEqual(postgres.fetch_calls[0][1][9], '')

    def test_raises_backend_error_when_another_cluster_owns_the_name(self):
        postgres = _postgres(fetch_results=[_k8s_rows(k8s_uid='other-uid')])

        with self.assertRaises(osmo_errors.OSMOBackendError) as context:
            agent_helpers.create_backend(postgres, BACKEND_NAME, self.init_body)

        self.assertIn('is already being used by a different cluster', context.exception.message)

    def test_records_a_create_history_entry_for_a_new_backend(self):
        postgres = _postgres(fetch_results=[_k8s_rows(is_new=True), _update_rows()])

        agent_helpers.create_backend(postgres, BACKEND_NAME, self.init_body)

        self.create_history.assert_called_once_with(
            postgres, BACKEND_NAME, 'system', f'Create backend {BACKEND_NAME}', [])

    def test_records_an_update_history_entry_when_the_backend_changed(self):
        postgres = _postgres(
            fetch_results=[_k8s_rows(is_new=False), _update_rows(did_update=True)])

        agent_helpers.create_backend(postgres, BACKEND_NAME, self.init_body)

        self.assertIn('Update backend test-backend', self.create_history.call_args[0][3])

    def test_skips_the_history_entry_when_nothing_changed(self):
        postgres = _postgres(
            fetch_results=[_k8s_rows(is_new=False), _update_rows(did_update=False)])

        agent_helpers.create_backend(postgres, BACKEND_NAME, self.init_body)

        self.create_history.assert_not_called()

    def test_updates_the_backend_queues_with_the_pre_update_snapshot(self):
        postgres = _postgres(fetch_results=[_k8s_rows(), _update_rows()])

        agent_helpers.create_backend(postgres, BACKEND_NAME, self.init_body)

        self.update_queues.assert_called_once_with(self.fetched_backend, self.fetched_backend)


class QueueUpdateGroupJobTest(PatchingTestCase):
    """Covers queue_update_group_job field persistence and job creation."""

    def setUp(self):
        self.send_update = self.start_method_patch(jobs.UpdateGroup, 'send_job_to_queue')
        self.send_label = self.start_method_patch(backend_jobs.LabelNode, 'send_job_to_queue')

    def _update_pod(self, **overrides) -> backend_messages.UpdatePodBody:
        body: Dict[str, Any] = {
            'workflow_uuid': WORKFLOW_UUID,
            'task_uuid': 'task-uuid-1',
            'retry_id': 0,
            'container': 'osmo-user',
            'status': 'RUNNING',
            'backend': BACKEND_NAME,
        }
        body.update(overrides)
        return backend_messages.UpdatePodBody(**body)

    def test_persists_the_node_name_when_the_task_has_none(self):
        postgres = _postgres(fetch_results=[[_task_row(node_name='')]])

        agent_helpers.queue_update_group_job(postgres, self._update_pod(node='node-7'))

        self.assertEqual(postgres.commit_calls[0][1], ('node-7', 'task-db-key'))

    def test_keeps_the_existing_node_name_when_already_recorded(self):
        postgres = _postgres(fetch_results=[[_task_row(node_name='node-1')]])

        agent_helpers.queue_update_group_job(postgres, self._update_pod(node='node-7'))

        self.assertEqual(postgres.commit_calls, [])

    def test_persists_the_pod_ip_when_the_task_has_none(self):
        postgres = _postgres(fetch_results=[[_task_row(pod_ip='')]])

        agent_helpers.queue_update_group_job(postgres, self._update_pod(pod_ip='10.1.2.3'))

        self.assertEqual(postgres.commit_calls[0][1], ('10.1.2.3', 'task-db-key'))

    def test_queues_a_node_label_job_when_the_preflight_test_failed(self):
        postgres = _postgres(fetch_results=[[_task_row()]])

        agent_helpers.queue_update_group_job(
            postgres, self._update_pod(exit_code=task.ExitCode.FAILED_PREFLIGHT.value))

        label_job = self.send_label.call_args[0][0]
        self.assertEqual(label_job.node_name, 'node-1')
        self.assertEqual(label_job.labels['osmo.reason'], 'PreflightTestFailed')
        self.assertEqual(label_job.labels['osmo.verified'], 'False')

    def test_skips_the_node_label_job_for_other_exit_codes(self):
        postgres = _postgres(fetch_results=[[_task_row()]])

        agent_helpers.queue_update_group_job(postgres, self._update_pod(exit_code=0))

        self.send_label.assert_not_called()

    def test_queues_an_update_group_job_from_the_task_row(self):
        postgres = _postgres(fetch_results=[[_task_row()]])

        agent_helpers.queue_update_group_job(
            postgres, self._update_pod(status='COMPLETED', message='done'))

        update_job = self.send_update.call_args[0][0]
        self.assertEqual(update_job.status, task.TaskGroupStatus.COMPLETED)
        self.assertEqual(update_job.group_name, 'group-a')
        self.assertEqual(update_job.task_name, 'task-a')
        self.assertEqual(update_job.user, 'alice')
        self.assertEqual(update_job.message, 'done')


class UpdateResourceUsageTest(PatchingTestCase):
    """Covers update_resource_usage column encoding."""

    def test_writes_encoded_usage_fields_for_the_resource(self):
        postgres = _postgres()
        message = backend_messages.ResourceUsageBody(
            hostname='node-1',
            usage_fields={'cpu': '2'},
            non_workflow_usage_fields={'cpu': '1'})

        agent_helpers.update_resource_usage(postgres, BACKEND_NAME, message)

        self.assertEqual(postgres.commit_calls[0][1],
                         ('node-1', BACKEND_NAME, 'cpu=>2', 'cpu=>1', 'cpu=>2', 'cpu=>1'))


class DeleteResourceTest(PatchingTestCase):
    """Covers delete_resource cleanup and failure jobs for affected tasks."""

    def setUp(self):
        self.send_update = self.start_method_patch(jobs.UpdateGroup, 'send_job_to_queue')
        self.message = backend_messages.DeleteResourceBody(resource='node-1')

    def test_deletes_the_resource_row_for_the_backend(self):
        postgres = _postgres(fetch_results=[[]])

        agent_helpers.delete_resource(postgres, BACKEND_NAME, self.message)

        self.assertEqual(postgres.commit_calls[0][1], ('node-1', BACKEND_NAME))

    def test_fails_tasks_that_were_running_on_the_removed_node(self):
        postgres = _postgres(fetch_results=[[_task_row()]])

        agent_helpers.delete_resource(postgres, BACKEND_NAME, self.message)

        update_job = self.send_update.call_args[0][0]
        self.assertEqual(update_job.status, task.TaskGroupStatus.FAILED_BACKEND_ERROR)
        self.assertEqual(update_job.exit_code, task.ExitCode.FAILED_BACKEND_ERROR.value)
        self.assertIn('Node got removed from the cluster', update_job.message)

    def test_queues_no_failure_jobs_when_no_tasks_used_the_node(self):
        postgres = _postgres(fetch_results=[[]])

        agent_helpers.delete_resource(postgres, BACKEND_NAME, self.message)

        self.send_update.assert_not_called()


class CleanResourcesTest(PatchingTestCase):
    """Covers clean_resources stale node removal."""

    def test_deletes_resources_missing_from_the_reported_node_hashes(self):
        postgres = _postgres(fetch_results=[[{'name': 'node-1'}, {'name': 'node-2'}]])

        agent_helpers.clean_resources(
            postgres, BACKEND_NAME, backend_messages.NodeBody(node_hashes=['node-1']))

        self.assertEqual(postgres.commit_calls[0][1], (('node-2',), BACKEND_NAME))

    def test_deletes_nothing_when_every_resource_is_still_reported(self):
        postgres = _postgres(fetch_results=[[{'name': 'node-1'}]])

        agent_helpers.clean_resources(
            postgres, BACKEND_NAME, backend_messages.NodeBody(node_hashes=['node-1']))

        self.assertEqual(postgres.commit_calls, [])


class CleanTasksTest(PatchingTestCase):
    """Covers clean_tasks query narrowing and failure jobs."""

    def setUp(self):
        self.send_update = self.start_method_patch(jobs.UpdateGroup, 'send_job_to_queue')

    def test_excludes_the_reported_tasks_from_the_lookup(self):
        postgres = _postgres(fetch_results=[[]])

        agent_helpers.clean_tasks(
            postgres, BACKEND_NAME, backend_messages.TaskListBody(task_list=['task-uuid-1']))

        self.assertIn('AND tasks.task_uuid not in %s', postgres.fetch_calls[0][0])
        self.assertEqual(postgres.fetch_calls[0][1][2], ('task-uuid-1',))

    def test_looks_up_every_backend_task_when_none_are_reported(self):
        postgres = _postgres(fetch_results=[[]])

        agent_helpers.clean_tasks(postgres, BACKEND_NAME,
                                  backend_messages.TaskListBody(task_list=[]))

        self.assertNotIn('AND tasks.task_uuid not in %s', postgres.fetch_calls[0][0])
        self.assertEqual(len(postgres.fetch_calls[0][1]), 2)

    def test_fails_tasks_whose_pods_vanished_while_the_agent_was_down(self):
        postgres = _postgres(fetch_results=[[_task_row()]])

        agent_helpers.clean_tasks(postgres, BACKEND_NAME,
                                  backend_messages.TaskListBody(task_list=[]))

        update_job = self.send_update.call_args[0][0]
        self.assertEqual(update_job.status, task.TaskGroupStatus.FAILED_BACKEND_ERROR)
        self.assertEqual(update_job.message, 'Pod was deleted while backend agents were down')


class SendMetricsTest(PatchingTestCase):
    """Covers send_metrics dispatch by metric type."""

    def setUp(self):
        self.meter = _FakeMeter()
        self.start_patch(metrics.MetricCreator, 'get_meter_instance',
                         mock.Mock(return_value=self.meter))

    def _metrics_body(self, metrics_type: backend_messages.MetricsType):
        return backend_messages.MetricsBody(
            type=metrics_type, value=2.5, name='osmo_test_metric', unit='count',
            description='a test metric')

    def test_sends_a_counter_tagged_with_the_backend(self):
        agent_helpers.send_metrics(self._metrics_body(backend_messages.MetricsType.COUNTER),
                                   BACKEND_NAME)

        self.assertEqual(self.meter.counters[0]['name'], 'osmo_test_metric')
        self.assertEqual(self.meter.counters[0]['tags'], {'backend': BACKEND_NAME})
        self.assertEqual(self.meter.histograms, [])

    def test_sends_a_histogram_tagged_with_the_backend(self):
        agent_helpers.send_metrics(self._metrics_body(backend_messages.MetricsType.HISTOGRAM),
                                   BACKEND_NAME)

        self.assertEqual(self.meter.histograms[0]['value'], 2.5)
        self.assertEqual(self.meter.counters, [])


class LogTest(PatchingTestCase):
    """Covers the log helper delegating to the backend logger."""

    def test_logs_the_message_text_with_the_workflow_uuid(self):
        logger = mock.Mock()
        self.start_patch(utils_logging, 'get_backend_logger', mock.Mock(return_value=logger))
        message = backend_messages.LoggingBody(
            type=backend_messages.LoggingType.WARNING, text='pod evicted',
            workflow_uuid=WORKFLOW_UUID)

        agent_helpers.log('backend_listener', BACKEND_NAME, utils_logging.LoggingConfig(), message)

        logger.log.assert_called_once_with(
            backend_messages.LoggingType.WARNING.value, 'pod evicted',
            extra={'workflow_uuid': WORKFLOW_UUID})


class CreateMonitorJobTest(PatchingTestCase):
    """Covers create_monitor_job start-timeout job scheduling."""

    def test_delays_a_start_timeout_job_by_the_pod_restart_limit(self):
        send_delayed = self.start_method_patch(jobs.UpdateGroup, 'send_delayed_job_to_queue')
        postgres = _postgres(fetch_results=[[_task_row()]])
        message = backend_messages.MonitorPodBody(
            workflow_uuid=WORKFLOW_UUID, task_uuid='task-uuid-1', retry_id=0,
            message='pod never started')

        agent_helpers.create_monitor_job(postgres, message)

        update_job = send_delayed.call_args[0][0]
        self.assertEqual(update_job.status, task.TaskGroupStatus.FAILED_START_TIMEOUT)
        self.assertEqual(update_job.message, 'pod never started')
        self.assertEqual(send_delayed.call_args[0][1], datetime.timedelta(minutes=5))


class KeepPodConditionsTest(unittest.TestCase):
    """Covers the pod condition filter."""

    def _condition(self, condition_type: str, status: str):
        return backend_messages.ConditionMessage(
            timestamp=EVENT_TIME, status=status, type=condition_type)

    def test_drops_containers_ready_conditions(self):
        self.assertFalse(agent_helpers.keep_pod_conditions(
            self._condition('ContainersReady', 'True')))

    def test_drops_unready_ready_conditions(self):
        self.assertFalse(agent_helpers.keep_pod_conditions(self._condition('Ready', 'False')))

    def test_drops_uninitialized_conditions(self):
        self.assertFalse(agent_helpers.keep_pod_conditions(
            self._condition('Initialized', 'False')))

    def test_keeps_ready_conditions(self):
        self.assertTrue(agent_helpers.keep_pod_conditions(self._condition('Ready', 'True')))

    def test_keeps_unscheduled_conditions(self):
        self.assertTrue(agent_helpers.keep_pod_conditions(
            self._condition('PodScheduled', 'False')))


class SendPodConditionsTest(PatchingTestCase):
    """Covers send_pod_conditions event stream writes and timestamp dedup."""

    def setUp(self):
        self.redis_client = _FakeRedisClient()
        self.start_patch(
            connectors.RedisConnector, 'get_instance',
            mock.Mock(return_value=types.SimpleNamespace(client=self.redis_client)))
        self.stream_name = common.get_workflow_events_redis_name(WORKFLOW_UUID)
        self.timestamp_key = f'pod_conditions:{WORKFLOW_UUID}:task-a:latest_timestamp'

    def _conditions_body(self, conditions: List[Any], retry_id: int = 0):
        return backend_messages.PodConditionsBody(
            workflow_uuid=WORKFLOW_UUID, task_uuid='task-uuid-1', retry_id=retry_id,
            conditions=conditions)

    def _condition(self, **overrides):
        body: Dict[str, Any] = {'timestamp': EVENT_TIME, 'status': 'True', 'type': 'Ready'}
        body.update(overrides)
        return backend_messages.ConditionMessage(**body)

    def test_raises_database_error_when_the_task_is_missing(self):
        postgres = _postgres(fetch_results=[[]])

        with self.assertRaises(osmo_errors.OSMODatabaseError) as context:
            agent_helpers.send_pod_conditions(postgres, self._conditions_body([]), 500)

        self.assertIn('No tasks were found for task uuid task-uuid-1', context.exception.message)

    def test_appends_a_new_condition_to_the_workflow_event_stream(self):
        postgres = _postgres(fetch_results=[[{'name': 'task-a'}]])

        agent_helpers.send_pod_conditions(
            postgres, self._conditions_body([self._condition()]), 500)

        stream, fields, maxlen = self.redis_client.xadds[0]
        self.assertEqual(stream, self.stream_name)
        self.assertEqual(fields['text'], f'{EVENT_TIME} [task-a] Ready: True')
        self.assertEqual(maxlen, 500)

    def test_labels_the_condition_with_the_retry_number(self):
        postgres = _postgres(fetch_results=[[{'name': 'task-a'}]])

        agent_helpers.send_pod_conditions(
            postgres, self._conditions_body([self._condition()], retry_id=2), 500)

        self.assertEqual(self.redis_client.xadds[0][1]['text'],
                         f'{EVENT_TIME} [task-a retry-2] Ready: True')

    def test_appends_the_reason_and_message_when_both_are_present(self):
        postgres = _postgres(fetch_results=[[{'name': 'task-a'}]])

        agent_helpers.send_pod_conditions(
            postgres,
            self._conditions_body([self._condition(reason='Unschedulable', message='no gpus')]),
            500)

        self.assertIn(', Reason: Unschedulable, Message: no gpus',
                      self.redis_client.xadds[0][1]['text'])

    def test_records_the_condition_timestamp_for_later_deduplication(self):
        postgres = _postgres(fetch_results=[[{'name': 'task-a'}]])

        agent_helpers.send_pod_conditions(
            postgres, self._conditions_body([self._condition()]), 500)

        self.assertEqual(self.redis_client.sets,
                         [(self.timestamp_key, EVENT_TIME.timestamp())])
        self.assertEqual(self.redis_client.expires,
                         [(self.timestamp_key, connectors.MAX_LOG_TTL, True),
                          (self.stream_name, connectors.MAX_LOG_TTL, True)])

    def test_skips_conditions_that_are_not_newer_than_the_last_one(self):
        postgres = _postgres(fetch_results=[[{'name': 'task-a'}]])
        self.redis_client.set(self.timestamp_key, str(EVENT_TIME.timestamp()))

        agent_helpers.send_pod_conditions(
            postgres, self._conditions_body([self._condition()]), 500)

        self.assertEqual(self.redis_client.xadds, [])

    def test_skips_conditions_filtered_out_by_the_condition_filter(self):
        postgres = _postgres(fetch_results=[[{'name': 'task-a'}]])

        agent_helpers.send_pod_conditions(
            postgres, self._conditions_body([self._condition(type='ContainersReady')]), 500)

        self.assertEqual(self.redis_client.xadds, [])


class SendPodEventTest(PatchingTestCase):
    """Covers send_pod_event event stream writes and timestamp dedup."""

    def setUp(self):
        self.redis_client = _FakeRedisClient()
        self.start_patch(
            connectors.RedisConnector, 'get_instance',
            mock.Mock(return_value=types.SimpleNamespace(client=self.redis_client)))
        self.stream_name = common.get_workflow_events_redis_name(WORKFLOW_UUID)
        self.timestamp_key = f'pod_event:{WORKFLOW_UUID}:task-a:latest_timestamp'
        self.message = backend_messages.PodEventBody(
            pod_name='osmo-pod-1', reason='Scheduled', timestamp=EVENT_TIME,
            message='pod assigned to node-1')

    def _pod_rows(self, count: int = 1) -> List[Dict[str, Any]]:
        return [{'name': 'task-a', 'workflow_uuid': WORKFLOW_UUID}] * count

    def test_ignores_events_for_pods_without_a_task(self):
        postgres = _postgres(fetch_results=[[]])

        agent_helpers.send_pod_event(postgres, self.message, 500)

        self.assertEqual(self.redis_client.xadds, [])

    def test_appends_a_new_event_to_the_workflow_event_stream(self):
        postgres = _postgres(fetch_results=[self._pod_rows()])

        agent_helpers.send_pod_event(postgres, self.message, 500)

        stream, fields, maxlen = self.redis_client.xadds[0]
        self.assertEqual(stream, self.stream_name)
        self.assertEqual(fields['text'],
                         f'{EVENT_TIME} [task-a] Scheduled: pod assigned to node-1')
        self.assertEqual(maxlen, 500)

    def test_derives_the_retry_id_from_the_number_of_task_rows(self):
        postgres = _postgres(fetch_results=[self._pod_rows(count=3)])

        agent_helpers.send_pod_event(postgres, self.message, 500)

        self.assertEqual(self.redis_client.xadds[0][1]['retry_id'], 2)

    def test_records_the_event_timestamp_for_later_deduplication(self):
        postgres = _postgres(fetch_results=[self._pod_rows()])

        agent_helpers.send_pod_event(postgres, self.message, 500)

        self.assertEqual(self.redis_client.sets,
                         [(self.timestamp_key, EVENT_TIME.timestamp())])
        self.assertEqual(self.redis_client.expires,
                         [(self.timestamp_key, connectors.MAX_LOG_TTL, True),
                          (self.stream_name, connectors.MAX_LOG_TTL, True)])

    def test_skips_events_that_are_not_newer_than_the_last_one(self):
        postgres = _postgres(fetch_results=[self._pod_rows()])
        self.redis_client.set(self.timestamp_key, str(EVENT_TIME.timestamp()))

        agent_helpers.send_pod_event(postgres, self.message, 500)

        self.assertEqual(self.redis_client.xadds, [])


class SendHeartbeatTest(PatchingTestCase):
    """Covers the heartbeat loop frame contents."""

    def test_sends_a_heartbeat_frame_to_the_backend_worker(self):
        websocket = _websocket()

        asyncio.run(_run_until(agent_helpers.send_heartbeat(websocket), websocket.frame_sent))

        self.assertEqual(websocket.sent, [json.dumps({'type': 'heartbeat'})])


class BackendListenerInitTest(PatchingTestCase):
    """Covers the initialization loop of backend_listener_impl."""

    def setUp(self):
        self.postgres = _postgres()
        self.start_patch(connectors.PostgresConnector, 'get_instance',
                         mock.Mock(return_value=self.postgres))
        self.start_patch(metrics.MetricCreator, 'get_meter_instance',
                         mock.Mock(return_value=_FakeMeter()))
        self.start_patch(
            workflow_objects.WorkflowServiceContext, 'get',
            mock.Mock(return_value=types.SimpleNamespace(
                config=types.SimpleNamespace(redis_url='redis://localhost:6379/0'))))
        self.create_backend = self.start_patch(agent_helpers, 'create_backend', mock.Mock())
        self.log = self.start_patch(agent_helpers, 'log', mock.Mock())

    def test_creates_the_backend_from_the_init_message(self):
        websocket = _websocket([_message('init', dict(INIT_BODY))])

        asyncio.run(_run_listener_until_idle(websocket))

        self.assertTrue(websocket.accepted)
        self.assertEqual(self.create_backend.call_args[0][1], BACKEND_NAME)
        self.assertEqual(self.create_backend.call_args[0][2].k8s_uid, 'k8s-uid-1')

    def test_logs_backend_messages_received_before_initialization(self):
        websocket = _websocket([
            _message('logging', {'type': 20, 'text': 'starting up'}),
            _message('init', dict(INIT_BODY)),
        ])

        asyncio.run(_run_listener_until_idle(websocket))

        self.assertEqual(self.log.call_args[0][3].text, 'starting up')

    def test_rejects_unexpected_message_types_before_initialization(self):
        websocket = _websocket([_message('heartbeat', {'time': '2026-01-02T03:04:05'})])

        with self.assertRaises(osmo_errors.OSMOBackendError) as context:
            asyncio.run(agent_helpers.backend_listener_impl(websocket, BACKEND_NAME))

        self.assertIn('Unexpected message: heartbeat', context.exception.message)

    def test_rejects_malformed_message_bodies_before_initialization(self):
        websocket = _websocket([_message('init', {'k8s_uid': 'only-uid'})])

        with self.assertRaises(osmo_errors.OSMOBackendError) as context:
            asyncio.run(agent_helpers.backend_listener_impl(websocket, BACKEND_NAME))

        self.assertIn('Invalid message received from backend', context.exception.message)

    def test_wraps_database_errors_raised_while_creating_the_backend(self):
        self.create_backend.side_effect = osmo_errors.OSMODatabaseError('connection refused')
        websocket = _websocket([_message('init', dict(INIT_BODY))])

        with self.assertRaises(osmo_errors.OSMOBackendError) as context:
            asyncio.run(agent_helpers.backend_listener_impl(websocket, BACKEND_NAME))

        self.assertIn('Encountered database error connection refused', context.exception.message)

    def test_returns_when_the_backend_disconnects_before_initialization(self):
        websocket = _websocket(receive_error=fastapi.WebSocketDisconnect(code=1000))

        asyncio.run(agent_helpers.backend_listener_impl(websocket, BACKEND_NAME))

        self.assertTrue(websocket.accepted)
        self.assertEqual(websocket.sent, [])


class BackendListenerDispatchTest(PatchingTestCase):
    """Covers the post-initialization message dispatch of backend_listener_impl."""

    def setUp(self):
        self.postgres = _postgres()
        self.meter = _FakeMeter()
        self.start_patch(connectors.PostgresConnector, 'get_instance',
                         mock.Mock(return_value=self.postgres))
        self.start_patch(metrics.MetricCreator, 'get_meter_instance',
                         mock.Mock(return_value=self.meter))
        self.start_patch(
            workflow_objects.WorkflowServiceContext, 'get',
            mock.Mock(return_value=types.SimpleNamespace(
                config=types.SimpleNamespace(redis_url='redis://localhost:6379/0'))))
        self.start_patch(agent_helpers, 'create_backend', mock.Mock())
        self.log = self.start_patch(agent_helpers, 'log', mock.Mock())
        self.queue_update_group_job = self.start_patch(
            agent_helpers, 'queue_update_group_job', mock.Mock())
        self.create_monitor_job = self.start_patch(
            agent_helpers, 'create_monitor_job', mock.Mock())
        self.update_resource = self.start_patch(agent_helpers, 'update_resource', mock.Mock())
        self.update_resource_usage = self.start_patch(
            agent_helpers, 'update_resource_usage', mock.Mock())
        self.delete_resource = self.start_patch(agent_helpers, 'delete_resource', mock.Mock())
        self.clean_resources = self.start_patch(agent_helpers, 'clean_resources', mock.Mock())
        self.clean_tasks = self.start_patch(agent_helpers, 'clean_tasks', mock.Mock())
        self.send_metrics = self.start_patch(agent_helpers, 'send_metrics', mock.Mock())
        self.send_pod_conditions = self.start_patch(
            agent_helpers, 'send_pod_conditions', mock.Mock())
        self.send_pod_event = self.start_patch(agent_helpers, 'send_pod_event', mock.Mock())
        self.update_heartbeat = self.start_patch(
            config_helpers, 'update_backend_last_heartbeat', mock.Mock())

    def _initialized_websocket(self, message: Dict[str, Any]) -> Any:
        return _websocket([_message('init', dict(INIT_BODY)), message])

    def test_acknowledges_every_processed_message(self):
        websocket = self._initialized_websocket(
            _message('heartbeat', {'time': '2026-01-02T03:04:05'}, uuid='heartbeat-uuid'))

        asyncio.run(_run_listener_until_acked(websocket))

        ack = json.loads(websocket.sent[0])
        self.assertEqual(ack['type'], 'ack')
        self.assertEqual(ack['body']['uuid'], 'heartbeat-uuid')

    def test_records_processing_metrics_for_every_message(self):
        websocket = self._initialized_websocket(
            _message('heartbeat', {'time': '2026-01-02T03:04:05'}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(self.meter.counters[0]['name'], 'osmo_backend_event_processing_time')
        self.assertEqual(self.meter.counters[1]['name'], 'osmo_backend_event_count')
        self.assertEqual(self.meter.counters[1]['tags'],
                         {'type': 'heartbeat', 'backend': BACKEND_NAME})

    def test_updates_the_last_heartbeat_for_heartbeat_messages(self):
        websocket = self._initialized_websocket(
            _message('heartbeat', {'time': '2026-01-02T03:04:05'}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.update_heartbeat.assert_called_once_with(BACKEND_NAME, EVENT_TIME)

    def test_logs_backend_messages_after_initialization(self):
        websocket = self._initialized_websocket(
            _message('logging', {'type': 20, 'text': 'pod started'}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(self.log.call_args[0][3].text, 'pod started')

    def test_queues_a_group_update_for_pod_updates(self):
        websocket = self._initialized_websocket(_message('update_pod', {
            'workflow_uuid': WORKFLOW_UUID, 'task_uuid': 'task-uuid-1', 'retry_id': 0,
            'container': 'osmo-user', 'status': 'RUNNING', 'backend': BACKEND_NAME}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(self.queue_update_group_job.call_args[0][1].status, 'RUNNING')

    def test_creates_a_monitor_job_for_pods_that_never_started(self):
        websocket = self._initialized_websocket(_message('monitor_pod', {
            'workflow_uuid': WORKFLOW_UUID, 'task_uuid': 'task-uuid-1', 'retry_id': 0,
            'message': 'still pending'}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(self.create_monitor_job.call_args[0][1].message, 'still pending')

    def test_updates_the_resource_for_node_messages(self):
        websocket = self._initialized_websocket(_message('resource', {
            'hostname': 'node-1', 'available': True, 'allocatable_fields': {'cpu': '8'},
            'label_fields': {'zone': 'a'}}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(self.update_resource.call_args[0][2].hostname, 'node-1')

    def test_updates_the_resource_usage_for_usage_messages(self):
        websocket = self._initialized_websocket(_message('resource_usage', {
            'hostname': 'node-1', 'usage_fields': {'cpu': '2'},
            'non_workflow_usage_fields': {'cpu': '1'}}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(self.update_resource_usage.call_args[0][2].usage_fields, {'cpu': '2'})

    def test_deletes_the_resource_for_removed_nodes(self):
        websocket = self._initialized_websocket(
            _message('delete_resource', {'resource': 'node-1'}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(self.delete_resource.call_args[0][2].resource, 'node-1')

    def test_cleans_stale_resources_for_node_hash_messages(self):
        websocket = self._initialized_websocket(
            _message('node_hash', {'node_hashes': ['node-1']}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(self.clean_resources.call_args[0][2].node_hashes, ['node-1'])

    def test_cleans_missing_tasks_for_task_list_messages(self):
        websocket = self._initialized_websocket(
            _message('task_list', {'task_list': ['task-uuid-1']}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(self.clean_tasks.call_args[0][2].task_list, ['task-uuid-1'])

    def test_forwards_backend_metrics(self):
        websocket = self._initialized_websocket(_message('metrics', {
            'type': 'COUNTER', 'value': 1.0, 'name': 'osmo_test_metric', 'unit': 'count',
            'description': 'a test metric'}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(self.send_metrics.call_args[0][0].name, 'osmo_test_metric')

    def test_forwards_pod_conditions_with_the_configured_log_limit(self):
        websocket = self._initialized_websocket(_message('pod_conditions', {
            'workflow_uuid': WORKFLOW_UUID, 'task_uuid': 'task-uuid-1', 'retry_id': 0,
            'conditions': [{'timestamp': '2026-01-02T03:04:05', 'status': 'True',
                            'type': 'Ready'}]}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(self.send_pod_conditions.call_args[0][2], 500)

    def test_forwards_pod_events_with_the_configured_log_limit(self):
        websocket = self._initialized_websocket(_message('pod_event', {
            'pod_name': 'osmo-pod-1', 'reason': 'Scheduled',
            'timestamp': '2026-01-02T03:04:05', 'message': 'assigned'}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(self.send_pod_event.call_args[0][1].pod_name, 'osmo-pod-1')

    def test_acknowledges_but_ignores_unhandled_message_types(self):
        websocket = self._initialized_websocket(_message('ack', {'uuid': 'other-uuid'}))

        asyncio.run(_run_listener_until_acked(websocket))

        self.assertEqual(json.loads(websocket.sent[0])['type'], 'ack')
        self.queue_update_group_job.assert_not_called()

    def test_rejects_malformed_message_bodies_after_initialization(self):
        websocket = self._initialized_websocket(
            _message('delete_resource', {'wrong_field': 'node-1'}))

        with self.assertRaises(osmo_errors.OSMOBackendError) as context:
            asyncio.run(agent_helpers.backend_listener_impl(websocket, BACKEND_NAME))

        self.assertIn('Invalid message received from backend', context.exception.message)

    def test_wraps_database_errors_raised_while_dispatching(self):
        self.delete_resource.side_effect = osmo_errors.OSMODatabaseError('deadlock detected')
        websocket = self._initialized_websocket(
            _message('delete_resource', {'resource': 'node-1'}))

        with self.assertRaises(osmo_errors.OSMOBackendError) as context:
            asyncio.run(agent_helpers.backend_listener_impl(websocket, BACKEND_NAME))

        self.assertIn('Encountered database error deadlock detected', context.exception.message)


class BackendListenerControlTest(PatchingTestCase):
    """Covers backend_listener_control_impl node condition delivery."""

    def setUp(self):
        self.postgres = _postgres()
        self.start_patch(connectors.PostgresConnector, 'get_instance',
                         mock.Mock(return_value=self.postgres))
        self.start_patch(
            workflow_objects.WorkflowServiceContext, 'get',
            mock.Mock(return_value=types.SimpleNamespace(
                config=types.SimpleNamespace(redis_url='redis://localhost:6379/0'))))
        self.start_patch(
            connectors.Backend, 'fetch_from_db',
            mock.Mock(return_value=types.SimpleNamespace(
                node_conditions=_FakeNodeConditions({'Ready': 'True'}))))
        self.sleep = self.start_patch(agent_helpers.asyncio, 'sleep', mock.AsyncMock())

    def _run_control(self, outcomes: List[Any], websocket) -> _FakeAsyncRedis:
        redis_double = _FakeAsyncRedis(outcomes)
        self.start_patch(agent_helpers.redis.asyncio, 'from_url',
                         mock.Mock(return_value=redis_double))
        asyncio.run(agent_helpers.backend_listener_control_impl(websocket, BACKEND_NAME))
        return redis_double

    def test_sends_the_stored_node_conditions_on_connect(self):
        websocket = _websocket()

        self._run_control([], websocket)

        first_message = json.loads(websocket.sent[0])
        self.assertEqual(first_message['type'], 'node_conditions')
        self.assertEqual(first_message['body']['rules'], {'Ready': 'True'})

    def test_forwards_node_condition_actions_from_the_backend_queue(self):
        websocket = _websocket()
        queue_name = connectors.backend_action_queue_name(BACKEND_NAME)

        redis_double = self._run_control(
            [(queue_name, json.dumps({'rules': {'Ready': 'False'}}))], websocket)

        self.assertEqual(redis_double.brpop_calls[0], queue_name)
        self.assertEqual(json.loads(websocket.sent[1])['body']['rules'], {'Ready': 'False'})

    def test_ignores_empty_reads_from_the_backend_queue(self):
        websocket = _websocket()

        self._run_control([None], websocket)

        self.assertEqual(len(websocket.sent), 1)

    def test_retries_after_a_redis_connection_error(self):
        websocket = _websocket()

        self._run_control([ConnectionError('connection reset'),
                           ('queue', json.dumps({'rules': {'Ready': 'False'}}))], websocket)

        self.sleep.assert_awaited_once_with(1)
        self.assertEqual(len(websocket.sent), 2)

    def test_retries_after_a_system_error(self):
        websocket = _websocket()

        self._run_control([OSError('too many open files')], websocket)

        self.sleep.assert_awaited_once_with(1)

    def test_reraises_unexpected_errors_from_the_backend_queue(self):
        websocket = _websocket()

        with self.assertRaises(RuntimeError):
            self._run_control([RuntimeError('boom')], websocket)

    def test_returns_when_the_control_connection_is_cancelled(self):
        websocket = _websocket()

        self._run_control([asyncio.CancelledError()], websocket)

        self.assertEqual(len(websocket.sent), 1)


class BackendWorkerTest(PatchingTestCase):
    """Covers backend_worker_impl initialization and shutdown paths."""

    def setUp(self):
        self.postgres = _postgres()
        self.start_patch(connectors.PostgresConnector, 'get_instance',
                         mock.Mock(return_value=self.postgres))
        self.start_patch(
            workflow_objects.WorkflowServiceContext, 'get',
            mock.Mock(return_value=types.SimpleNamespace(
                config=types.SimpleNamespace(redis_url='redis://localhost:6379/0'))))
        self.create_backend = self.start_patch(agent_helpers, 'create_backend', mock.Mock())
        self.log = self.start_patch(agent_helpers, 'log', mock.Mock())
        self.start_patch(agent_helpers.kombu, 'Connection', mock.MagicMock())
        self.worker = mock.Mock()
        self.worker.run_jobs = mock.AsyncMock()
        self.start_patch(agent_helpers.backend_objects, 'WebsocketWorker',
                         mock.Mock(return_value=self.worker))

    def test_runs_the_websocket_worker_after_initialization(self):
        websocket = _websocket([_message('init', dict(INIT_BODY))])

        asyncio.run(agent_helpers.backend_worker_impl(websocket, BACKEND_NAME))

        self.assertTrue(websocket.accepted)
        self.create_backend.assert_called_once()
        self.worker.run_jobs.assert_awaited_once_with(BACKEND_NAME)

    def test_logs_backend_worker_messages_before_initialization(self):
        websocket = _websocket([
            _message('logging', {'type': 20, 'text': 'worker ready'}),
            _message('init', dict(INIT_BODY)),
        ])

        asyncio.run(agent_helpers.backend_worker_impl(websocket, BACKEND_NAME))

        self.assertEqual(self.log.call_args[0][3].text, 'worker ready')

    def test_rejects_unexpected_message_types_before_initialization(self):
        websocket = _websocket([_message('heartbeat', {'time': '2026-01-02T03:04:05'})])

        with self.assertRaises(osmo_errors.OSMOBackendError) as context:
            asyncio.run(agent_helpers.backend_worker_impl(websocket, BACKEND_NAME))

        self.assertIn('Unexpected message: heartbeat', context.exception.message)

    def test_closes_the_connection_when_the_database_is_unavailable(self):
        self.create_backend.side_effect = osmo_errors.OSMODatabaseError('connection refused')
        websocket = _websocket([_message('init', dict(INIT_BODY))])

        asyncio.run(agent_helpers.backend_worker_impl(websocket, BACKEND_NAME))

        self.assertEqual(websocket.closed, (4000, 'connection refused'))
        self.worker.run_jobs.assert_not_awaited()

    def test_returns_when_the_worker_disconnects(self):
        websocket = _websocket(receive_error=fastapi.WebSocketDisconnect(code=1001))

        asyncio.run(agent_helpers.backend_worker_impl(websocket, BACKEND_NAME))

        self.assertTrue(websocket.accepted)
        self.worker.run_jobs.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
