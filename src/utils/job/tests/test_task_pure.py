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

import unittest
from unittest import mock

from src.lib.utils import priority as wf_priority
from src.utils.job import jobs, kb_objects, task


class RetryTaskK8sResourcesTest(unittest.TestCase):
    """Tests for retry resource reconciliation."""

    def test_retry_task_recreates_generated_file_secrets(self):
        workflow_uuid = 'a' * 32
        task_db_key = 'c' * 32
        group_uuid = 'd' * 32
        user = 'alice'
        database = mock.Mock()
        context = mock.Mock(postgres=database)
        progress_writer = mock.Mock()
        k8s_factory = kb_objects.K8sObjectFactory('default-scheduler')
        file_mount = kb_objects.FileMount(
            group_uid=group_uuid,
            path='/workspace/run.sh',
            content='ZWNobyBoZWxsbwo=',
            k8s_factory=k8s_factory,
        )
        pod_labels = {
            'osmo.workflow_uuid': workflow_uuid,
            'osmo.group_uuid': group_uuid,
            'osmo.group_name': 'group',
            'osmo.submitted_by': user,
            'osmo.task_name': 'worker',
            'osmo.retry_id': '1',
        }
        pod = {
            'apiVersion': 'v1',
            'kind': 'Pod',
            'metadata': {'name': 'retry-pod', 'labels': pod_labels},
            'spec': {},
        }

        spec = task.TaskSpec(
            name='worker',
            image='ubuntu:22.04',
            command=['/bin/sh'],
            backend='default',
        )
        group = mock.Mock()
        group.name = 'group'
        group.group_uuid = group_uuid
        group.spec.tasks = [spec]
        group.convert_to_pod_spec.return_value = (pod, {'run.sh': file_mount}, None)

        new_task = mock.Mock()
        new_task.name = 'worker'
        new_task.task_uuid = 'b' * 32
        new_task.task_db_key = 'e' * 32
        new_task.retry_id = 1
        task_obj = mock.Mock()
        task_obj.name = 'worker'
        task_obj.task_db_key = task_db_key
        task_obj.retry_id = 0
        task_obj.create_new.return_value = new_task
        workflow_obj = mock.Mock()
        workflow_obj.plugins = mock.Mock()
        workflow_obj.priority = wf_priority.WorkflowPriority.NORMAL
        update_job = jobs.UpdateGroup(
            workflow_id='workflow-1',
            workflow_uuid=workflow_uuid,
            group_name='group',
            task_name='worker',
            retry_id=0,
            status=task.TaskGroupStatus.RESCHEDULED,
            user=user,
        )

        with mock.patch.object(
            task.TaskGroup, 'fetch_metadata_from_db', return_value=group
        ), mock.patch.object(
            jobs.RescheduleTask, 'send_job_to_queue', autospec=True
        ) as send_job:
            update_job._retry_task(  # pylint: disable=protected-access
                task_obj,
                group,
                'default',
                mock.Mock(max_error_log_lines=1000),
                mock.Mock(),
                context,
                progress_writer,
                workflow_obj,
                k8s_factory,
            )

        reschedule_job = send_job.call_args.args[0]
        resources = reschedule_job.create_job.k8s_resources
        self.assertEqual(['Secret', 'Pod'], [resource['kind'] for resource in resources])
        self.assertEqual(file_mount.name, resources[0]['metadata']['name'])
        self.assertEqual(pod_labels, resources[0]['metadata']['labels'])
        self.assertEqual(pod, resources[1])
        self.assertEqual(2, progress_writer.report_progress.call_count)
