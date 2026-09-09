"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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

import contextlib
import io
import json
import unittest
from typing import Any
from unittest import mock

from src.cli import main_parser
from src.lib.utils import client, osmo_errors


class TestConfigShow(unittest.TestCase):
    """Exercise the public config parser and its read-only request behavior."""

    def setUp(self):
        self.parser = main_parser.create_cli_parser()
        self.service_client = mock.Mock()

    def run_show(self, arguments, response):
        args = self.parser.parse_args(['config', 'show', *arguments])
        self.service_client.request.return_value = response
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            args.func(self.service_client, args)
        return json.loads(output.getvalue())

    def test_all_current_config_types_use_get(self):
        for config_type in (
                'SERVICE', 'WORKFLOW', 'BACKEND', 'POOL', 'POD_TEMPLATE',
                'GROUP_TEMPLATE', 'RESOURCE_VALIDATION', 'BACKEND_TEST', 'ROLE'):
            with self.subTest(config_type=config_type):
                self.service_client.reset_mock()
                response = {'example': {'enabled': True}}
                self.assertEqual(self.run_show([config_type], response), response)
                self.service_client.request.assert_called_once_with(
                    client.RequestMethod.GET,
                    f'api/configs/{config_type.lower()}', params=None)

    def test_named_and_nested_lookups(self):
        cases: tuple[tuple[list[str], Any, Any], ...] = (
            (['SERVICE', 'notifications', 'enabled'],
             {'notifications': {'enabled': True}}, True),
            (['POOL', 'gpu', 'platforms', 'cpu'],
             {'pools': {'gpu': {'platforms': {'cpu': {'description': 'CPU'}}}}},
             {'description': 'CPU'}),
            (['BACKEND', 'cluster', 'version'],
             {'backends': [{'name': 'cluster', 'version': '6.4'}]}, '6.4'),
            (['ROLE', 'reader', 'policies', '0', 'actions'],
             [{'name': 'reader', 'policies': [{'actions': ['config:Read']}]}],
             ['config:Read']),
            (['POD_TEMPLATE', 'user', 'spec'],
             {'user': {'spec': {'containers': []}}}, {'containers': []}),
        )
        for arguments, response, expected in cases:
            with self.subTest(arguments=arguments):
                self.assertEqual(self.run_show(arguments, response), expected)

    def test_pool_verbose_preserves_resolved_output(self):
        response: dict[str, Any] = {'pools': {'gpu': {'parsed_pod_template': {'spec': {}}}}}
        for arguments, expected in (
                (['POOL', '--verbose'], response),
                (['POOL', 'gpu', '-v'], response['pools']['gpu'])):
            with self.subTest(arguments=arguments):
                self.service_client.reset_mock()
                self.assertEqual(self.run_show(arguments, response), expected)
                self.service_client.request.assert_called_once_with(
                    client.RequestMethod.GET, 'api/configs/pool', params={'verbose': True})

    def test_verbose_rejects_other_types_without_request(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'only supported for POOL'):
            self.run_show(['SERVICE', '--verbose'], {})
        self.service_client.request.assert_not_called()

    def test_invalid_paths_report_user_errors(self):
        cases = (
            (['missing'], {'enabled': True}, 'Cannot index'),
            (['rules', '-1'], {'rules': [True]}, 'out of range'),
            (['rules', '1'], {'rules': [True]}, 'out of range'),
            (['rules', 'name'], {'rules': [True]}, 'Expected integer index'),
            (['enabled', 'child'], {'enabled': True}, 'Cannot index'),
        )
        for names, response, message in cases:
            with self.subTest(names=names), self.assertRaisesRegex(
                    osmo_errors.OSMOUserError, message):
                self.run_show(['SERVICE', *names], response)

    def test_removed_commands_and_revision_syntax_are_parse_errors(self):
        arguments = [['config', command] for command in (
            'update', 'set', 'delete', 'list', 'history', 'diff', 'rollback', 'tag')]
        arguments.extend([
            ['config'], ['config', 'show'],
            ['config', 'show', 'SERVICE:1'],
            ['config', 'show', 'DATASET'],
            ['config', 'show', 'UNKNOWN'],
        ])
        for command in arguments:
            with self.subTest(command=command), contextlib.redirect_stderr(io.StringIO()), \
                    self.assertRaises(SystemExit) as raised:
                self.parser.parse_args(command)
            self.assertEqual(raised.exception.code, 2)
        self.service_client.request.assert_not_called()

    def test_config_help_only_advertises_show(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(SystemExit) as raised:
            self.parser.parse_args(['config', '--help'])
        self.assertEqual(raised.exception.code, 0)
        self.assertIn('{show}', output.getvalue())
        for command in ('update', 'set', 'delete', 'list', 'history', 'diff', 'rollback', 'tag'):
            self.assertNotRegex(output.getvalue(), rf'(?m)^  +{command}\s')

    def test_show_help_excludes_dataset_and_historical_examples(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(SystemExit):
            self.parser.parse_args(['config', 'show', '--help'])
        self.assertNotIn('DATASET', output.getvalue())
        self.assertNotIn('SERVICE:1', output.getvalue())


if __name__ == '__main__':
    unittest.main()
