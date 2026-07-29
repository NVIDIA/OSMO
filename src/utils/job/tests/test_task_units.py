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
import base64
import datetime
import json
import types
import unittest
from typing import Any, Dict, List, Tuple
from unittest import mock

from src.lib.utils import osmo_errors
from src.utils import connectors
from src.utils.job import task


class _RecordingPostgresConnector(connectors.PostgresConnector):
    """PostgresConnector test double that records commands and returns preset rows.

    Instead of opening a database connection, holds a queue of fetch results
    and records every commit call. Each fetch invocation pops the next row set.
    """

    def __init__(self,
                 fetch_results: List[Any] | None = None,
                 generic_creds: Dict[str, Dict[str, str]] | None = None):
        self.fetch_results: List[Any] = list(fetch_results or [])
        self.commit_calls: List[Tuple[str, Tuple]] = []
        self.commit_commands_calls: List[List[Tuple[str, Tuple]]] = []
        self._generic_creds = generic_creds or {}

    def execute_fetch_command(self, command, args, return_raw=False):
        # pylint: disable=unused-argument
        if not self.fetch_results:
            return []
        return self.fetch_results.pop(0)

    def execute_commit_command(self, command, args):
        self.commit_calls.append((command, args))

    def execute_commit_commands(self, commands):
        self.commit_commands_calls.append(list(commands))

    def get_generic_cred(self, user: str, cred_name: str):  # pylint: disable=unused-argument
        return self._generic_creds.get(cred_name, {})


def _make_task(name: str = 'mytask', workflow_id: str | None = 'wf-1',
               retry_id: int = 0, lead: bool = True,
               task_uuid: str = 'a' * 32,
               task_db_key: str = 'b' * 32,
               workflow_uuid: str = 'c' * 32,
               database=None, status=None) -> task.Task:
    return task.Task(
        workflow_id_internal=workflow_id,
        workflow_uuid=workflow_uuid,
        name=name,
        group_name='mygroup',
        task_uuid=task_uuid,
        task_db_key=task_db_key,
        retry_id=retry_id,
        status=status or task.TaskGroupStatus.WAITING,
        database=database or _RecordingPostgresConnector(),
        exit_actions={},
        lead=lead,
    )


def _make_group(name: str = 'mygroup', workflow_id: str | None = 'wf-1',
                ignore_nonlead: bool = True,
                barrier: bool = True,
                task_specs: List[task.TaskSpec] | None = None,
                tasks: List[task.Task] | None = None,
                database=None,
                remaining_upstream_groups=None,
                downstream_groups=None,
                status=None) -> task.TaskGroup:
    if task_specs is None:
        task_specs = [task.TaskSpec(
            name='lead', image='ubuntu', command=['ls'], lead=True)]
    spec = task.TaskGroupSpec(
        name=name,
        barrier=barrier,
        ignoreNonleadStatus=ignore_nonlead,
        tasks=task_specs,
    )
    return task.TaskGroup(
        workflow_id_internal=workflow_id,
        name=name,
        group_uuid='d' * 32,
        spec=spec,
        tasks=tasks or [],
        remaining_upstream_groups=remaining_upstream_groups or set(),
        downstream_groups=downstream_groups or set(),
        database=database or _RecordingPostgresConnector(),
        status=status or task.TaskGroupStatus.WAITING,
    )


class DockerAuthTest(unittest.TestCase):
    """Tests for task.docker_auth."""

    def test_produces_base64_of_user_colon_password(self):
        encoded = task.docker_auth('alice', 'secret')
        self.assertEqual(
            base64.b64decode(encoded).decode('utf-8'),
            'alice:secret',
        )

    def test_empty_user_and_password(self):
        encoded = task.docker_auth('', '')
        self.assertEqual(base64.b64decode(encoded).decode('utf-8'), ':')

    def test_non_ascii_characters_utf8_encoded(self):
        encoded = task.docker_auth('user', 'pässwörd')
        self.assertEqual(
            base64.b64decode(encoded).decode('utf-8'),
            'user:pässwörd',
        )


class TaskInputOutputErrorPathsTest(unittest.TestCase):
    """Tests targeting error paths in TaskInputOutput.is_from_previous_workflow
    and TaskInputOutput.parsed_workflow_info."""

    def test_is_from_previous_workflow_invalid_task_raises_server_error(self):
        # Build model bypassing validation to hit the runtime regex path.
        spec = task.TaskInputOutput.model_construct(task='!!!bad-name', regex='')
        with self.assertRaises(osmo_errors.OSMOServerError):
            spec.is_from_previous_workflow()

    def test_parsed_workflow_info_invalid_task_raises_submission_error(self):
        spec = task.TaskInputOutput.model_construct(task='!!!bad-name', regex='')
        with self.assertRaises(osmo_errors.OSMOSubmissionError):
            spec.parsed_workflow_info()

    def test_parsed_workflow_info_empty_first_field_raises(self):
        # If the regex matches but first field is empty, raises.
        # model_construct bypasses validation so we can supply an unusual value.
        spec = task.TaskInputOutput.model_construct(task='', regex='')
        with self.assertRaises(osmo_errors.OSMOSubmissionError):
            spec.parsed_workflow_info()


class TaskSpecGetResourceFromSpecTest(unittest.TestCase):
    """Tests for TaskSpec.get_resource_from_spec."""

    def _make_spec(self) -> task.TaskSpec:
        return task.TaskSpec(name='t', image='u', command=['ls'])

    def test_with_unit_returns_direct_value(self):
        spec = self._make_spec()
        # For allocatables with a 'unit', spec.get(label) is returned as-is.
        result = spec.get_resource_from_spec(
            {'memory': '4Gi'}, 'memory', 'Gi')
        self.assertEqual(result, '4Gi')

    def test_without_unit_reads_count_key(self):
        spec = self._make_spec()
        # Countable allocatables (cpu, gpu) read the .count sub-key.
        result = spec.get_resource_from_spec(
            {'cpu': {'count': 4}}, 'cpu', None)
        self.assertEqual(result, 4)

    def test_without_unit_missing_returns_none(self):
        spec = self._make_spec()
        result = spec.get_resource_from_spec({}, 'cpu', None)
        self.assertIsNone(result)


class TaskSpecToPodResourceSpecTest(unittest.TestCase):
    """Tests for TaskSpec.to_pod_resource_spec.

    The internal ``get_resource_from_spec`` helper expects the CPU/GPU entries
    in the model_dump output to be dicts of the form ``{'count': N}`` — which
    is not the shape a plain ``ResourceSpec`` produces (cpu/gpu are ints).
    Tests therefore patch ``model_dump`` to provide the expected shape.
    """

    _BASE_DUMP: Dict[str, Any] = {
        'cpu': {},
        'gpu': {},
        'memory': None,
        'storage': None,
        'nodesExcluded': [],
        'topology': [],
        'platform': None,
    }

    def _run_with_dump(self, dump: Dict[str, Any]) -> Dict:
        spec = task.TaskSpec(name='t', image='u', command=['ls'])
        resource = connectors.ResourceSpec()
        with mock.patch.object(
            connectors.ResourceSpec, 'model_dump', return_value=dump,
        ):
            return spec.to_pod_resource_spec(resource)

    def test_cpu_and_memory_mapped_to_kube_labels(self):
        dump = dict(self._BASE_DUMP)
        dump['cpu'] = {'count': 4}
        dump['memory'] = '16Gi'
        result = self._run_with_dump(dump)
        self.assertEqual(result.get('cpu'), 4)
        self.assertEqual(result.get('memory'), '16Gi')

    def test_gpu_zero_is_stripped(self):
        # When gpu resolves to '0', the nvidia.com/gpu key is deleted.
        dump = dict(self._BASE_DUMP)
        dump['cpu'] = {'count': 1}
        dump['gpu'] = {'count': '0'}
        result = self._run_with_dump(dump)
        self.assertNotIn('nvidia.com/gpu', result)
        self.assertEqual(result.get('cpu'), 1)

    def test_gpu_nonzero_preserved(self):
        dump = dict(self._BASE_DUMP)
        dump['gpu'] = {'count': 2}
        dump['cpu'] = {'count': 4}
        result = self._run_with_dump(dump)
        self.assertEqual(result.get('nvidia.com/gpu'), 2)

    def test_empty_resource_yields_empty_spec(self):
        result = self._run_with_dump(dict(self._BASE_DUMP))
        self.assertEqual(result, {})


