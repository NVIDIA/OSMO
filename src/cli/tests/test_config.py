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
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from typing import Any, List, cast
from unittest import mock

from src.cli import config, editor
from src.lib.utils import client, common, config_history, osmo_errors


def run_config_command(service_client: mock.MagicMock, argv: List[str]) -> None:
    """
    Parse the given ``osmo config`` argument vector with the real CLI parser and
    dispatch to the handler that the parser wired up.
    """
    parser = argparse.ArgumentParser(prog='osmo')
    subparsers = parser.add_subparsers(dest='module')
    config.setup_parser(subparsers)
    args = parser.parse_args(argv)
    args.func(service_client, args)


def joined_output(mock_print: mock.MagicMock) -> str:
    """Join every positional argument passed to a mocked ``print`` into one string."""
    return ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)


class ConfigCommandTestCase(unittest.TestCase):
    """
    Shared fixture for ``osmo config`` command tests: a mocked service client, a
    mocked ``print`` and deterministic timezone conversion helpers.
    """

    def setUp(self):
        self.service_client = mock.MagicMock()

        print_patcher = mock.patch('builtins.print')
        self.mock_print = print_patcher.start()
        self.addCleanup(print_patcher.stop)

        timezone_patcher = mock.patch.object(
            common, 'convert_timezone', side_effect=lambda date_value: date_value)
        timezone_patcher.start()
        self.addCleanup(timezone_patcher.stop)

        user_zone_patcher = mock.patch.object(
            common, 'convert_utc_datetime_to_user_zone',
            return_value='Jan 02, 2025 03:04 UTC')
        user_zone_patcher.start()
        self.addCleanup(user_zone_patcher.stop)

    @property
    def output(self) -> str:
        """Everything printed by the command under test, joined into one string."""
        return joined_output(self.mock_print)

    @property
    def request_calls(self) -> List[Any]:
        """The list of calls made against the mocked service client."""
        return self.service_client.request.call_args_list


class TestGetChangeDescription(unittest.TestCase):
    """Tests for get_change_description, which prompts for an audit description."""

    def test_get_change_description_comment_lines_are_stripped(self):
        with mock.patch.object(editor, 'get_editor_input',
                               return_value='# ignored\nUpdated pool quota\n# also ignored\n'):
            description = config.get_change_description()

        self.assertEqual(description, 'Updated pool quota')

    def test_get_change_description_multiple_content_lines_are_joined(self):
        with mock.patch.object(editor, 'get_editor_input',
                               return_value='first line\nsecond line\n# tail\n'):
            description = config.get_change_description()

        self.assertEqual(description, 'first line\nsecond line')

    def test_get_change_description_only_comments_returns_empty_string(self):
        with mock.patch.object(editor, 'get_editor_input',
                               return_value='# nothing but comments\n'):
            description = config.get_change_description()

        self.assertEqual(description, '')

    def test_get_change_description_prompt_explains_comment_handling(self):
        with mock.patch.object(editor, 'get_editor_input', return_value='a change') as mock_input:
            config.get_change_description()

        self.assertIn('Please enter the description for your changes',
                      mock_input.call_args.args[0])

    def test_get_change_description_with_configs_embeds_diff_in_prompt(self):
        diff_result = mock.MagicMock(stdout='--- current\n+++ updated\n-old\n+new\n')
        with mock.patch.object(editor, 'save_to_temp_file',
                               side_effect=['/tmp/current.json', '/tmp/updated.json']), \
                mock.patch.object(subprocess, 'run', return_value=diff_result), \
                mock.patch.object(editor, 'get_editor_input',
                                  return_value='a change') as mock_input:
            config.get_change_description(
                {'gpus': 1}, {'gpus': 2}, config_history.ConfigHistoryType.POOL)

        self.assertIn('# Diff of POOL between current and updated config:',
                      mock_input.call_args.args[0])

    def test_get_change_description_with_configs_includes_changed_lines(self):
        diff_result = mock.MagicMock(
            stdout='--- current\n+++ updated\n-  "gpus": 1\n+  "gpus": 2\n')
        with mock.patch.object(editor, 'save_to_temp_file',
                               side_effect=['/tmp/current.json', '/tmp/updated.json']), \
                mock.patch.object(subprocess, 'run', return_value=diff_result), \
                mock.patch.object(editor, 'get_editor_input',
                                  return_value='a change') as mock_input:
            config.get_change_description(
                {'gpus': 1}, {'gpus': 2}, config_history.ConfigHistoryType.POOL)

        self.assertIn('# +  "gpus": 2', mock_input.call_args.args[0])

    def test_get_change_description_with_empty_diff_omits_diff_section(self):
        diff_result = mock.MagicMock(stdout='')
        with mock.patch.object(editor, 'save_to_temp_file',
                               side_effect=['/tmp/current.json', '/tmp/updated.json']), \
                mock.patch.object(subprocess, 'run', return_value=diff_result), \
                mock.patch.object(editor, 'get_editor_input',
                                  return_value='a change') as mock_input:
            config.get_change_description(
                {'gpus': 1}, {'gpus': 1}, config_history.ConfigHistoryType.ROLE)

        self.assertNotIn('Diff of', mock_input.call_args.args[0])


