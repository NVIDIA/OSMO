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

        # Parse a valid command to verify structure
        args = parser.parse_args(['token', 'list'])
        self.assertEqual(args.command, 'list')

    def test_setup_parser_set_command_with_defaults(self):
        """Test that set command has correct defaults."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'set', 'my-token'])
        self.assertEqual(args.name, 'my-token')
        self.assertEqual(args.format_type, 'text')
        self.assertIsNone(args.description)
        self.assertIsNone(args.user)
        self.assertIsNone(args.roles)

    def test_setup_parser_set_command_with_all_options(self):
        """Test that set command parses all options correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args([
            'token', 'set', 'my-token',
            '--expires-at', '2026-05-01',
            '--description', 'Test description',
            '--user', 'user@example.com',
            '--roles', 'role1', 'role2',
            '--format-type', 'json'
        ])
        self.assertEqual(args.name, 'my-token')
        self.assertEqual(args.expires_at, '2026-05-01')
        self.assertEqual(args.description, 'Test description')
        self.assertEqual(args.user, 'user@example.com')
        self.assertEqual(args.roles, ['role1', 'role2'])
        self.assertEqual(args.format_type, 'json')

    def test_setup_parser_delete_command(self):
        """Test that delete command parses correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'delete', 'my-token', '--user', 'admin@example.com'])
        self.assertEqual(args.name, 'my-token')
        self.assertEqual(args.user, 'admin@example.com')

    def test_setup_parser_list_command(self):
        """Test that list command parses correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'list', '--user', 'user@example.com', '-t', 'json'])
        self.assertEqual(args.user, 'user@example.com')
        self.assertEqual(args.format_type, 'json')

    def test_setup_parser_roles_command(self):
        """Test that roles command parses correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'roles', 'my-token', '-t', 'json'])
        self.assertEqual(args.name, 'my-token')
        self.assertEqual(args.format_type, 'json')


class TestSetToken(unittest.TestCase):
    """Tests for _set_token function."""

    def test_set_token_invalid_name_raises_error(self):
        """Test that invalid token name raises OSMOUserError."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        args = argparse.Namespace(
            name='invalid name with spaces!',
            expires_at='2026-05-01',
            description=None,
            user=None,
            roles=None,
            format_type='text'
        )

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            access_token._set_token(mock_client, args)

        self.assertIn('invalid name with spaces!', str(context.exception))

    def test_set_token_for_current_user_text_format(self):
        """Test creating token for current user with text output."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'generated-token-value'
        args = argparse.Namespace(
            name='my-token',
            expires_at='2026-05-01',
            description=None,
            user=None,
            roles=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/access_token/my-token',
            payload=None,
            params={'expires_at': '2026-05-01'}
        )
        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('generated-token-value', output)
        self.assertIn('Save the token', output)

    def test_set_token_for_specific_user_text_format(self):
        """Test creating token for specific user (admin) with text output."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'admin-created-token'
        args = argparse.Namespace(
            name='service-token',
            expires_at='2026-05-01',
            description='Service account token',
            user='service@example.com',
            roles=['role1', 'role2'],
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/user/service@example.com/access_token/service-token',
            payload=None,
            params={
                'expires_at': '2026-05-01',
                'description': 'Service account token',
                'roles': ['role1', 'role2']
            }
        )
        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('admin-created-token', output)
        self.assertIn('service@example.com', output)
        self.assertIn('role1', output)

    def test_set_token_json_format(self):
        """Test creating token with JSON output format."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'json-token-value'
        args = argparse.Namespace(
            name='my-token',
            expires_at='2026-05-01',
            description=None,
            user=None,
            roles=None,
            format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(mock_client, args)

        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        parsed = json.loads(printed_output)
        self.assertEqual(parsed['token'], 'json-token-value')


class TestDeleteToken(unittest.TestCase):
    """Tests for _delete_token function."""

    def test_delete_token_for_current_user(self):
        """Test deleting token for current user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
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
        """Test deleting token for specific user (admin)."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
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

    def test_list_tokens_empty_for_current_user(self):
        """Test listing tokens when none exist for current user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = []
        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/access_token'
        )
        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('No tokens found', output)

    def test_list_tokens_empty_for_specific_user(self):
        """Test listing tokens when none exist for specific user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = []
        args = argparse.Namespace(
            user='empty@example.com',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/user/empty@example.com/access_token'
        )
        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('No tokens found', output)
        self.assertIn('empty@example.com', output)

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_text_format_with_active_token(self, mock_datetime):
        """Test listing tokens in text format with active token."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2025, 1, 1)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'active-token',
                'description': 'Test token',
                'expires_at': '2026-05-01T00:00:00Z',
                'roles': ['admin', 'user']
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
        """Test listing tokens in text format with expired token."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2027, 1, 1)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'expired-token',
                'description': 'Old token',
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

    def test_list_tokens_json_format(self):
        """Test listing tokens in JSON format."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'json-token',
                'description': 'JSON test',
                'expires_at': '2026-05-01T00:00:00Z',
                'roles': ['role1']
            }
        ]
        args = argparse.Namespace(
            user=None,
            format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        parsed = json.loads(printed_output)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]['token_name'], 'json-token')

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_for_specific_user_text_format(self, mock_datetime):
        """Test listing tokens for specific user in text format."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2025, 1, 1)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'user-token',
                'description': None,
                'expires_at': '2026-05-01T00:00:00Z',
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
        self.assertIn('user-token', output)


class TestListTokenRoles(unittest.TestCase):
    """Tests for _list_token_roles function."""

    def test_list_token_roles_text_format_with_roles(self):
        """Test listing token roles in text format when roles exist."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {
                    'role_name': 'admin',
                    'assigned_by': 'system',
                    'assigned_at': '2025-01-15T10:30:00Z'
                },
                {
                    'role_name': 'user',
                    'assigned_by': 'admin@example.com',
                    'assigned_at': '2025-01-16T14:00:00Z'
                }
            ]
        }
        args = argparse.Namespace(
            name='my-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/access_token/my-token/roles'
        )
        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('my-token', output)
        self.assertIn('user@example.com', output)
        self.assertIn('admin', output)
        self.assertIn('2025-01-15', output)

    def test_list_token_roles_text_format_no_roles(self):
        """Test listing token roles in text format when no roles exist."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
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

    def test_list_token_roles_json_format(self):
        """Test listing token roles in JSON format."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'json-token',
            'user_name': 'user@example.com',
            'roles': [{'role_name': 'viewer', 'assigned_by': 'admin', 'assigned_at': '2025-01-01'}]
        }
        args = argparse.Namespace(
            name='json-token',
            format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        parsed = json.loads(printed_output)
        self.assertEqual(parsed['token_name'], 'json-token')
        self.assertEqual(len(parsed['roles']), 1)

    def test_list_token_roles_with_missing_assigned_at(self):
        """Test listing token roles when assigned_at is missing."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'partial-token',
            'user_name': 'user@example.com',
            'roles': [
                {
                    'role_name': 'legacy-role',
                    'assigned_by': 'unknown',
                    'assigned_at': None
                }
            ]
        }
        args = argparse.Namespace(
            name='partial-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('legacy-role', output)

    def test_list_token_roles_with_default_assigned_at_dash(self):
        """Test listing token roles when assigned_at is dash placeholder."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'dash-token',
            'user_name': 'user@example.com',
            'roles': [
                {
                    'role_name': 'dash-role',
                    'assigned_by': 'system',
                    'assigned_at': '-'
                }
            ]
        }
        args = argparse.Namespace(
            name='dash-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('dash-role', output)

    def test_list_token_roles_uses_args_name_when_token_name_missing(self):
        """Test that args.name is used when token_name is not in response."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'user_name': 'user@example.com',
            'roles': []
        }
        args = argparse.Namespace(
            name='fallback-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('fallback-token', output)

    def test_list_token_roles_uses_dash_when_user_name_missing(self):
        """Test that dash is used when user_name is not in response."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'orphan-token',
            'roles': []
        }
        args = argparse.Namespace(
            name='orphan-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = ' '.join(str(call) for call in mock_print.call_args_list)
        self.assertIn('Owner: -', output)


class TestSetTokenWithDescription(unittest.TestCase):
    """Additional tests for _set_token with description parameter."""

    def test_set_token_with_description_only(self):
        """Test creating token with description but no roles."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'desc-token-value'
        args = argparse.Namespace(
            name='desc-token',
            expires_at='2026-05-01',
            description='My description',
            user=None,
            roles=None,
            format_type='text'
        )

        with mock.patch('builtins.print'):
            access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/access_token/desc-token',
            payload=None,
            params={'expires_at': '2026-05-01', 'description': 'My description'}
        )


if __name__ == '__main__':
    unittest.main()