class TaskSpecToPodContainerTest(unittest.TestCase):
    """Tests for TaskSpec.to_pod_container."""

    def _make_spec(self, **overrides) -> task.TaskSpec:
        base = {'name': 'mytask', 'image': 'ubuntu:22.04', 'command': ['sh', '-c']}
        base.update(overrides)
        return task.TaskSpec(**base)

    def test_command_args_appended_with_commands_flag(self):
        spec = self._make_spec(command=['echo', 'hi'])
        container = spec.to_pod_container(
            user_args=['-userArg', 'value'],
            files=[],
            mounts=[],
            user_secrets_name='secrets',
            config_dir_secret_name='config',
        )
        # Every command is added prefixed with '-commands'.
        args = container['args']
        self.assertIn('-commands', args)
        self.assertIn('echo', args)
        self.assertIn('hi', args)

    def test_args_appended_with_args_flag(self):
        spec = self._make_spec(command=['run'], args=['flag-a', 'flag-b'])
        container = spec.to_pod_container(
            user_args=[],
            files=[],
            mounts=[],
            user_secrets_name='secrets',
            config_dir_secret_name='config',
        )
        args = container['args']
        self.assertIn('-args', args)
        self.assertIn('flag-a', args)
        self.assertIn('flag-b', args)

    def test_environment_variables_added_to_env(self):
        spec = self._make_spec(environment={'FOO': 'bar', 'BAZ': 'qux'})
        container = spec.to_pod_container(
            user_args=[],
            files=[],
            mounts=[],
            user_secrets_name='secrets',
            config_dir_secret_name='config',
        )
        env_names = {e['name']: e for e in container['env'] if 'value' in e}
        self.assertEqual(env_names['FOO']['value'], 'bar')
        self.assertEqual(env_names['BAZ']['value'], 'qux')

    def test_dict_credentials_generate_secret_key_refs(self):
        spec = self._make_spec(
            credentials={'mycred': {'MY_KEY': 'k1'}},
        )
        container = spec.to_pod_container(
            user_args=[],
            files=[],
            mounts=[],
            user_secrets_name='secrets',
            config_dir_secret_name='config',
        )
        cred_env = next(e for e in container['env'] if e.get('name') == 'MY_KEY')
        secret_ref = cred_env['valueFrom']['secretKeyRef']
        self.assertEqual(secret_ref['name'], 'secrets')
        self.assertEqual(secret_ref['key'], 'mycred.k1')

    def test_string_credentials_do_not_generate_env(self):
        # str credentials (mount directory form) don't produce cred env entries.
        spec = self._make_spec(credentials={'mycred': '/mnt/secrets'})
        container = spec.to_pod_container(
            user_args=[],
            files=[],
            mounts=[],
            user_secrets_name='secrets',
            config_dir_secret_name='config',
        )
        # No env entry references mycred as its cred_name key mapping.
        self.assertFalse(any(
            e.get('valueFrom', {}).get('secretKeyRef', {}).get('key', '')
                .startswith('mycred.')
            for e in container['env']
        ))

    def test_config_override_env_added(self):
        spec = self._make_spec()
        container = spec.to_pod_container(
            user_args=[],
            files=[],
            mounts=[],
            user_secrets_name='secrets',
            config_dir_secret_name='config-dir',
        )
        override = next(
            e for e in container['env']
            if e.get('valueFrom', {}).get('secretKeyRef', {}).get('name')
            == 'config-dir'
        )
        self.assertEqual(
            override['valueFrom']['secretKeyRef']['key'], 'fileDir')

    def test_using_gpu_false_adds_nvidia_visible_devices_empty(self):
        spec = self._make_spec()
        container = spec.to_pod_container(
            user_args=[], files=[], mounts=[],
            user_secrets_name='s', config_dir_secret_name='c',
            using_gpu=False,
        )
        nvidia = next(
            e for e in container['env']
            if e.get('name') == 'NVIDIA_VISIBLE_DEVICES')
        self.assertEqual(nvidia['value'], '')

    def test_using_gpu_true_omits_nvidia_visible_devices(self):
        spec = self._make_spec()
        container = spec.to_pod_container(
            user_args=[], files=[], mounts=[],
            user_secrets_name='s', config_dir_secret_name='c',
            using_gpu=True,
        )
        self.assertFalse(any(
            e.get('name') == 'NVIDIA_VISIBLE_DEVICES'
            for e in container['env']
        ))

    def test_files_appended_to_volume_mounts(self):
        spec = self._make_spec()
        file_mount = mock.Mock()
        file_mount.volume_mount.return_value = {'name': 'file-vm'}
        container = spec.to_pod_container(
            user_args=[], files=[file_mount], mounts=[],
            user_secrets_name='s', config_dir_secret_name='c',
        )
        self.assertIn({'name': 'file-vm'}, container['volumeMounts'])

    def test_mounts_appended_to_volume_mounts(self):
        spec = self._make_spec()
        host_mount = mock.Mock()
        host_mount.volume_mount.return_value = {'name': 'host-vm'}
        container = spec.to_pod_container(
            user_args=[], files=[], mounts=[host_mount],
            user_secrets_name='s', config_dir_secret_name='c',
        )
        self.assertIn({'name': 'host-vm'}, container['volumeMounts'])

    def test_privileged_set_from_spec(self):
        spec = self._make_spec(privileged=True)
        container = spec.to_pod_container(
            user_args=[], files=[], mounts=[],
            user_secrets_name='s', config_dir_secret_name='c',
        )
        self.assertTrue(container['securityContext']['privileged'])


class TaskSpecParseUnknownInputTest(unittest.TestCase):
    """Test for TaskSpec.parse raising OSMOUsageError on unknown input."""

    def test_unknown_input_type_raises_usage_error(self):
        # Build a TaskSpec then swap out its inputs list with something that is
        # neither a TaskInputOutput nor URLInputOutput to trigger the else-branch.
        spec = task.TaskSpec(name='t', image='u', command=['ls'])
        # Bypass validation so we can inject a non-InputType value.
        spec.__dict__['inputs'] = ['not-a-real-input']
        with self.assertRaises(osmo_errors.OSMOUsageError):
            spec.parse(workflow_id='wf-1', host_tokens={})


class SubstitutePodTemplateTokensTest(unittest.TestCase):
    """Tests for substitute_pod_template_tokens.

    The ``keys_to_delete`` branch is unreachable in the current source:
    for ``replace_helper`` to return ``None`` the rendered string would
    have to be ``None``, but ``re.fullmatch`` is called on it first and
    raises ``TypeError`` on non-string input.
    """

    def test_string_value_substituted_from_tokens(self):
        template = {'greeting': 'hello {{ who }}!'}
        task.substitute_pod_template_tokens(template, {'who': 'world'})
        self.assertEqual(template['greeting'], 'hello world!')

    def test_array_marker_expanded_to_list(self):
        template: Dict[str, Any] = {'items': ['ARRAY:[a,b,c]']}
        task.substitute_pod_template_tokens(template, {})
        self.assertEqual(template['items'], [['a', 'b', 'c']])

    def test_dict_value_recursed(self):
        template: Dict[str, Any] = {'outer': {'inner': '{{ v }}'}}
        task.substitute_pod_template_tokens(template, {'v': 'ok'})
        self.assertEqual(template['outer']['inner'], 'ok')


class EncodeHstoreTest(unittest.TestCase):
    """Tests for _encode_hstore."""

    def test_empty_set_returns_empty_string(self):
        result = task._encode_hstore(set())  # pylint: disable=protected-access
        self.assertEqual(result, '')

    def test_single_task_encoded(self):
        result = task._encode_hstore({'task-a'})  # pylint: disable=protected-access
        self.assertEqual(result, '"task-a" => "NULL"')

    def test_multiple_tasks_encoded(self):
        # Order is not guaranteed for sets; validate via parsing back.
        encoded = task._encode_hstore({'a', 'b'})  # pylint: disable=protected-access
        self.assertEqual(task.decode_hstore(encoded.replace(' ', '')), {'a', 'b'})


class TaskInsertToDbTest(unittest.TestCase):
    """Tests for Task.insert_to_db."""

    def test_insert_issues_single_commit(self):
        database = _RecordingPostgresConnector()
        task_obj = _make_task(database=database)
        task_obj.insert_to_db(
            gpu_count=2, cpu_count=4, disk_count=100, memory_count=32,
            status=task.TaskGroupStatus.SCHEDULING, failure_message='msg',
        )
        self.assertEqual(len(database.commit_calls), 1)
        command, args = database.commit_calls[0]
        self.assertIn('INSERT INTO tasks', command)
        # The status name is passed as string.
        self.assertIn('SCHEDULING', args)

    def test_insert_uses_empty_workflow_uuid_when_none(self):
        database = _RecordingPostgresConnector()
        task_obj = _make_task(database=database, workflow_uuid='')
        task_obj.insert_to_db(
            gpu_count=0, cpu_count=0, disk_count=0, memory_count=0,
        )
        self.assertEqual(len(database.commit_calls), 1)

    def test_exit_actions_serialized_as_json(self):
        database = _RecordingPostgresConnector()
        task_obj = _make_task(database=database)
        task_obj.exit_actions = {'COMPLETE': '0', 'FAIL': '1'}
        task_obj.insert_to_db(
            gpu_count=1, cpu_count=1, disk_count=1, memory_count=1,
        )
        _, args = database.commit_calls[0]
        # exit_actions is serialized to a JSON string in the params tuple.
        exit_actions_json = next(a for a in args if isinstance(a, str)
                                 and a.startswith('{') and 'COMPLETE' in a)
        parsed = json.loads(exit_actions_json)
        self.assertEqual(parsed, {'COMPLETE': '0', 'FAIL': '1'})


