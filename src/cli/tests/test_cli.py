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
import contextlib
import io
import json
import unittest
from unittest import mock

import src.cli.cli as cli
from src.cli import main_parser, workflow
from src.lib.rsync import rsync
from src.lib.utils import osmo_errors


class TestInvalidLabelArgument(unittest.TestCase):
    def test_leading_hyphen_label_fails_before_client_setup(self):
        output = io.StringIO()
        with mock.patch.object(cli.sys, 'argv', [
                'osmo', 'workflow', 'submit', 'workflow.yaml', '--label', '-key=val']), \
             mock.patch.object(cli, 'configure_logging') as configure_logging, \
             mock.patch.object(cli.client, 'LoginManager') as login_manager, \
             mock.patch.object(cli.client, 'ServiceClient') as service_client, \
             contextlib.redirect_stderr(output), self.assertRaises(SystemExit) as raised:
            cli.main()

        self.assertEqual(raised.exception.code, 2)
        self.assertIn('If your label key starts with "-", it is invalid', output.getvalue())
        self.assertIn('--label key=val', output.getvalue())
        configure_logging.assert_not_called()
        login_manager.assert_not_called()
        service_client.assert_not_called()


class TestSubmissionErrorOutput(unittest.TestCase):
    """The CLI reports HTTP status separately from its process exit code."""

    def _run_cli(self, format_type: str, status_code: int | None) -> tuple[str, int]:
        args = argparse.Namespace(
            format_type=format_type,
            func=mock.Mock(side_effect=osmo_errors.OSMOSubmissionError(
                'Workflow submit failed.',
                status_code=status_code,
            )),
            log_level=mock.sentinel.log_level,
        )
        parser = mock.Mock()
        parser.parse_args.return_value = args
        output = io.StringIO()

        with mock.patch.object(
                cli.main_parser, 'create_cli_parser', return_value=parser), \
             mock.patch.object(cli, 'configure_logging'), \
             mock.patch.object(cli.client, 'LoginManager'), \
             mock.patch.object(cli.client, 'ServiceClient'), \
             mock.patch.object(cli.sys, 'argv', ['osmo']), \
             contextlib.redirect_stdout(output), \
             self.assertRaises(SystemExit) as raised:
            cli.main()

        exit_code = raised.exception.code
        if not isinstance(exit_code, int):
            self.fail(f'Expected integer exit code, got {exit_code!r}.')
        return output.getvalue(), exit_code

    def test_text_output_uses_http_status_and_submission_exit_code(self):
        output, exit_code = self._run_cli('text', 400)

        self.assertEqual(
            output,
            'Error message: Workflow submit failed.\nError code: 400\n',
        )
        self.assertEqual(exit_code, 1)

    def test_json_output_uses_http_status_and_submission_exit_code(self):
        output, exit_code = self._run_cli('json', 400)

        self.assertEqual(
            json.loads(output),
            {'message': 'Workflow submit failed.', 'code': 400},
        )
        self.assertEqual(exit_code, 1)

    def test_missing_http_status_retains_error_code_fallback(self):
        output, exit_code = self._run_cli('text', None)

        self.assertIn('Error code: 1', output)
        self.assertEqual(exit_code, 1)


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


class TestRemovedCommands(unittest.TestCase):
    def test_workflow_tags_reject_before_login_or_requests(self):
        cases = (
            ['workflow', 'tag'],
            ['workflow', 'tag', '--help'],
            ['workflow', 'tag', '--workflow', 'wf-1', '--add', 'nightly'],
            ['workflow', 'tag', '--workflow', 'wf-1', '--remove', 'nightly'],
            ['workflow', 'list', '--tags', 'nightly'],
            ['workflow', 'list', '--tag', 'nightly'],
        )
        for arguments in cases:
            with self.subTest(arguments=arguments):
                output = io.StringIO()
                errors = io.StringIO()
                with mock.patch.object(cli.sys, 'argv', ['osmo', *arguments]), \
                     mock.patch.object(cli, 'configure_logging') as configure_logging, \
                     mock.patch.object(cli.client, 'LoginManager') as login_manager, \
                     mock.patch.object(cli.client, 'ServiceClient') as service_client, \
                     contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                    service_client.return_value.request.return_value = {
                        'tags': [], 'workflows': [], 'more_entries': False,
                    }
                    with self.assertRaises(SystemExit) as raised:
                        cli.main()

                self.assertEqual(raised.exception.code, 2)
                diagnostic = 'invalid choice' if arguments[1] == 'tag' else 'unrecognized arguments'
                self.assertIn(diagnostic, errors.getvalue())
                configure_logging.assert_not_called()
                login_manager.assert_not_called()
                service_client.assert_not_called()
                service_client.return_value.request.assert_not_called()

    def test_dataset_command_is_not_registered(self):
        parser = main_parser.create_cli_parser()

        with self.assertRaises(SystemExit):
            parser.parse_args(["dataset", "list"])

    def test_bucket_command_is_not_registered(self):
        parser = main_parser.create_cli_parser()

        with self.assertRaises(SystemExit):
            parser.parse_args(["bucket", "list"])


if __name__ == "__main__":
    unittest.main()
