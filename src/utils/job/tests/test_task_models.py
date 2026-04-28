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
import copy
import datetime
import unittest

from src.lib.utils import osmo_errors
from src.utils.job import common as task_common, task
from src.utils.job.app import AppStatus


# ---------------------------------------------------------------------------
# AppStatus
# ---------------------------------------------------------------------------
class AppStatusDeletedTest(unittest.TestCase):
    def test_deleted_states(self):
        self.assertTrue(AppStatus.DELETED.deleted())
        self.assertTrue(AppStatus.PENDING_DELETE.deleted())

    def test_non_deleted_states(self):
        self.assertFalse(AppStatus.PENDING.deleted())
        self.assertFalse(AppStatus.READY.deleted())


# ---------------------------------------------------------------------------
# ExitAction / ExitCode enums
# ---------------------------------------------------------------------------
class ExitActionTest(unittest.TestCase):
    def test_values(self):
        self.assertEqual(task.ExitAction.COMPLETED.value, 'COMPLETE')
        self.assertEqual(task.ExitAction.FAILED.value, 'FAIL')
        self.assertEqual(task.ExitAction.RESCHEDULED.value, 'RESCHEDULE')


class ExitCodeTest(unittest.TestCase):
    def test_known_codes(self):
        self.assertEqual(task.ExitCode.FAILED_PREFLIGHT.value, 1001)
        self.assertEqual(task.ExitCode.FAILED_UPSTREAM.value, 3000)
        self.assertEqual(task.ExitCode.FAILED_UNKNOWN.value, 4000)


# ---------------------------------------------------------------------------
# TaskGroupStatus
# ---------------------------------------------------------------------------
class TaskGroupStatusMethodsTest(unittest.TestCase):
    def test_finished_for_completed(self):
        self.assertTrue(task.TaskGroupStatus.COMPLETED.finished())

    def test_finished_for_rescheduled(self):
        self.assertTrue(task.TaskGroupStatus.RESCHEDULED.finished())

    def test_finished_for_failed(self):
        self.assertTrue(task.TaskGroupStatus.FAILED.finished())

    def test_not_finished_for_running(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.finished())

    def test_group_finished_for_completed(self):
        self.assertTrue(task.TaskGroupStatus.COMPLETED.group_finished())

    def test_group_finished_for_failed(self):
        self.assertTrue(task.TaskGroupStatus.FAILED.group_finished())

    def test_group_finished_false_for_rescheduled(self):
        self.assertFalse(task.TaskGroupStatus.RESCHEDULED.group_finished())

    def test_failed(self):
        for status in task.TaskGroupStatus:
            if status.name.startswith('FAILED'):
                self.assertTrue(status.failed(), f'{status.name} should be failed')
            else:
                self.assertFalse(status.failed(), f'{status.name} should not be failed')

    def test_prescheduling(self):
        prescheduling = {task.TaskGroupStatus.SUBMITTING,
                         task.TaskGroupStatus.WAITING,
                         task.TaskGroupStatus.PROCESSING}
        for status in task.TaskGroupStatus:
            self.assertEqual(status.prescheduling(), status in prescheduling,
                             f'{status.name}')

    def test_in_queue(self):
        in_queue = {task.TaskGroupStatus.SUBMITTING,
                    task.TaskGroupStatus.WAITING,
                    task.TaskGroupStatus.PROCESSING,
                    task.TaskGroupStatus.SCHEDULING}
        for status in task.TaskGroupStatus:
            self.assertEqual(status.in_queue(), status in in_queue,
                             f'{status.name}')

    def test_prerunning(self):
        prerunning = {task.TaskGroupStatus.SUBMITTING,
                      task.TaskGroupStatus.WAITING,
                      task.TaskGroupStatus.PROCESSING,
                      task.TaskGroupStatus.SCHEDULING,
                      task.TaskGroupStatus.INITIALIZING}
        for status in task.TaskGroupStatus:
            self.assertEqual(status.prerunning(), status in prerunning,
                             f'{status.name}')

    def test_canceled(self):
        canceled = {task.TaskGroupStatus.FAILED_CANCELED,
                    task.TaskGroupStatus.FAILED_EXEC_TIMEOUT,
                    task.TaskGroupStatus.FAILED_QUEUE_TIMEOUT}
        for status in task.TaskGroupStatus:
            self.assertEqual(status.canceled(), status in canceled,
                             f'{status.name}')

    def test_server_errored(self):
        server_errored = {task.TaskGroupStatus.FAILED_SERVER_ERROR,
                          task.TaskGroupStatus.FAILED_EVICTED,
                          task.TaskGroupStatus.FAILED_START_ERROR,
                          task.TaskGroupStatus.FAILED_IMAGE_PULL}
        for status in task.TaskGroupStatus:
            self.assertEqual(status.server_errored(), status in server_errored,
                             f'{status.name}')

    def test_has_error_logs_for_rescheduled(self):
        self.assertTrue(task.TaskGroupStatus.RESCHEDULED.has_error_logs())

    def test_has_error_logs_for_regular_failure(self):
        self.assertTrue(task.TaskGroupStatus.FAILED.has_error_logs())
        self.assertTrue(task.TaskGroupStatus.FAILED_BACKEND_ERROR.has_error_logs())
        self.assertTrue(task.TaskGroupStatus.FAILED_PREEMPTED.has_error_logs())

    def test_no_error_logs_for_server_errored(self):
        self.assertFalse(task.TaskGroupStatus.FAILED_SERVER_ERROR.has_error_logs())
        self.assertFalse(task.TaskGroupStatus.FAILED_EVICTED.has_error_logs())
        self.assertFalse(task.TaskGroupStatus.FAILED_IMAGE_PULL.has_error_logs())

    def test_no_error_logs_for_canceled(self):
        self.assertFalse(task.TaskGroupStatus.FAILED_CANCELED.has_error_logs())
        self.assertFalse(task.TaskGroupStatus.FAILED_EXEC_TIMEOUT.has_error_logs())
        self.assertFalse(task.TaskGroupStatus.FAILED_QUEUE_TIMEOUT.has_error_logs())

    def test_no_error_logs_for_upstream(self):
        self.assertFalse(task.TaskGroupStatus.FAILED_UPSTREAM.has_error_logs())

    def test_no_error_logs_for_running(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.has_error_logs())

    def test_backend_states(self):
        states = task.TaskGroupStatus.backend_states()
        self.assertIn('SCHEDULING', states)
        self.assertIn('RUNNING', states)

    def test_get_alive_statuses(self):
        alive = task.TaskGroupStatus.get_alive_statuses()
        self.assertIn(task.TaskGroupStatus.SUBMITTING, alive)
        self.assertIn(task.TaskGroupStatus.RUNNING, alive)
        self.assertNotIn(task.TaskGroupStatus.COMPLETED, alive)
        self.assertNotIn(task.TaskGroupStatus.FAILED, alive)