class TestHistoryCommand(ConfigCommandTestCase):
    """Tests for ``osmo config history`` query building and rendering."""

    def setUp(self):
        super().setUp()
        self.service_client.request.return_value = {
            'configs': [
                {
                    'config_type': 'POOL',
                    'name': 'my-pool',
                    'revision': 7,
                    'username': 'alice',
                    'created_at': '2025-01-02 03:04:05',
                    'description': 'raised quota',
                    'tags': ['beta', 'alpha'],
                },
                {
                    'config_type': 'SERVICE',
                    'name': None,
                    'revision': 3,
                    'username': 'bob',
                    'created_at': '2025-01-02 03:04:05',
                    'description': 'service tweak',
                    'tags': [],
                },
            ]
        }

    def test_history_created_before_with_at_timestamp_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(
                self.service_client,
                ['config', 'history', '--created-before', '2025-05-18',
                 '--at-timestamp', '2025-05-20'])

    def test_history_created_after_with_at_timestamp_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(
                self.service_client,
                ['config', 'history', '--created-after', '2025-05-18',
                 '--at-timestamp', '2025-05-20'])

    def test_history_always_omits_config_data(self):
        run_config_command(self.service_client, ['config', 'history'])

        self.assertEqual(self.request_calls[0].kwargs['params']['omit_data'], True)

    def test_history_pagination_arguments_map_to_offset_and_limit(self):
        run_config_command(
            self.service_client, ['config', 'history', '--offset', '10', '--count', '5'])

        params = self.request_calls[0].kwargs['params']
        self.assertEqual((params['offset'], params['limit']), (10, 5))

    def test_history_order_argument_is_upper_cased(self):
        run_config_command(self.service_client, ['config', 'history', '--order', 'desc'])

        self.assertEqual(self.request_calls[0].kwargs['params']['order'], 'DESC')

    def test_history_config_type_becomes_config_types_filter(self):
        run_config_command(self.service_client, ['config', 'history', 'POOL'])

        self.assertEqual(self.request_calls[0].kwargs['params']['config_types'], ['POOL'])

    def test_history_name_argument_becomes_name_filter(self):
        run_config_command(self.service_client, ['config', 'history', '--name', 'my-pool'])

        self.assertEqual(self.request_calls[0].kwargs['params']['name'], 'my-pool')

    def test_history_revision_argument_becomes_revision_filter(self):
        run_config_command(self.service_client, ['config', 'history', '--revision', '4'])

        self.assertEqual(self.request_calls[0].kwargs['params']['revision'], 4)

    def test_history_tags_argument_becomes_tags_filter(self):
        run_config_command(self.service_client, ['config', 'history', '--tags', 'alpha', 'beta'])

        self.assertEqual(self.request_calls[0].kwargs['params']['tags'], ['alpha', 'beta'])

    def test_history_created_before_date_only_gets_midnight_time(self):
        run_config_command(
            self.service_client, ['config', 'history', '--created-before', '2025-05-18'])

        self.assertEqual(self.request_calls[0].kwargs['params']['created_before'],
                         '2025-05-18T00:00:00')

    def test_history_created_before_datetime_is_passed_through(self):
        run_config_command(
            self.service_client,
            ['config', 'history', '--created-before', '2025-05-18T12:30:45'])

        self.assertEqual(self.request_calls[0].kwargs['params']['created_before'],
                         '2025-05-18T12:30:45')

    def test_history_created_after_date_only_gets_midnight_time(self):
        run_config_command(
            self.service_client, ['config', 'history', '--created-after', '2025-05-18'])

        self.assertEqual(self.request_calls[0].kwargs['params']['created_after'],
                         '2025-05-18T00:00:00')

    def test_history_created_after_datetime_is_passed_through(self):
        run_config_command(
            self.service_client,
            ['config', 'history', '--created-after', '2025-05-18T12:30:45'])

        self.assertEqual(self.request_calls[0].kwargs['params']['created_after'],
                         '2025-05-18T12:30:45')

    def test_history_at_timestamp_date_only_gets_midnight_time(self):
        run_config_command(
            self.service_client, ['config', 'history', '--at-timestamp', '2025-05-18'])

        self.assertEqual(self.request_calls[0].kwargs['params']['at_timestamp'],
                         '2025-05-18T00:00:00')

    def test_history_at_timestamp_datetime_is_passed_through(self):
        run_config_command(
            self.service_client,
            ['config', 'history', '--at-timestamp', '2025-05-18T12:30:45'])

        self.assertEqual(self.request_calls[0].kwargs['params']['at_timestamp'],
                         '2025-05-18T12:30:45')

    def test_history_json_format_prints_raw_response(self):
        run_config_command(self.service_client, ['config', 'history', '--format-type', 'json'])

        self.assertIn('"config_type": "POOL"', self.output)

    def test_history_text_format_lists_config_names(self):
        run_config_command(self.service_client, ['config', 'history'])

        self.assertIn('my-pool', self.output)

    def test_history_text_format_renders_missing_name_as_dash(self):
        run_config_command(self.service_client, ['config', 'history'])

        self.assertIn(' - ', self.output)

    def test_history_text_format_sorts_tags(self):
        run_config_command(self.service_client, ['config', 'history'])

        self.assertIn('alpha, beta', self.output)

    def test_history_text_format_renders_converted_timestamp(self):
        run_config_command(self.service_client, ['config', 'history'])

        self.assertIn('Jan 02, 2025 03:04 UTC', self.output)


class TestRollbackCommand(ConfigCommandTestCase):
    """Tests for ``osmo config rollback``."""

    def test_rollback_sends_revision_and_config_type(self):
        self.service_client.request.return_value = None

        run_config_command(
            self.service_client, ['config', 'rollback', 'SERVICE:12', '--description', 'undo'])

        payload = self.request_calls[0].kwargs['payload']
        self.assertEqual(payload, {'revision': 12, 'config_type': 'SERVICE', 'description': 'undo'})

    def test_rollback_posts_to_rollback_endpoint(self):
        self.service_client.request.return_value = None

        run_config_command(
            self.service_client, ['config', 'rollback', 'SERVICE:12', '--description', 'undo'])

        self.assertEqual(self.request_calls[0].args,
                         (client.RequestMethod.POST, 'api/configs/history/rollback'))

    def test_rollback_includes_tags_when_provided(self):
        self.service_client.request.return_value = None

        run_config_command(
            self.service_client,
            ['config', 'rollback', 'POOL:3', '--description', 'undo', '--tags', 'urgent'])

        self.assertEqual(self.request_calls[0].kwargs['payload']['tags'], ['urgent'])

    def test_rollback_reports_success(self):
        self.service_client.request.return_value = None

        run_config_command(
            self.service_client, ['config', 'rollback', 'POOL:3', '--description', 'undo'])

        self.assertIn('Successfully rolled back POOL to revision 3.', self.output)

    def test_rollback_prints_server_response_when_returned(self):
        self.service_client.request.return_value = {'revision': 4}

        run_config_command(
            self.service_client, ['config', 'rollback', 'POOL:3', '--description', 'undo'])

        self.assertIn('"revision": 4', self.output)

    def test_rollback_without_description_prompts_for_one(self):
        self.service_client.request.return_value = None

        with mock.patch.object(config, 'get_change_description', return_value='prompted'):
            run_config_command(self.service_client, ['config', 'rollback', 'POOL:3'])

        self.assertEqual(self.request_calls[0].kwargs['payload']['description'], 'prompted')

    def test_rollback_with_empty_description_aborts(self):
        with mock.patch.object(config, 'get_change_description', return_value=''):
            run_config_command(self.service_client, ['config', 'rollback', 'POOL:3'])

        self.assertIn('Aborting rollback due to empty description.', self.output)

    def test_rollback_with_empty_description_makes_no_request(self):
        with mock.patch.object(config, 'get_change_description', return_value=''):
            run_config_command(self.service_client, ['config', 'rollback', 'POOL:3'])

        self.assertEqual(self.service_client.request.call_count, 0)

    def test_rollback_of_unknown_config_type_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(
                self.service_client,
                ['config', 'rollback', 'NOT_A_TYPE:3', '--description', 'undo'])


