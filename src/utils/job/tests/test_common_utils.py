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
import datetime
import os
import unittest

from src.lib.data.storage.backends.common import StoragePath
from src.lib.utils import osmo_errors
from src.utils.job import common


class GetWorkflowLogsPathTest(unittest.TestCase):
    def test_returns_joined_path(self):
        result = common.get_workflow_logs_path('wf-123', 'output.log')
        self.assertEqual(result, os.path.join('wf-123', 'output.log'))

    def test_different_filenames(self):
        result = common.get_workflow_logs_path('my-workflow', 'error.log')
        self.assertEqual(result, os.path.join('my-workflow', 'error.log'))


class GetWorkflowAppPathTest(unittest.TestCase):
    def test_without_prefix(self):
        path_params = StoragePath(
            scheme='s3', host='bucket', endpoint_url='http://s3',
            container='bucket', region='us-east-1', prefix='')
        result = common.get_workflow_app_path('app-uuid-123', 1, path_params)
        self.assertEqual(result, os.path.join('app-uuid-123', '1', 'workflow_app.txt'))

    def test_with_prefix(self):
        path_params = StoragePath(
            scheme='s3', host='bucket', endpoint_url='http://s3',
            container='bucket', region='us-east-1', prefix='my-prefix')
        result = common.get_workflow_app_path('app-uuid-123', 2, path_params)
        self.assertEqual(
            result,
            os.path.join('my-prefix', 'app-uuid-123', '2', 'workflow_app.txt'))

    def test_version_is_stringified(self):
        path_params = StoragePath(
            scheme='s3', host='bucket', endpoint_url='http://s3',
            container='bucket', region='us-east-1', prefix='')
        result = common.get_workflow_app_path('uuid', 42, path_params)
        self.assertIn('42', result)


class CalculateTotalTimeoutTest(unittest.TestCase):
    def test_returns_sum_of_timeouts(self):
        queue = datetime.timedelta(seconds=300)
        execution = datetime.timedelta(seconds=600)
        result = common.calculate_total_timeout('wf-1', queue, execution)
        self.assertEqual(result, 900)

    def test_raises_without_exec_timeout(self):
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            common.calculate_total_timeout(
                'wf-1', queue_timeout=datetime.timedelta(seconds=300))

    def test_raises_without_queue_timeout(self):
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            common.calculate_total_timeout(
                'wf-1', exec_timeout=datetime.timedelta(seconds=300))

    def test_raises_with_both_none(self):
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            common.calculate_total_timeout('wf-1')

    def test_truncates_to_int(self):
        queue = datetime.timedelta(seconds=1.7)
        execution = datetime.timedelta(seconds=2.9)
        result = common.calculate_total_timeout('wf-1', queue, execution)
        self.assertEqual(result, int(1.7) + int(2.9))


class BarrierKeyTest(unittest.TestCase):
    def test_format(self):
        result = common.barrier_key('wf-1', 'group-a', 'sync')
        self.assertEqual(result, 'client-connections:wf-1:group-a:barrier-sync')

    def test_different_inputs(self):
        result = common.barrier_key('workflow', 'train', 'ready')
        self.assertEqual(result, 'client-connections:workflow:train:barrier-ready')


class WorkflowPluginsTest(unittest.TestCase):
    def test_default_rsync_false(self):
        plugins = common.WorkflowPlugins()
        self.assertFalse(plugins.rsync)

    def test_rsync_enabled(self):
        plugins = common.WorkflowPlugins(rsync=True)
        self.assertTrue(plugins.rsync)


if __name__ == '__main__':
    unittest.main()
