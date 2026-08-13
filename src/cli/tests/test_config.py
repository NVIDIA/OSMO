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

import argparse
import subprocess
import unittest
from unittest import mock

from src.cli import config
from src.lib.utils import client, config_history, osmo_errors


def _parse_config_args(argv):
    """Route through the real `osmo config` parser so args.func matches production."""
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers()
    config.setup_parser(subparsers)
    return parser.parse_args(['config'] + argv)


def _service_client(response=None):
    """A ServiceClient stand-in that records the request it was handed."""
    service_client = mock.MagicMock()
    service_client.request.return_value = response
    return service_client


def _printed(mock_print):
    """Flatten every print() call into a single searchable string."""
    return ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)


def _completed_diff(stdout):
    """A `diff -u` result with the given stdout."""
    return subprocess.CompletedProcess(args=['diff'], returncode=1, stdout=stdout, stderr='')


class TestGetChangeDescription(unittest.TestCase):
    """get_change_description: comment stripping and the rendered config diff."""

    def test_get_change_description_strips_comment_lines(self):
        with mock.patch.object(config.editor, 'get_editor_input',
                               return_value='# ignored\nreal description\n# also ignored\n'):
            description = config.get_change_description()

        self.assertEqual(description, 'real description')

    def test_get_change_description_returns_empty_string_when_only_comments(self):
        with mock.patch.object(config.editor, 'get_editor_input',
                               return_value='# ignored\n# also ignored\n'):
            description = config.get_change_description()

        self.assertEqual(description, '')

    def test_get_change_description_embeds_diff_when_configs_provided(self):
        with mock.patch.object(config.editor, 'save_to_temp_file',
                               side_effect=['/tmp/current', '/tmp/updated']), \
             mock.patch.object(config.subprocess, 'run',
                               return_value=_completed_diff(
                                   '--- current\n+++ updated\n-old_value\n+new_value\n')), \
             mock.patch.object(config.editor, 'get_editor_input',
                               return_value='pool tweak') as editor_input:
            description = config.get_change_description(
                {'max_workers': 1}, {'max_workers': 2},
                config_history.ConfigHistoryType.POOL)

        prompt = editor_input.call_args.args[0]
        self.assertIn('# Diff of POOL between current and updated config:', prompt)
        self.assertIn('# -old_value', prompt)
        self.assertIn('# +new_value', prompt)
        self.assertEqual(description, 'pool tweak')

    def test_get_change_description_omits_diff_when_diff_output_empty(self):
        with mock.patch.object(config.editor, 'save_to_temp_file',
                               side_effect=['/tmp/current', '/tmp/updated']), \
             mock.patch.object(config.subprocess, 'run',
                               return_value=_completed_diff('')), \
             mock.patch.object(config.editor, 'get_editor_input',
                               return_value='no-op') as editor_input:
            config.get_change_description(
                {'max_workers': 1}, {'max_workers': 1},
                config_history.ConfigHistoryType.SERVICE)

        self.assertNotIn('Diff of SERVICE', editor_input.call_args.args[0])