class TestListCommand(ConfigCommandTestCase):
    """Tests for ``osmo config list``."""

    def setUp(self):
        super().setUp()
        self.service_client.request.return_value = {
            'configs': [
                {
                    'config_type': 'SERVICE',
                    'revision': 9,
                    'username': 'alice',
                    'created_at': '2025-01-02 03:04:05',
                },
                {
                    'config_type': 'BACKEND',
                    'revision': 2,
                    'username': 'bob',
                    'created_at': '2025-01-02 03:04:05',
                },
            ]
        }

    def test_list_requests_all_operable_config_types(self):
        run_config_command(self.service_client, ['config', 'list'])

        self.assertEqual(self.request_calls[0].kwargs['params']['config_types'],
                         config_history.OPERABLE_CONFIG_TYPES)

    def test_list_requests_history_without_data(self):
        run_config_command(self.service_client, ['config', 'list'])

        self.assertEqual(self.request_calls[0].kwargs['params']['omit_data'], True)

    def test_list_json_format_prints_raw_response(self):
        run_config_command(self.service_client, ['config', 'list', '--format-type', 'json'])

        self.assertIn('"config_type": "SERVICE"', self.output)

    def test_list_text_format_sorts_rows_by_config_type(self):
        run_config_command(self.service_client, ['config', 'list'])

        self.assertLess(self.output.index('BACKEND'), self.output.index('SERVICE'))

    def test_list_text_format_renders_converted_timestamp(self):
        run_config_command(self.service_client, ['config', 'list'])

        self.assertIn('Jan 02, 2025 03:04 UTC', self.output)


class TestShowCommand(ConfigCommandTestCase):
    """Tests for ``osmo config show``, including indexing into named configs."""

    def test_show_current_config_prints_json(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}

        run_config_command(self.service_client, ['config', 'show', 'SERVICE'])

        self.assertIn('"max_gpus": 8', self.output)

    def test_show_current_config_requests_lower_cased_endpoint(self):
        self.service_client.request.return_value = {}

        run_config_command(self.service_client, ['config', 'show', 'RESOURCE_VALIDATION'])

        self.assertEqual(self.request_calls[0].args,
                         (client.RequestMethod.GET, 'api/configs/resource_validation'))

    def test_show_non_operable_config_type_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(self.service_client, ['config', 'show', 'DATASET'])

    def test_show_revision_requests_history_with_data(self):
        self.service_client.request.return_value = {
            'configs': [{'data': {'limits': {'max_gpus': 4}}}]
        }

        run_config_command(self.service_client, ['config', 'show', 'SERVICE:5'])

        params = self.request_calls[0].kwargs['params']
        self.assertEqual(params, {'config_types': ['SERVICE'], 'omit_data': False, 'revision': 5})

    def test_show_revision_prints_historical_data(self):
        self.service_client.request.return_value = {
            'configs': [{'data': {'limits': {'max_gpus': 4}}}]
        }

        run_config_command(self.service_client, ['config', 'show', 'SERVICE:5'])

        self.assertIn('"max_gpus": 4', self.output)

    def test_show_revision_with_verbose_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(self.service_client, ['config', 'show', 'POOL:5', '--verbose'])

    def test_show_revision_with_no_matching_config_raises(self):
        self.service_client.request.return_value = {'configs': []}

        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(self.service_client, ['config', 'show', 'SERVICE:5'])

    def test_show_verbose_for_non_pool_config_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(self.service_client, ['config', 'show', 'SERVICE', '--verbose'])

    def test_show_verbose_for_pool_sends_verbose_parameter(self):
        self.service_client.request.return_value = {'pools': {}}

        run_config_command(self.service_client, ['config', 'show', 'POOL', '--verbose'])

        self.assertEqual(self.request_calls[0].kwargs['params'], {'verbose': True})

    def test_show_without_verbose_sends_no_parameters(self):
        self.service_client.request.return_value = {'pools': {}}

        run_config_command(self.service_client, ['config', 'show', 'POOL'])

        self.assertIsNone(self.request_calls[0].kwargs['params'])

    def test_show_named_pool_unwraps_pools_key(self):
        self.service_client.request.return_value = {
            'pools': {'my-pool': {'gpus': 8}, 'other-pool': {'gpus': 1}}
        }

        run_config_command(self.service_client, ['config', 'show', 'POOL', 'my-pool'])

        self.assertEqual(self.output, json.dumps({'gpus': 8}, indent=2))

    def test_show_named_backend_indexes_list_by_name(self):
        self.service_client.request.return_value = {
            'backends': [{'name': 'my-backend', 'cluster': 'c1'}]
        }

        run_config_command(self.service_client, ['config', 'show', 'BACKEND', 'my-backend'])

        self.assertIn('"cluster": "c1"', self.output)

    def test_show_named_role_indexes_list_by_name(self):
        self.service_client.request.return_value = [
            {'name': 'osmo-admin', 'description': 'admin role'}
        ]

        run_config_command(self.service_client, ['config', 'show', 'ROLE', 'osmo-admin'])

        self.assertIn('"description": "admin role"', self.output)

    def test_show_multiple_names_walks_nested_dictionaries(self):
        self.service_client.request.return_value = {
            'pools': {'my-pool': {'limits': {'max_gpus': 8}}}
        }

        run_config_command(
            self.service_client, ['config', 'show', 'POOL', 'my-pool', 'limits', 'max_gpus'])

        self.assertEqual(self.output, '8')

    def test_show_list_config_accepts_integer_index(self):
        self.service_client.request.return_value = ['first', 'second', 'third']

        run_config_command(self.service_client, ['config', 'show', 'SERVICE', '1'])

        self.assertEqual(self.output, '"second"')

    def test_show_list_config_with_out_of_range_index_raises(self):
        self.service_client.request.return_value = ['first', 'second']

        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(self.service_client, ['config', 'show', 'SERVICE', '5'])

    def test_show_list_config_with_non_integer_index_raises(self):
        self.service_client.request.return_value = ['first', 'second']

        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(self.service_client, ['config', 'show', 'SERVICE', 'nope'])

    def test_show_scalar_config_with_name_raises(self):
        self.service_client.request.return_value = 42

        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(self.service_client, ['config', 'show', 'SERVICE', 'nope'])

    def test_show_missing_dictionary_key_raises(self):
        self.service_client.request.return_value = {'pools': {'my-pool': {}}}

        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(self.service_client, ['config', 'show', 'POOL', 'absent-pool'])


