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

        # Parse a valid command to verify parser was set up correctly
        args = parser.parse_args(['token', 'list'])
        self.assertEqual(args.command, 'list')

    def test_setup_parser_set_command_with_name(self):
        """Test that set command accepts name argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'set', 'my-token'])
        self.assertEqual(args.name, 'my-token')
        self.assertEqual(args.command, 'set')

    def test_setup_parser_set_command_with_expires_at(self):
        """Test that set command accepts expires-at argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'set', 'my-token', '--expires-at', '2026-05-01'])
        self.assertEqual(args.expires_at, '2026-05-01')

    def test_setup_parser_set_command_with_description(self):
        """Test that set command accepts description argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'set', 'my-token', '-d', 'My description'])
        self.assertEqual(args.description, 'My description')

    def test_setup_parser_set_command_with_user(self):
        """Test that set command accepts user argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'set', 'my-token', '--user', 'admin@example.com'])
        self.assertEqual(args.user, 'admin@example.com')

    def test_setup_parser_set_command_with_roles(self):
        """Test that set command accepts multiple roles."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'set', 'my-token', '-r', 'role1', 'role2'])
        self.assertEqual(args.roles, ['role1', 'role2'])

    def test_setup_parser_set_command_with_json_format(self):
        """Test that set command accepts format-type argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'set', 'my-token', '-t', 'json'])
        self.assertEqual(args.format_type, 'json')

    def test_setup_parser_delete_command(self):
        """Test that delete command is configured correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'delete', 'my-token'])
        self.assertEqual(args.command, 'delete')
        self.assertEqual(args.name, 'my-token')

    def test_setup_parser_delete_command_with_user(self):
        """Test that delete command accepts user argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'delete', 'my-token', '-u', 'user@example.com'])
        self.assertEqual(args.user, 'user@example.com')

    def test_setup_parser_list_command(self):
        """Test that list command is configured correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'list'])
        self.assertEqual(args.command, 'list')

    def test_setup_parser_list_command_with_user(self):
        """Test that list command accepts user argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'list', '--user', 'user@example.com'])
        self.assertEqual(args.user, 'user@example.com')

    def test_setup_parser_list_command_with_json_format(self):
        """Test that list command accepts format-type argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'list', '-t', 'json'])
        self.assertEqual(args.format_type, 'json')

    def test_setup_parser_roles_command(self):
        """Test that roles command is configured correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'roles', 'my-token'])
        self.assertEqual(args.command, 'roles')
        self.assertEqual(args.name, 'my-token')

    def test_setup_parser_roles_command_with_json_format(self):
        """Test that roles command accepts format-type argument."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'roles', 'my-token', '-t', 'json'])
        self.assertEqual(args.format_type, 'json')


class TestSetToken(unittest.TestCase):
    """Tests for _set_token function."""

    def test_set_token_invalid_name_raises_error(self):
        """Test that invalid token name raises OSMOUserError."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        args = argparse.Namespace(
            name='invalid name with spaces',
            expires_at='2026-05-01',
            description=None,
            user=None,
            roles=None,
            format_type='text'
        )

        with self.assertRaises(osmo_errors.OSMOUserError):
            access_token._set_token(mock_client, args)

    @mock.patch('builtins.print')
    def test_set_token_for_current_user_text_format(self, mock_print):
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

        access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/access_token/my-token',
            payload=None,
            params={'expires_at': '2026-05-01'}
        )
        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('generated-token-value', output)
        self.assertIn('Save the token', output)

    @mock.patch('builtins.print')
    def test_set_token_for_specific_user_text_format(self, mock_print):
        """Test creating token for specific user (admin API)."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'admin-generated-token'
        args = argparse.Namespace(
            name='service-token',
            expires_at='2026-05-01',
            description=None,
            user='service@example.com',
            roles=None,
            format_type='text'
        )

        access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/user/service@example.com/access_token/service-token',
            payload=None,
            params={'expires_at': '2026-05-01'}
        )
        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('service@example.com', output)

    @mock.patch('builtins.print')
    def test_set_token_with_description_and_roles(self, mock_print):
        """Test creating token with description and roles."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'token-with-roles'
        args = argparse.Namespace(
            name='my-token',
            expires_at='2026-05-01',
            description='My token description',
            user=None,
            roles=['role1', 'role2'],
            format_type='text'
        )

        access_token._set_token(mock_client, args)

        call_args = mock_client.request.call_args
        self.assertEqual(call_args[1]['params']['description'], 'My token description')
        self.assertEqual(call_args[1]['params']['roles'], ['role1', 'role2'])
        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('role1, role2', output)

    @mock.patch('builtins.print')
    def test_set_token_json_format(self, mock_print):
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

        access_token._set_token(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('"token"', output)
        self.assertIn('json-token-value', output)


class TestDeleteToken(unittest.TestCase):
    """Tests for _delete_token function."""

    @mock.patch('builtins.print')
    def test_delete_token_for_current_user(self, mock_print):
        """Test deleting token for current user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        args = argparse.Namespace(
            name='my-token',
            user=None
        )

        access_token._delete_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.DELETE,
            'api/auth/access_token/my-token',
            payload=None,
            params=None
        )
        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('my-token deleted', output)

    @mock.patch('builtins.print')
    def test_delete_token_for_specific_user(self, mock_print):
        """Test deleting token for specific user (admin API)."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        args = argparse.Namespace(
            name='old-token',
            user='other-user@example.com'
        )

        access_token._delete_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.DELETE,
            'api/auth/user/other-user@example.com/access_token/old-token',
            payload=None,
            params=None
        )
        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('old-token deleted for user other-user@example.com', output)