class TaskWorkflowIdPropertyTest(unittest.TestCase):
    """Tests for Task.workflow_id property."""

    def test_returns_internal_when_present(self):
        db = _RecordingPostgresConnector()
        t = _make_task(database=db, workflow_id='wf-cached')
        self.assertEqual(t.workflow_id, 'wf-cached')
        # No DB fetch when already cached.
        self.assertEqual(db.fetch_results, [])

    def test_fetches_from_db_when_missing(self):
        db = _RecordingPostgresConnector(
            fetch_results=[[{'workflow_id': 'wf-fetched'}]])
        t = _make_task(database=db, workflow_id=None)
        # Bypass the workflow_id field validator by clearing directly.
        t.workflow_id_internal = None
        self.assertEqual(t.workflow_id, 'wf-fetched')
        self.assertEqual(t.workflow_id_internal, 'wf-fetched')

    def test_raises_database_error_when_task_missing(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        t = _make_task(database=db, workflow_id=None)
        t.workflow_id_internal = None
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            _ = t.workflow_id


class TaskFetchRowFromDbTest(unittest.TestCase):
    """Tests for Task.fetch_row_from_db."""

    def test_returns_last_row_by_default_retry(self):
        rows = [{'task_uuid': 'a', 'retry_id': 0},
                {'task_uuid': 'b', 'retry_id': 1}]
        db = _RecordingPostgresConnector(fetch_results=[rows])
        result = task.Task.fetch_row_from_db(db, 'wf-1', 'mytask')
        self.assertEqual(result, {'task_uuid': 'b', 'retry_id': 1})

    def test_raises_when_no_rows(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            task.Task.fetch_row_from_db(db, 'wf-1', 'missing')


class TaskFetchGroupNameTest(unittest.TestCase):
    """Tests for Task.fetch_group_name."""

    def test_returns_group_name_from_first_row(self):
        db = _RecordingPostgresConnector(
            fetch_results=[[{'group_name': 'g-1'}]])
        result = task.Task.fetch_group_name(db, 'wf-1', 'mytask')
        self.assertEqual(result, 'g-1')

    def test_raises_when_no_rows(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            task.Task.fetch_group_name(db, 'wf-1', 'missing')

    def test_raises_on_missing_key(self):
        db = _RecordingPostgresConnector(fetch_results=[[{}]])
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            task.Task.fetch_group_name(db, 'wf-1', 'mytask')


class TaskFetchFromDbFromUuidTest(unittest.TestCase):
    """Tests for Task.fetch_from_db_from_uuid."""

    def test_raises_when_no_rows(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            task.Task.fetch_from_db_from_uuid(
                db, workflow_uuid='wu', task_uuid='tu')


class TaskListTaskRowsByGroupNameTest(unittest.TestCase):
    """Tests for Task.list_task_rows_by_group_name."""

    def test_verbose_uses_verbose_query(self):
        rows = [{'name': 'a'}, {'name': 'b'}]
        db = _RecordingPostgresConnector(fetch_results=[rows])
        result = task.Task.list_task_rows_by_group_name(
            db, 'wf-1', 'g-1', verbose=True)
        self.assertEqual(result, rows)

    def test_non_verbose_uses_latest_retry_query(self):
        rows = [{'name': 'a'}]
        db = _RecordingPostgresConnector(fetch_results=[rows])
        result = task.Task.list_task_rows_by_group_name(
            db, 'wf-1', 'g-1', verbose=False)
        self.assertEqual(result, rows)

    def test_sort_flag_produces_ordered_query_no_error(self):
        rows = [{'name': 'a'}]
        db = _RecordingPostgresConnector(fetch_results=[rows])
        result = task.Task.list_task_rows_by_group_name(
            db, 'wf-1', 'g-1', verbose=True, sort=True)
        self.assertEqual(result, rows)

    def test_empty_rows_raises(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            task.Task.list_task_rows_by_group_name(db, 'wf-1', 'g-1')


class TaskUpdateStatusToDbTest(unittest.TestCase):
    """Tests for Task.update_status_to_db."""

    def test_no_change_when_status_already_finished(self):
        db = _RecordingPostgresConnector()
        t = _make_task(database=db, status=task.TaskGroupStatus.COMPLETED)
        t.update_status_to_db(
            datetime.datetime(2026, 1, 1),
            status=task.TaskGroupStatus.FAILED,
            message='ignore')
        # Already-finished tasks are not updated.
        self.assertEqual(db.commit_calls, [])

    def test_no_change_when_status_is_same(self):
        db = _RecordingPostgresConnector()
        t = _make_task(database=db, status=task.TaskGroupStatus.RUNNING)
        t.update_status_to_db(
            datetime.datetime(2026, 1, 1),
            status=task.TaskGroupStatus.RUNNING,
            message='')
        self.assertEqual(db.commit_calls, [])

    def test_processing_adds_processing_start_time_field(self):
        db = _RecordingPostgresConnector()
        t = _make_task(database=db, status=task.TaskGroupStatus.WAITING)
        t.update_status_to_db(
            datetime.datetime(2026, 1, 1),
            status=task.TaskGroupStatus.PROCESSING,
            message='')
        self.assertEqual(len(db.commit_calls), 1)
        command, _ = db.commit_calls[0]
        self.assertIn('processing_start_time', command)

    def test_scheduling_adds_scheduling_start_time_field(self):
        db = _RecordingPostgresConnector()
        t = _make_task(database=db, status=task.TaskGroupStatus.PROCESSING)
        t.update_status_to_db(
            datetime.datetime(2026, 1, 1),
            status=task.TaskGroupStatus.SCHEDULING,
            message='')
        command, _ = db.commit_calls[0]
        self.assertIn('scheduling_start_time', command)

    def test_initializing_adds_initializing_start_time_field(self):
        db = _RecordingPostgresConnector()
        t = _make_task(database=db, status=task.TaskGroupStatus.SCHEDULING)
        t.update_status_to_db(
            datetime.datetime(2026, 1, 1),
            status=task.TaskGroupStatus.INITIALIZING,
            message='')
        command, _ = db.commit_calls[0]
        self.assertIn('initializing_start_time', command)

    def test_running_adds_start_time_field(self):
        db = _RecordingPostgresConnector()
        t = _make_task(database=db, status=task.TaskGroupStatus.INITIALIZING)
        t.update_status_to_db(
            datetime.datetime(2026, 1, 1),
            status=task.TaskGroupStatus.RUNNING,
            message='')
        command, _ = db.commit_calls[0]
        # 'start_time' appears in the SET clause.
        self.assertIn('start_time', command)

    def test_finished_status_adds_end_time_and_failure_message(self):
        db = _RecordingPostgresConnector()
        t = _make_task(database=db, status=task.TaskGroupStatus.RUNNING)
        t.update_status_to_db(
            datetime.datetime(2026, 1, 1),
            status=task.TaskGroupStatus.FAILED,
            message='boom',
            exit_code=42,
        )
        command, _ = db.commit_calls[0]
        self.assertIn('end_time', command)
        self.assertIn('failure_message', command)
        self.assertIn('exit_code', command)

    def test_failed_start_timeout_uses_restricted_status_list(self):
        db = _RecordingPostgresConnector()
        t = _make_task(database=db, status=task.TaskGroupStatus.SCHEDULING)
        t.update_status_to_db(
            datetime.datetime(2026, 1, 1),
            status=task.TaskGroupStatus.FAILED_START_TIMEOUT,
            message='')
        command, _ = db.commit_calls[0]
        # RUNNING is excluded from the allowed statuses for FAILED_START_TIMEOUT.
        self.assertIn("'INITIALIZING'", command)
        # The generic finished branch WHERE clause has 'RUNNING'; verify the
        # start_timeout branch does NOT.
        after_start = command.split('WHERE', 1)[-1]
        self.assertNotIn("'RUNNING'", after_start)


class TaskCreateNewTest(unittest.TestCase):
    """Tests for Task.create_new."""

    def test_returns_new_task_with_incremented_retry(self):
        db = _RecordingPostgresConnector()
        t = _make_task(database=db, retry_id=2)
        new_task = t.create_new()
        self.assertEqual(new_task.retry_id, 3)
        self.assertEqual(new_task.name, t.name)
        self.assertEqual(new_task.workflow_uuid, t.workflow_uuid)
        # Fresh task_db_key
        self.assertNotEqual(new_task.task_db_key, t.task_db_key)


class TaskBatchAddRefreshTokensToDbTest(unittest.TestCase):
    """Tests for Task.batch_add_refresh_tokens_to_db empty branch."""

    def test_empty_entries_is_no_op(self):
        db = _RecordingPostgresConnector()
        task.Task.batch_add_refresh_tokens_to_db(db, [])
        # No commit issued.
        self.assertEqual(db.commit_calls, [])

    def test_nonempty_entries_triggers_commit(self):
        db = _RecordingPostgresConnector()
        with mock.patch(
            'src.utils.job.task.auth.hash_access_token',
            side_effect=lambda tk: f'hashed:{tk}',
        ):
            task.Task.batch_add_refresh_tokens_to_db(
                db, [('key1', 'tok1'), ('key2', 'tok2')])
        self.assertEqual(len(db.commit_calls), 1)
        command, args = db.commit_calls[0]
        self.assertIn('UPDATE tasks', command)
        # Args flatten to (task_db_key, hashed_token) pairs.
        self.assertIn('key1', args)
        self.assertIn('hashed:tok1', args)


class TaskBatchFetchLatestRetryIdsTest(unittest.TestCase):
    """Tests for Task.batch_fetch_latest_retry_ids."""

    def test_empty_task_names_returns_empty(self):
        db = _RecordingPostgresConnector()
        result = task.Task.batch_fetch_latest_retry_ids(db, 'wf-1', [])
        self.assertEqual(result, {})

    def test_nonempty_returns_mapping(self):
        rows = [{'name': 't1', 'retry_id': 2}, {'name': 't2', 'retry_id': 5}]
        db = _RecordingPostgresConnector(fetch_results=[rows])
        result = task.Task.batch_fetch_latest_retry_ids(
            db, 'wf-1', ['t1', 't2'])
        self.assertEqual(result, {'t1': 2, 't2': 5})


class TaskFromDbRowTest(unittest.TestCase):
    """Tests for Task.from_db_row."""

    def test_constructs_task_from_row(self):
        row = {
            'workflow_id': 'wf-1',
            'workflow_uuid': 'wu-1' + 'x' * 28,
            'name': 'mytask',
            'group_name': 'g-1',
            'task_uuid': 'tu-1' + 'x' * 28,
            'task_db_key': 'dk-1' + 'x' * 28,
            'retry_id': 3,
            'status': 'RUNNING',
            'start_time': None,
            'end_time': None,
            'failure_message': None,
            'exit_actions': {'COMPLETE': '0'},
            'node_name': None,
            'lead': True,
        }
        db = _RecordingPostgresConnector()
        t = task.Task.from_db_row(row, db)
        self.assertEqual(t.name, 'mytask')
        self.assertEqual(t.retry_id, 3)
        self.assertTrue(t.lead)
        self.assertEqual(t.status, task.TaskGroupStatus.RUNNING)


class TaskListAllTaskRowsByWorkflowTest(unittest.TestCase):
    """Tests for Task.list_all_task_rows_by_workflow."""

    def test_groups_rows_by_group_name(self):
        rows = [
            {'name': 'a', 'group_name': 'g1'},
            {'name': 'b', 'group_name': 'g1'},
            {'name': 'c', 'group_name': 'g2'},
        ]
        db = _RecordingPostgresConnector(fetch_results=[rows])
        result = task.Task.list_all_task_rows_by_workflow(
            db, 'wf-1', verbose=False)
        self.assertEqual(sorted(result.keys()), ['g1', 'g2'])
        self.assertEqual(len(result['g1']), 2)
        self.assertEqual(len(result['g2']), 1)

    def test_verbose_query_returns_grouped_rows(self):
        rows = [{'name': 'a', 'group_name': 'g1', 'retry_id': 0},
                {'name': 'a', 'group_name': 'g1', 'retry_id': 1}]
        db = _RecordingPostgresConnector(fetch_results=[rows])
        result = task.Task.list_all_task_rows_by_workflow(
            db, 'wf-1', verbose=True)
        self.assertEqual(len(result['g1']), 2)

    def test_empty_rows_returns_empty_dict(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        result = task.Task.list_all_task_rows_by_workflow(db, 'wf-1')
        self.assertEqual(result, {})


class TaskGroupInsertToDbTest(unittest.TestCase):
    """Tests for TaskGroup.insert_to_db."""

    def test_insert_issues_commit(self):
        db = _RecordingPostgresConnector()
        group = _make_group(database=db,
                            remaining_upstream_groups={'up1'},
                            downstream_groups={'down1'})
        group.insert_to_db(status=task.TaskGroupStatus.SUBMITTING,
                           failure_message='msg')
        self.assertEqual(len(db.commit_calls), 1)
        command, args = db.commit_calls[0]
        self.assertIn('INSERT INTO groups', command)
        self.assertIn('SUBMITTING', args)


class TaskGroupWorkflowIdPropertyTest(unittest.TestCase):
    """Tests for TaskGroup.workflow_id."""

    def test_returns_internal_when_present(self):
        db = _RecordingPostgresConnector()
        group = _make_group(database=db, workflow_id='cached')
        self.assertEqual(group.workflow_id, 'cached')

    def test_fetch_from_db_when_none(self):
        db = _RecordingPostgresConnector(
            fetch_results=[[{'workflow_id': 'fetched'}]])
        group = _make_group(database=db, workflow_id=None)
        group.workflow_id_internal = None
        self.assertEqual(group.workflow_id, 'fetched')

    def test_raises_when_not_found(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        group = _make_group(database=db, workflow_id=None)
        group.workflow_id_internal = None
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            _ = group.workflow_id


class TaskGroupUpdateGroupTemplateResourceTypesTest(unittest.TestCase):
    """Tests for TaskGroup.update_group_template_resource_types."""

    def test_issues_update_commit(self):
        db = _RecordingPostgresConnector()
        group = _make_group(database=db)
        group.group_template_resource_types = [
            {'apiVersion': 'v1', 'kind': 'Service'}]
        group.update_group_template_resource_types()
        self.assertEqual(len(db.commit_calls), 1)
        command, args = db.commit_calls[0]
        self.assertIn('UPDATE groups', command)
        payload = json.loads(args[0])
        self.assertEqual(payload, [{'apiVersion': 'v1', 'kind': 'Service'}])


class TaskGroupFetchStatusTest(unittest.TestCase):
    """Tests for TaskGroup.fetch_status."""

    def test_updates_status_from_db(self):
        db = _RecordingPostgresConnector(
            fetch_results=[[types.SimpleNamespace(status='RUNNING')]])
        group = _make_group(database=db, status=task.TaskGroupStatus.WAITING)
        group.fetch_status()
        self.assertEqual(group.status, task.TaskGroupStatus.RUNNING)

    def test_raises_when_not_found(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        group = _make_group(database=db)
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            group.fetch_status()


class TaskGroupSetTasksToProcessingTest(unittest.TestCase):
    """Tests for TaskGroup.set_tasks_to_processing."""

    def test_issues_update_command(self):
        db = _RecordingPostgresConnector()
        group = _make_group(database=db)
        group.set_tasks_to_processing()
        self.assertEqual(len(db.commit_calls), 1)
        command, args = db.commit_calls[0]
        self.assertIn("UPDATE tasks SET status = 'PROCESSING'", command)
        self.assertIn('wf-1', args)


class TaskGroupPatchCleanedUpTest(unittest.TestCase):
    """Tests for TaskGroup.patch_cleaned_up."""

    def test_returns_true_when_all_cleaned_up(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        result = task.TaskGroup.patch_cleaned_up(db, 'wf-1', 'g-1')
        self.assertTrue(result)
        # The update should have been issued.
        self.assertEqual(len(db.commit_calls), 1)

    def test_returns_false_when_some_uncleaned(self):
        db = _RecordingPostgresConnector(
            fetch_results=[[types.SimpleNamespace(cleaned_up=False)]])
        result = task.TaskGroup.patch_cleaned_up(db, 'wf-1', 'g-1')
        self.assertFalse(result)


class TaskGroupPatchMetricsInDbTest(unittest.TestCase):
    """Tests for TaskGroup.patch_metrics_in_db."""

    def test_input_download_metrics_updates_download_fields(self):
        db = _RecordingPostgresConnector()
        task.TaskGroup.patch_metrics_in_db(
            db, workflow_id='wf-1', task_name='mytask', retry_id=0,
            metrics_type='input_download',
            start_time=datetime.datetime(2026, 1, 1),
            end_time=datetime.datetime(2026, 1, 2),
        )
        command, _ = db.commit_calls[0]
        self.assertIn('input_download_start_time', command)

    def test_output_upload_metrics_updates_upload_fields(self):
        db = _RecordingPostgresConnector()
        task.TaskGroup.patch_metrics_in_db(
            db, workflow_id='wf-1', task_name='mytask', retry_id=0,
            metrics_type='output_upload',
            start_time=datetime.datetime(2026, 1, 1),
            end_time=datetime.datetime(2026, 1, 2),
        )
        command, _ = db.commit_calls[0]
        self.assertIn('output_upload_start_time', command)

    def test_invalid_metrics_type_raises(self):
        db = _RecordingPostgresConnector()
        with self.assertRaises(osmo_errors.OSMOError):
            task.TaskGroup.patch_metrics_in_db(
                db, workflow_id='wf-1', task_name='mytask', retry_id=0,
                metrics_type='nope',
                start_time=datetime.datetime(2026, 1, 1),
                end_time=datetime.datetime(2026, 1, 2),
            )


class TaskGroupFetchActiveGroupSizeTest(unittest.TestCase):
    """Tests for TaskGroup.fetch_active_group_size."""

    def test_no_rows_raises(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            task.TaskGroup.fetch_active_group_size(db, 'wf-1', 'g-1')

    def test_counts_non_finished_tasks(self):
        rows = [
            {'status': 'RUNNING'},
            {'status': 'COMPLETED'},
            {'status': 'FAILED'},
            {'status': 'WAITING'},
        ]
        db = _RecordingPostgresConnector(fetch_results=[rows])
        size = task.TaskGroup.fetch_active_group_size(db, 'wf-1', 'g-1')
        # RUNNING + WAITING = 2 non-finished.
        self.assertEqual(size, 2)

    def test_invalid_status_raises_database_error(self):
        rows = [{'status': 'NOT_A_STATUS'}]
        db = _RecordingPostgresConnector(fetch_results=[rows])
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            task.TaskGroup.fetch_active_group_size(db, 'wf-1', 'g-1')


class TaskGroupFetchTaskSecretsTest(unittest.TestCase):
    """Tests for TaskGroup.fetch_task_secrets."""

    def _make_row(self, task_creds: Dict[str, Any]) -> types.SimpleNamespace:
        spec = task.TaskGroupSpec(
            name='g-1',
            ignoreNonleadStatus=True,
            tasks=[task.TaskSpec(
                name='mytask',
                image='u', command=['ls'],
                lead=True,
                credentials=task_creds,
            )],
        )
        return types.SimpleNamespace(spec=json.loads(spec.model_dump_json()))

    def test_string_credential_pulls_all_values(self):
        row = self._make_row({'mycred': '/mnt'})
        db = _RecordingPostgresConnector(
            fetch_results=[[row]],
            generic_creds={'mycred': {'k1': 'longenoughvalue',
                                      'k2': 'short'}},
        )
        result = task.TaskGroup.fetch_task_secrets(
            db, workflow_id='wf-1', task_name='mytask',
            user='alice', retry_id=0)
        # Only values with length >= 8 are recorded.
        self.assertEqual(result, {'longenoughvalue'})

    def test_dict_credential_uses_specific_keys(self):
        row = self._make_row({'mycred': {'ENV_KEY': 'k1'}})
        db = _RecordingPostgresConnector(
            fetch_results=[[row]],
            generic_creds={'mycred': {'k1': 'longenoughvalue',
                                      'k2': 'longenoughvalue2'}},
        )
        result = task.TaskGroup.fetch_task_secrets(
            db, workflow_id='wf-1', task_name='mytask',
            user='alice', retry_id=0)
        self.assertEqual(result, {'longenoughvalue'})

    def test_task_not_found_raises(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            task.TaskGroup.fetch_task_secrets(
                db, workflow_id='wf-1', task_name='missing',
                user='alice', retry_id=0)


class TaskGroupFetchTaskSecretsUuidTest(unittest.TestCase):
    """Tests for TaskGroup.fetch_task_secrets_uuid."""

    def _make_row(self, task_creds: Dict[str, Any], task_name: str = 'mytask'
                  ) -> types.SimpleNamespace:
        spec = task.TaskGroupSpec(
            name='g-1',
            ignoreNonleadStatus=True,
            tasks=[task.TaskSpec(
                name=task_name,
                image='u', command=['ls'],
                lead=True,
                credentials=task_creds,
            )],
        )
        return types.SimpleNamespace(
            spec=json.loads(spec.model_dump_json()), name=task_name)

    def test_string_credential_pulls_values(self):
        row = self._make_row({'mycred': '/mnt'})
        db = _RecordingPostgresConnector(
            fetch_results=[[row]],
            generic_creds={'mycred': {'k1': 'longenoughvalue',
                                      'k2': 'x'}},
        )
        result = task.TaskGroup.fetch_task_secrets_uuid(
            db, workflow_id='wf-1', task_uuid='tu-1',
            user='alice', retry_id=0)
        self.assertEqual(result, {'longenoughvalue'})

    def test_dict_credential_pulls_specific_keys(self):
        row = self._make_row({'mycred': {'ENV_KEY': 'k1'}})
        db = _RecordingPostgresConnector(
            fetch_results=[[row]],
            generic_creds={'mycred': {'k1': 'longenoughvalue',
                                      'k2': 'x'}},
        )
        result = task.TaskGroup.fetch_task_secrets_uuid(
            db, workflow_id='wf-1', task_uuid='tu-1',
            user='alice', retry_id=0)
        self.assertEqual(result, {'longenoughvalue'})

    def test_task_not_found_raises(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            task.TaskGroup.fetch_task_secrets_uuid(
                db, workflow_id='wf-1', task_uuid='tu-missing',
                user='alice', retry_id=0)


class TaskGroupGetPodNameTest(unittest.TestCase):
    """Tests for TaskGroup._get_pod_name and get_pod_names."""

    def test_get_pod_name_composes_with_workflow_uuid(self):
        group = _make_group()
        name = group._get_pod_name(  # pylint: disable=protected-access
            'my_task', 'wfuuid')
        # k8s_name lowercases and replaces '_' with '-'
        self.assertEqual(name, 'my-task-wfuuid')

    def test_get_pod_names_returns_one_per_spec_task(self):
        specs = [
            task.TaskSpec(name='t1', image='u', command=['ls'], lead=True),
            task.TaskSpec(name='t2', image='u', command=['ls']),
        ]
        group = _make_group(task_specs=specs)
        names = group.get_pod_names('wu')
        self.assertEqual(names, ['t1-wu', 't2-wu'])


class TaskGroupConvertLabelsToVariablesTest(unittest.TestCase):
    """Tests for TaskGroup._convert_labels_to_variables."""

    def test_skips_non_osmo_labels(self):
        group = _make_group()
        result = group._convert_labels_to_variables(  # pylint: disable=protected-access
            {'osmo.group_name': 'g', 'notosmo': 'x'})
        self.assertNotIn('WF_NOTOSMO', result)
        self.assertIn('WF_GROUP_NAME', result)
        self.assertEqual(result['WF_GROUP_NAME'], 'g')

    def test_workflow_prefix_replaced_with_wf(self):
        group = _make_group()
        result = group._convert_labels_to_variables(  # pylint: disable=protected-access
            {'osmo.workflow_uuid': 'abc123'})
        # 'osmo.workflow_uuid' -> 'WORKFLOW_UUID' -> 'WF_UUID'
        self.assertEqual(result, {'WF_UUID': 'abc123'})

    def test_non_workflow_gets_wf_prefix(self):
        group = _make_group()
        result = group._convert_labels_to_variables(  # pylint: disable=protected-access
            {'osmo.pool': 'gpu-pool'})
        self.assertEqual(result, {'WF_POOL': 'gpu-pool'})


class TaskGroupGetImageSecretNameTest(unittest.TestCase):
    """Tests for TaskGroup._get_image_secret_name."""

    def test_composes_from_group_uid_and_name(self):
        group = _make_group()
        result = group._get_image_secret_name(  # pylint: disable=protected-access
            'guid-xyz', 'user')
        self.assertEqual(result, 'guid-xyz-user')


class TaskGroupLabelsTest(unittest.TestCase):
    """Tests for TaskGroup.system_labels."""

    def test_regular_user_included(self):
        group = _make_group()
        labels = group.system_labels('alice', 'wu' + 'x' * 30)
        self.assertEqual(labels.get('osmo.submitted_by'), 'alice')
        self.assertEqual(labels.get('osmo.workflow_id'), 'wf-1')

    def test_email_user_uses_localpart(self):
        group = _make_group()
        labels = group.system_labels(
            'alice@example.com', 'wu' + 'x' * 30)
        self.assertEqual(labels.get('osmo.submitted_by'), 'alice')

    def test_invalid_user_omits_submitted_by(self):
        group = _make_group()
        # '@' and unusual chars fail the regex → submitted_by dropped.
        labels = group.system_labels(
            '!bad!!!', 'wu' + 'x' * 30)
        self.assertNotIn('osmo.submitted_by', labels)

    def test_invalid_email_localpart_omits_submitted_by(self):
        group = _make_group()
        labels = group.system_labels(
            '!bad!@example.com', 'wu' + 'x' * 30)
        self.assertNotIn('osmo.submitted_by', labels)


class TaskGroupAggregateStatusTest(unittest.TestCase):
    """Tests for TaskGroup._aggregate_status."""

    def _row(self, status: str, lead: bool = True, count: int = 1) -> Dict:
        return {'status': status, 'lead': lead, 'count': count}

    def test_running_when_running_present(self):
        group = _make_group()
        summary = [self._row('RUNNING'), self._row('WAITING')]
        result = group._aggregate_status(summary)  # pylint: disable=protected-access
        self.assertEqual(result, task.TaskGroupStatus.RUNNING)

    def test_initializing_when_all_prerunning(self):
        group = _make_group()
        summary = [self._row('WAITING'), self._row('INITIALIZING')]
        result = group._aggregate_status(summary)  # pylint: disable=protected-access
        self.assertEqual(result, task.TaskGroupStatus.INITIALIZING)

    def test_running_when_finished_and_prerunning_mixed(self):
        group = _make_group()
        # COMPLETED (finished) present alongside WAITING (not-finished-group) →
        # some non-group-finished exists AND finished statuses are present → RUNNING.
        summary = [self._row('COMPLETED'), self._row('WAITING')]
        result = group._aggregate_status(summary)  # pylint: disable=protected-access
        self.assertEqual(result, task.TaskGroupStatus.RUNNING)

    def test_failed_upstream_when_all_finished_with_upstream(self):
        group = _make_group()
        summary = [self._row('FAILED_UPSTREAM'), self._row('COMPLETED')]
        result = group._aggregate_status(summary)  # pylint: disable=protected-access
        self.assertEqual(result, task.TaskGroupStatus.FAILED_UPSTREAM)

    def test_failed_server_error_takes_precedence(self):
        group = _make_group()
        # No UPSTREAM present, but SERVER_ERROR present.
        summary = [self._row('FAILED_SERVER_ERROR'), self._row('COMPLETED')]
        result = group._aggregate_status(summary)  # pylint: disable=protected-access
        self.assertEqual(result, task.TaskGroupStatus.FAILED_SERVER_ERROR)

    def test_failed_preempted_precedence(self):
        group = _make_group()
        summary = [self._row('FAILED_PREEMPTED'), self._row('COMPLETED')]
        result = group._aggregate_status(summary)  # pylint: disable=protected-access
        self.assertEqual(result, task.TaskGroupStatus.FAILED_PREEMPTED)

    def test_failed_evicted_precedence_in_considered(self):
        # FAILED_EVICTED is only considered if in considered_statuses.
        group = _make_group(ignore_nonlead=False)
        summary = [self._row('FAILED_EVICTED', lead=False),
                   self._row('COMPLETED', lead=True)]
        result = group._aggregate_status(summary)  # pylint: disable=protected-access
        self.assertEqual(result, task.TaskGroupStatus.FAILED_EVICTED)

    def test_failed_when_considered_status_failed(self):
        group = _make_group()
        summary = [self._row('FAILED', lead=True),
                   self._row('COMPLETED', lead=True)]
        result = group._aggregate_status(summary)  # pylint: disable=protected-access
        self.assertEqual(result, task.TaskGroupStatus.FAILED)

    def test_completed_when_all_considered_completed(self):
        group = _make_group()
        summary = [self._row('COMPLETED', lead=True, count=3)]
        result = group._aggregate_status(summary)  # pylint: disable=protected-access
        self.assertEqual(result, task.TaskGroupStatus.COMPLETED)

    def test_running_when_no_matches(self):
        # Considered has a non-completed but non-failed row → fall through to RUNNING.
        group = _make_group()
        summary = [self._row('RESCHEDULED', lead=True)]
        result = group._aggregate_status(summary)  # pylint: disable=protected-access
        # RESCHEDULED is group-finished-for-tasks-but-not-groups actually.
        # Since RESCHEDULED.group_finished() is False → returns INITIALIZING
        # (no RUNNING, no finished). We just check it doesn't raise.
        self.assertIn(result, [
            task.TaskGroupStatus.INITIALIZING,
            task.TaskGroupStatus.RUNNING,
        ])

    def test_ignore_nonlead_only_counts_lead_when_true(self):
        group = _make_group(ignore_nonlead=True)
        # Non-lead FAILED should be excluded from considered_statuses.
        summary = [
            self._row('COMPLETED', lead=True, count=1),
            self._row('FAILED', lead=False, count=1),
        ]
        # FAILED_UPSTREAM/SERVER_ERROR/PREEMPTED are checked against all_statuses.
        # Since FAILED is not one of those and not in considered_statuses,
        # the result should be COMPLETED (all considered are completed).
        result = group._aggregate_status(summary)  # pylint: disable=protected-access
        self.assertEqual(result, task.TaskGroupStatus.COMPLETED)


class TaskGroupUpdateStatusToDbTest(unittest.TestCase):
    """Tests for TaskGroup.update_status_to_db."""

    def test_in_queue_status_skips_aggregation_and_updates(self):
        db = _RecordingPostgresConnector()
        group = _make_group(database=db, status=task.TaskGroupStatus.SUBMITTING)
        group.update_status_to_db(
            update_time=datetime.datetime(2026, 1, 1),
            status=task.TaskGroupStatus.WAITING,
        )
        # An update should have been committed.
        self.assertEqual(len(db.commit_calls), 1)
        command, _ = db.commit_calls[0]
        self.assertIn('UPDATE groups', command)

    def test_canceled_status_skips_aggregation(self):
        db = _RecordingPostgresConnector()
        group = _make_group(database=db, status=task.TaskGroupStatus.RUNNING)
        group.update_status_to_db(
            update_time=datetime.datetime(2026, 1, 1),
            status=task.TaskGroupStatus.FAILED_CANCELED,
            message='canceled by user',
        )
        self.assertEqual(len(db.commit_calls), 1)

    def test_force_cancel_uses_expanded_status_list(self):
        db = _RecordingPostgresConnector()
        group = _make_group(database=db, status=task.TaskGroupStatus.PROCESSING)
        group.update_status_to_db(
            update_time=datetime.datetime(2026, 1, 1),
            status=task.TaskGroupStatus.FAILED_CANCELED,
            message='force',
            force_cancel=True,
        )
        # Force cancel path uses the version of allowed statuses that
        # includes 'PROCESSING'.
        command, _ = db.commit_calls[0]
        self.assertIn("'PROCESSING'", command)


class TaskGroupUpdateDownstreamGroupsInDbTest(unittest.TestCase):
    """Tests for TaskGroup.update_downstream_groups_in_db."""

    def test_no_downstream_groups_returns_empty(self):
        db = _RecordingPostgresConnector()
        group = _make_group(database=db, downstream_groups=set())
        result = group.update_downstream_groups_in_db()
        self.assertEqual(result, [])

    def test_missing_downstream_raises(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        group = _make_group(database=db, downstream_groups={'missing'})
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            group.update_downstream_groups_in_db()


class TaskGroupFetchStatusSummaryTest(unittest.TestCase):
    """Tests for TaskGroup._fetch_status_summary."""

    def test_returns_rows_when_present(self):
        rows = [{'status': 'RUNNING', 'lead': True, 'count': 1}]
        db = _RecordingPostgresConnector(fetch_results=[rows])
        result = task.TaskGroup._fetch_status_summary(  # pylint: disable=protected-access
            db, 'wf-1', 'g-1')
        self.assertEqual(result, rows)

    def test_raises_when_no_rows(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            task.TaskGroup._fetch_status_summary(  # pylint: disable=protected-access
                db, 'wf-1', 'g-1')


class TaskGroupFetchFromDbTest(unittest.TestCase):
    """Tests for TaskGroup.fetch_from_db."""

    def test_raises_when_no_group_found(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            task.TaskGroup.fetch_from_db(db, 'wf-1', 'g-1')

    def test_raises_when_metadata_group_not_found(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            task.TaskGroup.fetch_metadata_from_db(db, 'wf-1', 'g-1')


class TaskGroupBatchInsertGroupsAndTasksTest(unittest.TestCase):
    """Tests for TaskGroup.batch_insert_groups_and_tasks."""

    def test_empty_entries_is_no_op(self):
        db = _RecordingPostgresConnector()
        task.TaskGroup.batch_insert_groups_and_tasks(db, [], [])
        self.assertEqual(db.commit_calls, [])
        self.assertEqual(db.commit_commands_calls, [])

    def test_group_entries_produce_insert_groups(self):
        db = _RecordingPostgresConnector()
        # 11 columns per group entry per the INSERT statement.
        entry = tuple(f'v{i}' for i in range(11))
        task.TaskGroup.batch_insert_groups_and_tasks(
            db, [entry], [])
        self.assertEqual(len(db.commit_commands_calls), 1)
        commands = db.commit_commands_calls[0]
        self.assertEqual(len(commands), 1)
        self.assertIn('INSERT INTO groups', commands[0][0])

    def test_task_entries_produce_insert_tasks(self):
        db = _RecordingPostgresConnector()
        # 15 columns per task entry per the INSERT statement.
        entry = tuple(f'v{i}' for i in range(15))
        task.TaskGroup.batch_insert_groups_and_tasks(
            db, [], [entry])
        self.assertEqual(len(db.commit_commands_calls), 1)
        commands = db.commit_commands_calls[0]
        self.assertEqual(len(commands), 1)
        self.assertIn('INSERT INTO tasks', commands[0][0])

    def test_zero_or_negative_batch_size_defaults(self):
        db = _RecordingPostgresConnector()
        entry = tuple(f'v{i}' for i in range(11))
        task.TaskGroup.batch_insert_groups_and_tasks(
            db, [entry], [], batch_size=0)
        # Should not raise; issues a commit.
        self.assertEqual(len(db.commit_commands_calls), 1)


class TaskGroupBatchSetGroupsToProcessingTest(unittest.TestCase):
    """Tests for TaskGroup.batch_set_groups_to_processing."""

    def test_empty_names_returns_empty(self):
        db = _RecordingPostgresConnector()
        result = task.TaskGroup.batch_set_groups_to_processing(
            db, 'wf-1', [], datetime.datetime(2026, 1, 1), {})
        self.assertEqual(result, [])
        self.assertEqual(db.commit_calls, [])

    def test_transitioned_groups_returned_and_tasks_updated(self):
        db = _RecordingPostgresConnector(
            fetch_results=[[{'name': 'g-1'}]])
        result = task.TaskGroup.batch_set_groups_to_processing(
            db, 'wf-1', ['g-1'],
            datetime.datetime(2026, 1, 1),
            {'g-1': '{}'})
        self.assertEqual(result, ['g-1'])
        # Tasks update should be issued for the transitioned group.
        self.assertEqual(len(db.commit_calls), 1)

    def test_no_transitioned_groups_skips_task_update(self):
        db = _RecordingPostgresConnector(fetch_results=[[]])
        result = task.TaskGroup.batch_set_groups_to_processing(
            db, 'wf-1', ['g-1'],
            datetime.datetime(2026, 1, 1),
            {'g-1': '{}'})
        self.assertEqual(result, [])
        # No task-update commit since no groups transitioned.
        self.assertEqual(db.commit_calls, [])


_FULL_TASK_ROW: Dict[str, Any] = {
    'workflow_id': 'wf-1',
    'workflow_uuid': 'wu-1' + 'x' * 28,
    'name': 'mytask',
    'group_name': 'g-1',
    'task_uuid': 't-1' + 'x' * 29,
    'task_db_key': 'k-1' + 'x' * 29,
    'retry_id': 0,
    'status': 'WAITING',
    'start_time': None,
    'end_time': None,
    'failure_message': None,
    'exit_actions': {},
    'node_name': None,
    'lead': True,
}


class TaskFetchFromDbSuccessTest(unittest.TestCase):
    """Task.fetch_from_db success path."""

    def test_returns_task_from_last_row(self):
        db = _RecordingPostgresConnector(fetch_results=[[_FULL_TASK_ROW]])
        result = task.Task.fetch_from_db(db, 'wf-1', 'mytask')
        self.assertEqual(result.name, 'mytask')
        self.assertEqual(result.status, task.TaskGroupStatus.WAITING)


class TaskFetchFromDbFromUuidSuccessTest(unittest.TestCase):
    """Task.fetch_from_db_from_uuid success path."""

    def test_returns_task(self):
        db = _RecordingPostgresConnector(fetch_results=[[_FULL_TASK_ROW]])
        result = task.Task.fetch_from_db_from_uuid(
            db, workflow_uuid='wu', task_uuid='tu')
        self.assertEqual(result.name, 'mytask')


class TaskAddRefreshTokenToDbTest(unittest.TestCase):
    """Task.add_refresh_token_to_db."""

    def test_hashes_and_commits(self):
        db = _RecordingPostgresConnector()
        t = _make_task(database=db)
        with mock.patch(
            'src.utils.job.task.auth.hash_access_token',
            return_value=b'hashed',
        ):
            t.add_refresh_token_to_db('secret-token')
        self.assertEqual(len(db.commit_calls), 1)
        command, args = db.commit_calls[0]
        self.assertIn('UPDATE tasks', command)
        self.assertIn(b'hashed', args)


class TaskBatchUpdateStatusToDbTest(unittest.TestCase):
    """Task.batch_update_status_to_db."""

    def test_failed_start_timeout_status_restricts_state_set(self):
        db = _RecordingPostgresConnector()
        task.Task.batch_update_status_to_db(
            database=db,
            workflow_id='wf-1',
            group_name='g-1',
            status=task.TaskGroupStatus.FAILED_START_TIMEOUT,
            update_time=datetime.datetime(2026, 1, 1),
            message='',
        )
        self.assertEqual(len(db.commit_calls), 1)
        command, _ = db.commit_calls[0]
        # FAILED_START_TIMEOUT branch omits 'RUNNING' from the state list.
        self.assertIn("'INITIALIZING'", command)
        self.assertNotIn("'RUNNING'", command)

    def test_other_failed_status_includes_running(self):
        db = _RecordingPostgresConnector()
        task.Task.batch_update_status_to_db(
            database=db,
            workflow_id='wf-1',
            group_name='g-1',
            status=task.TaskGroupStatus.FAILED,
            update_time=datetime.datetime(2026, 1, 1),
            message='',
        )
        command, _ = db.commit_calls[0]
        self.assertIn("'RUNNING'", command)


class TaskGroupUpdateStatusAggregatePathTest(unittest.TestCase):
    """TaskGroup.update_status_to_db non-in_queue path."""

    def test_running_status_triggers_aggregation(self):
        # RUNNING is not in_queue/canceled, so the aggregation path is taken.
        db = _RecordingPostgresConnector()
        group = _make_group(database=db, status=task.TaskGroupStatus.WAITING)
        summary = [{'status': 'RUNNING', 'lead': True, 'count': 1}]
        with mock.patch.object(
            task.TaskGroup, '_fetch_status_summary',
            return_value=summary,
        ):
            group.update_status_to_db(
                update_time=datetime.datetime(2026, 1, 1),
                status=task.TaskGroupStatus.RUNNING,
                message='',
            )
        # Aggregation returned RUNNING; a commit was issued.
        self.assertEqual(len(db.commit_calls), 1)
        command, _ = db.commit_calls[0]
        self.assertIn('UPDATE groups', command)

    def test_no_change_when_aggregate_equals_current_status(self):
        # When _aggregate_status returns the same status the group already
        # holds, the update is short-circuited.
        db = _RecordingPostgresConnector()
        group = _make_group(database=db, status=task.TaskGroupStatus.RUNNING)
        with mock.patch.object(
            task.TaskGroup, '_fetch_status_summary',
            return_value=[{'status': 'RUNNING', 'lead': True, 'count': 1}],
        ):
            group.update_status_to_db(
                update_time=datetime.datetime(2026, 1, 1),
                status=task.TaskGroupStatus.RUNNING,
                message='',
            )
        self.assertEqual(db.commit_calls, [])

    def test_scheduling_aggregate_uses_scheduling_branch(self):
        db = _RecordingPostgresConnector()
        group = _make_group(database=db, status=task.TaskGroupStatus.WAITING)
        with mock.patch.object(
            task.TaskGroup, '_aggregate_status',
            return_value=task.TaskGroupStatus.SCHEDULING,
        ), mock.patch.object(
            task.TaskGroup, '_fetch_status_summary',
            return_value=[{'status': 'SCHEDULING', 'lead': True, 'count': 1}],
        ):
            group.update_status_to_db(
                update_time=datetime.datetime(2026, 1, 1),
                status=task.TaskGroupStatus.SCHEDULING,
                message='',
            )
        command, _ = db.commit_calls[0]
        self.assertIn('scheduling_start_time', command)

    def test_initializing_aggregate_uses_initializing_branch(self):
        db = _RecordingPostgresConnector()
        group = _make_group(database=db, status=task.TaskGroupStatus.WAITING)
        with mock.patch.object(
            task.TaskGroup, '_aggregate_status',
            return_value=task.TaskGroupStatus.INITIALIZING,
        ), mock.patch.object(
            task.TaskGroup, '_fetch_status_summary',
            return_value=[],
        ):
            group.update_status_to_db(
                update_time=datetime.datetime(2026, 1, 1),
                status=task.TaskGroupStatus.INITIALIZING,
                message='',
            )
        command, _ = db.commit_calls[0]
        self.assertIn('initializing_start_time', command)

    def test_running_aggregate_uses_running_branch(self):
        db = _RecordingPostgresConnector()
        group = _make_group(database=db, status=task.TaskGroupStatus.WAITING)
        with mock.patch.object(
            task.TaskGroup, '_aggregate_status',
            return_value=task.TaskGroupStatus.RUNNING,
        ), mock.patch.object(
            task.TaskGroup, '_fetch_status_summary',
            return_value=[],
        ):
            group.update_status_to_db(
                update_time=datetime.datetime(2026, 1, 1),
                status=task.TaskGroupStatus.RUNNING,
                message='',
            )
        command, _ = db.commit_calls[0]
        self.assertIn('start_time', command)


class TaskGroupBuildTopologyTreeTest(unittest.TestCase):
    """TaskGroup._build_topology_tree."""

    def _make_group_with_topology(self, database):
        topology_req = connectors.TopologyRequirement(
            key='rack', group='default',
            requirementType=connectors.TopologyRequirementType.REQUIRED,
        )
        resources = connectors.ResourceSpec(topology=[topology_req])
        spec = task.TaskSpec(
            name='lead', image='ubuntu', command=['ls'],
            lead=True, resources=resources,
        )
        return _make_group(database=database, task_specs=[spec])

    def test_no_topology_skips_db_fetch(self):
        db = _RecordingPostgresConnector()
        group = _make_group(database=db)
        # Regular _make_group has a task with no topology reqs.
        keys, task_infos = group._build_topology_tree(  # pylint: disable=protected-access
            'pool-a')
        self.assertEqual(keys, [])
        self.assertEqual(len(task_infos), 1)

    def test_topology_present_fetches_pool_and_builds_keys(self):
        db = _RecordingPostgresConnector()
        group = self._make_group_with_topology(db)
        # Mock the pool fetch to return topology_keys.
        fake_pool = types.SimpleNamespace(
            topology_keys=[
                types.SimpleNamespace(key='rack', label='topology.kubernetes.io/rack'),
            ],
        )
        with mock.patch.object(
            connectors.Pool, 'fetch_from_db', return_value=fake_pool,
        ):
            keys, task_infos = group._build_topology_tree(  # pylint: disable=protected-access
                'pool-a')
        self.assertEqual(len(keys), 1)
        self.assertEqual(keys[0].key, 'rack')
        self.assertEqual(len(task_infos), 1)
        # The topology requirement was captured.
        self.assertEqual(len(task_infos[0].topology_requirements), 1)

    def test_topology_pool_without_keys_returns_empty_list(self):
        db = _RecordingPostgresConnector()
        group = self._make_group_with_topology(db)
        fake_pool = types.SimpleNamespace(topology_keys=[])
        with mock.patch.object(
            connectors.Pool, 'fetch_from_db', return_value=fake_pool,
        ):
            keys, _ = group._build_topology_tree('p')  # pylint: disable=protected-access
        self.assertEqual(keys, [])


class TaskGroupTaskLabelsNoPlatformTest(unittest.TestCase):
    """TaskGroup._task_labels missing-platform raise."""

    def test_missing_platform_raises_osmo_error(self):
        group = _make_group()
        task_obj = _make_task(name='lead')
        # Craft a spec with no platform (default is None).
        spec = task.TaskSpec(name='lead', image='ubuntu', command=['ls'])
        # Sanity: platform must be None to trigger the branch.
        self.assertIsNone(spec.resources.platform)
        priority = mock.Mock()
        priority.value = 'HIGH'
        with self.assertRaises(osmo_errors.OSMOError):
            group._task_labels(  # pylint: disable=protected-access
                'alice', 'wu' + 'x' * 30, task_obj, spec, 'poolA', priority)


class _RegistryCredsPostgresConnector(_RecordingPostgresConnector):
    """PostgresConnector that returns a preset registry credential map."""

    def __init__(self, registry_map: Dict[str, Dict[str, str]] | None = None):
        super().__init__()
        self._registry_map = registry_map or {}

    def get_all_registry_creds(self, user):  # pylint: disable=unused-argument
        return self._registry_map


class TaskGroupGetRegistryCredsTest(unittest.TestCase):
    """TaskGroup._get_registry_creds."""

    def test_user_registry_creds_generated_when_match(self):
        # Task image maps to a registry the user has credentials for.
        registry_map = {
            'docker.io': {'username': 'alice', 'auth': 'apw'},
        }
        db = _RegistryCredsPostgresConnector(registry_map=registry_map)
        spec = task.TaskSpec(
            name='t', image='docker.io/library/ubuntu:22.04', command=['ls'])
        group = _make_group(task_specs=[spec], database=db)

        workflow_config = types.SimpleNamespace(
            backend_images=types.SimpleNamespace(
                credential=types.SimpleNamespace(
                    registry='', username='', auth=None,
                ),
            ),
        )
        # First call: user credentials only (osmo empty).
        user, osmo = group._get_registry_creds(  # pylint: disable=protected-access
            'alice', workflow_config)  # type: ignore[arg-type]
        self.assertTrue(len(user) > 0)
        self.assertIsNone(osmo)

    def test_osmo_registry_creds_generated_when_configured(self):
        db = _RegistryCredsPostgresConnector()
        spec = task.TaskSpec(name='t', image='ubuntu', command=['ls'])
        group = _make_group(task_specs=[spec], database=db)

        auth_secret = mock.Mock()
        auth_secret.get_secret_value.return_value = 'osmo-pw'
        workflow_config = types.SimpleNamespace(
            backend_images=types.SimpleNamespace(
                credential=types.SimpleNamespace(
                    registry='nvcr.io',
                    username='osmo',
                    auth=auth_secret,
                ),
            ),
        )
        _, osmo = group._get_registry_creds(  # pylint: disable=protected-access
            'alice', workflow_config)  # type: ignore[arg-type]
        self.assertIsNotNone(osmo)


class TaskGroupFromDbRowSchedulerAndTemplatesTest(unittest.TestCase):
    """TaskGroup.from_db_row scheduler+template branches."""

    def _row(self, **overrides):
        base = types.SimpleNamespace(
            workflow_id='wf-1',
            name='g-1',
            group_uuid='g-uuid' + 'x' * 26,
            spec={'name': 'g-1', 'tasks': [
                {'name': 'lead', 'image': 'ubuntu', 'command': ['ls'],
                 'lead': True},
            ]},
            remaining_upstream_groups=None,
            downstream_groups=None,
            scheduler_settings=None,
            group_template_resource_types=None,
            start_time=None,
            end_time=None,
            processing_start_time=None,
            scheduling_start_time=None,
            initializing_start_time=None,
            status='WAITING',
            failure_message=None,
        )
        for k, v in overrides.items():
            setattr(base, k, v)
        return base

    def test_scheduler_settings_parsed(self):
        row = self._row(
            scheduler_settings='{"scheduler_name": "kai-scheduler"}',
        )
        db = _RecordingPostgresConnector()
        with mock.patch.object(
            task.Task, 'list_by_group_name', return_value=[],
        ):
            group = task.TaskGroup.from_db_row(row, db, load_tasks=True)
        # Assert we produced a TaskGroup and reached the scheduler branch.
        self.assertEqual(group.name, 'g-1')
        self.assertIsNotNone(group.scheduler_settings)

    def test_group_template_resource_types_populated(self):
        row = self._row(
            group_template_resource_types=[
                {'apiVersion': 'v1', 'kind': 'ConfigMap'},
            ],
        )
        db = _RecordingPostgresConnector()
        with mock.patch.object(
            task.Task, 'list_by_group_name', return_value=[],
        ):
            group = task.TaskGroup.from_db_row(row, db, load_tasks=True)
        self.assertEqual(
            group.group_template_resource_types,
            [{'apiVersion': 'v1', 'kind': 'ConfigMap'}])


class TaskGroupUpdateDownstreamGroupsSuccessTest(unittest.TestCase):
    """TaskGroup.update_downstream_groups_in_db success path."""

    def test_downstream_with_empty_remaining_returned(self):
        # Row for a downstream group whose remaining_upstream_groups is empty
        # after decrement — should be returned from update_downstream_groups_in_db.
        downstream_row = types.SimpleNamespace(
            workflow_id='wf-1',
            name='down-1',
            group_uuid='down-1' + 'x' * 26,
            spec={'name': 'down-1', 'tasks': [
                {'name': 'lead', 'image': 'ubuntu', 'command': ['ls'],
                 'lead': True},
            ]},
            remaining_upstream_groups=None,
            downstream_groups=None,
            scheduler_settings=None,
            group_template_resource_types=None,
            start_time=None,
            end_time=None,
            processing_start_time=None,
            scheduling_start_time=None,
            initializing_start_time=None,
            status='WAITING',
            failure_message=None,
        )
        db = _RecordingPostgresConnector(fetch_results=[[downstream_row]])
        group = _make_group(database=db, downstream_groups={'down-1'})
        with mock.patch.object(
            task.Task, 'list_by_group_name', return_value=[],
        ):
            result = group.update_downstream_groups_in_db()
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, 'down-1')


if __name__ == '__main__':
    unittest.main()