class TestUpdateCommand(ConfigCommandTestCase):
    """Tests for ``osmo config update`` payload construction and API dispatch."""

    def setUp(self):
        super().setUp()
        self.temp_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.temp_dir)

        temp_file_patcher = mock.patch.object(
            editor, 'save_to_temp_file', return_value='/tmp/saved-update_.json')
        temp_file_patcher.start()
        self.addCleanup(temp_file_patcher.stop)

        description_patcher = mock.patch.object(
            config, 'get_change_description', return_value='prompted description')
        self.mock_get_description = description_patcher.start()
        self.addCleanup(description_patcher.stop)

    def write_config_file(self, content: str) -> str:
        """Write raw file content that ``osmo config update --file`` will read."""
        path = os.path.join(self.temp_dir, 'updated.json')
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write(content)
        return path

    def test_update_named_config_for_unsupported_type_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(self.service_client, ['config', 'update', 'SERVICE', 'some-name'])

    def test_update_whole_config_for_unsupported_type_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(self.service_client, ['config', 'update', 'BACKEND'])

    def test_update_named_config_with_unknown_name_raises(self):
        self.service_client.request.return_value = {'pools': {'my-pool': {'gpus': 1}}}
        path = self.write_config_file(json.dumps({'gpus': 2}))

        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(
                self.service_client, ['config', 'update', 'POOL', 'absent-pool', '--file', path])

    def test_update_service_config_patches_only_changed_fields(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8, 'max_cpus': 4}}
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 16, 'max_cpus': 4}}))

        run_config_command(
            self.service_client, ['config', 'update', 'SERVICE', '--file', path, '-d', 'bump'])

        self.assertEqual(self.request_calls[1].kwargs['payload']['configs_dict'],
                         {'limits': {'max_gpus': 16}})

    def test_update_service_config_uses_patch_method(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 16}}))

        run_config_command(
            self.service_client, ['config', 'update', 'SERVICE', '--file', path, '-d', 'bump'])

        self.assertEqual(self.request_calls[1].args,
                         (client.RequestMethod.PATCH, 'api/configs/service'))

    def test_update_service_config_reports_success(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 16}}))

        run_config_command(
            self.service_client, ['config', 'update', 'SERVICE', '--file', path, '-d', 'bump'])

        self.assertIn('Successfully updated SERVICE config', self.output)

    def test_update_named_pool_patches_only_changed_fields(self):
        self.service_client.request.return_value = {
            'pools': {'my-pool': {'gpus': 8, 'cpus': 4}, 'other': {'gpus': 1}}
        }
        path = self.write_config_file(json.dumps({'gpus': 16, 'cpus': 4}))

        run_config_command(
            self.service_client,
            ['config', 'update', 'POOL', 'my-pool', '--file', path, '-d', 'bump'])

        self.assertEqual(self.request_calls[1].kwargs['payload']['configs_dict'], {'gpus': 16})

    def test_update_named_pool_targets_named_endpoint(self):
        self.service_client.request.return_value = {'pools': {'my-pool': {'gpus': 8}}}
        path = self.write_config_file(json.dumps({'gpus': 16}))

        run_config_command(
            self.service_client,
            ['config', 'update', 'POOL', 'my-pool', '--file', path, '-d', 'bump'])

        self.assertEqual(self.request_calls[1].args,
                         (client.RequestMethod.PATCH, 'api/configs/pool/my-pool'))

    def test_update_named_pool_with_only_a_removed_key_reports_no_changes(self):
        """A merge patch cannot express key removal, so the removal is not sent."""
        self.service_client.request.return_value = {
            'pools': {'my-pool': {'limits': {'max_gpus': 8, 'max_cpus': 4}}}
        }
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 8}}))

        run_config_command(
            self.service_client,
            ['config', 'update', 'POOL', 'my-pool', '--file', path, '-d', 'drop'])

        self.assertIn('No changes were made to the config.', self.output)

    def test_update_whole_pool_config_puts_pools_mapping(self):
        self.service_client.request.return_value = {'pools': {'my-pool': {'gpus': 8}}}
        path = self.write_config_file(json.dumps({'pools': {'my-pool': {'gpus': 16}}}))

        run_config_command(
            self.service_client, ['config', 'update', 'POOL', '--file', path, '-d', 'bump'])

        self.assertEqual(self.request_calls[1].kwargs['payload']['configs'],
                         {'my-pool': {'gpus': 16}})

    def test_update_whole_resource_validation_config_puts_entire_document(self):
        self.service_client.request.return_value = {
            'default_cpu': {'max': 4}, 'default_gpu': {'max': 8}
        }
        path = self.write_config_file(
            json.dumps({'default_cpu': {'max': 16}, 'default_gpu': {'max': 8}}))

        run_config_command(
            self.service_client,
            ['config', 'update', 'RESOURCE_VALIDATION', '--file', path, '-d', 'bump'])

        self.assertEqual(self.request_calls[1].kwargs['payload']['configs_dict'],
                         {'default_cpu': {'max': 16}, 'default_gpu': {'max': 8}})

    def test_update_whole_resource_validation_config_uses_put_method(self):
        self.service_client.request.return_value = {'default_cpu': {'max': 4}}
        path = self.write_config_file(json.dumps({'default_cpu': {'max': 16}}))

        run_config_command(
            self.service_client,
            ['config', 'update', 'RESOURCE_VALIDATION', '--file', path, '-d', 'bump'])

        self.assertEqual(self.request_calls[1].args,
                         (client.RequestMethod.PUT, 'api/configs/resource_validation'))

    def test_update_named_backend_posts_whole_changed_field(self):
        self.service_client.request.return_value = {
            'backends': [{'name': 'my-backend', 'network': {'host': 'a', 'port': 1}}]
        }
        path = self.write_config_file(
            json.dumps({'name': 'my-backend', 'network': {'host': 'b', 'port': 1}}))

        run_config_command(
            self.service_client,
            ['config', 'update', 'BACKEND', 'my-backend', '--file', path, '-d', 'move'])

        self.assertEqual(self.request_calls[1].kwargs['payload']['configs'],
                         {'network': {'host': 'b', 'port': 1}})

    def test_update_named_backend_uses_post_method(self):
        self.service_client.request.return_value = {
            'backends': [{'name': 'my-backend', 'network': {'host': 'a'}}]
        }
        path = self.write_config_file(
            json.dumps({'name': 'my-backend', 'network': {'host': 'b'}}))

        run_config_command(
            self.service_client,
            ['config', 'update', 'BACKEND', 'my-backend', '--file', path, '-d', 'move'])

        self.assertEqual(self.request_calls[1].args,
                         (client.RequestMethod.POST, 'api/configs/backend/my-backend'))

    def test_update_named_backend_with_no_changes_reports_no_changes(self):
        self.service_client.request.return_value = {
            'backends': [{'name': 'my-backend', 'network': {'host': 'a'}}]
        }
        path = self.write_config_file(
            json.dumps({'name': 'my-backend', 'network': {'host': 'a'}}))

        run_config_command(
            self.service_client,
            ['config', 'update', 'BACKEND', 'my-backend', '--file', path, '-d', 'noop'])

        self.assertIn('No changes were made to the config.', self.output)

    def test_update_with_unchanged_file_reports_no_changes(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 8}}))

        run_config_command(
            self.service_client, ['config', 'update', 'SERVICE', '--file', path, '-d', 'noop'])

        self.assertIn('No changes were made to the config.', self.output)

    def test_update_with_unchanged_file_makes_no_update_request(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 8}}))

        run_config_command(
            self.service_client, ['config', 'update', 'SERVICE', '--file', path, '-d', 'noop'])

        self.assertEqual(self.service_client.request.call_count, 1)

    def test_update_with_invalid_json_file_raises(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}
        path = self.write_config_file('this is not json')

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(
                self.service_client, ['config', 'update', 'SERVICE', '--file', path, '-d', 'bad'])

        self.assertIn('Invalid JSON', str(raised.exception))

    def test_update_with_invalid_json_file_reports_saved_copy(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}
        path = self.write_config_file('this is not json')

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(
                self.service_client, ['config', 'update', 'SERVICE', '--file', path, '-d', 'bad'])

        self.assertIn('/tmp/saved-update_.json', str(raised.exception))

    def test_update_from_editor_without_edits_reports_no_changes(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}

        with mock.patch.object(editor, 'get_editor_input', side_effect=lambda content: content):
            run_config_command(self.service_client, ['config', 'update', 'SERVICE', '-d', 'noop'])

        self.assertIn('No changes were made to the config.', self.output)

    def test_update_from_editor_shows_current_config_as_json(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}

        with mock.patch.object(
                editor, 'get_editor_input', side_effect=lambda content: content) as mock_input:
            run_config_command(self.service_client, ['config', 'update', 'SERVICE', '-d', 'noop'])

        self.assertEqual(mock_input.call_args.args[0],
                         json.dumps({'limits': {'max_gpus': 8}}, indent=2))

    def test_update_from_editor_with_edits_sends_diff(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}

        with mock.patch.object(editor, 'get_editor_input',
                               return_value=json.dumps({'limits': {'max_gpus': 32}})):
            run_config_command(self.service_client, ['config', 'update', 'SERVICE', '-d', 'bump'])

        self.assertEqual(self.request_calls[1].kwargs['payload']['configs_dict'],
                         {'limits': {'max_gpus': 32}})

    def test_update_without_description_prompts_with_both_configs(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 16}}))

        run_config_command(self.service_client, ['config', 'update', 'SERVICE', '--file', path])

        self.assertEqual(
            self.mock_get_description.call_args.args,
            ({'limits': {'max_gpus': 8}}, {'limits': {'max_gpus': 16}},
             config_history.ConfigHistoryType.SERVICE))

    def test_update_with_empty_description_aborts(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 16}}))
        self.mock_get_description.return_value = ''

        run_config_command(self.service_client, ['config', 'update', 'SERVICE', '--file', path])

        self.assertIn('Aborting update due to empty description.', self.output)

    def test_update_with_empty_description_makes_no_update_request(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 16}}))
        self.mock_get_description.return_value = ''

        run_config_command(self.service_client, ['config', 'update', 'SERVICE', '--file', path])

        self.assertEqual(self.service_client.request.call_count, 1)

    def test_update_includes_tags_when_provided(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 16}}))

        run_config_command(
            self.service_client,
            ['config', 'update', 'SERVICE', '--file', path, '-d', 'bump', '-t', 'urgent', 'ops'])

        self.assertEqual(self.request_calls[1].kwargs['payload']['tags'], ['urgent', 'ops'])

    def test_update_request_failure_raises_user_error(self):
        self.service_client.request.side_effect = [
            {'limits': {'max_gpus': 8}}, RuntimeError('server exploded')]
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 16}}))

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(
                self.service_client, ['config', 'update', 'SERVICE', '--file', path, '-d', 'bump'])

        self.assertIn('Error updating config', str(raised.exception))

    def test_update_request_failure_reports_saved_copy(self):
        self.service_client.request.side_effect = [
            {'limits': {'max_gpus': 8}}, RuntimeError('server exploded')]
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 16}}))

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(
                self.service_client, ['config', 'update', 'SERVICE', '--file', path, '-d', 'bump'])

        self.assertIn('/tmp/saved-update_.json', str(raised.exception))

    def test_update_with_unsupported_request_method_raises(self):
        self.service_client.request.return_value = {'limits': {'max_gpus': 8}}
        path = self.write_config_file(json.dumps({'limits': {'max_gpus': 16}}))
        unsupported = {
            config_history.ConfigHistoryType.SERVICE: {
                'default': {'method': client.RequestMethod.DELETE, 'payload_key': 'configs'},
                'named': None,
            }
        }

        with mock.patch.dict(config.UPDATE_CONFIG_API_MAPPING, unsupported):
            with self.assertRaises(osmo_errors.OSMOUserError) as raised:
                run_config_command(
                    self.service_client,
                    ['config', 'update', 'SERVICE', '--file', path, '-d', 'bump'])

        self.assertIn('Unsupported method', str(raised.exception))


