"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import unittest
from unittest import mock

from src.cli import app
from src.lib.utils import client, osmo_errors


class TestSetupParser(unittest.TestCase):
    """Test cases for the setup_parser function."""

    def _build_parser(self) -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)
        return parser

    def test_create_command(self):
        parser = self._build_parser()
        args = parser.parse_args(['app', 'create', 'my-app', '-d', 'Description'])
        self.assertEqual(args.command, 'create')
        self.assertEqual(args.name, 'my-app')
        self.assertEqual(args.description, 'Description')
        self.assertIsNone(args.file)

    def test_create_command_with_file(self):
        parser = self._build_parser()
        args = parser.parse_args(
            ['app', 'create', 'my-app', '-d', 'desc', '-f', '/tmp/spec.yaml'])
        self.assertEqual(args.file, '/tmp/spec.yaml')

    def test_update_command(self):
        parser = self._build_parser()
        args = parser.parse_args(['app', 'update', 'my-app'])
        self.assertEqual(args.command, 'update')
        self.assertEqual(args.name, 'my-app')

    def test_info_command_defaults(self):
        parser = self._build_parser()
        args = parser.parse_args(['app', 'info', 'my-app'])
        self.assertEqual(args.command, 'info')
        self.assertEqual(args.count, 20)
        self.assertEqual(args.order, 'asc')
        self.assertEqual(args.format_type, 'text')

    def test_info_command_options(self):
        parser = self._build_parser()
        args = parser.parse_args(
            ['app', 'info', 'my-app', '-c', '5', '-o', 'desc', '-t', 'json'])
        self.assertEqual(args.count, 5)
        self.assertEqual(args.order, 'desc')
        self.assertEqual(args.format_type, 'json')

    def test_show_command(self):
        parser = self._build_parser()
        args = parser.parse_args(['app', 'show', 'my-app'])
        self.assertEqual(args.command, 'show')
        self.assertEqual(args.name, 'my-app')

    def test_spec_command(self):
        parser = self._build_parser()
        args = parser.parse_args(['app', 'spec', 'my-app'])
        self.assertEqual(args.command, 'spec')
        self.assertEqual(args.name, 'my-app')

    def test_list_command_defaults(self):
        parser = self._build_parser()
        args = parser.parse_args(['app', 'list'])
        self.assertEqual(args.command, 'list')
        self.assertEqual(args.count, 20)
        self.assertEqual(args.order, 'asc')
        self.assertEqual(args.format_type, 'text')
        self.assertFalse(args.all_users)
        self.assertIsNone(args.name)
        self.assertIsNone(args.user)

    def test_list_command_options(self):
        parser = self._build_parser()
        args = parser.parse_args(
            ['app', 'list', '-n', 'prefix', '-u', 'user1', 'user2', '-a',
             '-c', '50', '-o', 'desc', '-t', 'json'])
        self.assertEqual(args.name, 'prefix')
        self.assertEqual(args.user, ['user1', 'user2'])
        self.assertTrue(args.all_users)
        self.assertEqual(args.count, 50)
        self.assertEqual(args.order, 'desc')
        self.assertEqual(args.format_type, 'json')

    def test_delete_command(self):
        parser = self._build_parser()
        args = parser.parse_args(['app', 'delete', 'my-app:3', '-f'])
        self.assertEqual(args.command, 'delete')
        self.assertEqual(args.name, 'my-app:3')
        self.assertTrue(args.force)
        self.assertFalse(args.all)

    def test_delete_command_all(self):
        parser = self._build_parser()
        args = parser.parse_args(['app', 'delete', 'my-app', '--all'])
        self.assertTrue(args.all)

    def test_rename_command(self):
        parser = self._build_parser()
        args = parser.parse_args(['app', 'rename', 'original', 'new', '-f'])
        self.assertEqual(args.command, 'rename')
        self.assertEqual(args.original_name, 'original')
        self.assertEqual(args.new_name, 'new')
        self.assertTrue(args.force)

    def test_submit_command_defaults(self):
        parser = self._build_parser()
        args = parser.parse_args(['app', 'submit', 'my-app'])
        self.assertEqual(args.command, 'submit')
        self.assertEqual(args.name, 'my-app')
        self.assertEqual(args.set, [])
        self.assertEqual(args.set_string, [])
        self.assertEqual(args.set_env, [])
        self.assertFalse(args.dry)
        self.assertIsNone(args.pool)
        self.assertIsNone(args.priority)

    def test_submit_command_priority(self):
        parser = self._build_parser()
        args = parser.parse_args(['app', 'submit', 'my-app', '--priority', 'high'])
        self.assertEqual(args.priority, 'HIGH')

    def test_submit_command_dry_run(self):
        parser = self._build_parser()
        args = parser.parse_args(['app', 'submit', 'my-app', '--dry-run'])
        self.assertTrue(args.dry)

    def test_submit_command_set_options(self):
        parser = self._build_parser()
        args = parser.parse_args(
            ['app', 'submit', 'my-app', '--set', 'a=1', 'b=2',
             '--set-string', 's=foo', '--set-env', 'K=V'])
        self.assertEqual(args.set, ['a=1', 'b=2'])
        self.assertEqual(args.set_string, ['s=foo'])
        self.assertEqual(args.set_env, ['K=V'])


