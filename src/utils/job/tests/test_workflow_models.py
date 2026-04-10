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
import unittest

import yaml

from src.utils import connectors
from src.utils.job import workflow


# ---------------------------------------------------------------------------
# WorkflowStatus
# ---------------------------------------------------------------------------
class WorkflowStatusAliveTest(unittest.TestCase):
    def test_alive_statuses(self):
        for status in workflow.WorkflowStatus.get_alive_statuses():
            self.assertTrue(status.alive(), f'{status.name} should be alive')
            self.assertFalse(status.finished(), f'{status.name} should not be finished')

    def test_completed_is_finished(self):
        self.assertTrue(workflow.WorkflowStatus.COMPLETED.finished())
        self.assertFalse(workflow.WorkflowStatus.COMPLETED.alive())

    def test_failed_statuses(self):
        failed_statuses = [
            workflow.WorkflowStatus.FAILED,
            workflow.WorkflowStatus.FAILED_SUBMISSION,
            workflow.WorkflowStatus.FAILED_SERVER_ERROR,
            workflow.WorkflowStatus.FAILED_EXEC_TIMEOUT,
            workflow.WorkflowStatus.FAILED_QUEUE_TIMEOUT,
            workflow.WorkflowStatus.FAILED_CANCELED,
            workflow.WorkflowStatus.FAILED_BACKEND_ERROR,
            workflow.WorkflowStatus.FAILED_IMAGE_PULL,
            workflow.WorkflowStatus.FAILED_EVICTED,
            workflow.WorkflowStatus.FAILED_START_ERROR,
            workflow.WorkflowStatus.FAILED_START_TIMEOUT,
            workflow.WorkflowStatus.FAILED_PREEMPTED,
        ]
        for status in failed_statuses:
            self.assertTrue(status.failed(), f'{status.name} should be failed')
            self.assertTrue(status.finished(), f'{status.name} should be finished')
            self.assertFalse(status.alive(), f'{status.name} should not be alive')

    def test_completed_is_not_failed(self):
        self.assertFalse(workflow.WorkflowStatus.COMPLETED.failed())

    def test_alive_statuses_list(self):
        alive = workflow.WorkflowStatus.get_alive_statuses()
        self.assertIn(workflow.WorkflowStatus.PENDING, alive)
        self.assertIn(workflow.WorkflowStatus.RUNNING, alive)
        self.assertIn(workflow.WorkflowStatus.WAITING, alive)
        self.assertEqual(len(alive), 3)


# ---------------------------------------------------------------------------
# action_queue_name
# ---------------------------------------------------------------------------
class ActionQueueNameTest(unittest.TestCase):
    def test_format(self):
        result = workflow.action_queue_name('wf-1', 'train', 0)
        self.assertEqual(result, 'client-connections:wf-1:train:0')

    def test_with_retry_id(self):
        result = workflow.action_queue_name('wf-2', 'eval', 3)
        self.assertEqual(result, 'client-connections:wf-2:eval:3')


# ---------------------------------------------------------------------------
# TimeoutSpec
# ---------------------------------------------------------------------------
class TimeoutSpecValidationTest(unittest.TestCase):
    def test_from_int(self):
        spec = workflow.TimeoutSpec(exec_timeout=300, queue_timeout=60)
        self.assertEqual(spec.exec_timeout, datetime.timedelta(seconds=300))
        self.assertEqual(spec.queue_timeout, datetime.timedelta(seconds=60))

    def test_from_float(self):
        spec = workflow.TimeoutSpec(exec_timeout=60.5)
        self.assertEqual(spec.exec_timeout, datetime.timedelta(seconds=60.5))

    def test_from_none(self):
        spec = workflow.TimeoutSpec(exec_timeout=None)
        self.assertIsNone(spec.exec_timeout)

    def test_from_timedelta(self):
        td = datetime.timedelta(hours=1)
        spec = workflow.TimeoutSpec(exec_timeout=td)
        self.assertEqual(spec.exec_timeout, td)