class TestDeleteCommand(ConfigCommandTestCase):
    """Tests for ``osmo config delete`` for both revisions and named configs."""

    def setUp(self):
        super().setUp()
        description_patcher = mock.patch.object(
            config, 'get_change_description', return_value='prompted description')
        self.mock_get_description = description_patcher.start()
        self.addCleanup(description_patcher.stop)

    def test_delete_revision_targets_revision_endpoint(self):
        run_config_command(self.service_client, ['config', 'delete', 'SERVICE:7'])

        self.assertEqual(self.request_calls[0].args,
                         (client.RequestMethod.DELETE, 'api/configs/history/service/revision/7'))

    def test_delete_revision_reports_success(self):
        run_config_command(self.service_client, ['config', 'delete', 'SERVICE:7'])

        self.assertIn('Successfully deleted revision 7 of SERVICE config', self.output)

    def test_delete_revision_failure_raises_user_error(self):
        self.service_client.request.side_effect = RuntimeError('server exploded')

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(self.service_client, ['config', 'delete', 'SERVICE:7'])

        self.assertIn('Error deleting config revision', str(raised.exception))

    def test_delete_non_operable_config_type_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            run_config_command(self.service_client, ['config', 'delete', 'DATASET', 'my-data'])

    def test_delete_named_config_without_name_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(self.service_client, ['config', 'delete', 'POOL'])

        self.assertIn('Name is required when deleting a config', str(raised.exception))

    def test_delete_named_config_targets_named_endpoint(self):
        run_config_command(
            self.service_client, ['config', 'delete', 'POOL', 'my-pool', '-d', 'retired'])

        self.assertEqual(self.request_calls[0].args,
                         (client.RequestMethod.DELETE, 'api/configs/pool/my-pool'))

    def test_delete_named_config_sends_description(self):
        run_config_command(
            self.service_client, ['config', 'delete', 'POOL', 'my-pool', '-d', 'retired'])

        self.assertEqual(self.request_calls[0].kwargs['payload'], {'description': 'retired'})

    def test_delete_named_config_includes_tags_when_provided(self):
        run_config_command(
            self.service_client,
            ['config', 'delete', 'POOL', 'my-pool', '-d', 'retired', '-t', 'cleanup'])

        self.assertEqual(self.request_calls[0].kwargs['payload']['tags'], ['cleanup'])

    def test_delete_named_config_reports_success(self):
        run_config_command(
            self.service_client, ['config', 'delete', 'POOL', 'my-pool', '-d', 'retired'])

        self.assertIn('Successfully deleted POOL config "my-pool"', self.output)

    def test_delete_named_config_without_description_prompts_for_one(self):
        run_config_command(self.service_client, ['config', 'delete', 'POOL', 'my-pool'])

        self.assertEqual(self.request_calls[0].kwargs['payload']['description'],
                         'prompted description')

    def test_delete_named_config_with_empty_description_aborts(self):
        self.mock_get_description.return_value = ''

        run_config_command(self.service_client, ['config', 'delete', 'POOL', 'my-pool'])

        self.assertIn('Aborting delete due to empty description.', self.output)

    def test_delete_named_config_with_empty_description_makes_no_request(self):
        self.mock_get_description.return_value = ''

        run_config_command(self.service_client, ['config', 'delete', 'POOL', 'my-pool'])

        self.assertEqual(self.service_client.request.call_count, 0)

    def test_delete_named_config_failure_raises_user_error(self):
        self.service_client.request.side_effect = RuntimeError('server exploded')

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(
                self.service_client, ['config', 'delete', 'POOL', 'my-pool', '-d', 'retired'])

        self.assertIn('Error deleting config', str(raised.exception))


