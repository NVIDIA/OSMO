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
import copy
import datetime
import unittest
from unittest import mock

import pydantic

from src.lib.utils import credentials, osmo_errors
from src.lib.utils.osmo_errors import OSMOResourceError
from src.utils import connectors
from src.utils.job import task, kb_objects


class ShortenNameToFitKbTest(unittest.TestCase):
    """Pure-function tests for shorten_name_to_fit_kb."""

    def test_short_name_returned_unchanged(self):
        self.assertEqual(task.shorten_name_to_fit_kb('mytask'), 'mytask')

    def test_exactly_63_chars_returned_unchanged(self):
        name = 'x' * 63
        self.assertEqual(task.shorten_name_to_fit_kb(name), name)

    def test_long_name_truncated_to_63(self):
        name = 'a' * 200
        self.assertEqual(task.shorten_name_to_fit_kb(name), 'a' * 63)

    def test_long_name_strips_trailing_hyphen(self):
        # First 63 chars end with '-' so rstrip removes it.
        name = 'a' * 62 + '-' + 'b' * 50
        self.assertEqual(task.shorten_name_to_fit_kb(name), 'a' * 62)

    def test_long_name_strips_trailing_underscore(self):
        name = 'a' * 62 + '_' + 'b' * 50
        self.assertEqual(task.shorten_name_to_fit_kb(name), 'a' * 62)

    def test_long_name_strips_multiple_trailing_specials(self):
        # First 63 chars have multiple trailing hyphens and underscores
        name = 'a' * 60 + '---' + 'b' * 50
        self.assertEqual(task.shorten_name_to_fit_kb(name), 'a' * 60)


class CreateLoginDictTest(unittest.TestCase):
    """Tests for create_login_dict token vs dev login branches."""

    def test_token_branch_includes_token_login_block(self):
        result = task.create_login_dict(
            user='alice',
            url='https://api.example.com',
            token='my-token',
            refresh_endpoint='https://api.example.com/refresh',
            refresh_token='refresh-abc',
        )
        self.assertEqual(result['username'], 'alice')
        self.assertEqual(result['url'], 'https://api.example.com')
        self.assertTrue(result['osmo_token'])
        self.assertEqual(result['token_login']['id_token'], 'my-token')
        self.assertEqual(
            result['token_login']['refresh_url'], 'https://api.example.com/refresh'
        )
        self.assertEqual(result['token_login']['refresh_token'], 'refresh-abc')

    def test_token_branch_omits_dev_login(self):
        result = task.create_login_dict(
            user='alice', url='https://api.example.com', token='my-token'
        )
        self.assertNotIn('dev_login', result)

    def test_no_token_branch_uses_dev_login(self):
        result = task.create_login_dict(user='bob', url='https://example.com')
        self.assertEqual(result['url'], 'https://example.com')
        self.assertEqual(result['dev_login']['username'], 'bob')

    def test_no_token_branch_omits_token_login(self):
        result = task.create_login_dict(user='bob', url='https://example.com')
        self.assertNotIn('token_login', result)
        self.assertNotIn('osmo_token', result)


class CreateConfigDictTest(unittest.TestCase):
    """Tests for create_config_dict."""

    def test_static_credential_includes_access_keys(self):
        static_cred = credentials.StaticDataCredential(
            endpoint='s3://bucket',
            access_key_id='ACCESS_KEY_ID',
            access_key='ACCESS_KEY_VALUE',
            region='us-east-1',
        )
        result = task.create_config_dict({'s3://bucket': static_cred})
        entry = result['auth']['data']['s3://bucket']
        self.assertEqual(entry['access_key_id'], 'ACCESS_KEY_ID')
        self.assertEqual(entry['access_key'], 'ACCESS_KEY_VALUE')

    def test_default_credential_omits_access_keys(self):
        default_cred = credentials.DefaultDataCredential(
            endpoint='s3://bucket', region='us-east-2'
        )
        result = task.create_config_dict({'s3://bucket': default_cred})
        entry = result['auth']['data']['s3://bucket']
        self.assertEqual(entry['endpoint'], 's3://bucket')
        self.assertNotIn('access_key_id', entry)
        self.assertNotIn('access_key', entry)

    def test_empty_input_yields_empty_data_dict(self):
        result = task.create_config_dict({})
        self.assertEqual(result, {'auth': {'data': {}}})


class TaskGroupStatusFinishedTest(unittest.TestCase):
    """Predicates: finished, group_finished, failed."""

    def test_finished_completed_true(self):
        self.assertTrue(task.TaskGroupStatus.COMPLETED.finished())

    def test_finished_rescheduled_true(self):
        self.assertTrue(task.TaskGroupStatus.RESCHEDULED.finished())

    def test_finished_failed_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED.finished())

    def test_finished_failed_canceled_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_CANCELED.finished())

    def test_finished_running_false(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.finished())

    def test_finished_waiting_false(self):
        self.assertFalse(task.TaskGroupStatus.WAITING.finished())

    def test_group_finished_completed_true(self):
        self.assertTrue(task.TaskGroupStatus.COMPLETED.group_finished())

    def test_group_finished_failed_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_BACKEND_ERROR.group_finished())

    def test_group_finished_rescheduled_false(self):
        # RESCHEDULED is finished for tasks but not for groups.
        self.assertFalse(task.TaskGroupStatus.RESCHEDULED.group_finished())

    def test_group_finished_running_false(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.group_finished())

    def test_failed_failed_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED.failed())

    def test_failed_failed_upstream_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_UPSTREAM.failed())

    def test_failed_completed_false(self):
        self.assertFalse(task.TaskGroupStatus.COMPLETED.failed())

    def test_failed_running_false(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.failed())


