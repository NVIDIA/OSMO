# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

import argparse
import json
import unittest
from unittest import mock

from src.cli import app
from src.lib.utils import osmo_errors


class TestSetupParser(unittest.TestCase):
    """Tests for setup_parser function."""

    def test_setup_parser_creates_app_parser_with_subcommands(self):
        """Test that setup_parser creates the app parser with all subcommands."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'list'])
        self.assertEqual(parsed_args.command, 'list')

    def test_setup_parser_create_subcommand_with_required_args(self):
        """Test that create subcommand parses required arguments."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'create', 'my-app', '-d', 'My description'])

        self.assertEqual(parsed_args.name, 'my-app')
        self.assertEqual(parsed_args.description, 'My description')

    def test_setup_parser_create_subcommand_with_file_option(self):
        """Test that create subcommand parses file option."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'create', 'my-app', '-d', 'desc', '-f', 'path.yaml'])

        self.assertEqual(parsed_args.file, 'path.yaml')

    def test_setup_parser_update_subcommand(self):
        """Test that update subcommand parses arguments."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'update', 'my-app', '-f', 'file.yaml'])

        self.assertEqual(parsed_args.name, 'my-app')
        self.assertEqual(parsed_args.file, 'file.yaml')

    def test_setup_parser_info_subcommand_with_defaults(self):
        """Test that info subcommand has correct defaults."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'info', 'my-app'])

        self.assertEqual(parsed_args.count, 20)
        self.assertEqual(parsed_args.order, 'asc')
        self.assertEqual(parsed_args.format_type, 'text')

    def test_setup_parser_info_subcommand_with_options(self):
        """Test that info subcommand parses all options."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'info', 'my-app', '-c', '50', '-o', 'desc', '-t', 'json'])

        self.assertEqual(parsed_args.count, 50)
        self.assertEqual(parsed_args.order, 'desc')
        self.assertEqual(parsed_args.format_type, 'json')

    def test_setup_parser_show_subcommand(self):
        """Test that show subcommand parses name argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'show', 'my-app:1'])

        self.assertEqual(parsed_args.name, 'my-app:1')

    def test_setup_parser_spec_subcommand(self):
        """Test that spec subcommand parses name argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'spec', 'my-app:2'])

        self.assertEqual(parsed_args.name, 'my-app:2')

    def test_setup_parser_list_subcommand_with_defaults(self):
        """Test that list subcommand has correct defaults."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'list'])

        self.assertEqual(parsed_args.count, 20)
        self.assertEqual(parsed_args.order, 'asc')
        self.assertEqual(parsed_args.format_type, 'text')
        self.assertFalse(parsed_args.all_users)

    def test_setup_parser_list_subcommand_with_options(self):
        """Test that list subcommand parses all options."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'list', '-n', 'test', '-u', 'user1', 'user2', '-a', '-c', '100', '-o', 'desc', '-t', 'json'])

        self.assertEqual(parsed_args.name, 'test')
        self.assertEqual(parsed_args.user, ['user1', 'user2'])
        self.assertTrue(parsed_args.all_users)
        self.assertEqual(parsed_args.count, 100)
        self.assertEqual(parsed_args.order, 'desc')
        self.assertEqual(parsed_args.format_type, 'json')

    def test_setup_parser_delete_subcommand(self):
        """Test that delete subcommand parses arguments."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'delete', 'my-app:1', '--all', '--force'])

        self.assertEqual(parsed_args.name, 'my-app:1')
        self.assertTrue(parsed_args.all)
        self.assertTrue(parsed_args.force)

    def test_setup_parser_rename_subcommand(self):
        """Test that rename subcommand parses arguments."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'rename', 'old-app', 'new-app', '-f'])

        self.assertEqual(parsed_args.original_name, 'old-app')
        self.assertEqual(parsed_args.new_name, 'new-app')
        self.assertTrue(parsed_args.force)

    def test_setup_parser_submit_subcommand_with_defaults(self):
        """Test that submit subcommand has correct defaults."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args(['app', 'submit', 'my-app'])

        self.assertEqual(parsed_args.name, 'my-app')
        self.assertEqual(parsed_args.format_type, 'text')
        self.assertEqual(parsed_args.set, [])
        self.assertEqual(parsed_args.set_string, [])
        self.assertEqual(parsed_args.set_env, [])
        self.assertFalse(parsed_args.dry)

    def test_setup_parser_submit_subcommand_with_options(self):
        """Test that submit subcommand parses all options."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        app.setup_parser(subparsers)

        parsed_args = parser.parse_args([
            'app', 'submit', 'my-app:1',
            '-t', 'json',
            '--set', 'key1=val1', 'key2=val2',
            '--set-string', 'str1=strval',
            '--set-env', 'ENV1=env_val',
            '--dry-run',
            '--pool', 'my-pool',
            '--priority', 'HIGH',
            '--rsync', '/local:/remote'
        ])

        self.assertEqual(parsed_args.name, 'my-app:1')
        self.assertEqual(parsed_args.format_type, 'json')
        self.assertEqual(parsed_args.set, ['key1=val1', 'key2=val2'])
        self.assertEqual(parsed_args.set_string, ['str1=strval'])
        self.assertEqual(parsed_args.set_env, ['ENV1=env_val'])
        self.assertTrue(parsed_args.dry)
        self.assertEqual(parsed_args.pool, 'my-pool')
        self.assertEqual(parsed_args.priority, 'HIGH')
        self.assertEqual(parsed_args.rsync, '/local:/remote')