# ---------------------------------------------------------------------------
# create_login_dict
# ---------------------------------------------------------------------------
class CreateLoginDictTest(unittest.TestCase):
    def test_with_token(self):
        result = task.create_login_dict(
            user='testuser', url='https://api.example.com',
            token='my-token', refresh_endpoint='/refresh',
            refresh_token='refresh-abc')
        self.assertEqual(result['token_login']['id_token'], 'my-token')
        self.assertEqual(result['token_login']['refresh_url'], '/refresh')
        self.assertEqual(result['token_login']['refresh_token'], 'refresh-abc')
        self.assertEqual(result['url'], 'https://api.example.com')
        self.assertTrue(result['osmo_token'])
        self.assertEqual(result['username'], 'testuser')

    def test_without_token(self):
        result = task.create_login_dict(
            user='devuser', url='https://dev.example.com')
        self.assertEqual(result['dev_login']['username'], 'devuser')
        self.assertEqual(result['url'], 'https://dev.example.com')
        self.assertNotIn('token_login', result)


# ---------------------------------------------------------------------------
# shorten_name_to_fit_kb
# ---------------------------------------------------------------------------
class ShortenNameToFitKbTest(unittest.TestCase):
    def test_short_name_unchanged(self):
        self.assertEqual(task.shorten_name_to_fit_kb('short'), 'short')

    def test_exactly_63_chars(self):
        name = 'a' * 63
        self.assertEqual(task.shorten_name_to_fit_kb(name), name)

    def test_truncates_to_63(self):
        name = 'a' * 100
        self.assertEqual(len(task.shorten_name_to_fit_kb(name)), 63)

    def test_strips_trailing_hyphens(self):
        name = 'a' * 60 + '---' + 'b' * 10
        result = task.shorten_name_to_fit_kb(name)
        self.assertTrue(len(result) <= 63)
        self.assertFalse(result.endswith('-'))

    def test_strips_trailing_underscores(self):
        name = 'a' * 60 + '___' + 'b' * 10
        result = task.shorten_name_to_fit_kb(name)
        self.assertTrue(len(result) <= 63)
        self.assertFalse(result.endswith('_'))