# ---------------------------------------------------------------------------
# split_assertion_rules
# ---------------------------------------------------------------------------
class SplitAssertionRulesTest(unittest.TestCase):
    def test_static_assertion(self):
        assertion = connectors.ResourceAssertion(
            operator='GT',
            left_operand='{{USER_CPU}}',
            right_operand='0',
            assert_message='CPU must be > 0')
        static, k8 = workflow.split_assertion_rules([assertion])
        self.assertEqual(len(static), 1)
        self.assertEqual(len(k8), 0)

    def test_k8_assertion_left_operand(self):
        assertion = connectors.ResourceAssertion(
            operator='GE',
            left_operand='{{K8_GPU}}',
            right_operand='{{USER_GPU}}',
            assert_message='K8 GPU must be >= user GPU')
        static, k8 = workflow.split_assertion_rules([assertion])
        self.assertEqual(len(static), 0)
        self.assertEqual(len(k8), 1)

    def test_k8_assertion_right_operand(self):
        assertion = connectors.ResourceAssertion(
            operator='LE',
            left_operand='{{USER_MEMORY}}',
            right_operand='{{K8_MEMORY}}',
            assert_message='User memory <= k8 memory')
        static, k8 = workflow.split_assertion_rules([assertion])
        self.assertEqual(len(static), 0)
        self.assertEqual(len(k8), 1)

    def test_mixed_assertions(self):
        static_assertion = connectors.ResourceAssertion(
            operator='GT',
            left_operand='{{USER_CPU}}',
            right_operand='0',
            assert_message='CPU > 0')
        k8_assertion = connectors.ResourceAssertion(
            operator='GE',
            left_operand='{{K8_GPU}}',
            right_operand='{{USER_GPU}}',
            assert_message='K8 GPU >= user GPU')
        static, k8 = workflow.split_assertion_rules(
            [static_assertion, k8_assertion])
        self.assertEqual(len(static), 1)
        self.assertEqual(len(k8), 1)

    def test_empty_list(self):
        static, k8 = workflow.split_assertion_rules([])
        self.assertEqual(len(static), 0)
        self.assertEqual(len(k8), 0)


# ---------------------------------------------------------------------------
# VersionedWorkflowSpec
# ---------------------------------------------------------------------------
class VersionedWorkflowSpecTest(unittest.TestCase):
    def test_unsupported_version_raises(self):
        with self.assertRaises(Exception):
            workflow.VersionedWorkflowSpec(
                version=1,
                workflow=workflow.WorkflowSpec(
                    name='test',
                    tasks=[{'name': 'a', 'command': ['echo'], 'image': 'ubuntu'}]))

    def test_default_version_is_2(self):
        spec_dict = yaml.safe_load('''
            workflow:
              name: test
              tasks:
              - name: task1
                command: ['echo']
                image: ubuntu
        ''')
        versioned = workflow.VersionedWorkflowSpec(**spec_dict)
        self.assertEqual(versioned.version, 2)


# ---------------------------------------------------------------------------
# WorkflowSpec validation
# ---------------------------------------------------------------------------
class WorkflowSpecValidationTest(unittest.TestCase):
    def test_no_tasks_or_groups_raises(self):
        with self.assertRaises(Exception):
            workflow.WorkflowSpec(name='test')

    def test_both_tasks_and_groups_raises(self):
        with self.assertRaises(Exception):
            workflow.WorkflowSpec(
                name='test',
                tasks=[{'name': 'a', 'command': ['echo'], 'image': 'ubuntu'}],
                groups=[{'name': 'g', 'tasks': [
                    {'name': 'b', 'command': ['echo'], 'image': 'ubuntu'}
                ]}])


# ---------------------------------------------------------------------------
# ResourceValidationResult
# ---------------------------------------------------------------------------
class ResourceValidationResultTest(unittest.TestCase):
    def test_passed(self):
        result = workflow.ResourceValidationResult(passed=True)
        self.assertTrue(result.passed)
        self.assertEqual(result.logs, '')

    def test_failed_with_logs(self):
        result = workflow.ResourceValidationResult(
            passed=False, logs='GPU count too low')
        self.assertFalse(result.passed)
        self.assertEqual(result.logs, 'GPU count too low')


if __name__ == '__main__':
    unittest.main()