class TestHistoryCommand(unittest.TestCase):
    """osmo config history: mutually exclusive time filters and query construction."""

    def test_history_created_before_with_at_timestamp_raises_user_error(self):
        args = _parse_config_args(['history', '--created-before', '2026-01-01',
                                   '--at-timestamp', '2026-02-01'])

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            args.func(_service_client(), args)

        self.assertIn('--created-before', str(raised.exception))

    def test_history_created_after_with_at_timestamp_raises_user_error(self):
        args = _parse_config_args(['history', '--created-after', '2026-01-01',
                                   '--at-timestamp', '2026-02-01'])

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            args.func(_service_client(), args)

        self.assertIn('--created-after', str(raised.exception))

    def test_history_json_format_forwards_every_filter(self):
        args = _parse_config_args(['history', 'SERVICE', '--format-type', 'json',
                                   '--offset', '10', '--count', '5', '--order', 'desc',
                                   '--name', 'my-pool', '--revision', '3',
                                   '--tags', 'stable', 'audited',
                                   '--created-before', '2026-01-02',
                                   '--created-after', '2026-01-01'])
        service_client = _service_client({'configs': []})

        with mock.patch('builtins.print') as mock_print:
            args.func(service_client, args)

        method, endpoint = service_client.request.call_args.args
        params = service_client.request.call_args.kwargs['params']
        self.assertEqual(method, client.RequestMethod.GET)
        self.assertEqual(endpoint, 'api/configs/history')
        self.assertEqual(params['omit_data'], True)
        self.assertEqual(params['offset'], 10)
        self.assertEqual(params['limit'], 5)
        self.assertEqual(params['order'], 'DESC')
        self.assertEqual(params['config_types'], ['SERVICE'])
        self.assertEqual(params['name'], 'my-pool')
        self.assertEqual(params['revision'], 3)
        self.assertEqual(params['tags'], ['stable', 'audited'])
        self.assertIn('created_before', params)
        self.assertIn('created_after', params)
        self.assertIn('"configs": []', _printed(mock_print))

    def test_history_at_timestamp_is_forwarded_as_query_param(self):
        args = _parse_config_args(['history', '--at-timestamp', '2026-01-01T12:00:00',
                                   '--format-type', 'json'])
        service_client = _service_client({'configs': []})

        with mock.patch('builtins.print'):
            args.func(service_client, args)

        params = service_client.request.call_args.kwargs['params']
        self.assertIn('at_timestamp', params)
        self.assertNotIn('created_before', params)

    def test_history_text_format_renders_entry_in_table(self):
        args = _parse_config_args(['history'])
        service_client = _service_client({'configs': [{
            'config_type': 'POOL',
            'name': 'my-pool',
            'revision': 7,
            'username': 'alice',
            'created_at': '2026-01-01 12:00:00',
            'description': 'resize',
            'tags': ['stable', 'audited'],
        }]})

        with mock.patch('builtins.print') as mock_print:
            args.func(service_client, args)

        output = _printed(mock_print)
        self.assertIn('POOL', output)
        self.assertIn('my-pool', output)
        self.assertIn('alice', output)
        self.assertIn('audited, stable', output)

    def test_history_text_format_shows_dashes_for_missing_name_and_tags(self):
        args = _parse_config_args(['history'])
        service_client = _service_client({'configs': [{
            'config_type': 'SERVICE',
            'name': None,
            'revision': 1,
            'username': 'bob',
            'created_at': '2026-01-01 12:00:00',
            'description': 'initial',
            'tags': [],
        }]})

        with mock.patch('builtins.print') as mock_print:
            args.func(service_client, args)

        output = _printed(mock_print)
        self.assertIn('SERVICE', output)
        self.assertIn('-', output)


class TestRollbackCommand(unittest.TestCase):
    """osmo config rollback: payload construction and empty-description abort."""

    def test_rollback_forwards_revision_description_and_tags(self):
        args = _parse_config_args(['rollback', 'SERVICE:4',
                                  '--description', 'restore stable',
                                  '--tags', 'rollback'])
        service_client = _service_client({'revision': 5})

        with mock.patch('builtins.print') as mock_print:
            args.func(service_client, args)

        method, endpoint = service_client.request.call_args.args
        payload = service_client.request.call_args.kwargs['payload']
        self.assertEqual(method, client.RequestMethod.POST)
        self.assertEqual(endpoint, 'api/configs/history/rollback')
        self.assertEqual(payload, {
            'revision': 4,
            'config_type': 'SERVICE',
            'description': 'restore stable',
            'tags': ['rollback'],
        })
        self.assertIn('Successfully rolled back SERVICE to revision 4', _printed(mock_print))

    def test_rollback_uses_editor_description_when_flag_omitted(self):
        args = _parse_config_args(['rollback', 'BACKEND:2'])
        service_client = _service_client(None)

        with mock.patch.object(config.editor, 'get_editor_input',
                               return_value='typed in editor'), \
             mock.patch('builtins.print'):
            args.func(service_client, args)

        payload = service_client.request.call_args.kwargs['payload']
        self.assertEqual(payload['description'], 'typed in editor')

    def test_rollback_aborts_when_description_is_empty(self):
        args = _parse_config_args(['rollback', 'BACKEND:2'])
        service_client = _service_client(None)

        with mock.patch.object(config.editor, 'get_editor_input',
                               return_value='# only a comment\n'), \
             mock.patch('builtins.print') as mock_print:
            args.func(service_client, args)

        self.assertIn('Aborting rollback due to empty description.', _printed(mock_print))
        service_client.request.assert_not_called()