class TaskGroupStatusQueuePredicatesTest(unittest.TestCase):
    """Predicates: prescheduling, in_queue, prerunning."""

    def test_prescheduling_submitting_true(self):
        self.assertTrue(task.TaskGroupStatus.SUBMITTING.prescheduling())

    def test_prescheduling_waiting_true(self):
        self.assertTrue(task.TaskGroupStatus.WAITING.prescheduling())

    def test_prescheduling_processing_true(self):
        self.assertTrue(task.TaskGroupStatus.PROCESSING.prescheduling())

    def test_prescheduling_scheduling_false(self):
        self.assertFalse(task.TaskGroupStatus.SCHEDULING.prescheduling())

    def test_prescheduling_running_false(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.prescheduling())

    def test_in_queue_submitting_true(self):
        self.assertTrue(task.TaskGroupStatus.SUBMITTING.in_queue())

    def test_in_queue_scheduling_true(self):
        self.assertTrue(task.TaskGroupStatus.SCHEDULING.in_queue())

    def test_in_queue_initializing_false(self):
        self.assertFalse(task.TaskGroupStatus.INITIALIZING.in_queue())

    def test_in_queue_running_false(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.in_queue())

    def test_prerunning_initializing_true(self):
        self.assertTrue(task.TaskGroupStatus.INITIALIZING.prerunning())

    def test_prerunning_waiting_true(self):
        self.assertTrue(task.TaskGroupStatus.WAITING.prerunning())

    def test_prerunning_running_false(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.prerunning())

    def test_prerunning_completed_false(self):
        self.assertFalse(task.TaskGroupStatus.COMPLETED.prerunning())


class TaskGroupStatusErrorPredicatesTest(unittest.TestCase):
    """Predicates: canceled, server_errored, has_error_logs."""

    def test_canceled_failed_canceled_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_CANCELED.canceled())

    def test_canceled_failed_exec_timeout_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_EXEC_TIMEOUT.canceled())

    def test_canceled_failed_queue_timeout_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_QUEUE_TIMEOUT.canceled())

    def test_canceled_plain_failed_false(self):
        self.assertFalse(task.TaskGroupStatus.FAILED.canceled())

    def test_canceled_completed_false(self):
        self.assertFalse(task.TaskGroupStatus.COMPLETED.canceled())

    def test_server_errored_failed_server_error_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_SERVER_ERROR.server_errored())

    def test_server_errored_failed_evicted_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_EVICTED.server_errored())

    def test_server_errored_failed_start_error_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_START_ERROR.server_errored())

    def test_server_errored_failed_image_pull_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_IMAGE_PULL.server_errored())

    def test_server_errored_plain_failed_false(self):
        self.assertFalse(task.TaskGroupStatus.FAILED.server_errored())

    def test_server_errored_completed_false(self):
        self.assertFalse(task.TaskGroupStatus.COMPLETED.server_errored())

    def test_has_error_logs_rescheduled_true(self):
        self.assertTrue(task.TaskGroupStatus.RESCHEDULED.has_error_logs())

    def test_has_error_logs_failed_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED.has_error_logs())

    def test_has_error_logs_failed_canceled_false(self):
        # canceled() is true → excluded from error logs.
        self.assertFalse(task.TaskGroupStatus.FAILED_CANCELED.has_error_logs())

    def test_has_error_logs_failed_upstream_false(self):
        self.assertFalse(task.TaskGroupStatus.FAILED_UPSTREAM.has_error_logs())

    def test_has_error_logs_failed_server_error_false(self):
        # server_errored() is true → excluded from error logs.
        self.assertFalse(task.TaskGroupStatus.FAILED_SERVER_ERROR.has_error_logs())

    def test_has_error_logs_completed_false(self):
        self.assertFalse(task.TaskGroupStatus.COMPLETED.has_error_logs())

    def test_has_error_logs_running_false(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.has_error_logs())


class TaskGroupStatusClassmethodsTest(unittest.TestCase):
    """Tests for backend_states and get_alive_statuses."""

    def test_backend_states_includes_running(self):
        self.assertIn('RUNNING', task.TaskGroupStatus.backend_states())

    def test_backend_states_includes_scheduling(self):
        self.assertIn('SCHEDULING', task.TaskGroupStatus.backend_states())

    def test_backend_states_returns_expected_set(self):
        self.assertEqual(
            sorted(task.TaskGroupStatus.backend_states()),
            sorted(['SCHEDULING', 'DOWNLOADING', 'RUNNING', 'UPLOADING']),
        )

    def test_get_alive_statuses_includes_running(self):
        self.assertIn(
            task.TaskGroupStatus.RUNNING, task.TaskGroupStatus.get_alive_statuses()
        )

    def test_get_alive_statuses_includes_rescheduled(self):
        self.assertIn(
            task.TaskGroupStatus.RESCHEDULED,
            task.TaskGroupStatus.get_alive_statuses(),
        )

    def test_get_alive_statuses_excludes_completed(self):
        self.assertNotIn(
            task.TaskGroupStatus.COMPLETED,
            task.TaskGroupStatus.get_alive_statuses(),
        )

    def test_get_alive_statuses_excludes_failed(self):
        self.assertNotIn(
            task.TaskGroupStatus.FAILED, task.TaskGroupStatus.get_alive_statuses()
        )


class ExitCodeAndExitActionTest(unittest.TestCase):
    """Tests for ExitCode and ExitAction enum values."""

    def test_exit_action_completed_value(self):
        self.assertEqual(task.ExitAction.COMPLETED.value, 'COMPLETE')

    def test_exit_action_failed_value(self):
        self.assertEqual(task.ExitAction.FAILED.value, 'FAIL')

    def test_exit_action_rescheduled_value(self):
        self.assertEqual(task.ExitAction.RESCHEDULED.value, 'RESCHEDULE')

    def test_exit_action_from_string_completed(self):
        self.assertEqual(task.ExitAction('COMPLETE'), task.ExitAction.COMPLETED)

    def test_exit_action_invalid_string_raises(self):
        with self.assertRaises(ValueError):
            task.ExitAction('NOT_A_REAL_ACTION')

    def test_exit_code_failed_preflight_value(self):
        self.assertEqual(task.ExitCode.FAILED_PREFLIGHT.value, 1001)

    def test_exit_code_failed_upstream_value(self):
        self.assertEqual(task.ExitCode.FAILED_UPSTREAM.value, 3000)

    def test_exit_code_failed_unknown_value(self):
        self.assertEqual(task.ExitCode.FAILED_UNKNOWN.value, 4000)


