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
import unittest
from unittest import mock

from src.cli import access_token
from src.lib.utils import client, osmo_errors


class TestSetToken(unittest.TestCase):
    """Tests for _set_token function."""

    def test_set_token_creates_token_for_current_user(self):
        """Test creating a token for the current user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'secret-token-value'

        args = argparse.Namespace(
            name='my-token',
            expires_at='2026-12-31',
            description=None,
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
            params={'expires_at': '2026-12-31'}
        )
        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('secret-token-value', output)
        self.assertIn('Save the token', output)

    def test_set_token_creates_token_for_specific_user(self):
        """Test creating a token for a specific user (admin API)."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'admin-created-token'

        args = argparse.Namespace(
            name='service-token',
            expires_at='2026-12-31',
            description=None,
            roles=None,
            user='service@example.com',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/user/service@example.com/access_token/service-token',
            payload=None,
            params={'expires_at': '2026-12-31'}
        )
        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('service@example.com', output)

    def test_set_token_with_description_and_roles(self):
        """Test creating a token with description and roles."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'token-with-options'

        args = argparse.Namespace(
            name='my-token',
            expires_at='2026-12-31',
            description='My token description',
            roles=['role1', 'role2'],
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/access_token/my-token',
            payload=None,
            params={
                'expires_at': '2026-12-31',
                'description': 'My token description',
                'roles': ['role1', 'role2']
            }
        )
        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('role1, role2', output)

    def test_set_token_json_output(self):
        """Test creating a token with JSON output format."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'json-token-value'

        args = argparse.Namespace(
            name='json-token',
            expires_at='2026-12-31',
            description=None,
            roles=None,
            user=None,
            format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._set_token(mock_client, args)

        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        self.assertIn('json-token-value', printed_output)
        self.assertIn('"token"', printed_output)

    def test_set_token_invalid_name_raises_error(self):
        """Test that invalid token name raises OSMOUserError."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)

        args = argparse.Namespace(
            name='123invalid',
            expires_at='2026-12-31',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            access_token._set_token(mock_client, args)

        self.assertIn('123invalid', str(context.exception))
        self.assertIn('must match regex', str(context.exception))

    def test_set_token_invalid_name_with_special_chars_raises_error(self):
        """Test that token name with special characters raises OSMOUserError."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)

        args = argparse.Namespace(
            name='invalid@name',
            expires_at='2026-12-31',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with self.assertRaises(osmo_errors.OSMOUserError):
            access_token._set_token(mock_client, args)

    def test_set_token_single_char_name_is_valid(self):
        """Test that single character token name is valid."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'single-char-token'

        args = argparse.Namespace(
            name='a',
            expires_at='2026-12-31',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print'):
            access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/auth/access_token/a',
            payload=None,
            params={'expires_at': '2026-12-31'}
        )

    def test_set_token_two_char_name_is_valid(self):
        """Test that two character token name is valid."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'two-char-token'

        args = argparse.Namespace(
            name='ab',
            expires_at='2026-12-31',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print'):
            access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once()

    def test_set_token_name_ending_with_underscore_raises_error(self):
        """Test that token name ending with underscore raises OSMOUserError."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)

        args = argparse.Namespace(
            name='token_',
            expires_at='2026-12-31',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with self.assertRaises(osmo_errors.OSMOUserError):
            access_token._set_token(mock_client, args)

    def test_set_token_name_ending_with_hyphen_raises_error(self):
        """Test that token name ending with hyphen raises OSMOUserError."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)

        args = argparse.Namespace(
            name='token-',
            expires_at='2026-12-31',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with self.assertRaises(osmo_errors.OSMOUserError):
            access_token._set_token(mock_client, args)

    def test_set_token_empty_name_raises_error(self):
        """Test that empty token name raises OSMOUserError."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)

        args = argparse.Namespace(
            name='',
            expires_at='2026-12-31',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with self.assertRaises(osmo_errors.OSMOUserError):
            access_token._set_token(mock_client, args)

    def test_set_token_name_with_underscore_middle_is_valid(self):
        """Test that token name with underscore in middle is valid."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'underscore-token'

        args = argparse.Namespace(
            name='my_token1',
            expires_at='2026-12-31',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print'):
            access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once()

    def test_set_token_name_with_hyphen_middle_is_valid(self):
        """Test that token name with hyphen in middle is valid."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = 'hyphen-token'

        args = argparse.Namespace(
            name='my-token1',
            expires_at='2026-12-31',
            description=None,
            roles=None,
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print'):
            access_token._set_token(mock_client, args)

        mock_client.request.assert_called_once()


class TestDeleteToken(unittest.TestCase):
    """Tests for _delete_token function."""

    def test_delete_token_for_current_user(self):
        """Test deleting a token for the current user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)

        args = argparse.Namespace(
            name='my-token',
            user=None
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._delete_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.DELETE,
            'api/auth/access_token/my-token',
            payload=None,
            params=None
        )
        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('my-token', output)
        self.assertIn('deleted', output)

    def test_delete_token_for_specific_user(self):
        """Test deleting a token for a specific user (admin API)."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)

        args = argparse.Namespace(
            name='old-token',
            user='other-user@example.com'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._delete_token(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.DELETE,
            'api/auth/user/other-user@example.com/access_token/old-token',
            payload=None,
            params=None
        )
        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('old-token', output)
        self.assertIn('other-user@example.com', output)


class TestListTokens(unittest.TestCase):
    """Tests for _list_tokens function."""

    def test_list_tokens_for_current_user(self):
        """Test listing tokens for the current user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'token1',
                'description': 'First token',
                'expires_at': '2099-01-01T00:00:00',
                'roles': ['admin', 'user']
            }
        ]

        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print'):
            access_token._list_tokens(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/access_token'
        )

    def test_list_tokens_for_specific_user(self):
        """Test listing tokens for a specific user (admin API)."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'user-token',
                'description': 'User token',
                'expires_at': '2027-01-01T00:00:00',
                'roles': []
            }
        ]

        args = argparse.Namespace(
            user='target-user@example.com',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        mock_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/auth/user/target-user@example.com/access_token'
        )
        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('target-user@example.com', output)

    def test_list_tokens_empty_result_for_current_user(self):
        """Test listing tokens when no tokens exist for current user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = []

        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('No tokens found', output)

    def test_list_tokens_empty_result_for_specific_user(self):
        """Test listing tokens when no tokens exist for specific user."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = []

        args = argparse.Namespace(
            user='no-tokens@example.com',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('No tokens found for user no-tokens@example.com', output)

    def test_list_tokens_json_output(self):
        """Test listing tokens with JSON output format."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'json-token',
                'description': 'JSON token',
                'expires_at': '2027-01-01T00:00:00',
                'roles': ['reader']
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
        self.assertIn('json-token', printed_output)

    def test_list_tokens_shows_expired_status(self):
        """Test that expired tokens show 'Expired' status."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'expired-token',
                'description': 'Old token',
                'expires_at': '2020-01-01T00:00:00',
                'roles': []
            }
        ]

        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('Expired', output)

    def test_list_tokens_shows_active_status(self):
        """Test that active tokens show 'Active' status."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'active-token',
                'description': 'Current token',
                'expires_at': '2099-12-31T00:00:00',
                'roles': []
            }
        ]

        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('Active', output)

    def test_list_tokens_with_no_roles_shows_dash(self):
        """Test that tokens with no roles show dash."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'no-roles-token',
                'description': 'No roles',
                'expires_at': '2099-12-31T00:00:00',
                'roles': []
            }
        ]

        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('-', output)

    def test_list_tokens_formats_roles_as_comma_separated(self):
        """Test that roles are formatted as comma-separated list."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'multi-role-token',
                'description': 'Multiple roles',
                'expires_at': '2099-12-31T00:00:00',
                'roles': ['admin', 'developer', 'viewer']
            }
        ]

        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('admin, developer, viewer', output)

    def test_list_tokens_with_none_description(self):
        """Test listing tokens when description is None."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'no-desc-token',
                'description': None,
                'expires_at': '2099-12-31T00:00:00',
                'roles': []
            }
        ]

        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('no-desc-token', output)

    def test_list_tokens_with_missing_roles_key(self):
        """Test listing tokens when roles key is missing from response."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'missing-roles-token',
                'description': 'No roles key',
                'expires_at': '2099-12-31T00:00:00'
            }
        ]

        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('missing-roles-token', output)
        self.assertIn('-', output)

    def test_list_tokens_with_multiple_tokens(self):
        """Test listing multiple tokens shows all tokens."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = [
            {
                'token_name': 'token-one',
                'description': 'First',
                'expires_at': '2099-12-31T00:00:00',
                'roles': []
            },
            {
                'token_name': 'token-two',
                'description': 'Second',
                'expires_at': '2099-12-31T00:00:00',
                'roles': ['admin']
            }
        ]

        args = argparse.Namespace(
            user=None,
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_tokens(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('token-one', output)
        self.assertIn('token-two', output)


class TestListTokenRoles(unittest.TestCase):
    """Tests for _list_token_roles function."""

    def test_list_token_roles_text_output(self):
        """Test listing token roles with text output."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'my-token',
            'user_name': 'user@example.com',
            'roles': [
                {
                    'role_name': 'admin',
                    'assigned_by': 'super-admin@example.com',
                    'assigned_at': '2026-01-15T10:30:00'
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
        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('my-token', output)
        self.assertIn('user@example.com', output)
        self.assertIn('admin', output)
        self.assertIn('super-admin@example.com', output)
        self.assertIn('2026-01-15', output)

    def test_list_token_roles_json_output(self):
        """Test listing token roles with JSON output."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'json-token',
            'user_name': 'user@example.com',
            'roles': [{'role_name': 'reader', 'assigned_by': 'admin', 'assigned_at': None}]
        }

        args = argparse.Namespace(
            name='json-token',
            format_type='json'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        self.assertIn('json-token', printed_output)

    def test_list_token_roles_no_roles(self):
        """Test listing token roles when token has no roles."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'empty-roles-token',
            'user_name': 'user@example.com',
            'roles': []
        }

        args = argparse.Namespace(
            name='empty-roles-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('Roles: None', output)

    def test_list_token_roles_with_missing_assigned_at(self):
        """Test listing token roles when assigned_at is missing."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'token-no-date',
            'user_name': 'user@example.com',
            'roles': [
                {
                    'role_name': 'developer',
                    'assigned_by': 'admin@example.com',
                    'assigned_at': None
                }
            ]
        }

        args = argparse.Namespace(
            name='token-no-date',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('developer', output)

    def test_list_token_roles_with_dash_assigned_at(self):
        """Test listing token roles when assigned_at is dash placeholder."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'token-dash-date',
            'user_name': 'user@example.com',
            'roles': [
                {
                    'role_name': 'viewer',
                    'assigned_by': 'system',
                    'assigned_at': '-'
                }
            ]
        }

        args = argparse.Namespace(
            name='token-dash-date',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('viewer', output)
        self.assertIn('-', output)

    def test_list_token_roles_uses_name_from_args_when_missing_in_response(self):
        """Test that args.name is used when token_name is missing in response."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'user_name': 'user@example.com',
            'roles': []
        }

        args = argparse.Namespace(
            name='fallback-token-name',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('fallback-token-name', output)

    def test_list_token_roles_with_missing_user_name(self):
        """Test listing token roles when user_name is missing in response."""
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

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('Owner: -', output)

    def test_list_token_roles_with_multiple_roles(self):
        """Test listing token roles with multiple roles assigned."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {
            'token_name': 'multi-role-token',
            'user_name': 'user@example.com',
            'roles': [
                {
                    'role_name': 'admin',
                    'assigned_by': 'super@example.com',
                    'assigned_at': '2026-01-15T10:30:00'
                },
                {
                    'role_name': 'developer',
                    'assigned_by': 'manager@example.com',
                    'assigned_at': '2026-02-20T14:00:00'
                }
            ]
        }

        args = argparse.Namespace(
            name='multi-role-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('admin', output)
        self.assertIn('developer', output)
        self.assertIn('super@example.com', output)
        self.assertIn('manager@example.com', output)

    def test_list_token_roles_empty_response(self):
        """Test listing token roles when response has minimal data."""
        mock_client = mock.MagicMock(spec=client.ServiceClient)
        mock_client.request.return_value = {}

        args = argparse.Namespace(
            name='minimal-token',
            format_type='text'
        )

        with mock.patch('builtins.print') as mock_print:
            access_token._list_token_roles(mock_client, args)

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn('minimal-token', output)
        self.assertIn('Owner: -', output)
        self.assertIn('Roles: None', output)


class TestSetupParser(unittest.TestCase):
    """Tests for setup_parser function."""

    def test_setup_parser_creates_token_subcommand(self):
        """Test that setup_parser creates the token subcommand."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'list'])
        self.assertEqual(args.command, 'list')

    def test_setup_parser_set_command_has_required_args(self):
        """Test that the set subcommand has required arguments."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'set', 'my-token'])
        self.assertEqual(args.name, 'my-token')
        self.assertIsNotNone(args.expires_at)
        self.assertEqual(args.format_type, 'text')

    def test_setup_parser_delete_command_has_required_args(self):
        """Test that the delete subcommand has required arguments."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'delete', 'old-token'])
        self.assertEqual(args.name, 'old-token')

    def test_setup_parser_roles_command_has_required_args(self):
        """Test that the roles subcommand has required arguments."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        access_token.setup_parser(subparsers)

        args = parser.parse_args(['token', 'roles', 'my-token'])
        self.assertEqual(args.name, 'my-token')


if __name__ == '__main__':
    unittest.main()
