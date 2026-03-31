# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import argparse
import json
import unittest
from unittest import mock

from src.cli import app
from src.lib.utils import client, common, osmo_errors


class TestSetupParser(unittest.TestCase):
    """Tests for setup_parser function."""

    def test_setup_parser_creates_app_subparser(self):
        """Test that setup_parser creates the app subparser with required subcommands."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'list'])
        self.assertEqual(parsed.command, 'list')

    def test_setup_parser_create_command_with_required_args(self):
        """Test that create command requires name and description."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'create', 'my-app', '-d', 'My description'])
        self.assertEqual(parsed.name, 'my-app')
        self.assertEqual(parsed.description, 'My description')

    def test_setup_parser_create_command_with_file_option(self):
        """Test that create command accepts file option."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'create', 'my-app', '-d', 'desc', '-f', '/path/to/file'])
        self.assertEqual(parsed.file, '/path/to/file')

    def test_setup_parser_update_command_with_name(self):
        """Test that update command accepts name argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'update', 'my-app'])
        self.assertEqual(parsed.name, 'my-app')
        self.assertIsNone(parsed.file)

    def test_setup_parser_update_command_with_file(self):
        """Test that update command accepts file option."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'update', 'my-app', '-f', '/path/to/file'])
        self.assertEqual(parsed.file, '/path/to/file')

    def test_setup_parser_info_command_with_defaults(self):
        """Test that info command has correct defaults."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'info', 'my-app'])
        self.assertEqual(parsed.name, 'my-app')
        self.assertEqual(parsed.count, 20)
        self.assertEqual(parsed.order, 'asc')
        self.assertEqual(parsed.format_type, 'text')

    def test_setup_parser_info_command_with_all_options(self):
        """Test that info command accepts all options."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'info', 'my-app', '-c', '50', '-o', 'desc', '-t', 'json'])
        self.assertEqual(parsed.count, 50)
        self.assertEqual(parsed.order, 'desc')
        self.assertEqual(parsed.format_type, 'json')

    def test_setup_parser_show_command(self):
        """Test that show command accepts name argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'show', 'my-app:1'])
        self.assertEqual(parsed.name, 'my-app:1')

    def test_setup_parser_spec_command(self):
        """Test that spec command accepts name argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'spec', 'my-app:2'])
        self.assertEqual(parsed.name, 'my-app:2')

    def test_setup_parser_list_command_with_defaults(self):
        """Test that list command has correct defaults."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'list'])
        self.assertIsNone(parsed.name)
        self.assertIsNone(parsed.user)
        self.assertFalse(parsed.all_users)
        self.assertEqual(parsed.count, 20)
        self.assertEqual(parsed.order, 'asc')
        self.assertEqual(parsed.format_type, 'text')

    def test_setup_parser_list_command_with_all_options(self):
        """Test that list command accepts all options."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args([
            'app', 'list', '-n', 'search', '-u', 'user1', 'user2',
            '-a', '-c', '100', '-o', 'desc', '-t', 'json'
        ])
        self.assertEqual(parsed.name, 'search')
        self.assertEqual(parsed.user, ['user1', 'user2'])
        self.assertTrue(parsed.all_users)
        self.assertEqual(parsed.count, 100)
        self.assertEqual(parsed.order, 'desc')
        self.assertEqual(parsed.format_type, 'json')

    def test_setup_parser_delete_command_with_defaults(self):
        """Test that delete command has correct defaults."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'delete', 'my-app:1'])
        self.assertEqual(parsed.name, 'my-app:1')
        self.assertFalse(getattr(parsed, 'all'))
        self.assertFalse(parsed.force)

    def test_setup_parser_delete_command_with_all_and_force(self):
        """Test that delete command accepts all and force options."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'delete', 'my-app', '-a', '-f'])
        self.assertTrue(getattr(parsed, 'all'))
        self.assertTrue(parsed.force)

    def test_setup_parser_rename_command(self):
        """Test that rename command accepts original and new names."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'rename', 'old-name', 'new-name'])
        self.assertEqual(parsed.original_name, 'old-name')
        self.assertEqual(parsed.new_name, 'new-name')
        self.assertFalse(parsed.force)

    def test_setup_parser_rename_command_with_force(self):
        """Test that rename command accepts force option."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'rename', 'old-name', 'new-name', '-f'])
        self.assertTrue(parsed.force)

    def test_setup_parser_submit_command_with_defaults(self):
        """Test that submit command has correct defaults."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args(['app', 'submit', 'my-app:1'])
        self.assertEqual(parsed.name, 'my-app:1')
        self.assertEqual(parsed.format_type, 'text')
        self.assertEqual(parsed.set, [])
        self.assertEqual(parsed.set_string, [])
        self.assertEqual(parsed.set_env, [])
        self.assertFalse(parsed.dry)
        self.assertIsNone(parsed.pool)
        self.assertIsNone(parsed.local_path)
        self.assertIsNone(parsed.rsync)
        self.assertIsNone(parsed.priority)

    def test_setup_parser_submit_command_with_options_except_local_path(self):
        """Test that submit command accepts options (excluding local_path which validates)."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed = parser.parse_args([
            'app', 'submit', 'my-app', '-t', 'json',
            '--set', 'key1=val1', 'key2=val2',
            '--set-string', 'str1=strval',
            '--set-env', 'ENV1=envval',
            '--dry-run', '-p', 'my-pool',
            '--rsync', '/local:/remote',
            '--priority', 'high'
        ])
        self.assertEqual(parsed.format_type, 'json')
        self.assertEqual(parsed.set, ['key1=val1', 'key2=val2'])
        self.assertEqual(parsed.set_string, ['str1=strval'])
        self.assertEqual(parsed.set_env, ['ENV1=envval'])
        self.assertTrue(parsed.dry)
        self.assertEqual(parsed.pool, 'my-pool')
        self.assertEqual(parsed.rsync, '/local:/remote')
        self.assertEqual(parsed.priority, 'HIGH')


class TestCreateApp(unittest.TestCase):
    """Tests for _create_app function."""

    def test_create_app_with_version_raises_error(self):
        """Test that creating app with version specified raises error."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(name='my-app:1', description='desc', file=None)

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            app._create_app(mock_client, args)

        self.assertIn('Cannot create a specific version', str(context.exception))

    def test_create_app_with_file_success(self):
        """Test creating app from file successfully."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(name='my-app', description='My description', file='/path/to/file')

        mock_file_content = 'app: content'
        with mock.patch('builtins.open', mock.mock_open(read_data=mock_file_content)):
            with mock.patch('builtins.print') as mock_print:
                app._create_app(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/app/user/my-app',
            params={'description': 'My description'},
            payload='app: content'
        )
        mock_print.assert_called_with('App my-app created successfully')

    def test_create_app_with_editor_success(self):
        """Test creating app using editor successfully."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(name='my-app', description='desc', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='editor content'):
            with mock.patch('builtins.print') as mock_print:
                app._create_app(mock_client, args)

        mock_client.request.assert_called_once()
        mock_print.assert_called_with('App my-app created successfully')

    def test_create_app_empty_content_raises_error(self):
        """Test that empty app content raises error."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(name='my-app', description='desc', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value=''):
            with self.assertRaises(osmo_errors.OSMOUserError) as context:
                app._create_app(mock_client, args)

        self.assertIn('App is empty', str(context.exception))

    def test_create_app_request_failure_saves_to_temp_file(self):
        """Test that request failure saves content to temp file."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = Exception('Network error')
        args = argparse.Namespace(name='my-app', description='desc', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='content'):
            with mock.patch('src.cli.editor.save_to_temp_file', return_value='/tmp/saved.yaml'):
                with self.assertRaises(osmo_errors.OSMOUserError) as context:
                    app._create_app(mock_client, args)

        self.assertIn('Error creating app', str(context.exception))
        self.assertIn('/tmp/saved.yaml', str(context.exception))