class TestCreateRole(unittest.TestCase):
    """Tests for create_role, which synthesizes generated RBAC roles."""

    def test_create_role_for_pool_derives_pool_name_from_role_name(self):
        generated = config.create_role(config.SetRoleType.POOL, 'osmo-isaac-hil')

        self.assertEqual(generated.description, 'Generated Role for pool isaac-hil')

    def test_create_role_for_pool_keeps_requested_role_name(self):
        generated = config.create_role(config.SetRoleType.POOL, 'osmo-isaac-hil')

        self.assertEqual(generated.name, 'osmo-isaac-hil')

    def test_create_role_for_pool_grants_all_workflow_actions(self):
        generated = config.create_role(config.SetRoleType.POOL, 'osmo-isaac-hil')

        self.assertEqual(generated.policies[0].actions, ['workflow:*'])

    def test_create_role_for_pool_scopes_resources_to_pool_prefix(self):
        generated = config.create_role(config.SetRoleType.POOL, 'osmo-isaac-hil')

        self.assertEqual(generated.policies[0].resources, ['pool/isaac-hil*'])

    def test_create_role_for_pool_creates_exactly_one_policy(self):
        generated = config.create_role(config.SetRoleType.POOL, 'osmo-isaac-hil')

        self.assertEqual(len(generated.policies), 1)

    def test_create_role_for_pool_with_field_name_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            config.create_role(config.SetRoleType.POOL, 'osmo-isaac-hil', 'isaac-hil')

        self.assertIn('Pool name must be specified in the role name', str(raised.exception))

    def test_create_role_for_pool_without_osmo_prefix_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            config.create_role(config.SetRoleType.POOL, 'isaac-hil')

        self.assertIn('Pool role name must start with "osmo-"', str(raised.exception))

    def test_create_role_for_backend_describes_target_backend(self):
        generated = config.create_role(
            config.SetRoleType.BACKEND, 'my-backend-role', 'prod-cluster')

        self.assertEqual(generated.description, 'Generated Role for backend prod-cluster')

    def test_create_role_for_backend_grants_operator_actions(self):
        generated = config.create_role(
            config.SetRoleType.BACKEND, 'my-backend-role', 'prod-cluster')

        self.assertEqual(generated.policies[0].actions,
                         ['internal:Operator', 'pool:List', 'config:Read'])

    def test_create_role_for_backend_scopes_resources_to_backend(self):
        generated = config.create_role(
            config.SetRoleType.BACKEND, 'my-backend-role', 'prod-cluster')

        self.assertEqual(generated.policies[0].resources, ['backend/prod-cluster'])

    def test_create_role_for_backend_grants_no_workflow_actions(self):
        generated = config.create_role(
            config.SetRoleType.BACKEND, 'my-backend-role', 'prod-cluster')

        self.assertNotIn('workflow:*', generated.policies[0].actions)

    def test_create_role_for_backend_without_field_name_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            config.create_role(config.SetRoleType.BACKEND, 'my-backend-role')

        self.assertIn('Backend name is required for backend role', str(raised.exception))

    def test_create_role_with_unknown_role_type_raises(self):
        unknown_role_type = cast(config.SetRoleType, 'POOL')

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            config.create_role(unknown_role_type, 'osmo-isaac-hil')

        self.assertIn('Unsupported role type', str(raised.exception))