class TestListTokens(unittest.TestCase):
    """Tests for _list_tokens function."""

    @mock.patch('builtins.print')
    def test_list_tokens_empty_for_current_user(self, mock_print):
        """Test listing tokens when none exist for current user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = []
        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        access_token._list_tokens(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/access_token'
        )
        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('No tokens found', output)

    @mock.patch('builtins.print')
    def test_list_tokens_empty_for_specific_user(self, mock_print):
        """Test listing tokens when none exist for specific user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = []
        args = argparse.Namespace(
            user='user@example.com',
            format_type='text'
        )

        access_token._list_tokens(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/user/user@example.com/access_token'
        )
        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('No tokens found for user user@example.com', output)

    @mock.patch('builtins.print')
    def test_list_tokens_json_format(self, mock_print):
        """Test listing tokens with JSON output format."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {'token_name': 'token1', 'expires_at': '2026-05-01T00:00:00', 'roles': ['admin']}
        ]
        args = argparse.Namespace(
            user=None,
            format_type='json'
        )

        access_token._list_tokens(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('token1', output)

    @mock.patch('src.cli.access_token.datetime')
    @mock.patch('builtins.print')
    def test_list_tokens_text_format_with_active_token(self, mock_print, mock_datetime):
        """Test listing active tokens in text format."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2025, 1, 1)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'active-token',
                'description': 'Test description',
                'expires_at': '2026-05-01T00:00:00',
                'roles': ['role1', 'role2']
            }
        ]
        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        access_token._list_tokens(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('active-token', output)

    @mock.patch('src.cli.access_token.datetime')
    @mock.patch('builtins.print')
    def test_list_tokens_text_format_with_expired_token(self, mock_print, mock_datetime):
        """Test listing expired tokens in text format."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2027, 1, 1)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'expired-token',
                'description': None,
                'expires_at': '2026-05-01T00:00:00',
                'roles': []
            }
        ]
        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        access_token._list_tokens(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('expired-token', output)

    @mock.patch('src.cli.access_token.datetime')
    @mock.patch('builtins.print')
    def test_list_tokens_for_specific_user_text_format(self, mock_print, mock_datetime):
        """Test listing tokens for specific user in text format."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2025, 1, 1)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'user-token',
                'description': 'User token',
                'expires_at': '2026-05-01T00:00:00',
                'roles': ['viewer']
            }
        ]
        args = argparse.Namespace(
            user='specific-user@example.com',
            format_type='text'
        )

        access_token._list_tokens(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('Tokens for user: specific-user@example.com', output)


class TestListTokenRoles(unittest.TestCase):
    """Tests for _list_token_roles function."""

    @mock.patch('builtins.print')
    def test_list_token_roles_json_format(self, mock_print):
        """Test listing token roles with JSON output format."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {'role_name': 'admin', 'assigned_by': 'system', 'assigned_at': '2025-01-01T00:00:00'}
            ]
        }
        args = argparse.Namespace(
            name='my-token',
            format_type='json'
        )

        access_token._list_token_roles(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/access_token/my-token/roles'
        )
        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('my-token', output)
        self.assertIn('admin', output)

    @mock.patch('builtins.print')
    def test_list_token_roles_text_format_with_roles(self, mock_print):
        """Test listing token roles in text format with roles present."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {'role_name': 'admin', 'assigned_by': 'system', 'assigned_at': '2025-01-01T00:00:00'},
                {'role_name': 'viewer', 'assigned_by': 'admin', 'assigned_at': '2025-02-01T12:00:00'}
            ]
        }
        args = argparse.Namespace(
            name='my-token',
            format_type='text'
        )

        access_token._list_token_roles(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('Token: my-token', output)
        self.assertIn('Owner: user@example.com', output)
        self.assertIn('admin', output)
        self.assertIn('viewer', output)
        self.assertIn('2025-01-01', output)

    @mock.patch('builtins.print')
    def test_list_token_roles_text_format_no_roles(self, mock_print):
        """Test listing token roles in text format with no roles."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': []
        }
        args = argparse.Namespace(
            name='my-token',
            format_type='text'
        )

        access_token._list_token_roles(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('Token: my-token', output)
        self.assertIn('Roles: None', output)

    @mock.patch('builtins.print')
    def test_list_token_roles_text_format_missing_assigned_at(self, mock_print):
        """Test listing token roles when assigned_at is missing."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {'role_name': 'admin', 'assigned_by': 'system', 'assigned_at': None}
            ]
        }
        args = argparse.Namespace(
            name='my-token',
            format_type='text'
        )

        access_token._list_token_roles(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('admin', output)

    @mock.patch('builtins.print')
    def test_list_token_roles_text_format_fallback_to_args_name(self, mock_print):
        """Test listing token roles when token_name not in response."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'roles': []
        }
        args = argparse.Namespace(
            name='fallback-token',
            format_type='text'
        )

        access_token._list_token_roles(mock_client, args)

        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn('Token: fallback-token', output)
        self.assertIn('Owner: -', output)


if __name__ == '__main__':
    unittest.main()