class TestUpdateApp(unittest.TestCase):
    """Tests for _update_app function."""

    def test_update_app_with_file_success(self):
        """Test updating app from file successfully."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            'original content',
            {'name': 'my-app', 'version': 2}
        ]
        args = argparse.Namespace(name='my-app', file='/path/to/file')

        with mock.patch('builtins.open', mock.mock_open(read_data='new content')):
            with mock.patch('builtins.print') as mock_print:
                app._update_app(mock_client, args)

        output = ' '.join(str(c) for c in mock_print.call_args_list)
        self.assertIn('updated successfully', output)
        self.assertIn('Version: 2', output)

    def test_update_app_with_editor_success(self):
        """Test updating app using editor successfully."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            'original content',
            {'name': 'my-app', 'version': 3}
        ]
        args = argparse.Namespace(name='my-app', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='modified content'):
            with mock.patch('builtins.print') as mock_print:
                app._update_app(mock_client, args)

        output = ' '.join(str(c) for c in mock_print.call_args_list)
        self.assertIn('updated successfully', output)

    def test_update_app_no_changes_made(self):
        """Test that no version is created when no changes are made."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = 'original content'
        args = argparse.Namespace(name='my-app', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='original content'):
            with mock.patch('builtins.print') as mock_print:
                app._update_app(mock_client, args)

        mock_print.assert_called_with('No version was created because no changes were made to the app.')

    def test_update_app_empty_content_no_changes(self):
        """Test that empty content results in no changes."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = 'original content'
        args = argparse.Namespace(name='my-app', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value=''):
            with mock.patch('builtins.print') as mock_print:
                app._update_app(mock_client, args)

        mock_print.assert_called_with('No version was created because no changes were made to the app.')

    def test_update_app_with_version_param(self):
        """Test updating app with specific version."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            'version content',
            {'name': 'my-app', 'version': 4}
        ]
        args = argparse.Namespace(name='my-app:2', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='new content'):
            with mock.patch('builtins.print'):
                app._update_app(mock_client, args)

        first_call_params = mock_client.request.call_args_list[0]
        self.assertEqual(first_call_params[1]['params'], {'version': 2})

    def test_update_app_deleted_app_creates_new(self):
        """Test updating deleted app attempts to create new version."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            osmo_errors.OSMOUserError('App not found'),
            {'name': 'my-app', 'version': 1}
        ]
        args = argparse.Namespace(name='my-app', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='new content'):
            with mock.patch('builtins.print') as mock_print:
                app._update_app(mock_client, args)

        output = ' '.join(str(c) for c in mock_print.call_args_list)
        self.assertIn('deleted/does not exist', output)

    def test_update_app_with_version_deleted_raises_error(self):
        """Test updating specific version of deleted app raises error."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = osmo_errors.OSMOUserError('Version not found')
        args = argparse.Namespace(name='my-app:5', file=None)

        with self.assertRaises(osmo_errors.OSMOUserError):
            app._update_app(mock_client, args)

    def test_update_app_request_failure_saves_to_temp_file(self):
        """Test that request failure during update saves content to temp file."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            'original content',
            Exception('Update failed')
        ]
        args = argparse.Namespace(name='my-app', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='new content'):
            with mock.patch('src.cli.editor.save_to_temp_file', return_value='/tmp/saved.yaml'):
                with self.assertRaises(osmo_errors.OSMOUserError) as context:
                    app._update_app(mock_client, args)

        self.assertIn('Error editing app', str(context.exception))
        self.assertIn('/tmp/saved.yaml', str(context.exception))


