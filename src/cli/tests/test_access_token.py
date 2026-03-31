# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

"""Unit tests for src/cli/access_token.py"""

import argparse
import datetime
import json
import unittest
from unittest import mock

from src.cli import access_token
from src.lib.utils import client, osmo_errors


class TestSetupParser(unittest.TestCase):
    """Tests for setup_parser function."""

    def test_setup_parser_creates_token_subparser(self):
        """Test that setup_parser creates the token subparser with required subcommands."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        # Parse a valid command to verify setup
        args = parser.parse_args(['token', 'list'])
        self.assertEqual(args.command, 'list')

    def test_setup_parser_set_command_with_all_options(self):
        """Test that set command accepts all expected arguments."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args([
            'token', 'set', 'my-token',
            '--expires-at', '2026-05-01',
            '--description', 'Test description',
            '--user', 'test@example.com',
            '--roles', 'role1', 'role2',
            '--format-type', 'json'
        ])

        self.assertEqual(args.name, 'my-token')
        self.assertEqual(args.expires_at, '2026-05-01')
        self.assertEqual(args.description, 'Test description')
        self.assertEqual(args.user, 'test@example.com')
        self.assertEqual(args.roles, ['role1', 'role2'])
        self.assertEqual(args.format_type, 'json')

    def test_setup_parser_delete_command_with_user(self):
        """Test that delete command accepts user argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args([
            'token', 'delete', 'old-token',
            '--user', 'other@example.com'
        ])

        self.assertEqual(args.name, 'old-token')
        self.assertEqual(args.user, 'other@example.com')

    def test_setup_parser_list_command_with_format_type(self):
        """Test that list command accepts format-type argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args([
            'token', 'list',
            '--format-type', 'json',
            '--user', 'admin@example.com'
        ])

        self.assertEqual(args.format_type, 'json')
        self.assertEqual(args.user, 'admin@example.com')

    def test_setup_parser_roles_command(self):
        """Test that roles command is properly configured."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args([
            'token', 'roles', 'my-token',
            '--format-type', 'text'
        ])

        self.assertEqual(args.name, 'my-token')
        self.assertEqual(args.format_type, 'text')


class TestSetToken(unittest.TestCase):
    """Tests for _set_token function."""

    def test_set_token_invalid_name_raises_error(self):
        """Test that invalid token name raises OSMOUserError."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            name='invalid name with spaces!',
            expires_at='2026-05-01',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            access_token._set_token(mock_client, args)

        self.assertIn('invalid name with spaces!', str(context.exception))

    def test_set_token_for_current_user_text_format(self):
        """Test creating token for current user with text output."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = 'generated-token-value'
        args = argparse.Namespace(
            name='my-token',
            expires_at='2026-05-01',
            description='Test token',
            roles=None,
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/access_token/my-token',
            payload=None,
            params={'expires_at': '2026-05-01', 'description': 'Test token'}
        )
        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('generated-token-value', output)
        self.assertIn('Save the token', output)

    def test_set_token_for_specific_user_with_roles(self):
        """Test creating token for specific user with roles."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = 'admin-generated-token'
        args = argparse.Namespace(
            name='service-token',
            expires_at='2026-12-31',
            description=None,
            roles=['role1', 'role2'],
            user='service@example.com',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/user/service@example.com/access_token/service-token',
            payload=None,
            params={'expires_at': '2026-12-31', 'roles': ['role1', 'role2']}
        )
        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('service@example.com', output)
        self.assertIn('role1', output)

    def test_set_token_json_format(self):
        """Test creating token with JSON output format."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = 'json-token-value'
        args = argparse.Namespace(
            name='json-token',
            expires_at='2026-05-01',
            description=None,
            roles=None,
            user=None,
            format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('json-token-value', output)
        self.assertIn('token', output)


class TestDeleteToken(unittest.TestCase):
    """Tests for _delete_token function."""

    def test_delete_token_for_current_user(self):
        """Test deleting token for current user."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            name='old-token',
            user=None
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._delete_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.DELETE,
            'api/auth/access_token/old-token',
            payload=None,
            params=None
        )
        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('old-token', output)
        self.assertIn('deleted', output)

    def test_delete_token_for_specific_user(self):
        """Test deleting token for specific user as admin."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            name='user-token',
            user='other@example.com'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._delete_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.DELETE,
            'api/auth/user/other@example.com/access_token/user-token',
            payload=None,
            params=None
        )
        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('user-token', output)
        self.assertIn('other@example.com', output)


class TestListTokens(unittest.TestCase):
    """Tests for _list_tokens function."""

    def test_list_tokens_empty_result_for_current_user(self):
        """Test listing tokens when no tokens exist for current user."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = []
        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('No tokens found', output)

    def test_list_tokens_empty_result_for_specific_user(self):
        """Test listing tokens when no tokens exist for specific user."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = []
        args = argparse.Namespace(
            user='empty@example.com',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('No tokens found', output)
        self.assertIn('empty@example.com', output)

    def test_list_tokens_json_format(self):
        """Test listing tokens with JSON output format."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {'token_name': 'token1', 'expires_at': '2026-05-01T00:00:00Z', 'roles': ['admin']}
        ]
        args = argparse.Namespace(
            user=None,
            format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('token1', output)

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_text_format_with_active_token(self, mock_datetime):
        """Test listing active tokens with text output format."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2025, 1, 1)
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'active-token',
                'description': 'Test description',
                'expires_at': '2026-05-01T00:00:00Z',
                'roles': ['role1', 'role2']
            }
        ]
        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('active-token', output)
        self.assertIn('Active', output)

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_text_format_with_expired_token(self, mock_datetime):
        """Test listing expired tokens with text output format."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2027, 1, 1)
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'expired-token',
                'description': None,
                'expires_at': '2026-05-01T00:00:00Z',
                'roles': []
            }
        ]
        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('expired-token', output)
        self.assertIn('Expired', output)

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_for_specific_user_text_format(self, mock_datetime):
        """Test listing tokens for specific user with text format."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2025, 1, 1)
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'user-token',
                'expires_at': '2026-12-31T00:00:00Z',
                'roles': None
            }
        ]
        args = argparse.Namespace(
            user='specific@example.com',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/user/specific@example.com/access_token'
        )
        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('specific@example.com', output)


class TestListTokenRoles(unittest.TestCase):
    """Tests for _list_token_roles function."""

    def test_list_token_roles_json_format(self):
        """Test listing token roles with JSON output format."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {'role_name': 'admin', 'assigned_by': 'system', 'assigned_at': '2025-01-01T00:00:00Z'}
            ]
        }
        args = argparse.Namespace(
            name='my-token',
            format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('my-token', output)
        self.assertIn('admin', output)

    def test_list_token_roles_text_format_with_roles(self):
        """Test listing token roles with text output format when roles exist."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'role-token',
            'user_name': 'owner@example.com',
            'roles': [
                {'role_name': 'editor', 'assigned_by': 'admin@example.com', 'assigned_at': '2025-03-15T10:30:00Z'},
                {'role_name': 'viewer', 'assigned_by': 'admin@example.com', 'assigned_at': None}
            ]
        }
        args = argparse.Namespace(
            name='role-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('role-token', output)
        self.assertIn('owner@example.com', output)
        self.assertIn('editor', output)
        self.assertIn('2025-03-15', output)

    def test_list_token_roles_text_format_no_roles(self):
        """Test listing token roles with text output format when no roles exist."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'empty-token',
            'user_name': 'user@example.com',
            'roles': []
        }
        args = argparse.Namespace(
            name='empty-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('empty-token', output)
        self.assertIn('Roles: None', output)

    def test_list_token_roles_text_format_missing_fields(self):
        """Test listing token roles when response has missing optional fields."""
        mock_client = mock.Mock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'roles': [
                {'role_name': 'basic', 'assigned_by': 'system', 'assigned_at': '-'}
            ]
        }
        args = argparse.Namespace(
            name='minimal-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/access_token/minimal-token/roles'
        )
        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('minimal-token', output)
        self.assertIn('basic', output)


if __name__ == '__main__':
    unittest.main()
