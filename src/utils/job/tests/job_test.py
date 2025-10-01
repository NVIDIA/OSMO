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

import unittest
from unittest import mock

import yaml

from src.lib.utils import common
from src.utils.job import jobs, task, workflow
from src.utils.job.tests import test_harness

POSTGRES_PORT = 5555
REDIS_PORT = 5556

def get_workflow_spec():
    spec_dict = yaml.safe_load('''
      name: test_workflow
      resources:
        default:
          cpu:
            count: 1
          memory: 1Gi
          storage: 1Gi

      tasks:
      - name: task1
        command: ['command1']
        image: image1
      - name: task2
        command: ['command2']
        image: image2
        inputs:
        - task: task1
    ''')
    spec = workflow.WorkflowSpec(**spec_dict)
    return spec.convert_to_workflow_spec()

class MockContext:
    def __init__(self, redis_config):
        self.cluster = mock.Mock()
        self.redis = redis_config
        self.backend_k8s_timeout = 60

class JobTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.harness = test_harness.TestHarness(postgres_port=POSTGRES_PORT, redis_port=REDIS_PORT)

    def assert_wf_status(self, workflow_id, workflow_status, group_statuses):
        wf = workflow.Workflow.fetch_from_db(self.harness.database, workflow_id)
        self.assertEqual(wf.status, workflow_status)
        for group, status in group_statuses.items():
            group = task.TaskGroup.fetch_from_db(self.harness.database, workflow_id, group)
            self.assertEqual(group.status, status,
                f"Status for group {group} in workflow {workflow_id}")

    def create_update_job(self, workflow_id, workflow_uuid, group_name, status):
        update_job = jobs.UpdateGroup(workflow_id=workflow_id, workflow_uuid=workflow_uuid,
            group_name=group_name, status=status, user='user')
        update_job.send_job_to_queue(self.harness.config)

    def test_run_serial_workflow(self):
        """ Runs a simple serial workflow """
        self.run_serial_workflow('serial-workflow', common.generate_unique_id())

    def test_run_serial_workflow_repeat_jobs(self):
        """ Run a serial workflow but execute each job twice to make sure they are idempotent """
        self.run_serial_workflow('serial-workflow-repeat', common.generate_unique_id(), repeat=2)

    def run_serial_workflow(self, workflow_id, workflow_uuid, repeat=1):
        # Submit, fetch, and execute a submit workflow job
        spec = get_workflow_spec()
        submit_job = jobs.SubmitWorkflow(
            workflow_id=workflow_id, workflow_uuid=workflow_uuid,
            user='user', spec=spec,
            original_spec={'version': 2, 'workflow': {}})
        submit_job.send_job_to_queue()
        self.harness.get_and_run_job('SubmitWorkflow')

        # Make sure the task/workflow are created and in PENDING state
        self.assert_wf_status(workflow_id, workflow.WorkflowStatus.PENDING, group_statuses={
            'task1-group': task.TaskGroupStatus.PROCESSING,
            'task2-group': task.TaskGroupStatus.PROCESSING,
        })

        # We should get a submit task, run the submit task
        backend_context = MockContext(self.harness.config)
        self.harness.get_job('CreateGroup')

        # Now send an update task, make sure the workflow and task are running
        self.create_update_job(workflow_id, workflow_uuid, 'task1-group',
                               task.TaskGroupStatus.RUNNING)
        self.harness.get_and_run_job('UpdateGroup')
        self.assert_wf_status(workflow_id, workflow.WorkflowStatus.RUNNING, group_statuses={
            'task1-group': task.TaskGroupStatus.RUNNING,
            'task2-group': task.TaskGroupStatus.PROCESSING,
        })

        # Send another update task for completed
        self.create_update_job(workflow_id, workflow_uuid, 'task1-group',
                               task.TaskGroupStatus.COMPLETED)
        self.harness.get_and_run_job('UpdateGroup')
        self.assert_wf_status(workflow_id, workflow.WorkflowStatus.RUNNING, group_statuses={
            'task1-group': task.TaskGroupStatus.COMPLETED,
            'task2-group': task.TaskGroupStatus.PROCESSING,
        })

        # Get the submit task job for task2 and execute it
        submit_task_job = self.harness.get_job('CreateGroup')

        # Send an update task for group2
        self.create_update_job(workflow_id, workflow_uuid, 'task2-group',
                               task.TaskGroupStatus.RUNNING)
        self.harness.get_and_run_job('UpdateGroup')
        self.assert_wf_status(workflow_id, workflow.WorkflowStatus.RUNNING, group_statuses={
            'task1-group': task.TaskGroupStatus.COMPLETED,
            'task2-group': task.TaskGroupStatus.RUNNING,
        })

        # Send another update task for completed
        self.create_update_job(workflow_id, workflow_uuid, 'task2-group',
                               task.TaskGroupStatus.COMPLETED)
        self.harness.get_and_run_job('UpdateGroup')
        self.assert_wf_status(workflow_id, workflow.WorkflowStatus.COMPLETED, group_statuses={
            'task1-group': task.TaskGroupStatus.COMPLETED,
            'task2-group': task.TaskGroupStatus.COMPLETED,
        })

        # Run the backend cleanup task for both jobs
        # self.harness.get_and_run_job('BackendCleanupGroup', backend_context)
        # self.harness.get_and_run_job('BackendCleanupGroup', backend_context)
        # self.harness.get_and_run_job('CleanupGroup')
        # self.harness.get_and_run_job('CleanupGroup')


if __name__ == '__main__':
    unittest.main()