class TestCreateApp(unittest.TestCase):
    """Tests for _create_app function."""

    def test_create_app_raises_error_when_version_specified(self):
        """Test that creating a specific version raises an error."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(name='my-app:1', description='desc', file=None)

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            app._create_app(mock_client, args)

        self.assertIn('Cannot create a specific version', str(context.exception))

    def test_create_app_raises_error_when_content_empty(self):
        """Test that empty app content raises an error."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(name='my-app', description='desc', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value=''):
            with self.assertRaises(osmo_errors.OSMOUserError) as context:
                app._create_app(mock_client, args)

        self.assertIn('App is empty', str(context.exception))

    def test_create_app_from_file_success(self):
        """Test successful app creation from file."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(name='my-app', description='My description', file='/path/to/file.yaml')

        mock_file_content = 'app: content'
        with mock.patch('builtins.open', mock.mock_open(read_data=mock_file_content)):
            with mock.patch('builtins.print') as mock_print:
                app._create_app(mock_client, args)

        mock_client.request.assert_called_once()
        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('created successfully', output)

    def test_create_app_from_editor_success(self):
        """Test successful app creation from editor."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(name='my-app', description='desc', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='app: content'):
            with mock.patch('builtins.print') as mock_print:
                app._create_app(mock_client, args)

        mock_client.request.assert_called_once()
        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('created successfully', output)

    def test_create_app_saves_to_temp_on_error(self):
        """Test that content is saved to temp file on error."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = Exception('API Error')
        args = argparse.Namespace(name='my-app', description='desc', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='app: content'):
            with mock.patch('src.cli.editor.save_to_temp_file', return_value='/tmp/file.yaml'):
                with self.assertRaises(osmo_errors.OSMOUserError) as context:
                    app._create_app(mock_client, args)

        self.assertIn('Error creating app', str(context.exception))
        self.assertIn('/tmp/file.yaml', str(context.exception))


class TestUpdateApp(unittest.TestCase):
    """Tests for _update_app function."""

    def test_update_app_no_changes_made(self):
        """Test that no version is created when no changes are made."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = 'original content'
        args = argparse.Namespace(name='my-app', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='original content'):
            with mock.patch('builtins.print') as mock_print:
                app._update_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('No version was created', output)

    def test_update_app_empty_content_no_changes(self):
        """Test that empty content results in no changes."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = 'original content'
        args = argparse.Namespace(name='my-app', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value=''):
            with mock.patch('builtins.print') as mock_print:
                app._update_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('No version was created', output)

    def test_update_app_success_from_file(self):
        """Test successful app update from file."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            'original content',
            {'name': 'my-app', 'version': 2}
        ]
        args = argparse.Namespace(name='my-app', file='/path/to/file.yaml')

        with mock.patch('builtins.open', mock.mock_open(read_data='new content')):
            with mock.patch('builtins.print') as mock_print:
                app._update_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('updated successfully', output)
        self.assertIn('Version', output)

    def test_update_app_success_from_editor(self):
        """Test successful app update from editor."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            'original content',
            {'name': 'my-app', 'version': 2}
        ]
        args = argparse.Namespace(name='my-app', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='new content'):
            with mock.patch('builtins.print') as mock_print:
                app._update_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('updated successfully', output)

    def test_update_app_with_version_raises_on_deleted(self):
        """Test that updating a deleted version raises an error."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = osmo_errors.OSMOUserError('Not found')
        args = argparse.Namespace(name='my-app:1', file=None)

        with self.assertRaises(osmo_errors.OSMOUserError):
            app._update_app(mock_client, args)

    def test_update_app_creates_new_when_deleted(self):
        """Test that updating a deleted app tries to create a new version."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            osmo_errors.OSMOUserError('Not found'),
            {'name': 'my-app', 'version': 1}
        ]
        args = argparse.Namespace(name='my-app', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='new content'):
            with mock.patch('builtins.print') as mock_print:
                app._update_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('Trying to create a new version', output)

    def test_update_app_saves_to_temp_on_error(self):
        """Test that content is saved to temp file on PATCH error."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            'original content',
            Exception('API Error')
        ]
        args = argparse.Namespace(name='my-app', file=None)

        with mock.patch('src.cli.editor.get_editor_input', return_value='new content'):
            with mock.patch('src.cli.editor.save_to_temp_file', return_value='/tmp/file.yaml'):
                with self.assertRaises(osmo_errors.OSMOUserError) as context:
                    app._update_app(mock_client, args)

        self.assertIn('Error editing app', str(context.exception))
        self.assertIn('/tmp/file.yaml', str(context.exception))


