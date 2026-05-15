"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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

import json
from unittest import mock

from src.service.core import taskgroup_status


def test_backend_updates_from_explicit_task_updates():
    report = taskgroup_status.ReportOTGStatusRequest(
        namespace='default',
        name='otg-a',
        task_status_updates=[
            taskgroup_status.TaskStatusUpdate(
                workflow_uuid='workflow-uuid',
                task_uuid='task-uuid',
                retry_id=1,
                container='user',
                node='node-a',
                pod_ip='10.0.0.1',
                status='RUNNING',
                exit_code=-1,
                backend='kai',
            ),
        ],
    )

    updates = taskgroup_status.backend_updates_from_report(report)

    assert len(updates) == 1
    assert updates[0].workflow_uuid == 'workflow-uuid'
    assert updates[0].task_uuid == 'task-uuid'
    assert updates[0].status == 'RUNNING'
    assert updates[0].exit_code is None


def test_backend_updates_from_status_json_runtime_status():
    report = taskgroup_status.ReportOTGStatusRequest(
        namespace='default',
        name='otg-a',
        status_json=json.dumps({
            'runtimeStatus': {
                'task_status_updates': [
                    {
                        'workflow_uuid': 'workflow-uuid',
                        'task_uuid': 'task-uuid',
                        'retry_id': 2,
                        'container': 'user',
                        'status': 'COMPLETED',
                        'exit_code': 0,
                        'backend': 'kai',
                    },
                ],
            },
        }),
    )

    updates = taskgroup_status.backend_updates_from_report(report)

    assert len(updates) == 1
    assert updates[0].retry_id == 2
    assert updates[0].status == 'COMPLETED'
    assert updates[0].exit_code == 0


def test_status_token_rejects_when_not_configured():
    with mock.patch.dict('os.environ', {}, clear=True):
        assert not taskgroup_status.is_valid_status_token(None)


def test_status_token_must_match_when_configured():
    with mock.patch.dict('os.environ', {
        taskgroup_status.STATUS_TOKEN_ENV: 'expected-token',
    }):
        assert taskgroup_status.is_valid_status_token('expected-token')
        assert not taskgroup_status.is_valid_status_token('wrong-token')