class TestSetCommand(ConfigCommandTestCase):
    """Tests for ``osmo config set``, which stores generated role configs."""

    def setUp(self):
        super().setUp()
        description_patcher = mock.patch.object(
            config, 'get_change_description', return_value='prompted description')
        self.mock_get_description = description_patcher.start()
        self.addCleanup(description_patcher.stop)

    def test_set_pool_role_targets_named_role_endpoint(self):
        run_config_command(
            self.service_client,
            ['config', 'set', 'ROLE', 'osmo-my-pool', 'pool', '--description', 'new'])

        self.assertEqual(self.request_calls[0].args,
                         (client.RequestMethod.PUT, 'api/configs/role/osmo-my-pool'))

    def test_set_pool_role_sends_generated_role_policies(self):
        run_config_command(
            self.service_client,
            ['config', 'set', 'ROLE', 'osmo-my-pool', 'pool', '--description', 'new'])

        self.assertEqual(self.request_calls[0].kwargs['payload']['configs']['policies'],
                         [{'effect': 'Allow',
                           'actions': ['workflow:*'],
                           'resources': ['pool/my-pool*']}])

    def test_set_backend_role_sends_generated_backend_policies(self):
        run_config_command(
            self.service_client,
            ['config', 'set', 'ROLE', 'my-backend-role', 'backend', '--field', 'prod',
             '--description', 'new'])

        self.assertEqual(self.request_calls[0].kwargs['payload']['configs']['policies'],
                         [{'effect': 'Allow',
                           'actions': ['config:Read', 'internal:Operator', 'pool:List'],
                           'resources': ['backend/prod']}])

    def test_set_role_type_argument_is_case_insensitive(self):
        run_config_command(
            self.service_client,
            ['config', 'set', 'ROLE', 'osmo-my-pool', 'POOL', '--description', 'new'])

        self.assertEqual(self.request_calls[0].kwargs['payload']['configs']['name'],
                         'osmo-my-pool')

    def test_set_role_reports_success(self):
        run_config_command(
            self.service_client,
            ['config', 'set', 'ROLE', 'osmo-my-pool', 'pool', '--description', 'new'])

        self.assertIn('Successfully set ROLE config "osmo-my-pool"', self.output)

    def test_set_role_includes_tags_when_provided(self):
        run_config_command(
            self.service_client,
            ['config', 'set', 'ROLE', 'osmo-my-pool', 'pool', '--description', 'new',
             '--tags', 'rbac'])

        self.assertEqual(self.request_calls[0].kwargs['payload']['tags'], ['rbac'])

    def test_set_role_without_description_prompts_for_one(self):
        run_config_command(self.service_client, ['config', 'set', 'ROLE', 'osmo-my-pool', 'pool'])

        self.assertEqual(self.request_calls[0].kwargs['payload']['description'],
                         'prompted description')

    def test_set_role_with_empty_description_aborts(self):
        self.mock_get_description.return_value = ''

        run_config_command(self.service_client, ['config', 'set', 'ROLE', 'osmo-my-pool', 'pool'])

        self.assertIn('Aborting set due to empty description.', self.output)

    def test_set_role_with_empty_description_makes_no_request(self):
        self.mock_get_description.return_value = ''

        run_config_command(self.service_client, ['config', 'set', 'ROLE', 'osmo-my-pool', 'pool'])

        self.assertEqual(self.service_client.request.call_count, 0)

    def test_set_role_request_failure_raises_user_error(self):
        self.service_client.request.side_effect = RuntimeError('server exploded')

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(
                self.service_client,
                ['config', 'set', 'ROLE', 'osmo-my-pool', 'pool', '--description', 'new'])

        self.assertIn('Error setting config', str(raised.exception))

    def test_set_unsupported_config_type_raises(self):
        with mock.patch.dict(config.SET_CONFIG_SUPPORTED_TYPES, {}, clear=True):
            with self.assertRaises(osmo_errors.OSMOUserError) as raised:
                run_config_command(
                    self.service_client,
                    ['config', 'set', 'ROLE', 'osmo-my-pool', 'pool', '--description', 'new'])

        self.assertIn('Setting of ROLE config is not supported', str(raised.exception))

    def test_set_supported_but_unhandled_config_type_raises(self):
        pool_mapping = {
            config_history.ConfigHistoryType.POOL: {
                'method': client.RequestMethod.PUT, 'payload_key': 'configs'
            }
        }

        with mock.patch.dict(config.SET_CONFIG_SUPPORTED_TYPES, pool_mapping), \
                mock.patch.object(config, 'set_choices', ['POOL', 'ROLE']):
            with self.assertRaises(osmo_errors.OSMOUserError) as raised:
                run_config_command(
                    self.service_client,
                    ['config', 'set', 'POOL', 'my-pool', 'pool', '--description', 'new'])

        self.assertIn('Unsupported config type: POOL', str(raised.exception))