class TestInfoApp(unittest.TestCase):
    """Tests for _info_app function."""

    def test_info_app_text_format(self):
        """Test info app with text format output."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {
            'uuid': 'uuid-123',
            'owner': 'test-user',
            'created_date': '2025-01-01T00:00:00Z',
            'description': 'Test description',
            'versions': [
                {'version': 1, 'created_by': 'user1', 'created_date': '2025-01-01T00:00:00Z', 'status': 'active'}
            ]
        }
        args = argparse.Namespace(name='my-app', count=20, order='asc', format_type='text')

        with mock.patch('src.lib.utils.common.convert_utc_datetime_to_user_zone', return_value='2025-01-01'):
            with mock.patch('src.lib.utils.common.osmo_table') as mock_table:
                mock_table_instance = mock.MagicMock()
                mock_table.return_value = mock_table_instance
                mock_table_instance.draw.return_value = 'table output'
                with mock.patch('builtins.print') as mock_print:
                    app._info_app(mock_client, args)

        output = ' '.join(str(c) for c in mock_print.call_args_list)
        self.assertIn('Name: my-app', output)
        self.assertIn('UUID: uuid-123', output)

    def test_info_app_json_format(self):
        """Test info app with JSON format output."""
        mock_client = mock.MagicMock()
        app_data = {
            'uuid': 'uuid-123',
            'owner': 'test-user',
            'created_date': '2025-01-01T00:00:00Z',
            'description': 'Test description',
            'versions': []
        }
        mock_client.request.return_value = app_data
        args = argparse.Namespace(name='my-app', count=20, order='asc', format_type='json')

        with mock.patch('builtins.print') as mock_print:
            app._info_app(mock_client, args)

        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        parsed_json = json.loads(printed_output)
        self.assertEqual(parsed_json['uuid'], 'uuid-123')

    def test_info_app_with_version(self):
        """Test info app with specific version."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {
            'uuid': 'uuid-123',
            'owner': 'test-user',
            'created_date': '2025-01-01T00:00:00Z',
            'description': 'Test',
            'versions': []
        }
        args = argparse.Namespace(name='my-app:2', count=20, order='asc', format_type='json')

        with mock.patch('builtins.print'):
            app._info_app(mock_client, args)

        call_params = mock_client.request.call_args[1]['params']
        self.assertEqual(call_params['version'], 2)