class TaskInputOutputTest(unittest.TestCase):
    """Tests for TaskInputOutput regex validation and workflow info parsing."""

    def test_empty_regex_passes(self):
        spec = task.TaskInputOutput(task='task1', regex='')
        self.assertEqual(spec.regex, '')

    def test_valid_regex_passes(self):
        spec = task.TaskInputOutput(task='task1', regex=r'.*\.csv$')
        self.assertEqual(spec.regex, r'.*\.csv$')

    def test_invalid_regex_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskInputOutput(task='task1', regex='[unclosed')

    def test_is_from_previous_workflow_with_workflow_id_returns_true(self):
        spec = task.TaskInputOutput(task='wf-1:upstream-task')
        self.assertTrue(spec.is_from_previous_workflow())

    def test_is_from_previous_workflow_simple_name_returns_false(self):
        spec = task.TaskInputOutput(task='upstream-task')
        self.assertFalse(spec.is_from_previous_workflow())

    def test_parsed_workflow_info_qualified_name(self):
        spec = task.TaskInputOutput(task='wf-id:tname')
        self.assertEqual(spec.parsed_workflow_info(), ('wf-id', 'tname'))

    def test_parsed_workflow_info_simple_name(self):
        spec = task.TaskInputOutput(task='tname')
        self.assertEqual(spec.parsed_workflow_info(), ('tname', None))

    def test_hash_uses_class_and_task(self):
        spec_a = task.TaskInputOutput(task='task1')
        spec_b = task.TaskInputOutput(task='task1', regex='abc')
        # __hash__ ignores regex; only class + task contribute.
        self.assertEqual(hash(spec_a), hash(spec_b))

    def test_hash_differs_for_different_tasks(self):
        spec_a = task.TaskInputOutput(task='task1')
        spec_b = task.TaskInputOutput(task='task2')
        self.assertNotEqual(hash(spec_a), hash(spec_b))


class DatasetInputOutputTest(unittest.TestCase):
    """Tests for DatasetInputOutput field validators."""

    def _make(self, **fields) -> task.DatasetInputOutput:
        defaults = {'name': 'mydataset'}
        defaults.update(fields)
        return task.DatasetInputOutput(dataset=defaults)

    def test_valid_name_passes(self):
        spec = self._make(name='valid-name_1')
        self.assertEqual(spec.dataset.name, 'valid-name_1')

    def test_invalid_name_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            self._make(name='!!bad!!')

    def test_empty_path_passes(self):
        spec = self._make(path='')
        self.assertEqual(spec.dataset.path, '')

    def test_valid_path_passes(self):
        spec = self._make(path='subdir/file.txt')
        self.assertEqual(spec.dataset.path, 'subdir/file.txt')

    def test_invalid_path_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            self._make(path='bad?path')

    def test_invalid_metadata_path_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            self._make(metadata=['bad,path'])

    def test_valid_metadata_passes(self):
        spec = self._make(metadata=['meta/info.json'])
        self.assertEqual(spec.dataset.metadata, ['meta/info.json'])

    def test_invalid_label_path_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            self._make(labels=['bad<path'])

    def test_valid_labels_passes(self):
        spec = self._make(labels=['mylabel/subdir'])
        self.assertEqual(spec.dataset.labels, ['mylabel/subdir'])

    def test_empty_regex_passes(self):
        spec = self._make(regex='')
        self.assertEqual(spec.dataset.regex, '')

    def test_invalid_regex_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            self._make(regex='[unclosed')

    def test_hash_uses_name_and_path(self):
        spec_a = task.DatasetInputOutput(
            dataset={'name': 'mydataset', 'path': 'p1'}
        )
        spec_b = task.DatasetInputOutput(
            dataset={'name': 'mydataset', 'path': 'p1'}
        )
        self.assertEqual(hash(spec_a), hash(spec_b))

    def test_hash_differs_for_different_path(self):
        spec_a = task.DatasetInputOutput(
            dataset={'name': 'mydataset', 'path': 'p1'}
        )
        spec_b = task.DatasetInputOutput(
            dataset={'name': 'mydataset', 'path': 'p2'}
        )
        self.assertNotEqual(hash(spec_a), hash(spec_b))


class UpdateDatasetOutputTest(unittest.TestCase):
    """Tests for UpdateDatasetOutput field validators."""

    def _make(self, **fields) -> task.UpdateDatasetOutput:
        defaults = {'name': 'mydataset'}
        defaults.update(fields)
        return task.UpdateDatasetOutput(update_dataset=defaults)

    def test_valid_name_passes(self):
        spec = self._make(name='dataset-1')
        self.assertEqual(spec.update_dataset.name, 'dataset-1')

    def test_invalid_name_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            self._make(name='!!bad!!')

    def test_valid_paths_passes(self):
        spec = self._make(paths=['dir/file.txt'])
        self.assertEqual(spec.update_dataset.paths, ['dir/file.txt'])

    def test_invalid_paths_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            self._make(paths=['bad?path'])

    def test_invalid_metadata_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            self._make(metadata=['bad,path'])

    def test_valid_metadata_passes(self):
        spec = self._make(metadata=['meta/file.json'])
        self.assertEqual(spec.update_dataset.metadata, ['meta/file.json'])

    def test_invalid_labels_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            self._make(labels=['bad<label'])

    def test_valid_labels_passes(self):
        spec = self._make(labels=['mylabel'])
        self.assertEqual(spec.update_dataset.labels, ['mylabel'])

    def test_hash_uses_name(self):
        spec_a = task.UpdateDatasetOutput(update_dataset={'name': 'ds-1'})
        spec_b = task.UpdateDatasetOutput(update_dataset={'name': 'ds-1'})
        self.assertEqual(hash(spec_a), hash(spec_b))

    def test_hash_differs_for_different_name(self):
        spec_a = task.UpdateDatasetOutput(update_dataset={'name': 'ds-1'})
        spec_b = task.UpdateDatasetOutput(update_dataset={'name': 'ds-2'})
        self.assertNotEqual(hash(spec_a), hash(spec_b))


