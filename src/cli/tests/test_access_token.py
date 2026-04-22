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
import json
import unittest
from unittest import mock

from src.cli import access_token
from src.lib.utils import client, osmo_errors


class TestSetupParser(unittest.TestCase):
    """Test cases for the setup_parser function."""

    def test_setup_parser_creates_token_subparser(self):
        """Test that setup_parser creates the token subparser with correct subcommands."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        # Parse a token set command to verify structure
        args = parser.parse_args(['token', 'set', 'my-token'])
        self.assertEqual(args.name, 'my-token')
        self.assertEqual(args.command, 'set')

    def test_setup_parser_list_command(self):
        """Test that list command parses correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'list'])
        self.assertEqual(args.command, 'list')
        self.assertEqual(args.format_type, 'text')

    def test_setup_parser_list_command_with_user(self):
        """Test that list command parses user option correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'list', '--user', 'admin@example.com'])
        self.assertEqual(args.user, 'admin@example.com')

    def test_setup_parser_delete_command(self):
        """Test that delete command parses correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'delete', 'old-token'])
        self.assertEqual(args.command, 'delete')
        self.assertEqual(args.name, 'old-token')

    def test_setup_parser_roles_command(self):
        """Test that roles command parses correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'roles', 'my-token'])
        self.assertEqual(args.command, 'roles')
        self.assertEqual(args.name, 'my-token')

    def test_setup_parser_set_with_description(self):
        """Test that set command parses description option correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'set', 'my-token', '-d', 'My description'])
        self.assertEqual(args.description, 'My description')

    def test_setup_parser_set_with_roles(self):
        """Test that set command parses roles option correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'set', 'my-token', '-r', 'role1', '-r', 'role2'])
        self.assertEqual(args.roles, ['role1', 'role2'])

    def test_setup_parser_set_with_json_format(self):
        """Test that set command parses json format option correctly."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'set', 'my-token', '-t', 'json'])
        self.assertEqual(args.format_type, 'json')


