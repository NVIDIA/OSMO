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
import argparse
import unittest
from unittest import mock

from src.cli import workflow
from src.lib.rsync import rsync

class TestPortParse(unittest.TestCase):
    def test_port_parse(self):
        """ Test different cases for port parsing. """
        regular_port = '8000:8000'
        parsed_port = workflow.parse_port(regular_port)
        self.assertEqual(parsed_port[0], [8000])
        self.assertEqual(parsed_port[1], [8000])

        single_port = '8000'
        parsed_port = workflow.parse_port(single_port)
        self.assertEqual(parsed_port[0], [8000])
        self.assertEqual(parsed_port[1], [8000])

        multiple_port = '8000-8002:9000-9002,8005'
        parsed_port = workflow.parse_port(multiple_port)
        self.assertEqual(parsed_port[0], [8000, 8001, 8002, 8005])
        self.assertEqual(parsed_port[1], [9000, 9001, 9002, 8005])

        def test_bad_port(bad_port: str):
            with self.assertRaises(argparse.ArgumentTypeError):
                _ = workflow.parse_port(bad_port)

        # More than 1 colon is not allowed
        test_bad_port('8000:8000:8000')

        # Non-digits are not allowed
        test_bad_port('hello:port')
        test_bad_port('hello')

        # Values below 0 for ports are not allowed
        test_bad_port('-1:8000')
        test_bad_port('8000:-1')

        # Values above 65535 for ports are not allowed
        test_bad_port('70000:8000')
        test_bad_port('8000:70000')

        # Ports not matched
        test_bad_port('8000-8005:9001-9002')


class TestAsyncioEntrypoints(unittest.TestCase):
    def test_exec_workflow_runs_without_current_event_loop(self):
        service_client = mock.Mock()
        service_client.request.return_value = {
            'router_address': 'ws://router',
            'cookie': 'session=abc',
            'key': 'key-1',
        }
        args = argparse.Namespace(
            group=None,
            task='task-1',
            keep_alive=False,
            exec_entry_command='/bin/bash',
            workflow_id='workflow-1',
        )

        with mock.patch.object(
            workflow,
            '_run_exec_interactive',
            new=mock.AsyncMock(),
        ) as run_exec_interactive:
            workflow._exec_workflow(service_client, args)

        self.assertEqual(run_exec_interactive.await_count, 1)

    def test_port_forward_runs_without_current_event_loop(self):
        service_client = mock.Mock()
        service_client.request.return_value = [{
            'router_address': 'ws://router',
            'key': 'key-1',
            'cookie': 'session=abc',
        }]
        args = argparse.Namespace(
            workflow_id='workflow-1',
            task='task-1',
            port=([8080], [8080]),
            udp=False,
            host='localhost',
            connect_timeout=10,
        )

        with mock.patch.object(
            workflow,
            '_single_port_forward',
            new=mock.AsyncMock(),
        ) as single_port_forward:
            workflow._port_forward(service_client, args)

        self.assertEqual(single_port_forward.await_count, 1)

    def test_rsync_upload_runs_without_current_event_loop_for_foreground_mode(self):
        service_client = mock.Mock()

        with mock.patch.object(rsync, 'get_rsync_config', return_value={}), mock.patch.object(
            rsync,
            'parse_rsync_request',
            return_value=mock.sentinel.rsync_request,
        ), mock.patch.object(
            rsync,
            'rsync_upload_task',
            new=mock.AsyncMock(),
        ) as upload_task:
            rsync.rsync_upload(
                service_client,
                'workflow-1',
                'task-1',
                '/tmp/local:/tmp/remote',
                daemon=False,
            )

        self.assertEqual(upload_task.await_count, 1)

    def test_rsync_download_runs_without_current_event_loop(self):
        service_client = mock.Mock()

        with mock.patch.object(rsync, 'get_rsync_config', return_value={}), mock.patch.object(
            rsync,
            'parse_rsync_request',
            return_value=mock.sentinel.rsync_request,
        ), mock.patch.object(
            rsync,
            'rsync_download_task',
            new=mock.AsyncMock(),
        ) as download_task:
            rsync.rsync_download(
                service_client,
                'workflow-1',
                'task-1',
                '/tmp/remote:/tmp/local',
            )

        self.assertEqual(download_task.await_count, 1)


if __name__ == "__main__":
    unittest.main()