class URLInputOutputTest(unittest.TestCase):
    """Tests for URLInputOutput.validate_regex."""

    def test_valid_regex_passes(self):
        spec = task.URLInputOutput(url='https://example.com', regex=r'\d+')
        self.assertEqual(spec.regex, r'\d+')

    def test_empty_regex_passes(self):
        spec = task.URLInputOutput(url='https://example.com', regex='')
        self.assertEqual(spec.regex, '')

    def test_invalid_regex_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.URLInputOutput(url='https://example.com', regex='[bad')

    def test_hash_uses_url(self):
        spec_a = task.URLInputOutput(url='https://example.com')
        spec_b = task.URLInputOutput(url='https://example.com', regex='abc')
        self.assertEqual(hash(spec_a), hash(spec_b))


class CheckpointSpecTest(unittest.TestCase):
    """Tests for CheckpointSpec.validate_frequency and validate_regex."""

    def _make(self, frequency, regex: str = '') -> task.CheckpointSpec:
        return task.CheckpointSpec(
            path='/some/path',
            url='s3://bucket/key',
            frequency=frequency,
            regex=regex,
        )

    def test_frequency_int_seconds_converts_to_timedelta(self):
        spec = self._make(frequency=30)
        self.assertEqual(spec.frequency, datetime.timedelta(seconds=30))

    def test_frequency_float_seconds_converts_to_timedelta(self):
        spec = self._make(frequency=2.5)
        self.assertEqual(spec.frequency, datetime.timedelta(seconds=2.5))

    def test_frequency_timedelta_passthrough(self):
        original = datetime.timedelta(minutes=15)
        spec = self._make(frequency=original)
        self.assertEqual(spec.frequency, original)

    def test_frequency_string_converts_via_to_timedelta(self):
        spec = self._make(frequency='10s')
        self.assertEqual(spec.frequency, datetime.timedelta(seconds=10))

    def test_frequency_iso8601_string_converts(self):
        spec = self._make(frequency='PT1M')
        self.assertEqual(spec.frequency, datetime.timedelta(minutes=1))

    def test_frequency_bool_raises(self):
        # Booleans are explicitly rejected.
        with self.assertRaises(pydantic.ValidationError):
            self._make(frequency=True)

    def test_invalid_regex_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            self._make(frequency=1, regex='[bad')

    def test_empty_regex_passes(self):
        spec = self._make(frequency=1, regex='')
        self.assertEqual(spec.regex, '')

    def test_valid_regex_passes(self):
        spec = self._make(frequency=1, regex=r'\d+')
        self.assertEqual(spec.regex, r'\d+')


class FileTest(unittest.TestCase):
    """Tests for File.validate_path and encoded_contents."""

    def test_metadata_output_path_passes(self):
        # Paths under DATA_LOCATION + '/output/' bypass restrictions.
        path = f'{kb_objects.DATA_LOCATION}/output/result.json'
        file_obj = task.File(path=path, contents='data')
        self.assertEqual(file_obj.path, path)

    def test_empty_path_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.File(path='', contents='data')

    def test_only_slashes_path_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.File(path='///', contents='data')

    def test_osmo_root_path_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.File(path='/osmo/secret', contents='data')

    def test_valid_path_passes(self):
        file_obj = task.File(path='/etc/myfile', contents='data')
        self.assertEqual(file_obj.path, '/etc/myfile')

    def test_encoded_contents_plain_text_returns_base64(self):
        # 'hello' -> b64 'aGVsbG8='
        file_obj = task.File(path='/etc/x', contents='hello', base64=False)
        self.assertEqual(file_obj.encoded_contents(), 'aGVsbG8=')

    def test_encoded_contents_already_base64_passes_through(self):
        file_obj = task.File(path='/etc/x', contents='aGVsbG8=', base64=True)
        self.assertEqual(file_obj.encoded_contents(), 'aGVsbG8=')

    def test_encoded_contents_unicode_text_encoded_utf8_then_base64(self):
        file_obj = task.File(path='/etc/x', contents='héllo')
        # 'héllo' utf-8: bytes 68 c3 a9 6c 6c 6f -> b64 'aMOpbGxv'
        self.assertEqual(file_obj.encoded_contents(), 'aMOpbGxv')


class TaskSpecValidateNameTest(unittest.TestCase):
    """Tests for TaskSpec.validate_name."""

    def test_osmo_ctrl_name_raises(self):
        # 'osmo-ctrl' is a restricted name (used for the orchestrator container).
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(name='osmo-ctrl', image='ubuntu', command=['ls'])

    def test_osmo_ctrl_underscore_form_raises(self):
        # k8s_name lowercases and replaces '_' with '-'; 'osmo_ctrl' -> 'osmo-ctrl'.
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(name='osmo_ctrl', image='ubuntu', command=['ls'])

    def test_valid_name_passes(self):
        spec = task.TaskSpec(name='mytask', image='ubuntu', command=['ls'])
        self.assertEqual(spec.name, 'mytask')


class TaskSpecValidateCommandTest(unittest.TestCase):
    """Tests for TaskSpec.validate_command."""

    def test_empty_command_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(name='mytask', image='ubuntu', command=[])

    def test_nonempty_command_passes(self):
        spec = task.TaskSpec(name='mytask', image='ubuntu', command=['echo', 'hi'])
        self.assertEqual(spec.command, ['echo', 'hi'])


