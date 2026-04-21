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

import argparse
import datetime
import unittest
from unittest import mock

from src.cli import access_token
from src.lib.utils import client, osmo_errors


class TestSetupParser(unittest.TestCase):
    """Test cases for setup_parser function."""

    def setUp(self):
        self.parser = argparse.ArgumentParser()
        self.subparsers = self.parser.add_subparsers()

    def test_setup_parser_creates_token_subcommand(self):
        """Test that setup_parser creates the token subcommand."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'list'])
        self.assertEqual(args.command, 'list')

    def test_setup_parser_set_command_with_name(self):
        """Test that set command requires name argument."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'set', 'my-token'])
        self.assertEqual(args.name, 'my-token')
        self.assertEqual(args.format_type, 'text')

    def test_setup_parser_set_command_with_description(self):
        """Test that set command accepts description option."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'set', 'my-token', '-d', 'My description'])
        self.assertEqual(args.description, 'My description')

    def test_setup_parser_set_command_with_user(self):
        """Test that set command accepts user option."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'set', 'my-token', '-u', 'user@example.com'])
        self.assertEqual(args.user, 'user@example.com')

    def test_setup_parser_set_command_with_roles(self):
        """Test that set command accepts multiple roles."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'set', 'my-token', '-r', 'role1', 'role2'])
        self.assertEqual(args.roles, ['role1', 'role2'])

    def test_setup_parser_set_command_with_json_format(self):
        """Test that set command accepts json format type."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'set', 'my-token', '-t', 'json'])
        self.assertEqual(args.format_type, 'json')

    def test_setup_parser_delete_command_with_name(self):
        """Test that delete command requires name argument."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'delete', 'my-token'])
        self.assertEqual(args.name, 'my-token')

    def test_setup_parser_delete_command_with_user(self):
        """Test that delete command accepts user option."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'delete', 'my-token', '-u', 'user@example.com'])
        self.assertEqual(args.user, 'user@example.com')

    def test_setup_parser_list_command(self):
        """Test that list command is available."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'list'])
        self.assertEqual(args.command, 'list')
        self.assertEqual(args.format_type, 'text')

    def test_setup_parser_list_command_with_user(self):
        """Test that list command accepts user option."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'list', '-u', 'user@example.com'])
        self.assertEqual(args.user, 'user@example.com')

    def test_setup_parser_list_command_with_json_format(self):
        """Test that list command accepts json format type."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'list', '-t', 'json'])
        self.assertEqual(args.format_type, 'json')

    def test_setup_parser_roles_command_with_name(self):
        """Test that roles command requires name argument."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'roles', 'my-token'])
        self.assertEqual(args.name, 'my-token')
        self.assertEqual(args.format_type, 'text')

    def test_setup_parser_roles_command_with_json_format(self):
        """Test that roles command accepts json format type."""
        access_token.setup_parser(self.subparsers)

        args = self.parser.parse_args(['token', 'roles', 'my-token', '-t', 'json'])
        self.assertEqual(args.format_type, 'json')