# ---------------------------------------------------------------------------
# _encode_hstore / decode_hstore
# ---------------------------------------------------------------------------
class HstoreTest(unittest.TestCase):
    def test_encode_single_task(self):
        result = task._encode_hstore({'taskA'})
        self.assertEqual(result, '"taskA" => "NULL"')

    def test_encode_multiple_tasks(self):
        result = task._encode_hstore({'taskA', 'taskB'})
        self.assertIn('"taskA" => "NULL"', result)
        self.assertIn('"taskB" => "NULL"', result)

    def test_decode_single_task(self):
        encoded = '"taskA"=>"NULL"'
        self.assertEqual(task.decode_hstore(encoded), {'taskA'})

    def test_decode_multiple_tasks(self):
        encoded = '"taskA"=>"NULL", "taskB"=>"NULL"'
        self.assertEqual(task.decode_hstore(encoded), {'taskA', 'taskB'})

    def test_decode_db_format(self):
        db_output = '"taskA"=>"NULL","taskB"=>"NULL"'
        decoded = task.decode_hstore(db_output)
        self.assertEqual(decoded, {'taskA', 'taskB'})


# ---------------------------------------------------------------------------
# TaskInputOutput
# ---------------------------------------------------------------------------
class TaskInputOutputTest(unittest.TestCase):
    def test_simple_task_name(self):
        tio = task.TaskInputOutput(task='myTask')
        self.assertEqual(tio.task, 'myTask')
        self.assertFalse(tio.is_from_previous_workflow())

    def test_previous_workflow_task(self):
        tio = task.TaskInputOutput(task='prevWorkflow:taskName')
        self.assertTrue(tio.is_from_previous_workflow())

    def test_parsed_workflow_info_simple(self):
        tio = task.TaskInputOutput(task='taskA')
        first, second = tio.parsed_workflow_info()
        self.assertEqual(first, 'taskA')
        self.assertIsNone(second)

    def test_parsed_workflow_info_with_workflow(self):
        tio = task.TaskInputOutput(task='wf1:taskA')
        first, second = tio.parsed_workflow_info()
        self.assertEqual(first, 'wf1')
        self.assertEqual(second, 'taskA')

    def test_valid_regex(self):
        tio = task.TaskInputOutput(task='taskA', regex=r'.*\.txt')
        self.assertEqual(tio.regex, r'.*\.txt')

    def test_invalid_regex_raises(self):
        with self.assertRaises(Exception):
            task.TaskInputOutput(task='taskA', regex='[invalid')

    def test_empty_regex_allowed(self):
        tio = task.TaskInputOutput(task='taskA', regex='')
        self.assertEqual(tio.regex, '')

    def test_hash(self):
        tio1 = task.TaskInputOutput(task='taskA')
        tio2 = task.TaskInputOutput(task='taskA')
        self.assertEqual(hash(tio1), hash(tio2))

    def test_different_hash(self):
        tio1 = task.TaskInputOutput(task='taskA')
        tio2 = task.TaskInputOutput(task='taskB')
        self.assertNotEqual(hash(tio1), hash(tio2))


# ---------------------------------------------------------------------------
# URLInputOutput
# ---------------------------------------------------------------------------
class URLInputOutputTest(unittest.TestCase):
    def test_creation(self):
        uio = task.URLInputOutput(url='s3://bucket/path')
        self.assertEqual(uio.url, 's3://bucket/path')

    def test_valid_regex(self):
        uio = task.URLInputOutput(url='s3://b', regex=r'.*\.log')
        self.assertEqual(uio.regex, r'.*\.log')

    def test_invalid_regex_raises(self):
        with self.assertRaises(Exception):
            task.URLInputOutput(url='s3://b', regex='[bad')

    def test_empty_regex(self):
        uio = task.URLInputOutput(url='s3://b', regex='')
        self.assertEqual(uio.regex, '')

    def test_hash(self):
        u1 = task.URLInputOutput(url='s3://a')
        u2 = task.URLInputOutput(url='s3://a')
        self.assertEqual(hash(u1), hash(u2))


# ---------------------------------------------------------------------------
# File
# ---------------------------------------------------------------------------
class FileTest(unittest.TestCase):
    def test_valid_path(self):
        f = task.File(path='/home/user/test.txt', contents='hello')
        self.assertEqual(f.path, '/home/user/test.txt')

    def test_output_path_allowed(self):
        f = task.File(path='/osmo/data/output/meta.yaml', contents='data')
        self.assertEqual(f.path, '/osmo/data/output/meta.yaml')

    def test_osmo_path_rejected(self):
        with self.assertRaises(Exception):
            task.File(path='/osmo/forbidden', contents='data')

    def test_empty_path_rejected(self):
        with self.assertRaises(Exception):
            task.File(path='/', contents='data')

    def test_encoded_contents_plain(self):
        f = task.File(path='/home/test.txt', contents='hello world')
        import base64
        decoded = base64.b64decode(f.encoded_contents()).decode('utf-8')
        self.assertEqual(decoded, 'hello world')

    def test_encoded_contents_already_base64(self):
        import base64
        original = base64.b64encode(b'binary data').decode('utf-8')
        f = task.File(path='/home/test.bin', contents=original, base64=True)
        self.assertEqual(f.encoded_contents(), original)