class TaskSpecValidateFilesTest(unittest.TestCase):
    """Tests for TaskSpec.validate_files."""

    def test_duplicate_paths_raise(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(
                name='mytask', image='ubuntu', command=['ls'],
                files=[
                    task.File(path='/etc/file1', contents='a'),
                    task.File(path='/etc/file1', contents='b'),
                ])

    def test_unique_paths_pass(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            files=[
                task.File(path='/etc/file1', contents='a'),
                task.File(path='/etc/file2', contents='b'),
            ])
        self.assertEqual(len(spec.files), 2)


class TaskSpecValidateExitActionsTest(unittest.TestCase):
    """Tests for TaskSpec.validate_exit_actions."""

    def test_invalid_action_key_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(
                name='mytask', image='ubuntu', command=['ls'],
                exitActions={'NOT_AN_ACTION': '1'})

    def test_invalid_exit_code_format_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(
                name='mytask', image='ubuntu', command=['ls'],
                exitActions={'COMPLETE': 'not-a-code'})

    def test_lowercase_action_key_passes(self):
        # validate_exit_actions uppercases the key before checking the enum.
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            exitActions={'complete': '0'})
        self.assertEqual(spec.exitActions, {'complete': '0'})

    def test_valid_action_with_range_passes(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            exitActions={'COMPLETE': '0,1-5,10'})
        self.assertEqual(spec.exitActions, {'COMPLETE': '0,1-5,10'})