class TestCreateApp(unittest.TestCase):
    """Test cases for _create_app."""

    def test_create_app_version_in_name_raises(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(name='my-app:1', description='d', file=None)
        with self.assertRaises(osmo_errors.OSMOUserError):
            app._create_app(service_client, args)

    def test_create_app_with_file(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(name='my-app', description='desc', file='/tmp/spec.yaml')
        mock_open = mock.mock_open(read_data='workflow-content')
        with mock.patch('builtins.open', mock_open), mock.patch('builtins.print'):
            app._create_app(service_client, args)
        service_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/app/user/my-app',
            params={'description': 'desc'},
            payload='workflow-content')

    def test_create_app_from_editor(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(name='my-app', description='desc', file=None)
        with mock.patch('src.cli.app.editor.get_editor_input',
                        return_value='edited-content'), \
             mock.patch('builtins.print'):
            app._create_app(service_client, args)
        service_client.request.assert_called_once()
        self.assertEqual(service_client.request.call_args[1]['payload'], 'edited-content')

    def test_create_app_empty_content_raises(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(name='my-app', description='d', file=None)
        with mock.patch('src.cli.app.editor.get_editor_input', return_value=''):
            with self.assertRaises(osmo_errors.OSMOUserError) as cm:
                app._create_app(service_client, args)
        self.assertIn('empty', str(cm.exception).lower())

    def test_create_app_request_failure_saves_tempfile(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = RuntimeError('boom')
        args = argparse.Namespace(name='my-app', description='d', file=None)
        with mock.patch('src.cli.app.editor.get_editor_input', return_value='content'), \
             mock.patch('src.cli.app.editor.save_to_temp_file',
                        return_value='/tmp/saved.yaml') as save_mock:
            with self.assertRaises(osmo_errors.OSMOUserError) as cm:
                app._create_app(service_client, args)
        save_mock.assert_called_once_with('content', suffix='.yaml')
        self.assertIn('/tmp/saved.yaml', str(cm.exception))


class TestUpdateApp(unittest.TestCase):
    """Test cases for _update_app."""

    def test_update_app_with_version_fetch_fails_reraises(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = osmo_errors.OSMOUserError('not found')
        args = argparse.Namespace(name='my-app:2', file=None)
        with self.assertRaises(osmo_errors.OSMOUserError):
            app._update_app(service_client, args)

    def test_update_app_no_version_deleted_creates_new(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            osmo_errors.OSMOUserError('deleted'),
            {'name': 'my-app', 'version': 5},
        ]
        args = argparse.Namespace(name='my-app', file=None)
        with mock.patch('src.cli.app.editor.get_editor_input',
                        return_value='new-content'), \
             mock.patch('builtins.print'):
            app._update_app(service_client, args)
        self.assertEqual(service_client.request.call_count, 2)
        patch_call = service_client.request.call_args_list[1]
        self.assertEqual(patch_call[0][0], client.RequestMethod.PATCH)

    def test_update_app_with_file(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            'old-content',
            {'name': 'my-app', 'version': 3},
        ]
        args = argparse.Namespace(name='my-app', file='/tmp/updated.yaml')
        mock_open = mock.mock_open(read_data='new-content')
        with mock.patch('builtins.open', mock_open), mock.patch('builtins.print'):
            app._update_app(service_client, args)
        self.assertEqual(service_client.request.call_count, 2)

    def test_update_app_no_changes_returns_early(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = 'same-content'
        args = argparse.Namespace(name='my-app', file=None)
        with mock.patch('src.cli.app.editor.get_editor_input',
                        return_value='same-content'), \
             mock.patch('builtins.print') as mock_print:
            app._update_app(service_client, args)
        # Only the GET request should have been made (no PATCH)
        self.assertEqual(service_client.request.call_count, 1)
        output = ' '.join(str(a) for call in mock_print.call_args_list for a in call.args)
        self.assertIn('No version', output)

    def test_update_app_empty_content_returns_early(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = 'existing'
        args = argparse.Namespace(name='my-app', file=None)
        with mock.patch('src.cli.app.editor.get_editor_input', return_value=''), \
             mock.patch('builtins.print'):
            app._update_app(service_client, args)
        self.assertEqual(service_client.request.call_count, 1)

    def test_update_app_with_version_param(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            'old-content',
            {'name': 'my-app', 'version': 7},
        ]
        args = argparse.Namespace(name='my-app:4', file=None)
        with mock.patch('src.cli.app.editor.get_editor_input',
                        return_value='new-content'), \
             mock.patch('builtins.print'):
            app._update_app(service_client, args)
        get_call = service_client.request.call_args_list[0]
        self.assertEqual(get_call[1]['params'], {'version': 4})

    def test_update_app_patch_failure_saves_tempfile(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = ['old-content', RuntimeError('boom')]
        args = argparse.Namespace(name='my-app', file=None)
        with mock.patch('src.cli.app.editor.get_editor_input',
                        return_value='new-content'), \
             mock.patch('src.cli.app.editor.save_to_temp_file',
                        return_value='/tmp/saved.yaml') as save_mock:
            with self.assertRaises(osmo_errors.OSMOUserError) as cm:
                app._update_app(service_client, args)
        save_mock.assert_called_once()
        self.assertIn('/tmp/saved.yaml', str(cm.exception))


class TestInfoApp(unittest.TestCase):
    """Test cases for _info_app."""

    def test_info_app_json_format(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        result = {
            'uuid': 'uuid-1',
            'owner': 'user',
            'created_date': '2026-01-01T00:00:00',
            'description': 'desc',
            'versions': [],
        }
        service_client.request.return_value = result
        args = argparse.Namespace(
            name='my-app', order='asc', count=10, format_type='json')
        with mock.patch('builtins.print') as mock_print:
            app._info_app(service_client, args)
        mock_print.assert_called_once()
        parsed = json.loads(mock_print.call_args[0][0])
        self.assertEqual(parsed['uuid'], 'uuid-1')

    def test_info_app_text_format(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'uuid': 'uuid-1',
            'owner': 'user',
            'created_date': '2026-01-01T00:00:00',
            'description': 'desc',
            'versions': [
                {
                    'version': 1,
                    'created_by': 'user',
                    'created_date': '2026-01-02T00:00:00',
                    'status': 'active'
                }
            ],
        }
        args = argparse.Namespace(
            name='my-app', order='asc', count=10, format_type='text')
        with mock.patch('builtins.print') as mock_print:
            app._info_app(service_client, args)
        output = ' '.join(str(a) for call in mock_print.call_args_list for a in call.args)
        self.assertIn('my-app', output)
        self.assertIn('uuid-1', output)

    def test_info_app_with_version_param(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'uuid': 'u',
            'owner': 'o',
            'created_date': '2026-01-01T00:00:00',
            'description': 'd',
            'versions': [],
        }
        args = argparse.Namespace(
            name='my-app:2', order='desc', count=5, format_type='json')
        with mock.patch('builtins.print'):
            app._info_app(service_client, args)
        call_args = service_client.request.call_args
        self.assertEqual(call_args[1]['params']['version'], 2)
        self.assertEqual(call_args[1]['params']['order'], 'DESC')
        self.assertEqual(call_args[1]['params']['limit'], 5)


class TestShowApp(unittest.TestCase):
    """Test cases for _show_app."""

    def test_show_app_no_default_values(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            {'description': 'A description'},
            'spec-content',
        ]
        args = argparse.Namespace(name='my-app')
        with mock.patch('src.cli.app.workflow_utils.fetch_default_values',
                        return_value=None), \
             mock.patch('builtins.print') as mock_print:
            app._show_app(service_client, args)
        output = ' '.join(str(a) for call in mock_print.call_args_list for a in call.args)
        self.assertIn('A description', output)
        self.assertNotIn('PARAMETERS', output)

    def test_show_app_with_default_values(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            {'description': 'desc'},
            'spec',
        ]
        args = argparse.Namespace(name='my-app')
        with mock.patch('src.cli.app.workflow_utils.fetch_default_values',
                        return_value={'key': 'value'}), \
             mock.patch('builtins.print') as mock_print:
            app._show_app(service_client, args)
        output = ' '.join(str(a) for call in mock_print.call_args_list for a in call.args)
        self.assertIn('PARAMETERS', output)

    def test_show_app_with_version(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            {'description': 'desc'},
            'spec',
        ]
        args = argparse.Namespace(name='my-app:3')
        with mock.patch('src.cli.app.workflow_utils.fetch_default_values',
                        return_value=None), \
             mock.patch('builtins.print'):
            app._show_app(service_client, args)
        second_call = service_client.request.call_args_list[1]
        self.assertEqual(second_call[1]['params']['version'], 3)


class TestSpecApp(unittest.TestCase):
    """Test cases for _spec_app."""

    def test_spec_app_no_version(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = 'spec-text'
        args = argparse.Namespace(name='my-app')
        with mock.patch('builtins.print') as mock_print:
            app._spec_app(service_client, args)
        mock_print.assert_called_once_with('spec-text')
        self.assertEqual(service_client.request.call_args[1]['params'], {})

    def test_spec_app_with_version(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = 'spec-text-v2'
        args = argparse.Namespace(name='my-app:2')
        with mock.patch('builtins.print'):
            app._spec_app(service_client, args)
        self.assertEqual(service_client.request.call_args[1]['params'], {'version': 2})


class TestListApps(unittest.TestCase):
    """Test cases for _list_apps."""

    def test_list_apps_empty_text(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'apps': [], 'more_entries': False}
        args = argparse.Namespace(
            order='asc', user=None, name=None, all_users=False,
            count=20, format_type='text')
        with mock.patch('builtins.print') as mock_print:
            app._list_apps(service_client, args)
        output = ' '.join(str(a) for call in mock_print.call_args_list for a in call.args)
        self.assertIn('no apps', output.lower())

    def test_list_apps_json_format(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'apps': [
                {
                    'owner': 'o',
                    'name': 'n',
                    'description': 'd',
                    'created_date': '2026-01-01T00:00:00',
                    'latest_version': 1,
                }
            ],
            'more_entries': False,
        }
        args = argparse.Namespace(
            order='asc', user=None, name=None, all_users=False,
            count=20, format_type='json')
        with mock.patch('builtins.print') as mock_print:
            app._list_apps(service_client, args)
        mock_print.assert_called_once()
        parsed = json.loads(mock_print.call_args[0][0])
        self.assertEqual(len(parsed['apps']), 1)

    def test_list_apps_text_with_apps(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'apps': [
                {
                    'owner': 'owner-1',
                    'name': 'app-1',
                    'description': 'd',
                    'created_date': '2026-01-01T00:00:00',
                    'latest_version': 4,
                }
            ],
            'more_entries': False,
        }
        args = argparse.Namespace(
            order='asc', user=None, name=None, all_users=False,
            count=20, format_type='text')
        with mock.patch('builtins.print') as mock_print:
            app._list_apps(service_client, args)
        output = ' '.join(str(a) for call in mock_print.call_args_list for a in call.args)
        self.assertIn('owner-1', output)
        self.assertIn('app-1', output)

    def test_list_apps_params_passed(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'apps': [], 'more_entries': False}
        args = argparse.Namespace(
            order='desc', user=['u1'], name='prefix', all_users=True,
            count=30, format_type='text')
        with mock.patch('builtins.print'):
            app._list_apps(service_client, args)
        call = service_client.request.call_args
        self.assertEqual(call[1]['params']['order'], 'DESC')
        self.assertEqual(call[1]['params']['users'], ['u1'])
        self.assertEqual(call[1]['params']['name'], 'prefix')
        self.assertTrue(call[1]['params']['all_users'])

    def test_list_apps_paginates(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        # First page has 1000 entries + more, second has the remainder
        first_page = [
            {'owner': 'o', 'name': f'a{i}', 'description': '',
             'created_date': '2026-01-01T00:00:00', 'latest_version': 1}
            for i in range(1000)
        ]
        second_page = [
            {'owner': 'o', 'name': 'a1000', 'description': '',
             'created_date': '2026-01-01T00:00:00', 'latest_version': 1}
        ]
        service_client.request.side_effect = [
            {'apps': first_page, 'more_entries': True},
            {'apps': second_page, 'more_entries': False},
        ]
        args = argparse.Namespace(
            order='asc', user=None, name=None, all_users=False,
            count=1500, format_type='json')
        with mock.patch('builtins.print'):
            app._list_apps(service_client, args)
        self.assertEqual(service_client.request.call_count, 2)


class TestDeleteApp(unittest.TestCase):
    """Test cases for _delete_app."""

    def test_delete_app_no_version_no_all_raises(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(name='my-app', all=False, force=True)
        with self.assertRaises(osmo_errors.OSMOUserError):
            app._delete_app(service_client, args)

    def test_delete_app_with_version_force(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'versions': [2]}
        args = argparse.Namespace(name='my-app:2', all=False, force=True)
        with mock.patch('builtins.print') as mock_print:
            app._delete_app(service_client, args)
        service_client.request.assert_called_once_with(
            client.RequestMethod.DELETE,
            'api/app/user/my-app',
            params={'version': 2})
        output = ' '.join(str(a) for call in mock_print.call_args_list for a in call.args)
        self.assertIn('scheduled', output)

    def test_delete_app_all_versions_force(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'versions': [1, 2, 3]}
        args = argparse.Namespace(name='my-app', all=True, force=True)
        with mock.patch('builtins.print'):
            app._delete_app(service_client, args)
        call = service_client.request.call_args
        self.assertTrue(call[1]['params']['all_versions'])

    def test_delete_app_confirm_yes(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'versions': [2]}
        args = argparse.Namespace(name='my-app:2', all=False, force=False)
        with mock.patch('src.cli.app.common.prompt_user', return_value=True), \
             mock.patch('builtins.print'):
            app._delete_app(service_client, args)
        service_client.request.assert_called_once()

    def test_delete_app_confirm_no_returns(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(name='my-app:2', all=False, force=False)
        with mock.patch('src.cli.app.common.prompt_user', return_value=False), \
             mock.patch('builtins.print'):
            app._delete_app(service_client, args)
        service_client.request.assert_not_called()

    def test_delete_app_all_confirm_yes(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'versions': [1]}
        args = argparse.Namespace(name='my-app', all=True, force=False)
        with mock.patch('src.cli.app.common.prompt_user', return_value=True) as pu, \
             mock.patch('builtins.print'):
            app._delete_app(service_client, args)
        pu.assert_called_once()
        service_client.request.assert_called_once()


class TestRenameApp(unittest.TestCase):
    """Test cases for _rename_app."""

    def test_rename_app_original_with_version_raises(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(original_name='original:1', new_name='new', force=True)
        with self.assertRaises(osmo_errors.OSMOUserError):
            app._rename_app(service_client, args)

    def test_rename_app_new_with_version_raises(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(original_name='original', new_name='new:2', force=True)
        with self.assertRaises(osmo_errors.OSMOUserError):
            app._rename_app(service_client, args)

    def test_rename_app_force(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = 'new'
        args = argparse.Namespace(original_name='original', new_name='new', force=True)
        with mock.patch('builtins.print') as mock_print:
            app._rename_app(service_client, args)
        service_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/app/user/original/rename',
            payload='new')
        output = ' '.join(str(a) for call in mock_print.call_args_list for a in call.args)
        self.assertIn('original', output)
        self.assertIn('new', output)

    def test_rename_app_confirm_yes(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = 'new'
        args = argparse.Namespace(original_name='original', new_name='new', force=False)
        with mock.patch('src.cli.app.common.prompt_user', return_value=True), \
             mock.patch('builtins.print'):
            app._rename_app(service_client, args)
        service_client.request.assert_called_once()

    def test_rename_app_confirm_no_returns(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(original_name='original', new_name='new', force=False)
        with mock.patch('src.cli.app.common.prompt_user', return_value=False), \
             mock.patch('builtins.print'):
            app._rename_app(service_client, args)
        service_client.request.assert_not_called()


class TestSubmitApp(unittest.TestCase):
    """Test cases for _submit_app."""

    def _make_args(self, **overrides) -> argparse.Namespace:
        defaults: dict = {
            'name': 'my-app',
            'pool': 'pool-1',
            'priority': None,
            'set': [],
            'set_string': [],
            'set_env': [],
            'dry': False,
            'local_path': '/some/path',
            'rsync': None,
            'format_type': 'text',
        }
        defaults.update(overrides)
        return argparse.Namespace(**defaults)

    def test_submit_app_with_pool_and_priority(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            {'uuid': 'uuid-1', 'versions': [{'version': 3}]},
            'spec-text',
        ]
        args = self._make_args(priority='HIGH')
        with mock.patch('src.cli.app.workflow.parse_file_for_template',
                        return_value='template-data') as parse_mock, \
             mock.patch('src.cli.app.workflow.submit_workflow_helper') as submit_mock, \
             mock.patch('src.cli.app.pool.fetch_default_pool') as pool_mock:
            app._submit_app(service_client, args)
        pool_mock.assert_not_called()
        parse_mock.assert_called_once_with('spec-text', [], [])
        submit_mock.assert_called_once()
        _, _, _, local_path, params = submit_mock.call_args[0]
        self.assertEqual(local_path, '/some/path')
        self.assertEqual(params['app_uuid'], 'uuid-1')
        self.assertEqual(params['app_version'], 3)
        self.assertEqual(params['priority'], 'HIGH')

    def test_submit_app_no_pool_fetches_default(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            {'uuid': 'u', 'versions': [{'version': 1}]},
            'spec',
        ]
        args = self._make_args(pool=None)
        with mock.patch('src.cli.app.workflow.parse_file_for_template',
                        return_value='td'), \
             mock.patch('src.cli.app.workflow.submit_workflow_helper'), \
             mock.patch('src.cli.app.pool.fetch_default_pool',
                        return_value='default-pool') as pool_mock:
            app._submit_app(service_client, args)
        pool_mock.assert_called_once_with(service_client)
        self.assertEqual(args.pool, 'default-pool')

    def test_submit_app_no_local_path_uses_cwd(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            {'uuid': 'u', 'versions': [{'version': 1}]},
            'spec',
        ]
        args = self._make_args(local_path=None)
        with mock.patch('src.cli.app.workflow.parse_file_for_template',
                        return_value='td'), \
             mock.patch('src.cli.app.workflow.submit_workflow_helper') as submit_mock, \
             mock.patch('src.cli.app.os.getcwd', return_value='/mocked/cwd'):
            app._submit_app(service_client, args)
        _, _, _, local_path, _ = submit_mock.call_args[0]
        self.assertEqual(local_path, '/mocked/cwd')

    def test_submit_app_with_version_in_name(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            {'uuid': 'u', 'versions': [{'version': 5}]},
            'spec',
        ]
        args = self._make_args(name='my-app:5')
        with mock.patch('src.cli.app.workflow.parse_file_for_template',
                        return_value='td'), \
             mock.patch('src.cli.app.workflow.submit_workflow_helper'):
            app._submit_app(service_client, args)
        first_call = service_client.request.call_args_list[0]
        self.assertEqual(first_call[1]['params']['version'], 5)
        self.assertEqual(first_call[1]['params']['limit'], 1)


if __name__ == '__main__':
    unittest.main()