class TestSetTokenViaParser(unittest.TestCase):
    """Test cases for set token command via parser."""

    def setUp(self):
        self.parser = argparse.ArgumentParser()
        self.subparsers = self.parser.add_subparsers()
        access_token.setup_parser(self.subparsers)

    def test_set_token_invalid_name_with_leading_underscore_raises_error(self):
        """Test that token name starting with underscore raises OSMOUserError."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        args = self.parser.parse_args([
            'token', 'set', '_invalid', '-e', '2026-05-01'
        ])

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            args.func(mock_client, args)

        self.assertIn('_invalid', str(context.exception))

    def test_set_token_invalid_name_with_trailing_underscore_raises_error(self):
        """Test that token name ending with underscore raises OSMOUserError."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        args = self.parser.parse_args([
            'token', 'set', 'invalid_', '-e', '2026-05-01'
        ])

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            args.func(mock_client, args)

        self.assertIn('invalid_', str(context.exception))

    def test_set_token_invalid_name_starting_with_digit_raises_error(self):
        """Test that token name starting with digit raises OSMOUserError."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        args = self.parser.parse_args([
            'token', 'set', '1invalid', '-e', '2026-05-01'
        ])

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            args.func(mock_client, args)

        self.assertIn('1invalid', str(context.exception))

    def test_set_token_invalid_name_with_special_char_raises_error(self):
        """Test that token name with special characters raises OSMOUserError."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        args = self.parser.parse_args([
            'token', 'set', 'a@b', '-e', '2026-05-01'
        ])

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            args.func(mock_client, args)

        self.assertIn('a@b', str(context.exception))

    def test_set_token_valid_single_char_name(self):
        """Test that single character token name is valid."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'token-secret-value'
        args = self.parser.parse_args([
            'token', 'set', 'a', '-e', '2026-05-01'
        ])

        with mock.patch('builtins.print'):
            args.func(mock_client, args)

        mock_client.request.assert_called_once()

    def test_set_token_valid_name_with_hyphen_and_underscore(self):
        """Test that token name with hyphen and underscore is valid."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'token-secret-value'
        args = self.parser.parse_args([
            'token', 'set', 'my-token_v2', '-e', '2026-05-01'
        ])

        with mock.patch('builtins.print'):
            args.func(mock_client, args)

        mock_client.request.assert_called_once()

    def test_set_token_invalid_name_raises_error(self):
        """Test that invalid token name raises OSMOUserError."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        args = self.parser.parse_args([
            'token', 'set', 'invalid name with spaces', '-e', '2026-05-01'
        ])

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            args.func(mock_client, args)

        self.assertIn('invalid name with spaces', str(context.exception))

    def test_set_token_for_current_user_text_format(self):
        """Test creating token for current user with text output."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'token-secret-value'
        args = self.parser.parse_args([
            'token', 'set', 'my-token', '-e', '2026-05-01'
        ])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/access_token/my-token',
            payload=None,
            params={'expires_at': '2026-05-01'}
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('token-secret-value', output)
        self.assertIn('Save the token in a secure location', output)

    def test_set_token_for_specific_user_text_format(self):
        """Test creating token for specific user with text output."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'token-secret-value'
        args = self.parser.parse_args([
            'token', 'set', 'my-token', '-e', '2026-05-01', '-u', 'user@example.com'
        ])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/user/user@example.com/access_token/my-token',
            payload=None,
            params={'expires_at': '2026-05-01'}
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('user@example.com', output)

    def test_set_token_with_description(self):
        """Test creating token with description."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'token-secret-value'
        args = self.parser.parse_args([
            'token', 'set', 'my-token', '-e', '2026-05-01', '-d', 'My token description'
        ])

        with mock.patch('builtins.print'):
            args.func(mock_client, args)

        call_args = mock_client.request.call_args
        self.assertEqual(call_args.kwargs['params']['description'], 'My token description')

    def test_set_token_with_roles(self):
        """Test creating token with roles."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'token-secret-value'
        args = self.parser.parse_args([
            'token', 'set', 'my-token', '-e', '2026-05-01', '-r', 'role1', 'role2'
        ])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        call_args = mock_client.request.call_args
        self.assertEqual(call_args.kwargs['params']['roles'], ['role1', 'role2'])
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('Roles:', output)

    def test_set_token_json_format(self):
        """Test creating token with json output."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'token-secret-value'
        args = self.parser.parse_args([
            'token', 'set', 'my-token', '-e', '2026-05-01', '-t', 'json'
        ])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        self.assertIn('"token"', printed_output)
        self.assertIn('token-secret-value', printed_output)


class TestDeleteTokenViaParser(unittest.TestCase):
    """Test cases for delete token command via parser."""

    def setUp(self):
        self.parser = argparse.ArgumentParser()
        self.subparsers = self.parser.add_subparsers()
        access_token.setup_parser(self.subparsers)

    def test_delete_token_for_current_user(self):
        """Test deleting token for current user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        args = self.parser.parse_args(['token', 'delete', 'my-token'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.DELETE,
            'api/auth/access_token/my-token',
            payload=None,
            params=None
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('my-token deleted', output)

    def test_delete_token_for_specific_user(self):
        """Test deleting token for specific user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        args = self.parser.parse_args([
            'token', 'delete', 'my-token', '-u', 'user@example.com'
        ])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.DELETE,
            'api/auth/user/user@example.com/access_token/my-token',
            payload=None,
            params=None
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('my-token deleted for user user@example.com', output)