class TestSetToken(unittest.TestCase):
    """Test cases for the _set_token function."""

    def test_set_token_invalid_name_raises_error(self):
        """Test that invalid token name raises OSMOUserError."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            name='123invalid',
            expires_at='2026-05-01',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with self.assertRaises(osmo_errors.OSMOUserError):
            access_token._set_token(service_client, args)

    def test_set_token_invalid_name_with_spaces(self):
        """Test that token name with spaces raises OSMOUserError."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            name='invalid name',
            expires_at='2026-05-01',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with self.assertRaises(osmo_errors.OSMOUserError):
            access_token._set_token(service_client, args)

    def test_set_token_success_text_format(self):
        """Test successful token creation with text output format."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = 'generated-token-value'
        args = argparse.Namespace(
            name='my-token',
            expires_at='2026-05-01',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/access_token/my-token',
            payload=None,
            params={'expires_at': '2026-05-01'}
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('generated-token-value', output)

    def test_set_token_success_json_format(self):
        """Test successful token creation with JSON output format."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = 'generated-token-value'
        args = argparse.Namespace(
            name='my-token',
            expires_at='2026-05-01',
            description=None,
            roles=None,
            user=None,
            format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(service_client, args)

        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        parsed = json.loads(printed_output)
        self.assertEqual(parsed, {'token': 'generated-token-value'})

    def test_set_token_with_description(self):
        """Test token creation with description parameter."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = 'generated-token-value'
        args = argparse.Namespace(
            name='my-token',
            expires_at='2026-05-01',
            description='My token description',
            roles=None,
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print'):
            access_token._set_token(service_client, args)

        service_client.request.assert_called_once()
        call_args = service_client.request.call_args
        self.assertEqual(call_args[1]['params']['description'], 'My token description')

    def test_set_token_with_roles(self):
        """Test token creation with roles parameter."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = 'generated-token-value'
        args = argparse.Namespace(
            name='my-token',
            expires_at='2026-05-01',
            description=None,
            roles=['role1', 'role2'],
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(service_client, args)

        service_client.request.assert_called_once()
        call_args = service_client.request.call_args
        self.assertEqual(call_args[1]['params']['roles'], ['role1', 'role2'])
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('role1', output)
        self.assertIn('role2', output)

    def test_set_token_for_specific_user_admin_api(self):
        """Test token creation for a specific user via admin API."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = 'generated-token-value'
        args = argparse.Namespace(
            name='service-token',
            expires_at='2026-05-01',
            description=None,
            roles=None,
            user='service-account@example.com',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/user/service-account@example.com/access_token/service-token',
            payload=None,
            params={'expires_at': '2026-05-01'}
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('service-account@example.com', output)


class TestDeleteToken(unittest.TestCase):
    """Test cases for the _delete_token function."""

    def test_delete_token_for_current_user(self):
        """Test deleting a token for the current user."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            name='old-token',
            user=None
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._delete_token(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.DELETE,
            'api/auth/access_token/old-token',
            payload=None,
            params=None
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('old-token', output)
        self.assertIn('deleted', output)

    def test_delete_token_for_specific_user_admin_api(self):
        """Test deleting a token for a specific user via admin API."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            name='user-token',
            user='other-user@example.com'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._delete_token(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.DELETE,
            'api/auth/user/other-user@example.com/access_token/user-token',
            payload=None,
            params=None
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('user-token', output)
        self.assertIn('other-user@example.com', output)


class TestListTokens(unittest.TestCase):
    """Test cases for the _list_tokens function."""

    def test_list_tokens_empty_result_for_current_user(self):
        """Test listing tokens when no tokens exist for current user."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = []
        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(service_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('No tokens found', output)

    def test_list_tokens_empty_result_for_specific_user(self):
        """Test listing tokens when no tokens exist for specific user."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = []
        args = argparse.Namespace(
            user='some-user@example.com',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(service_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('some-user@example.com', output)

    def test_list_tokens_json_format(self):
        """Test listing tokens with JSON output format."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = [
            {
                'token_name': 'my-token',
                'description': 'Test token',
                'expires_at': '2026-05-01T00:00:00Z',
                'roles': ['role1']
            }
        ]
        args = argparse.Namespace(
            user=None,
            format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(service_client, args)

        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        parsed = json.loads(printed_output)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]['token_name'], 'my-token')

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_text_format_with_active_token(self, mock_datetime):
        """Test listing tokens in text format with an active token."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = \
            __import__('datetime').date(2026, 4, 1)
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = [
            {
                'token_name': 'active-token',
                'description': 'An active token',
                'expires_at': '2026-05-01T00:00:00Z',
                'roles': ['admin', 'user']
            }
        ]
        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/access_token'
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('active-token', output)

    @mock.patch('src.cli.access_token.datetime')
    def test_list_tokens_text_format_with_expired_token(self, mock_datetime):
        """Test listing tokens in text format with an expired token."""
        mock_datetime.datetime.utcnow.return_value.date.return_value = \
            __import__('datetime').date(2026, 6, 1)
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = [
            {
                'token_name': 'expired-token',
                'description': 'An expired token',
                'expires_at': '2026-05-01T00:00:00Z',
                'roles': []
            }
        ]
        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(service_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('expired-token', output)

    def test_list_tokens_for_specific_user_admin_api(self):
        """Test listing tokens for a specific user via admin API."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = [
            {
                'token_name': 'user-token',
                'description': 'User token',
                'expires_at': '2026-05-01T00:00:00Z',
                'roles': []
            }
        ]
        args = argparse.Namespace(
            user='admin@example.com',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/user/admin@example.com/access_token'
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('admin@example.com', output)

    def test_list_tokens_text_format_no_roles(self):
        """Test listing tokens in text format when token has no roles."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = [
            {
                'token_name': 'no-roles-token',
                'description': None,
                'expires_at': '2026-05-01T00:00:00Z'
            }
        ]
        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(service_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('no-roles-token', output)


class TestListTokenRoles(unittest.TestCase):
    """Test cases for the _list_token_roles function."""

    def test_list_token_roles_json_format(self):
        """Test listing token roles with JSON output format."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {'role_name': 'admin', 'assigned_by': 'system', 'assigned_at': '2026-01-01T00:00:00Z'}
            ]
        }
        args = argparse.Namespace(
            name='my-token',
            format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(service_client, args)

        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        parsed = json.loads(printed_output)
        self.assertEqual(parsed['token_name'], 'my-token')

    def test_list_token_roles_text_format_with_roles(self):
        """Test listing token roles in text format when roles exist."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {'role_name': 'admin', 'assigned_by': 'system', 'assigned_at': '2026-01-01T00:00:00Z'},
                {'role_name': 'user', 'assigned_by': 'admin', 'assigned_at': '2026-02-15T12:30:00Z'}
            ]
        }
        args = argparse.Namespace(
            name='my-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/access_token/my-token/roles'
        )
        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('my-token', output)
        self.assertIn('user@example.com', output)
        self.assertIn('admin', output)

    def test_list_token_roles_text_format_no_roles(self):
        """Test listing token roles in text format when no roles exist."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': []
        }
        args = argparse.Namespace(
            name='my-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(service_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('None', output)

    def test_list_token_roles_text_format_missing_assigned_at(self):
        """Test listing token roles when assigned_at is missing."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {'role_name': 'viewer', 'assigned_by': 'system'}
            ]
        }
        args = argparse.Namespace(
            name='my-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(service_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('viewer', output)

    def test_list_token_roles_text_format_uses_name_fallback(self):
        """Test listing token roles when token_name is missing from response."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'user_name': 'user@example.com',
            'roles': []
        }
        args = argparse.Namespace(
            name='fallback-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(service_client, args)

        output = ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('fallback-token', output)


if __name__ == '__main__':
    unittest.main()