class TestShowApp(unittest.TestCase):
    """Tests for _show_app function."""

    def test_show_app_with_default_values(self):
        """Test show app displays description and parameters."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'description': 'App description'},
            'app-spec-content'
        ]
        args = argparse.Namespace(name='my-app')

        with mock.patch('src.lib.utils.workflow.fetch_default_values', return_value={'key': 'value'}):
            with mock.patch('builtins.print') as mock_print:
                app._show_app(mock_client, args)

        output = ' '.join(str(c) for c in mock_print.call_args_list)
        self.assertIn('DESCRIPTION', output)
        self.assertIn('App description', output)
        self.assertIn('PARAMETERS', output)

    def test_show_app_without_default_values(self):
        """Test show app displays only description when no parameters."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'description': 'App description'},
            'app-spec-content'
        ]
        args = argparse.Namespace(name='my-app')

        with mock.patch('src.lib.utils.workflow.fetch_default_values', return_value=None):
            with mock.patch('builtins.print') as mock_print:
                app._show_app(mock_client, args)

        output = ' '.join(str(c) for c in mock_print.call_args_list)
        self.assertIn('DESCRIPTION', output)
        self.assertNotIn('PARAMETERS', output)

    def test_show_app_with_version(self):
        """Test show app with specific version."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'description': 'Desc'},
            'spec'
        ]
        args = argparse.Namespace(name='my-app:3')

        with mock.patch('src.lib.utils.workflow.fetch_default_values', return_value=None):
            with mock.patch('builtins.print'):
                app._show_app(mock_client, args)

        spec_call_params = mock_client.request.call_args_list[1][1]['params']
        self.assertEqual(spec_call_params['version'], 3)


class TestSpecApp(unittest.TestCase):
    """Tests for _spec_app function."""

    def test_spec_app_prints_spec(self):
        """Test spec app prints the app specification."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = 'app-spec-yaml-content'
        args = argparse.Namespace(name='my-app')

        with mock.patch('builtins.print') as mock_print:
            app._spec_app(mock_client, args)

        mock_print.assert_called_once_with('app-spec-yaml-content')

    def test_spec_app_with_version(self):
        """Test spec app with specific version."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = 'versioned-spec'
        args = argparse.Namespace(name='my-app:5')

        with mock.patch('builtins.print'):
            app._spec_app(mock_client, args)

        call_params = mock_client.request.call_args[1]['params']
        self.assertEqual(call_params['version'], 5)


class TestListApps(unittest.TestCase):
    """Tests for _list_apps function."""

    def test_list_apps_text_format_with_apps(self):
        """Test list apps with text format when apps exist."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {
            'apps': [
                {'owner': 'user1', 'name': 'app1', 'description': 'desc1',
                 'created_date': '2025-01-01T00:00:00Z', 'latest_version': 1}
            ],
            'more_entries': False
        }
        args = argparse.Namespace(
            order='asc', user=None, name=None, all_users=False,
            count=20, format_type='text'
        )

        with mock.patch('src.lib.utils.common.convert_utc_datetime_to_user_zone', return_value='2025-01-01'):
            with mock.patch('src.lib.utils.common.osmo_table') as mock_table:
                mock_table_instance = mock.MagicMock()
                mock_table.return_value = mock_table_instance
                mock_table_instance.draw.return_value = 'table'
                with mock.patch('builtins.print') as mock_print:
                    app._list_apps(mock_client, args)

        mock_print.assert_called_with('table')

    def test_list_apps_text_format_no_apps(self):
        """Test list apps with text format when no apps exist."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {'apps': [], 'more_entries': False}
        args = argparse.Namespace(
            order='asc', user=None, name=None, all_users=False,
            count=20, format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            app._list_apps(mock_client, args)

        mock_print.assert_called_with('There are no apps to view.')

    def test_list_apps_json_format(self):
        """Test list apps with JSON format."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {
            'apps': [{'name': 'app1'}],
            'more_entries': False
        }
        args = argparse.Namespace(
            order='asc', user=None, name=None, all_users=False,
            count=20, format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            app._list_apps(mock_client, args)

        printed_output = mock_print.call_args[0][0]
        parsed_json = json.loads(printed_output)
        self.assertEqual(len(parsed_json['apps']), 1)

    def test_list_apps_with_user_filter(self):
        """Test list apps with user filter."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {'apps': [], 'more_entries': False}
        args = argparse.Namespace(
            order='asc', user=['user1', 'user2'], name=None, all_users=False,
            count=20, format_type='text'
        )

        with mock.patch('builtins.print'):
            app._list_apps(mock_client, args)

        call_params = mock_client.request.call_args[1]['params']
        self.assertEqual(call_params['users'], ['user1', 'user2'])

    def test_list_apps_with_name_filter(self):
        """Test list apps with name filter."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {'apps': [], 'more_entries': False}
        args = argparse.Namespace(
            order='asc', user=None, name='search-term', all_users=False,
            count=20, format_type='text'
        )

        with mock.patch('builtins.print'):
            app._list_apps(mock_client, args)

        call_params = mock_client.request.call_args[1]['params']
        self.assertEqual(call_params['name'], 'search-term')

    def test_list_apps_with_all_users_flag(self):
        """Test list apps with all_users flag."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {'apps': [], 'more_entries': False}
        args = argparse.Namespace(
            order='asc', user=None, name=None, all_users=True,
            count=20, format_type='text'
        )

        with mock.patch('builtins.print'):
            app._list_apps(mock_client, args)

        call_params = mock_client.request.call_args[1]['params']
        self.assertTrue(call_params['all_users'])

    def test_list_apps_pagination(self):
        """Test list apps with pagination when more entries exist."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'apps': [{'name': 'app1'}], 'more_entries': True},
            {'apps': [{'name': 'app2'}], 'more_entries': False}
        ]
        args = argparse.Namespace(
            order='asc', user=None, name=None, all_users=False,
            count=2000, format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            app._list_apps(mock_client, args)

        printed_output = mock_print.call_args[0][0]
        parsed_json = json.loads(printed_output)
        self.assertEqual(len(parsed_json['apps']), 2)


class TestDeleteApp(unittest.TestCase):
    """Tests for _delete_app function."""

    def test_delete_app_without_version_or_all_raises_error(self):
        """Test that delete without version or all flag raises error."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(name='my-app', all=False, force=True)

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            app._delete_app(mock_client, args)

        self.assertIn('Must specify a version or all_versions', str(context.exception))

    def test_delete_app_with_version_and_force(self):
        """Test deleting specific version with force flag."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {'versions': [1]}
        args = argparse.Namespace(name='my-app:1', all=False, force=True)

        with mock.patch('builtins.print') as mock_print:
            app._delete_app(mock_client, args)

        output = ' '.join(str(c) for c in mock_print.call_args_list)
        self.assertIn('Delete Job', output)
        self.assertIn('1', output)

    def test_delete_app_all_versions_with_force(self):
        """Test deleting all versions with force flag."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {'versions': [1, 2, 3]}
        args = argparse.Namespace(name='my-app', all=True, force=True)

        with mock.patch('builtins.print') as mock_print:
            app._delete_app(mock_client, args)

        call_params = mock_client.request.call_args[1]['params']
        self.assertTrue(call_params['all_versions'])
        self.assertEqual(mock_print.call_count, 3)

    def test_delete_app_with_confirmation_accepted(self):
        """Test deleting app with user confirmation accepted."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {'versions': [1]}
        args = argparse.Namespace(name='my-app:1', all=False, force=False)

        with mock.patch('src.lib.utils.common.prompt_user', return_value=True):
            with mock.patch('builtins.print') as mock_print:
                app._delete_app(mock_client, args)

        output = ' '.join(str(c) for c in mock_print.call_args_list)
        self.assertIn('Delete Job', output)

    def test_delete_app_with_confirmation_rejected(self):
        """Test deleting app with user confirmation rejected."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(name='my-app:1', all=False, force=False)

        with mock.patch('src.lib.utils.common.prompt_user', return_value=False):
            app._delete_app(mock_client, args)

        mock_client.request.assert_not_called()

    def test_delete_app_all_versions_confirmation_prompt(self):
        """Test delete all versions shows correct confirmation prompt."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {'versions': [1]}
        args = argparse.Namespace(name='my-app', all=True, force=False)

        with mock.patch('src.lib.utils.common.prompt_user', return_value=True) as mock_prompt:
            with mock.patch('builtins.print'):
                app._delete_app(mock_client, args)

        prompt_message = mock_prompt.call_args[0][0]
        self.assertIn('all versions', prompt_message)


class TestRenameApp(unittest.TestCase):
    """Tests for _rename_app function."""

    def test_rename_app_with_original_version_raises_error(self):
        """Test that renaming with version in original name raises error."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(original_name='my-app:1', new_name='new-app', force=True)

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            app._rename_app(mock_client, args)

        self.assertIn('Cannot rename a specific version', str(context.exception))

    def test_rename_app_with_new_version_raises_error(self):
        """Test that renaming to name with version raises error."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(original_name='my-app', new_name='new-app:1', force=True)

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            app._rename_app(mock_client, args)

        self.assertIn('Cannot rename to a specific version', str(context.exception))

    def test_rename_app_with_force_success(self):
        """Test renaming app with force flag succeeds."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = 'new-app'
        args = argparse.Namespace(original_name='old-app', new_name='new-app', force=True)

        with mock.patch('builtins.print') as mock_print:
            app._rename_app(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/app/user/old-app/rename',
            payload='new-app'
        )
        mock_print.assert_called_with('App old-app renamed to new-app successfully.')

    def test_rename_app_with_confirmation_accepted(self):
        """Test renaming app with user confirmation accepted."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = 'new-app'
        args = argparse.Namespace(original_name='old-app', new_name='new-app', force=False)

        with mock.patch('src.lib.utils.common.prompt_user', return_value=True):
            with mock.patch('builtins.print') as mock_print:
                app._rename_app(mock_client, args)

        mock_print.assert_called_with('App old-app renamed to new-app successfully.')

    def test_rename_app_with_confirmation_rejected(self):
        """Test renaming app with user confirmation rejected."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(original_name='old-app', new_name='new-app', force=False)

        with mock.patch('src.lib.utils.common.prompt_user', return_value=False):
            app._rename_app(mock_client, args)

        mock_client.request.assert_not_called()


class TestSubmitApp(unittest.TestCase):
    """Tests for _submit_app function."""

    def test_submit_app_basic_success(self):
        """Test submitting app with basic parameters."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'uuid': 'app-uuid', 'versions': [{'version': 1}]},
            'spec-content'
        ]
        args = argparse.Namespace(
            name='my-app', pool='test-pool', priority=None,
            set=[], set_string=[], set_env=[], local_path=None,
            format_type='text', dry=False, rsync=None
        )

        with mock.patch('src.cli.workflow.parse_file_for_template', return_value='template'):
            with mock.patch('src.cli.workflow.submit_workflow_helper') as mock_submit:
                with mock.patch('os.getcwd', return_value='/current/dir'):
                    app._submit_app(mock_client, args)

        mock_submit.assert_called_once()
        call_params = mock_submit.call_args[0][4]
        self.assertEqual(call_params['app_uuid'], 'app-uuid')
        self.assertEqual(call_params['app_version'], 1)

    def test_submit_app_with_version(self):
        """Test submitting specific version of app."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'uuid': 'app-uuid', 'versions': [{'version': 5}]},
            'spec-content'
        ]
        args = argparse.Namespace(
            name='my-app:5', pool='test-pool', priority=None,
            set=[], set_string=[], set_env=[], local_path=None,
            format_type='text', dry=False, rsync=None
        )

        with mock.patch('src.cli.workflow.parse_file_for_template', return_value='template'):
            with mock.patch('src.cli.workflow.submit_workflow_helper'):
                with mock.patch('os.getcwd', return_value='/current/dir'):
                    app._submit_app(mock_client, args)

        spec_call_params = mock_client.request.call_args_list[1][1]['params']
        self.assertEqual(spec_call_params['version'], 5)

    def test_submit_app_without_pool_uses_default(self):
        """Test submitting app without pool uses default pool."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'uuid': 'app-uuid', 'versions': [{'version': 1}]},
            'spec-content'
        ]
        args = argparse.Namespace(
            name='my-app', pool=None, priority=None,
            set=[], set_string=[], set_env=[], local_path=None,
            format_type='text', dry=False, rsync=None
        )

        with mock.patch('src.cli.pool.fetch_default_pool', return_value='default-pool') as mock_fetch:
            with mock.patch('src.cli.workflow.parse_file_for_template', return_value='template'):
                with mock.patch('src.cli.workflow.submit_workflow_helper'):
                    with mock.patch('os.getcwd', return_value='/current/dir'):
                        app._submit_app(mock_client, args)

        mock_fetch.assert_called_once_with(mock_client)
        self.assertEqual(args.pool, 'default-pool')

    def test_submit_app_with_priority(self):
        """Test submitting app with priority."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'uuid': 'app-uuid', 'versions': [{'version': 1}]},
            'spec-content'
        ]
        args = argparse.Namespace(
            name='my-app', pool='test-pool', priority='HIGH',
            set=[], set_string=[], set_env=[], local_path=None,
            format_type='text', dry=False, rsync=None
        )

        with mock.patch('src.cli.workflow.parse_file_for_template', return_value='template'):
            with mock.patch('src.cli.workflow.submit_workflow_helper') as mock_submit:
                with mock.patch('os.getcwd', return_value='/current/dir'):
                    app._submit_app(mock_client, args)

        call_params = mock_submit.call_args[0][4]
        self.assertEqual(call_params['priority'], 'HIGH')

    def test_submit_app_with_local_path(self):
        """Test submitting app with custom local path."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'uuid': 'app-uuid', 'versions': [{'version': 1}]},
            'spec-content'
        ]
        args = argparse.Namespace(
            name='my-app', pool='test-pool', priority=None,
            set=[], set_string=[], set_env=[], local_path='/custom/path',
            format_type='text', dry=False, rsync=None
        )

        with mock.patch('src.cli.workflow.parse_file_for_template', return_value='template'):
            with mock.patch('src.cli.workflow.submit_workflow_helper') as mock_submit:
                app._submit_app(mock_client, args)

        local_path_arg = mock_submit.call_args[0][3]
        self.assertEqual(local_path_arg, '/custom/path')

    def test_submit_app_with_set_parameters(self):
        """Test submitting app with set parameters."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'uuid': 'app-uuid', 'versions': [{'version': 1}]},
            'spec-content'
        ]
        args = argparse.Namespace(
            name='my-app', pool='test-pool', priority=None,
            set=['key1=val1', 'key2=val2'], set_string=['str1=strval'],
            set_env=[], local_path=None,
            format_type='text', dry=False, rsync=None
        )

        with mock.patch('src.cli.workflow.parse_file_for_template', return_value='template') as mock_parse:
            with mock.patch('src.cli.workflow.submit_workflow_helper'):
                with mock.patch('os.getcwd', return_value='/current/dir'):
                    app._submit_app(mock_client, args)

        mock_parse.assert_called_once_with(
            'spec-content',
            ['key1=val1', 'key2=val2'],
            ['str1=strval']
        )


if __name__ == '__main__':
    unittest.main()