class TestInfoApp(unittest.TestCase):
    """Tests for _info_app function."""

    def test_info_app_json_format(self):
        """Test app info output in JSON format."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {
            'uuid': 'test-uuid',
            'owner': 'test-owner',
            'created_date': '2025-01-01T00:00:00Z',
            'description': 'Test description',
            'versions': []
        }
        args = argparse.Namespace(name='my-app', count=20, order='asc', format_type='json')

        with mock.patch('builtins.print') as mock_print:
            app._info_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('test-uuid', output)

    def test_info_app_text_format(self):
        """Test app info output in text format."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {
            'uuid': 'test-uuid',
            'owner': 'test-owner',
            'created_date': '2025-01-01T00:00:00Z',
            'description': 'Test description',
            'versions': [
                {'version': 1, 'created_by': 'user1', 'created_date': '2025-01-01T00:00:00Z', 'status': 'active'}
            ]
        }
        args = argparse.Namespace(name='my-app', count=20, order='asc', format_type='text')

        with mock.patch('builtins.print') as mock_print:
            with mock.patch('src.lib.utils.common.convert_utc_datetime_to_user_zone', return_value='2025-01-01'):
                app._info_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('Name:', output)
        self.assertIn('UUID:', output)

    def test_info_app_with_version(self):
        """Test app info with specific version."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {
            'uuid': 'test-uuid',
            'owner': 'test-owner',
            'created_date': '2025-01-01T00:00:00Z',
            'description': 'Test description',
            'versions': []
        }
        args = argparse.Namespace(name='my-app:1', count=20, order='asc', format_type='json')

        with mock.patch('builtins.print'):
            app._info_app(mock_client, args)

        call_args = mock_client.request.call_args
        self.assertIn('version', call_args.kwargs['params'])


class TestShowApp(unittest.TestCase):
    """Tests for _show_app function."""

    def test_show_app_displays_description_and_parameters(self):
        """Test that show app displays description and parameters."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'description': 'Test description'},
            'default-values:\n  key: value'
        ]
        args = argparse.Namespace(name='my-app')

        with mock.patch('src.lib.utils.workflow.fetch_default_values', return_value='key: value'):
            with mock.patch('builtins.print') as mock_print:
                app._show_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('DESCRIPTION', output)
        self.assertIn('PARAMETERS', output)

    def test_show_app_with_version(self):
        """Test show app with specific version."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'description': 'Test description'},
            'default-values:\n  key: value'
        ]
        args = argparse.Namespace(name='my-app:1')

        with mock.patch('src.lib.utils.workflow.fetch_default_values', return_value=None):
            with mock.patch('builtins.print'):
                app._show_app(mock_client, args)

        self.assertEqual(mock_client.request.call_count, 2)

    def test_show_app_no_default_values(self):
        """Test show app when there are no default values."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'description': 'Test description'},
            'spec content'
        ]
        args = argparse.Namespace(name='my-app')

        with mock.patch('src.lib.utils.workflow.fetch_default_values', return_value=None):
            with mock.patch('builtins.print') as mock_print:
                app._show_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('DESCRIPTION', output)
        self.assertNotIn('PARAMETERS', output)