class TaskSpecValidateDownloadTypeTest(unittest.TestCase):
    """Tests for TaskSpec.validate_download_type."""

    def test_none_passes(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'], downloadType=None)
        self.assertIsNone(spec.downloadType)

    def test_enum_value_passes(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            downloadType=connectors.DownloadType.DOWNLOAD)
        self.assertEqual(spec.downloadType, connectors.DownloadType.DOWNLOAD)

    def test_string_value_converts_to_enum(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            downloadType='download')
        self.assertEqual(spec.downloadType, connectors.DownloadType.DOWNLOAD)

    def test_invalid_string_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(
                name='mytask', image='ubuntu', command=['ls'],
                downloadType='not-a-real-type')

    def test_invalid_type_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(
                name='mytask', image='ubuntu', command=['ls'], downloadType=42)


class TaskSpecCoerceDictStrValuesTest(unittest.TestCase):
    """Tests for TaskSpec.coerce_dict_str_values applied to environment."""

    def test_bool_value_coerced_to_string(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            environment={'DEBUG': True})
        self.assertEqual(spec.environment, {'DEBUG': 'True'})

    def test_int_value_coerced_to_string(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            environment={'COUNT': 5})
        self.assertEqual(spec.environment, {'COUNT': '5'})

    def test_float_value_coerced_to_string(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            environment={'RATIO': 0.5})
        self.assertEqual(spec.environment, {'RATIO': '0.5'})

    def test_string_value_passes_through(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            environment={'NAME': 'alice'})
        self.assertEqual(spec.environment, {'NAME': 'alice'})

    def test_non_dict_passes_through_to_validation_error(self):
        # Non-dict environment values fall through to schema validation, which
        # rejects them since environment is typed as Dict[str, str].
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(
                name='mytask', image='ubuntu', command=['ls'],
                environment=['not', 'a', 'dict'])


class TaskSpecCoerceCredentialValuesTest(unittest.TestCase):
    """Tests for TaskSpec.coerce_credential_values."""

    def test_string_credential_passes_through(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            credentials={'mycred': '/mnt/secret'})
        self.assertEqual(spec.credentials, {'mycred': '/mnt/secret'})

    def test_dict_credential_with_scalar_values_coerced_to_strings(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            credentials={'mycred': {'KEY1': 'val', 'KEY2': 42, 'KEY3': True}})
        self.assertEqual(
            spec.credentials,
            {'mycred': {'KEY1': 'val', 'KEY2': '42', 'KEY3': 'True'}})

    def test_int_credential_value_coerced_to_string(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            credentials={'mycred': 42})
        self.assertEqual(spec.credentials, {'mycred': '42'})

    def test_none_credential_value_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(
                name='mytask', image='ubuntu', command=['ls'],
                credentials={'mycred': None})

    def test_list_credential_value_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(
                name='mytask', image='ubuntu', command=['ls'],
                credentials={'mycred': ['not', 'allowed']})

    def test_inner_dict_with_invalid_value_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(
                name='mytask', image='ubuntu', command=['ls'],
                credentials={'mycred': {'KEY': ['list', 'not', 'allowed']}})

    def test_non_str_non_dict_top_level_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskSpec(
                name='mytask', image='ubuntu', command=['ls'],
                credentials=['not', 'allowed'])


class TaskSpecSavedSpecTest(unittest.TestCase):
    """Tests for TaskSpec.saved_spec strips resources/backend."""

    def test_saved_spec_strips_resources_field(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            resources=connectors.ResourceSpec(cpu=4))
        saved = spec.saved_spec()
        self.assertNotIn('resources', saved)

    def test_saved_spec_strips_backend_field(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'], backend='cluster-a')
        saved = spec.saved_spec()
        self.assertNotIn('backend', saved)

    def test_saved_spec_keeps_required_fields(self):
        spec = task.TaskSpec(name='mytask', image='ubuntu', command=['ls'])
        saved = spec.saved_spec()
        self.assertEqual(saved['name'], 'mytask')
        self.assertEqual(saved['image'], 'ubuntu')
        self.assertEqual(saved['command'], ['ls'])


class TaskSpecPropagateResourceValuesTest(unittest.TestCase):
    """Tests for TaskSpec.propagate_resource_values."""

    def test_default_resource_missing_raises(self):
        spec = task.TaskSpec(name='mytask', image='ubuntu', command=['ls'])
        with self.assertRaises(osmo_errors.OSMOResourceError):
            spec.propagate_resource_values({})

    def test_custom_resource_missing_raises(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'], resource='gpu-pool')
        with self.assertRaises(osmo_errors.OSMOResourceError):
            spec.propagate_resource_values({})

    def test_resource_present_sets_resources(self):
        spec = task.TaskSpec(name='mytask', image='ubuntu', command=['ls'])
        resource_spec = connectors.ResourceSpec(cpu=4, memory='16Gi')
        spec.propagate_resource_values({'default': resource_spec})
        self.assertEqual(spec.resources, resource_spec)


class TaskSpecValidatePrivilegeHostMountTest(unittest.TestCase):
    """Tests for TaskSpec.validate_privilege_host_mount."""

    def _make_platform(self, **kwargs) -> connectors.Platform:
        defaults = {
            'privileged_allowed': False,
            'host_network_allowed': False,
            'allowed_mounts': [],
            'default_mounts': [],
        }
        defaults.update(kwargs)
        return connectors.Platform(**defaults)

    def test_no_special_options_skips_validation(self):
        # When privileged/hostNetwork/volumeMounts are all unset, no platform check.
        spec = task.TaskSpec(name='mytask', image='ubuntu', command=['ls'])
        spec.validate_privilege_host_mount({})

    def test_privileged_without_platform_raises(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'], privileged=True)
        with self.assertRaises(OSMOResourceError):
            spec.validate_privilege_host_mount({})

    def test_privileged_disallowed_raises(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'], privileged=True,
            resources=connectors.ResourceSpec(platform='gpu-platform'))
        platform = self._make_platform(privileged_allowed=False)
        with self.assertRaises(OSMOResourceError):
            spec.validate_privilege_host_mount({'gpu-platform': platform})

    def test_privileged_allowed_passes(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'], privileged=True,
            resources=connectors.ResourceSpec(platform='gpu-platform'))
        platform = self._make_platform(privileged_allowed=True)
        spec.validate_privilege_host_mount({'gpu-platform': platform})

    def test_host_network_disallowed_raises(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'], hostNetwork=True,
            resources=connectors.ResourceSpec(platform='gpu-platform'))
        platform = self._make_platform(host_network_allowed=False)
        with self.assertRaises(OSMOResourceError):
            spec.validate_privilege_host_mount({'gpu-platform': platform})

    def test_invalid_volume_mount_format_raises(self):
        # A mount with more than one ':' separator is rejected.
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            volumeMounts=['/host:/container:extra'],
            resources=connectors.ResourceSpec(platform='gpu-platform'))
        platform = self._make_platform(allowed_mounts=['/host'])
        with self.assertRaises(OSMOResourceError):
            spec.validate_privilege_host_mount({'gpu-platform': platform})

    def test_invalid_volume_mount_empty_target_raises(self):
        # 'src:' (empty target) is rejected.
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            volumeMounts=['/host:'],
            resources=connectors.ResourceSpec(platform='gpu-platform'))
        platform = self._make_platform(allowed_mounts=['/host'])
        with self.assertRaises(OSMOResourceError):
            spec.validate_privilege_host_mount({'gpu-platform': platform})

    def test_disallowed_mount_raises(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            volumeMounts=['/forbidden'],
            resources=connectors.ResourceSpec(platform='gpu-platform'))
        platform = self._make_platform(allowed_mounts=['/host'])
        with self.assertRaises(OSMOResourceError):
            spec.validate_privilege_host_mount({'gpu-platform': platform})

    def test_allowed_mount_passes(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            volumeMounts=['/host'],
            resources=connectors.ResourceSpec(platform='gpu-platform'))
        platform = self._make_platform(allowed_mounts=['/host'])
        spec.validate_privilege_host_mount({'gpu-platform': platform})

    def test_default_only_mount_raises(self):
        # A mount that is only a platform default (already provided by the pod template)
        # but not an allowed host mount is rejected, so it cannot collide with the
        # default mount and stall the workflow during CreateGroup.
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            volumeMounts=['/default'],
            resources=connectors.ResourceSpec(platform='gpu-platform'))
        platform = self._make_platform(default_mounts=['/default'])
        with self.assertRaises(OSMOResourceError):
            spec.validate_privilege_host_mount({'gpu-platform': platform})

    def test_default_and_allowed_mount_passes(self):
        # A mount that is both a default and an allowed host mount is still accepted.
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            volumeMounts=['/shared'],
            resources=connectors.ResourceSpec(platform='gpu-platform'))
        platform = self._make_platform(
            allowed_mounts=['/shared'], default_mounts=['/shared'])
        spec.validate_privilege_host_mount({'gpu-platform': platform})


class TaskSpecParseTest(unittest.TestCase):
    """Tests for TaskSpec.parse token substitution."""

    def test_workflow_id_token_substituted_in_args(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            args=['--id={{ workflow_id }}'])
        parsed = spec.parse(workflow_id='wf-123', host_tokens={})
        self.assertEqual(parsed.args, ['--id=wf-123'])

    def test_output_token_substituted_in_args(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            args=['{{ output }}/result'])
        parsed = spec.parse(workflow_id='wf-123', host_tokens={})
        self.assertEqual(
            parsed.args, [f'{kb_objects.DATA_LOCATION}/output/result'])

    def test_host_tokens_override_substituted(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            args=['--host={{ host:peer }}'])
        parsed = spec.parse(
            workflow_id='wf-123', host_tokens={'host:peer': 'peer.example'})
        self.assertEqual(parsed.args, ['--host=peer.example'])

    def test_input_index_token_substituted_for_dataset_input(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            args=['{{ input:0 }}'],
            inputs=[task.DatasetInputOutput(dataset={'name': 'mydataset'})])
        parsed = spec.parse(workflow_id='wf-123', host_tokens={})
        self.assertEqual(
            parsed.args, [f'{kb_objects.DATA_LOCATION}/input/0'])

    def test_input_named_token_substituted_for_task_input(self):
        spec = task.TaskSpec(
            name='mytask', image='ubuntu', command=['ls'],
            args=['{{ input:upstream }}'],
            inputs=[task.TaskInputOutput(task='upstream')])
        parsed = spec.parse(workflow_id='wf-123', host_tokens={})
        self.assertEqual(
            parsed.args, [f'{kb_objects.DATA_LOCATION}/input/0'])