# ---------------------------------------------------------------------------
# CheckpointSpec
# ---------------------------------------------------------------------------
class CheckpointSpecTest(unittest.TestCase):
    def test_frequency_from_int(self):
        spec = task.CheckpointSpec(
            path='/data', url='s3://bucket/ckpt', frequency=300)
        self.assertEqual(spec.frequency, datetime.timedelta(seconds=300))

    def test_frequency_from_float(self):
        spec = task.CheckpointSpec(
            path='/data', url='s3://bucket/ckpt', frequency=60.5)
        self.assertEqual(spec.frequency, datetime.timedelta(seconds=60.5))

    def test_frequency_from_timedelta(self):
        td = datetime.timedelta(minutes=10)
        spec = task.CheckpointSpec(
            path='/data', url='s3://bucket/ckpt', frequency=td)
        self.assertEqual(spec.frequency, td)

    def test_valid_regex(self):
        spec = task.CheckpointSpec(
            path='/data', url='s3://bucket/ckpt', frequency=60,
            regex=r'ckpt-\d+')
        self.assertEqual(spec.regex, r'ckpt-\d+')

    def test_invalid_regex_raises(self):
        with self.assertRaises(Exception):
            task.CheckpointSpec(
                path='/data', url='s3://bucket/ckpt', frequency=60,
                regex='[bad')


# ---------------------------------------------------------------------------
# TaskKPI
# ---------------------------------------------------------------------------
class TaskKPITest(unittest.TestCase):
    def test_creation(self):
        kpi = task.TaskKPI(index='loss', path='/metrics/loss.json')
        self.assertEqual(kpi.index, 'loss')
        self.assertEqual(kpi.path, '/metrics/loss.json')


# ---------------------------------------------------------------------------
# TaskSpec validation
# ---------------------------------------------------------------------------
class TaskSpecValidationTest(unittest.TestCase):
    def test_osmo_ctrl_name_rejected(self):
        with self.assertRaises(Exception):
            task.TaskSpec(name='osmo-ctrl', image='ubuntu', command=['echo'])

    def test_empty_command_rejected(self):
        with self.assertRaises(Exception):
            task.TaskSpec(name='myTask', image='ubuntu', command=[])

    def test_duplicate_file_paths_rejected(self):
        with self.assertRaises(Exception):
            task.TaskSpec(
                name='myTask', image='ubuntu', command=['run'],
                files=[
                    task.File(path='/home/a.txt', contents='1'),
                    task.File(path='/home/a.txt', contents='2'),
                ])

    def test_valid_task_spec(self):
        spec = task.TaskSpec(name='myTask', image='ubuntu', command=['echo', 'hi'])
        self.assertEqual(spec.name, 'myTask')
        self.assertEqual(spec.image, 'ubuntu')


# ---------------------------------------------------------------------------
# render_group_templates
# ---------------------------------------------------------------------------
class RenderGroupTemplatesTest(unittest.TestCase):
    def test_injects_labels(self):
        templates = [{
            'apiVersion': 'v1',
            'kind': 'ConfigMap',
            'metadata': {'name': 'test'},
        }]
        labels = {'app': 'osmo'}
        result = task.render_group_templates(templates, {}, labels)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['metadata']['labels']['app'], 'osmo')

    def test_strips_namespace(self):
        templates = [{
            'metadata': {'name': 'test', 'namespace': 'old-ns'},
        }]
        result = task.render_group_templates(templates, {}, {})
        self.assertNotIn('namespace', result[0]['metadata'])

    def test_does_not_modify_original(self):
        templates = [{'metadata': {'name': 'test'}}]
        original = copy.deepcopy(templates)
        task.render_group_templates(templates, {}, {'key': 'val'})
        self.assertEqual(templates, original)


# ---------------------------------------------------------------------------
# DownloadTypeMetrics (task_io.py)
# ---------------------------------------------------------------------------
class DownloadTypeMetricsTest(unittest.TestCase):
    def test_values(self):
        from src.utils.job.task_io import DownloadTypeMetrics
        self.assertEqual(DownloadTypeMetrics.DOWNLOAD.value, 'download')
        self.assertEqual(DownloadTypeMetrics.MOUNTPOINT.value, 'mountpoint-s3')
        self.assertEqual(DownloadTypeMetrics.NOT_APPLICABLE.value, 'N/A')


if __name__ == '__main__':
    unittest.main()
