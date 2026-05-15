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

from src.service.agent import helpers
from src.utils import backend_messages
from src.utils.job import task


class OTGStatusUpdateTest(unittest.TestCase):

    def test_task_updates_are_forwarded_to_pod_status_path(self):
        message = backend_messages.OTGStatusBody(
            workflow_uuid='workflow-uuid',
            group_name='group-a',
            namespace='osmo-vpan',
            name='otg-a',
            phase='Running',
            task_status_updates=[
                backend_messages.OTGTaskStatusUpdateBody(
                    workflow_uuid='workflow-uuid',
                    task_uuid='task-uuid',
                    retry_id=2,
                    container='user',
                    status='RUNNING',
                    backend='backend-a',
                )
            ],
        )
        forwarded = []

        with mock.patch.object(
                helpers, 'queue_update_group_job', side_effect=lambda _postgres, body:
                forwarded.append(body)):
            helpers.queue_otg_status_update_job(mock.Mock(), message)

        self.assertEqual(len(forwarded), 1)
        self.assertEqual(forwarded[0].workflow_uuid, 'workflow-uuid')
        self.assertEqual(forwarded[0].task_uuid, 'task-uuid')
        self.assertEqual(forwarded[0].status, 'RUNNING')

    def test_group_fallback_queues_update_group_when_no_task_updates_exist(self):
        postgres = mock.Mock()
        postgres.execute_fetch_command.return_value = [{
            'workflow_id': 'workflow-a',
            'workflow_uuid': 'workflow-uuid',
            'submitted_by': 'user-a',
        }]
        message = backend_messages.OTGStatusBody(
            workflow_uuid='workflow-uuid',
            group_name='group-a',
            namespace='osmo-vpan',
            name='otg-a',
            phase='Failed',
            message='controller failed',
        )

        with mock.patch.object(helpers.jobs, 'UpdateGroup') as update_group_class:
            helpers.queue_otg_status_update_job(postgres, message)

        update_group_class.assert_called_once()
        update_group_class.return_value.send_job_to_queue.assert_called_once()
        self.assertEqual(
            update_group_class.call_args.kwargs['status'],
            task.TaskGroupStatus.FAILED_SERVER_ERROR,
        )
        self.assertEqual(update_group_class.call_args.kwargs['message'], 'controller failed')


if __name__ == '__main__':
    unittest.main()