class TaskGroupSpecValidateTasksTest(unittest.TestCase):
    """Tests for TaskGroupSpec.validate_tasks."""

    def _task(self, name: str = 'task1', lead: bool = False) -> task.TaskSpec:
        return task.TaskSpec(
            name=name, image='ubuntu', command=['ls'], lead=lead)

    def test_empty_tasks_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskGroupSpec(name='mygroup', tasks=[])

    def test_single_task_auto_promoted_to_lead(self):
        # When a group has exactly one task, lead is auto-set even if False.
        group = task.TaskGroupSpec(
            name='mygroup', tasks=[self._task(name='only', lead=False)])
        self.assertTrue(group.tasks[0].lead)

    def test_two_tasks_with_no_leader_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskGroupSpec(
                name='mygroup',
                tasks=[self._task(name='t1'), self._task(name='t2')])

    def test_two_tasks_with_two_leaders_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            task.TaskGroupSpec(
                name='mygroup',
                tasks=[
                    self._task(name='t1', lead=True),
                    self._task(name='t2', lead=True),
                ])

    def test_two_tasks_with_one_leader_passes(self):
        group = task.TaskGroupSpec(
            name='mygroup',
            tasks=[
                self._task(name='t1', lead=True),
                self._task(name='t2', lead=False),
            ])
        self.assertEqual(len(group.tasks), 2)


class TaskGroupSpecMethodsTest(unittest.TestCase):
    """Tests for TaskGroupSpec.has_group_barrier, inputs, saved_spec."""

    def _task(self, name: str = 'task1', lead: bool = False, inputs=None) -> task.TaskSpec:
        return task.TaskSpec(
            name=name, image='ubuntu', command=['ls'], lead=lead,
            inputs=inputs or [])

    def test_has_group_barrier_single_task_false(self):
        group = task.TaskGroupSpec(name='mygroup', tasks=[self._task()])
        self.assertFalse(group.has_group_barrier())

    def test_has_group_barrier_multi_task_with_barrier_true(self):
        group = task.TaskGroupSpec(
            name='mygroup', barrier=True,
            tasks=[
                self._task(name='t1', lead=True),
                self._task(name='t2'),
            ])
        self.assertTrue(group.has_group_barrier())

    def test_has_group_barrier_multi_task_no_barrier_false(self):
        group = task.TaskGroupSpec(
            name='mygroup', barrier=False,
            tasks=[
                self._task(name='t1', lead=True),
                self._task(name='t2'),
            ])
        self.assertFalse(group.has_group_barrier())

    def test_inputs_aggregates_across_tasks(self):
        group = task.TaskGroupSpec(
            name='mygroup',
            tasks=[
                self._task(
                    name='t1', lead=True,
                    inputs=[task.TaskInputOutput(task='upstream-a')]),
                self._task(
                    name='t2',
                    inputs=[task.TaskInputOutput(task='upstream-b')]),
            ])
        input_tasks = sorted(
            inp.task for inp in group.inputs
            if isinstance(inp, task.TaskInputOutput))
        self.assertEqual(input_tasks, ['upstream-a', 'upstream-b'])

    def test_inputs_dedupes_identical_inputs(self):
        # TaskInputOutput.__hash__ ignores regex, so identical task names
        # collapse to one entry in the input set.
        group = task.TaskGroupSpec(
            name='mygroup',
            tasks=[
                self._task(
                    name='t1', lead=True,
                    inputs=[task.TaskInputOutput(task='upstream')]),
                self._task(
                    name='t2',
                    inputs=[task.TaskInputOutput(task='upstream')]),
            ])
        self.assertEqual(len(group.inputs), 1)

    def test_saved_spec_includes_tasks(self):
        group = task.TaskGroupSpec(name='mygroup', tasks=[self._task()])
        saved = group.saved_spec()
        self.assertEqual(saved['name'], 'mygroup')
        self.assertEqual(len(saved['tasks']), 1)
        self.assertEqual(saved['tasks'][0]['name'], 'task1')


class SubstitutePodTemplateTokensTest(unittest.TestCase):
    """Tests for substitute_pod_template_tokens."""

    def test_top_level_string_substituted(self):
        template = {'image': '{{ tag }}'}
        task.substitute_pod_template_tokens(template, {'tag': 'v1.0'})
        self.assertEqual(template['image'], 'v1.0')

    def test_nested_dict_substituted(self):
        template = {'metadata': {'name': '{{ name }}'}}
        task.substitute_pod_template_tokens(template, {'name': 'pod-1'})
        self.assertEqual(template['metadata']['name'], 'pod-1')

    def test_list_of_strings_substituted(self):
        template = {'args': ['--name={{ name }}', '--ver={{ ver }}']}
        task.substitute_pod_template_tokens(
            template, {'name': 'pod-1', 'ver': '2'})
        self.assertEqual(template['args'], ['--name=pod-1', '--ver=2'])

    def test_list_of_dicts_recursed(self):
        template = {'env': [{'name': 'X', 'value': '{{ val }}'}]}
        task.substitute_pod_template_tokens(template, {'val': 'hello'})
        self.assertEqual(template['env'][0]['value'], 'hello')

    def test_array_string_marker_splits_into_list(self):
        # ARRAY:[a,b,c] is unwrapped into a list.
        template = {'args': '{{ items }}'}
        task.substitute_pod_template_tokens(
            template, {'items': 'ARRAY:[a,b,c]'})
        self.assertEqual(template['args'], ['a', 'b', 'c'])

    def test_bool_value_skipped(self):
        # Bool top-level values are not template-substituted.
        template = {'enabled': True}
        task.substitute_pod_template_tokens(template, {})
        self.assertEqual(template['enabled'], True)

    def test_invalid_template_syntax_raises(self):
        # Jinja sandbox wraps TemplateSyntaxError as OSMOUsageError before it
        # reaches the substitute_pod_template_tokens catch.
        template = {'name': '{{ unclosed'}
        with self.assertRaises(osmo_errors.OSMOUsageError):
            task.substitute_pod_template_tokens(template, {})