class TestListTokensViaParser(unittest.TestCase):
    """Test cases for list tokens command via parser."""

    def setUp(self):
        self.parser = argparse.ArgumentParser()
        self.subparsers = self.parser.add_subparsers()
        access_token.setup_parser(self.subparsers)

    def test_list_tokens_empty_for_current_user(self):
        """Test listing tokens when none exist for current user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = []
        args = self.parser.parse_args(['token', 'list'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/access_token'
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('No tokens found', output)

    def test_list_tokens_empty_for_specific_user(self):
        """Test listing tokens when none exist for specific user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = []
        args = self.parser.parse_args(['token', 'list', '-u', 'user@example.com'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/user/user@example.com/access_token'
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('No tokens found for user user@example.com', output)

    def test_list_tokens_json_format(self):
        """Test listing tokens with json output."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {'token_name': 'token1', 'expires_at': '2026-05-01T00:00:00', 'roles': ['role1']}
        ]
        args = self.parser.parse_args(['token', 'list', '-t', 'json'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        self.assertIn('token1', printed_output)

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_text_format_with_active_token(self, mock_datetime):
        """Test listing active tokens with text output."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2026, 1, 1)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'token1',
                'description': 'Test token',
                'expires_at': '2026-12-31T00:00:00',
                'roles': ['role1', 'role2']
            }
        ]
        args = self.parser.parse_args(['token', 'list'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('token1', output)
        self.assertIn('Active', output)

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_text_format_with_expired_token(self, mock_datetime):
        """Test listing expired tokens with text output."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2026, 12, 31)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'token1',
                'description': 'Test token',
                'expires_at': '2026-01-01T00:00:00',
                'roles': []
            }
        ]
        args = self.parser.parse_args(['token', 'list'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('token1', output)
        self.assertIn('Expired', output)

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_for_specific_user_text_format(self, mock_datetime):
        """Test listing tokens for specific user with text output."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2026, 1, 1)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'token1',
                'description': 'Test token',
                'expires_at': '2026-12-31T00:00:00',
                'roles': ['role1']
            }
        ]
        args = self.parser.parse_args(['token', 'list', '-u', 'user@example.com'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('Tokens for user: user@example.com', output)

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_with_no_roles(self, mock_datetime):
        """Test listing tokens with no roles shows dash."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2026, 1, 1)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'token1',
                'expires_at': '2026-12-31T00:00:00'
            }
        ]
        args = self.parser.parse_args(['token', 'list'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('token1', output)


class TestListTokenRolesViaParser(unittest.TestCase):
    """Test cases for list token roles command via parser."""

    def setUp(self):
        self.parser = argparse.ArgumentParser()
        self.subparsers = self.parser.add_subparsers()
        access_token.setup_parser(self.subparsers)

    def test_list_token_roles_json_format(self):
        """Test listing token roles with json output."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [{'role_name': 'role1', 'assigned_by': 'admin', 'assigned_at': '2026-01-01'}]
        }
        args = self.parser.parse_args(['token', 'roles', 'my-token', '-t', 'json'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/access_token/my-token/roles'
        )
        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        self.assertIn('my-token', printed_output)

    def test_list_token_roles_text_format_with_roles(self):
        """Test listing token roles with text output when roles exist."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {
                    'role_name': 'role1',
                    'assigned_by': 'admin',
                    'assigned_at': '2026-01-01T12:00:00'
                }
            ]
        }
        args = self.parser.parse_args(['token', 'roles', 'my-token'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('Token: my-token', output)
        self.assertIn('Owner: user@example.com', output)
        self.assertIn('role1', output)
        self.assertIn('admin', output)
        self.assertIn('2026-01-01', output)

    def test_list_token_roles_text_format_without_roles(self):
        """Test listing token roles with text output when no roles exist."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': []
        }
        args = self.parser.parse_args(['token', 'roles', 'my-token'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('Token: my-token', output)
        self.assertIn('Roles: None', output)

    def test_list_token_roles_text_format_with_missing_assigned_at(self):
        """Test listing token roles when assigned_at is missing."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {'role_name': 'role1', 'assigned_by': 'admin'}
            ]
        }
        args = self.parser.parse_args(['token', 'roles', 'my-token'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('role1', output)

    def test_list_token_roles_text_format_uses_args_name_as_fallback(self):
        """Test listing token roles uses args.name when token_name missing."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'user_name': 'user@example.com',
            'roles': []
        }
        args = self.parser.parse_args(['token', 'roles', 'my-token'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('Token: my-token', output)

    def test_list_token_roles_text_format_with_dash_assigned_at(self):
        """Test listing token roles when assigned_at is dash."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {'role_name': 'role1', 'assigned_by': 'admin', 'assigned_at': '-'}
            ]
        }
        args = self.parser.parse_args(['token', 'roles', 'my-token'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('role1', output)
        self.assertIn('-', output)

    def test_list_token_roles_text_format_with_missing_user_name(self):
        """Test listing token roles when user_name is missing shows dash."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'roles': []
        }
        args = self.parser.parse_args(['token', 'roles', 'my-token'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('Owner: -', output)

    def test_list_token_roles_text_format_with_missing_assigned_by(self):
        """Test listing token roles when assigned_by is missing shows None."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {'role_name': 'role1', 'assigned_at': '2026-01-01T12:00:00'}
            ]
        }
        args = self.parser.parse_args(['token', 'roles', 'my-token'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('role1', output)
        self.assertIn('None', output)


class TestListTokensEdgeCases(unittest.TestCase):
    """Test edge cases for list tokens command."""

    def setUp(self):
        self.parser = argparse.ArgumentParser()
        self.subparsers = self.parser.add_subparsers()
        access_token.setup_parser(self.subparsers)

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_with_missing_description_shows_dash(self, mock_datetime):
        """Test listing tokens when description is missing shows dash."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2026, 1, 1)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'token1',
                'expires_at': '2026-12-31T00:00:00',
                'roles': ['role1']
            }
        ]
        args = self.parser.parse_args(['token', 'list'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('token1', output)

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_expiring_today_shows_expired(self, mock_datetime):
        """Test that token expiring today is marked as Expired."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2026, 6, 15)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'token1',
                'expires_at': '2026-06-15T00:00:00',
                'roles': []
            }
        ]
        args = self.parser.parse_args(['token', 'list'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('Expired', output)

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_multiple_roles_comma_separated(self, mock_datetime):
        """Test that multiple roles are displayed comma-separated."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = datetime.date(2026, 1, 1)
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'token1',
                'expires_at': '2026-12-31T00:00:00',
                'roles': ['admin', 'user', 'viewer']
            }
        ]
        args = self.parser.parse_args(['token', 'list'])

        with mock.patch('builtins.print') as mock_print:
            args.func(mock_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('admin, user, viewer', output)


if __name__ == '__main__':
    unittest.main()