class TestTagCommand(ConfigCommandTestCase):
    """Tests for ``osmo config tag``."""

    def test_tag_revision_targets_revision_tags_endpoint(self):
        run_config_command(self.service_client, ['config', 'tag', 'BACKEND:5', '--set', 'stable'])

        self.assertEqual(
            self.request_calls[0].args,
            (client.RequestMethod.POST, 'api/configs/history/backend/revision/5/tags'))

    def test_tag_revision_sends_tags_to_add(self):
        run_config_command(self.service_client, ['config', 'tag', 'BACKEND:5', '--set', 'stable'])

        self.assertEqual(self.request_calls[0].kwargs['payload'], {'set_tags': ['stable']})

    def test_tag_revision_sends_tags_to_delete(self):
        run_config_command(
            self.service_client, ['config', 'tag', 'BACKEND:5', '--delete', 'old', 'stale'])

        self.assertEqual(self.request_calls[0].kwargs['payload'],
                         {'delete_tags': ['old', 'stale']})

    def test_tag_revision_reports_success(self):
        run_config_command(self.service_client, ['config', 'tag', 'BACKEND:5', '--set', 'stable'])

        self.assertIn('Successfully updated tags for BACKEND:5', self.output)

    def test_tag_current_revision_looks_up_latest_revision(self):
        self.service_client.request.side_effect = [{'configs': [{'revision': 11}]}, None]

        run_config_command(self.service_client, ['config', 'tag', 'BACKEND', '--set', 'current'])

        self.assertEqual(self.request_calls[0].kwargs['params'],
                         {'config_types': ['BACKEND'], 'order': 'DESC', 'limit': 1})

    def test_tag_current_revision_targets_latest_revision_endpoint(self):
        self.service_client.request.side_effect = [{'configs': [{'revision': 11}]}, None]

        run_config_command(self.service_client, ['config', 'tag', 'BACKEND', '--set', 'current'])

        self.assertEqual(
            self.request_calls[1].args,
            (client.RequestMethod.POST, 'api/configs/history/backend/revision/11/tags'))

    def test_tag_current_revision_without_history_raises(self):
        self.service_client.request.return_value = {'configs': []}

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(self.service_client, ['config', 'tag', 'BACKEND', '--set', 'x'])

        self.assertIn('No config found matching the specified criteria', str(raised.exception))

    def test_tag_non_operable_config_type_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(self.service_client, ['config', 'tag', 'DATASET', '--set', 'x'])

        self.assertIn('Invalid config type "DATASET"', str(raised.exception))

    def test_tag_request_failure_raises_user_error(self):
        self.service_client.request.side_effect = RuntimeError('server exploded')

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(
                self.service_client, ['config', 'tag', 'BACKEND:5', '--set', 'stable'])

        self.assertIn('Error updating tags', str(raised.exception))


class TestDiffCommand(ConfigCommandTestCase):
    """Tests for ``osmo config diff`` revision resolution and rendering."""

    def setUp(self):
        super().setUp()
        temp_file_patcher = mock.patch.object(
            editor, 'save_to_temp_file', side_effect=['/tmp/first.json', '/tmp/second.json'])
        temp_file_patcher.start()
        self.addCleanup(temp_file_patcher.stop)

        subprocess_patcher = mock.patch.object(subprocess, 'run')
        self.mock_subprocess_run = subprocess_patcher.start()
        self.addCleanup(subprocess_patcher.stop)

        self.diff_response = {'first_data': {'gpus': 1}, 'second_data': {'gpus': 2}}

    def test_diff_single_revision_compares_against_current_revision(self):
        self.service_client.request.side_effect = [
            {'configs': [{'revision': 20}]}, self.diff_response]

        run_config_command(self.service_client, ['config', 'diff', 'WORKFLOW:15'])

        self.assertEqual(self.request_calls[1].kwargs['params'],
                         {'config_type': 'WORKFLOW', 'first_revision': '15',
                          'second_revision': '20'})

    def test_diff_config_type_only_compares_current_revision_with_itself(self):
        self.service_client.request.side_effect = [
            {'configs': [{'revision': 9}]}, {'configs': [{'revision': 9}]}, self.diff_response]

        run_config_command(self.service_client, ['config', 'diff', 'SERVICE'])

        self.assertEqual(self.request_calls[2].kwargs['params'],
                         {'config_type': 'SERVICE', 'first_revision': '9', 'second_revision': '9'})

    def test_diff_two_revisions_needs_no_revision_lookup(self):
        self.service_client.request.side_effect = [self.diff_response]

        run_config_command(self.service_client, ['config', 'diff', 'SERVICE:14', 'SERVICE:15'])

        self.assertEqual(self.request_calls[0].kwargs['params'],
                         {'config_type': 'SERVICE', 'first_revision': '14',
                          'second_revision': '15'})

    def test_diff_second_config_type_only_resolves_current_revision(self):
        self.service_client.request.side_effect = [
            {'configs': [{'revision': 30}]}, self.diff_response]

        run_config_command(self.service_client, ['config', 'diff', 'SERVICE:14', 'SERVICE'])

        self.assertEqual(self.request_calls[1].kwargs['params']['second_revision'], '30')

    def test_diff_mismatched_second_revision_type_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(self.service_client, ['config', 'diff', 'SERVICE:14', 'WORKFLOW:15'])

        self.assertIn('Config type mismatch', str(raised.exception))

    def test_diff_mismatched_second_config_type_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(self.service_client, ['config', 'diff', 'SERVICE:14', 'WORKFLOW'])

        self.assertIn('Config type mismatch', str(raised.exception))

    def test_diff_without_history_entries_raises(self):
        self.service_client.request.return_value = {'configs': []}

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(self.service_client, ['config', 'diff', 'SERVICE'])

        self.assertIn('No config history entries found for type SERVICE', str(raised.exception))

    def test_diff_writes_both_revisions_to_temp_files(self):
        self.service_client.request.side_effect = [self.diff_response]

        run_config_command(self.service_client, ['config', 'diff', 'SERVICE:14', 'SERVICE:15'])

        self.assertEqual(self.mock_subprocess_run.call_args.args[0],
                         ['diff', '-u', '--color', '/tmp/first.json', '/tmp/second.json'])

    def test_diff_identical_revisions_reports_no_differences(self):
        self.service_client.request.side_effect = [self.diff_response]

        run_config_command(self.service_client, ['config', 'diff', 'SERVICE:14', 'SERVICE:15'])

        self.assertIn('No differences were found between the two revisions', self.output)

    def test_diff_with_differences_prints_nothing_extra(self):
        self.service_client.request.side_effect = [self.diff_response]
        self.mock_subprocess_run.side_effect = subprocess.CalledProcessError(1, ['diff'])

        run_config_command(self.service_client, ['config', 'diff', 'SERVICE:14', 'SERVICE:15'])

        self.assertEqual(self.output, '')

    def test_diff_renderer_failure_raises_user_error(self):
        self.service_client.request.side_effect = [self.diff_response]
        self.mock_subprocess_run.side_effect = subprocess.CalledProcessError(2, ['diff'])

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            run_config_command(self.service_client, ['config', 'diff', 'SERVICE:14', 'SERVICE:15'])

        self.assertIn('Error rendering diff', str(raised.exception))


if __name__ == '__main__':
    unittest.main()
