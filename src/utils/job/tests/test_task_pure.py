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
import unittest

import pydantic

from src.lib.utils import credentials
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


if __name__ == '__main__':
    unittest.main()