class TestSpecApp(unittest.TestCase):
    """Tests for _spec_app function."""

    def test_spec_app_prints_spec(self):
        """Test that spec app prints the spec content."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = 'spec: content\ntasks:\n  - name: task1'
        args = argparse.Namespace(name='my-app')

        with mock.patch('builtins.print') as mock_print:
            app._spec_app(mock_client, args)

        mock_print.assert_called_once_with('spec: content\ntasks:\n  - name: task1')

    def test_spec_app_with_version(self):
        """Test spec app with specific version."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = 'spec content'
        args = argparse.Namespace(name='my-app:2')

        with mock.patch('builtins.print'):
            app._spec_app(mock_client, args)

        call_args = mock_client.request.call_args
        self.assertIn('version', call_args.kwargs['params'])


class TestListApps(unittest.TestCase):
    """Tests for _list_apps function."""

    def test_list_apps_json_format(self):
        """Test list apps output in JSON format."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {
            'apps': [{'name': 'app1', 'owner': 'user1'}],
            'more_entries': False
        }
        args = argparse.Namespace(
            name=None, user=None, all_users=False,
            count=20, order='asc', format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            app._list_apps(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('app1', output)

    def test_list_apps_text_format_with_apps(self):
        """Test list apps output in text format with apps."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {
            'apps': [
                {'name': 'app1', 'owner': 'user1', 'description': 'desc1',
                 'created_date': '2025-01-01T00:00:00Z', 'latest_version': 1}
            ],
            'more_entries': False
        }
        args = argparse.Namespace(
            name=None, user=None, all_users=False,
            count=20, order='asc', format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            with mock.patch('src.lib.utils.common.convert_utc_datetime_to_user_zone', return_value='2025-01-01'):
                app._list_apps(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('app1', output)

    def test_list_apps_text_format_no_apps(self):
        """Test list apps output in text format with no apps."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {
            'apps': [],
            'more_entries': False
        }
        args = argparse.Namespace(
            name=None, user=None, all_users=False,
            count=20, order='asc', format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            app._list_apps(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('no apps to view', output)

    def test_list_apps_with_filters(self):
        """Test list apps with user and name filters."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {
            'apps': [],
            'more_entries': False
        }
        args = argparse.Namespace(
            name='test', user=['user1', 'user2'], all_users=True,
            count=20, order='desc', format_type='text'
        )

        with mock.patch('builtins.print'):
            app._list_apps(mock_client, args)

        call_args = mock_client.request.call_args
        self.assertEqual(call_args.kwargs['params']['name'], 'test')
        self.assertEqual(call_args.kwargs['params']['users'], ['user1', 'user2'])
        self.assertTrue(call_args.kwargs['params']['all_users'])

    def test_list_apps_pagination(self):
        """Test list apps with pagination."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'apps': [{'name': 'app1'}], 'more_entries': True},
            {'apps': [{'name': 'app2'}], 'more_entries': False}
        ]
        args = argparse.Namespace(
            name=None, user=None, all_users=False,
            count=2000, order='asc', format_type='json'
        )

        with mock.patch('builtins.print'):
            app._list_apps(mock_client, args)

        self.assertEqual(mock_client.request.call_count, 2)


class TestDeleteApp(unittest.TestCase):
    """Tests for _delete_app function."""

    def test_delete_app_raises_error_without_version_or_all(self):
        """Test that delete raises error without version or all flag."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(name='my-app', all=False, force=True)

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            app._delete_app(mock_client, args)

        self.assertIn('Must specify a version or all_versions', str(context.exception))

    def test_delete_app_with_version_force(self):
        """Test delete app with specific version and force flag."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {'versions': [1]}
        args = argparse.Namespace(name='my-app:1', all=False, force=True)

        with mock.patch('builtins.print') as mock_print:
            app._delete_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('Delete Job', output)

    def test_delete_app_all_versions_force(self):
        """Test delete all versions with force flag."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {'versions': [1, 2]}
        args = argparse.Namespace(name='my-app', all=True, force=True)

        with mock.patch('builtins.print') as mock_print:
            app._delete_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('Delete Job', output)

    def test_delete_app_with_confirmation_yes(self):
        """Test delete app with user confirmation accepted."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {'versions': [1]}
        args = argparse.Namespace(name='my-app:1', all=False, force=False)

        with mock.patch('src.lib.utils.common.prompt_user', return_value=True):
            with mock.patch('builtins.print') as mock_print:
                app._delete_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('Delete Job', output)

    def test_delete_app_with_confirmation_no(self):
        """Test delete app with user confirmation rejected."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(name='my-app:1', all=False, force=False)

        with mock.patch('src.lib.utils.common.prompt_user', return_value=False):
            app._delete_app(mock_client, args)

        mock_client.request.assert_not_called()

    def test_delete_app_all_confirmation_prompt(self):
        """Test delete all versions confirmation prompt."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = {'versions': [1]}
        args = argparse.Namespace(name='my-app', all=True, force=False)

        with mock.patch('src.lib.utils.common.prompt_user', return_value=True) as mock_prompt:
            with mock.patch('builtins.print'):
                app._delete_app(mock_client, args)

        prompt_arg = mock_prompt.call_args[0][0]
        self.assertIn('all versions', prompt_arg)


class TestRenameApp(unittest.TestCase):
    """Tests for _rename_app function."""

    def test_rename_app_raises_error_with_original_version(self):
        """Test that renaming with version in original name raises error."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(original_name='my-app:1', new_name='new-app', force=True)

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            app._rename_app(mock_client, args)

        self.assertIn('Cannot rename a specific version', str(context.exception))

    def test_rename_app_raises_error_with_new_version(self):
        """Test that renaming to a version name raises error."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(original_name='my-app', new_name='new-app:1', force=True)

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            app._rename_app(mock_client, args)

        self.assertIn('Cannot rename to a specific version', str(context.exception))

    def test_rename_app_success_with_force(self):
        """Test successful rename with force flag."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = 'new-app'
        args = argparse.Namespace(original_name='old-app', new_name='new-app', force=True)

        with mock.patch('builtins.print') as mock_print:
            app._rename_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('renamed to', output)
        self.assertIn('successfully', output)

    def test_rename_app_with_confirmation_yes(self):
        """Test rename with user confirmation accepted."""
        mock_client = mock.MagicMock()
        mock_client.request.return_value = 'new-app'
        args = argparse.Namespace(original_name='old-app', new_name='new-app', force=False)

        with mock.patch('src.lib.utils.common.prompt_user', return_value=True):
            with mock.patch('builtins.print') as mock_print:
                app._rename_app(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('renamed to', output)

    def test_rename_app_with_confirmation_no(self):
        """Test rename with user confirmation rejected."""
        mock_client = mock.MagicMock()
        args = argparse.Namespace(original_name='old-app', new_name='new-app', force=False)

        with mock.patch('src.lib.utils.common.prompt_user', return_value=False):
            app._rename_app(mock_client, args)

        mock_client.request.assert_not_called()


class TestSubmitApp(unittest.TestCase):
    """Tests for _submit_app function."""

    def test_submit_app_fetches_default_pool_when_not_specified(self):
        """Test that submit fetches default pool when not specified."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'uuid': 'app-uuid', 'versions': [{'version': 1}]},
            'spec content'
        ]
        args = argparse.Namespace(
            name='my-app',
            pool=None,
            priority=None,
            set=[],
            set_string=[],
            set_env=[],
            local_path=None,
            dry=False,
            format_type='text',
            rsync=None
        )

        with mock.patch('src.cli.pool.fetch_default_pool', return_value='default-pool') as mock_fetch:
            with mock.patch('src.cli.workflow.parse_file_for_template', return_value={}):
                with mock.patch('src.cli.workflow.submit_workflow_helper'):
                    with mock.patch('os.getcwd', return_value='/current/dir'):
                        app._submit_app(mock_client, args)

        mock_fetch.assert_called_once()

    def test_submit_app_with_version(self):
        """Test submit app with specific version."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'uuid': 'app-uuid', 'versions': [{'version': 2}]},
            'spec content'
        ]
        args = argparse.Namespace(
            name='my-app:2',
            pool='my-pool',
            priority='HIGH',
            set=['key=val'],
            set_string=['str=strval'],
            set_env=[],
            local_path='/custom/path',
            dry=False,
            format_type='text',
            rsync=None
        )

        with mock.patch('src.cli.workflow.parse_file_for_template', return_value={'key': 'val'}):
            with mock.patch('src.cli.workflow.submit_workflow_helper') as mock_submit:
                app._submit_app(mock_client, args)

        call_args = mock_submit.call_args
        self.assertEqual(call_args[0][3], '/custom/path')
        self.assertIn('priority', call_args[0][4])

    def test_submit_app_uses_cwd_when_no_local_path(self):
        """Test submit app uses current working directory when no local path."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'uuid': 'app-uuid', 'versions': [{'version': 1}]},
            'spec content'
        ]
        args = argparse.Namespace(
            name='my-app',
            pool='my-pool',
            priority=None,
            set=[],
            set_string=[],
            set_env=[],
            local_path=None,
            dry=False,
            format_type='text',
            rsync=None
        )

        with mock.patch('src.cli.workflow.parse_file_for_template', return_value={}):
            with mock.patch('src.cli.workflow.submit_workflow_helper') as mock_submit:
                with mock.patch('os.getcwd', return_value='/test/cwd'):
                    app._submit_app(mock_client, args)

        call_args = mock_submit.call_args
        self.assertEqual(call_args[0][3], '/test/cwd')

    def test_submit_app_passes_priority(self):
        """Test submit app passes priority parameter."""
        mock_client = mock.MagicMock()
        mock_client.request.side_effect = [
            {'uuid': 'app-uuid', 'versions': [{'version': 1}]},
            'spec content'
        ]
        args = argparse.Namespace(
            name='my-app',
            pool='my-pool',
            priority='LOW',
            set=[],
            set_string=[],
            set_env=[],
            local_path='/path',
            dry=False,
            format_type='text',
            rsync=None
        )

        with mock.patch('src.cli.workflow.parse_file_for_template', return_value={}):
            with mock.patch('src.cli.workflow.submit_workflow_helper') as mock_submit:
                app._submit_app(mock_client, args)

        call_args = mock_submit.call_args
        self.assertEqual(call_args[0][4]['priority'], 'LOW')


if __name__ == '__main__':
    unittest.main()