class TestListCommand(unittest.TestCase):
    """osmo config list: current revision lookup for every operable config type."""

    def test_list_json_format_requests_all_operable_config_types(self):
        args = _parse_config_args(['list', '--format-type', 'json'])
        service_client = _service_client({'configs': []})

        with mock.patch('builtins.print') as mock_print:
            args.func(service_client, args)

        params = service_client.request.call_args.kwargs['params']
        self.assertEqual(params['config_types'], config_history.OPERABLE_CONFIG_TYPES)
        self.assertEqual(params['omit_data'], True)
        self.assertIn('at_timestamp', params)
        self.assertIn('"configs": []', _printed(mock_print))

    def test_list_text_format_sorts_rows_by_config_type(self):
        args = _parse_config_args(['list'])
        service_client = _service_client({'configs': [
            {'config_type': 'POOL', 'revision': 9, 'username': 'alice',
             'created_at': '2026-01-01 12:00:00'},
            {'config_type': 'BACKEND', 'revision': 2, 'username': 'bob',
             'created_at': '2026-01-01 12:00:00'},
        ]})

        with mock.patch('builtins.print') as mock_print:
            args.func(service_client, args)

        output = _printed(mock_print)
        self.assertLess(output.index('BACKEND'), output.index('POOL'))


class TestShowCommand(unittest.TestCase):
    """osmo config show: revision lookup, verbose gating, and named-config indexing."""

    def test_show_historical_revision_prints_stored_data(self):
        args = _parse_config_args(['show', 'SERVICE:3'])
        service_client = _service_client({'configs': [{'data': {'timeout': 30}}]})

        with mock.patch('builtins.print') as mock_print:
            args.func(service_client, args)

        params = service_client.request.call_args.kwargs['params']
        self.assertEqual(params['config_types'], ['SERVICE'])
        self.assertEqual(params['omit_data'], False)
        self.assertEqual(params['revision'], 3)
        self.assertIn('"timeout": 30', _printed(mock_print))

    def test_show_historical_revision_with_verbose_raises_user_error(self):
        args = _parse_config_args(['show', 'POOL:3', '--verbose'])

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            args.func(_service_client(), args)

        self.assertIn('--verbose is not supported for historical revisions',
                      str(raised.exception))

    def test_show_historical_revision_not_found_raises_user_error(self):
        args = _parse_config_args(['show', 'SERVICE:3'])
        service_client = _service_client({'configs': []})

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            args.func(service_client, args)

        self.assertIn('No config found matching the specified criteria', str(raised.exception))

    def test_show_verbose_for_non_pool_config_raises_user_error(self):
        args = _parse_config_args(['show', 'WORKFLOW', '--verbose'])

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            args.func(_service_client(), args)

        self.assertIn('--verbose is only supported for POOL configs', str(raised.exception))

    def test_show_pool_verbose_forwards_verbose_query_param(self):
        args = _parse_config_args(['show', 'POOL', '--verbose'])
        service_client = _service_client({'pools': []})

        with mock.patch('builtins.print'):
            args.func(service_client, args)

        _method, endpoint = service_client.request.call_args.args
        self.assertEqual(endpoint, 'api/configs/pool')
        self.assertEqual(service_client.request.call_args.kwargs['params'], {'verbose': True})

    def test_show_current_config_omits_params_without_verbose(self):
        args = _parse_config_args(['show', 'SERVICE'])
        service_client = _service_client({'timeout': 30})

        with mock.patch('builtins.print') as mock_print:
            args.func(service_client, args)

        self.assertIsNone(service_client.request.call_args.kwargs['params'])
        self.assertIn('"timeout": 30', _printed(mock_print))

    def test_show_non_operable_config_type_raises_user_error(self):
        args = _parse_config_args(['show', 'DATASET'])

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            args.func(_service_client(), args)

        self.assertIn('Invalid config type "DATASET"', str(raised.exception))

    def test_show_named_backend_indexes_into_backends_list(self):
        args = _parse_config_args(['show', 'BACKEND', 'my-backend'])
        service_client = _service_client(
            {'backends': [{'name': 'my-backend', 'url': 'https://backend.example'},
                          {'name': 'other-backend', 'url': 'https://other.example'}]})

        with mock.patch('builtins.print') as mock_print:
            args.func(service_client, args)

        output = _printed(mock_print)
        self.assertIn('https://backend.example', output)
        self.assertNotIn('https://other.example', output)

    def test_show_named_pool_indexes_into_pools_list(self):
        args = _parse_config_args(['show', 'POOL', 'my-pool'])
        service_client = _service_client(
            {'pools': [{'name': 'my-pool', 'max_workers': 4}]})

        with mock.patch('builtins.print') as mock_print:
            args.func(service_client, args)

        self.assertIn('"max_workers": 4', _printed(mock_print))

    def test_show_named_config_missing_key_raises_user_error(self):
        args = _parse_config_args(['show', 'POOL', 'absent-pool'])
        service_client = _service_client({'pools': [{'name': 'my-pool', 'max_workers': 4}]})

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            args.func(service_client, args)

        self.assertIn('Cannot index into', str(raised.exception))


if __name__ == '__main__':
    unittest.main()