class RenderGroupTemplatesTest(unittest.TestCase):
    """Tests for render_group_templates."""

    def test_substitutes_variables(self):
        templates = [{'metadata': {'name': '{{ pod_name }}'}}]
        rendered = task.render_group_templates(
            templates, variables={'pod_name': 'mypod'}, labels={})
        self.assertEqual(rendered[0]['metadata']['name'], 'mypod')

    def test_strips_namespace(self):
        templates = [{'metadata': {'namespace': 'leftover-ns', 'name': 'x'}}]
        rendered = task.render_group_templates(
            templates, variables={}, labels={})
        self.assertNotIn('namespace', rendered[0]['metadata'])

    def test_injects_labels(self):
        templates = [{'metadata': {'name': 'x'}}]
        rendered = task.render_group_templates(
            templates, variables={},
            labels={'workflow': 'wf-1', 'group': 'g-1'})
        self.assertEqual(
            rendered[0]['metadata']['labels'],
            {'workflow': 'wf-1', 'group': 'g-1'})

    def test_creates_metadata_when_missing(self):
        templates = [{'spec': {'replicas': '1'}}]
        rendered = task.render_group_templates(
            templates, variables={}, labels={'a': 'b'})
        self.assertEqual(rendered[0]['metadata']['labels'], {'a': 'b'})

    def test_does_not_mutate_input_templates(self):
        templates = [{'metadata': {'name': '{{ x }}'}}]
        templates_snapshot = copy.deepcopy(templates)
        task.render_group_templates(
            templates, variables={'x': 'replaced'}, labels={'a': 'b'})
        self.assertEqual(templates, templates_snapshot)


class DecodeHstoreTest(unittest.TestCase):
    """Tests for decode_hstore."""

    def test_empty_string_returns_empty_set(self):
        self.assertEqual(task.decode_hstore(''), set())

    def test_single_entry(self):
        self.assertEqual(task.decode_hstore('"task-a"=>"NULL"'), {'task-a'})

    def test_multiple_entries(self):
        encoded = '"task-a"=>"NULL", "task-b"=>"NULL"'
        self.assertEqual(task.decode_hstore(encoded), {'task-a', 'task-b'})

    def test_only_picks_up_well_formed_names(self):
        # Names that don't match NAMEREGEX (e.g. start with digits) are skipped.
        encoded = '"123bad"=>"NULL", "task-good"=>"NULL"'
        self.assertEqual(task.decode_hstore(encoded), {'task-good'})


class FetchCredsTest(unittest.TestCase):
    """Tests for fetch_creds."""

    def _make_static(self, endpoint: str) -> credentials.StaticDataCredential:
        return credentials.StaticDataCredential(
            endpoint=endpoint,
            access_key_id='AKID',
            access_key='SECRET',
        )

    def test_returns_credential_when_profile_matches(self):
        cred = self._make_static('s3://my-bucket')
        result = task.fetch_creds(
            user='alice',
            data_creds={'s3://my-bucket': cred},
            path='s3://my-bucket/some/path',
        )
        self.assertIs(result, cred)

    def test_env_auth_supported_returns_none_when_no_credential(self):
        # S3 backend supports environment auth → None instead of raising.
        result = task.fetch_creds(
            user='alice',
            data_creds={},
            path='s3://other-bucket/path',
        )
        self.assertIsNone(result)

    def test_disabled_scheme_returns_none(self):
        # GS does not support env auth, but if 'gs' is in disabled_data
        # the lookup returns None instead of raising.
        result = task.fetch_creds(
            user='alice',
            data_creds={},
            path='gs://other-bucket/path',
            disabled_data=['gs'],
        )
        self.assertIsNone(result)

    def test_missing_credential_for_non_env_scheme_raises(self):
        # GS has no env auth and 'gs' not in disabled_data → raises.
        with self.assertRaises(osmo_errors.OSMOCredentialError):
            task.fetch_creds(
                user='alice',
                data_creds={},
                path='gs://other-bucket/path',
            )


class BatchUpdateStatusToDbValidationTest(unittest.TestCase):
    """Tests for Task.batch_update_status_to_db input validation."""

    def test_non_finished_status_raises(self):
        # Only finished statuses are allowed; RUNNING is rejected before any
        # DB call, so the mock connector is never invoked.
        database = mock.create_autospec(connectors.PostgresConnector, instance=True)
        with self.assertRaises(ValueError):
            task.Task.batch_update_status_to_db(
                database=database,
                workflow_id='wf-1',
                group_name='g-1',
                update_time=datetime.datetime(2026, 1, 1),
                status=task.TaskGroupStatus.RUNNING,
                message='ignored',
            )
        database.execute_commit_command.assert_not_called()

    def test_waiting_status_raises(self):
        database = mock.create_autospec(connectors.PostgresConnector, instance=True)
        with self.assertRaises(ValueError):
            task.Task.batch_update_status_to_db(
                database=database,
                workflow_id='wf-1',
                group_name='g-1',
                update_time=datetime.datetime(2026, 1, 1),
                status=task.TaskGroupStatus.WAITING,
                message='ignored',
            )
        database.execute_commit_command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
