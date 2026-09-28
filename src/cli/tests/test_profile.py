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

import contextlib
import io
import json
import tempfile
import unittest
from typing import Any
from unittest import mock

from src.cli import main_parser
from src.lib.utils import client, client_configs


class TestProfileList(unittest.TestCase):
    """Exercise profile output with and without token expiration information."""

    def setUp(self):
        self.parser = main_parser.create_cli_parser()
        self.service_client = mock.Mock()
        self.response: dict[str, Any] = {
            'profile': {
                'username': 'admin',
                'email_notification': False,
                'slack_notification': False,
                'pool': 'default',
            },
            'pools': ['default'],
            'roles': ['osmo-admin'],
            'token': {'name': 'bootstrap-admin-primary', 'expires_at': None},
        }

    def run_list(self, *arguments: str) -> str:
        args = self.parser.parse_args(['profile', 'list', *arguments])
        self.service_client.request.return_value = self.response
        self.service_client.reset_mock()
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as config_dir, \
                mock.patch.object(client_configs, 'get_client_config_dir',
                                  return_value=config_dir), \
                contextlib.redirect_stdout(output):
            args.func(self.service_client, args)
        self.service_client.request.assert_called_once_with(
            client.RequestMethod.GET, 'api/profile/settings')
        return output.getvalue()

    def test_null_expiry_prints_unknown_and_continues_to_roles(self):
        output = self.run_list()
        self.assertIn('token: bootstrap-admin-primary\n  expires_at: unknown\n', output)
        self.assertIn('roles:\n  - osmo-admin\n', output)
        self.assertIn('user:\n  email: admin\n', output)

    def test_missing_expiry_prints_unknown(self):
        del self.response['token']['expires_at']
        output = self.run_list()
        self.assertIn('token: bootstrap-admin-primary\n  expires_at: unknown\n', output)
        self.assertIn('roles:\n  - osmo-admin\n', output)

    def test_dated_token_preserves_date_only_output(self):
        self.response['token'] = {
            'name': 'dated-token', 'expires_at': '2026-10-15T23:45:00+00:00'}
        output = self.run_list('--format-type', 'text')
        self.assertIn('token: dated-token\n  expires_at: 2026-10-15\n', output)
        self.assertIn('roles:\n  - osmo-admin\n', output)

    def test_absent_or_null_token_omits_token_block(self):
        for present in (True, False):
            with self.subTest(token_present=present):
                if present:
                    self.response['token'] = None
                else:
                    del self.response['token']
                output = self.run_list()
                self.assertNotIn('token:', output)
                self.assertNotIn('expires_at:', output)
                self.assertIn('user:\n  email: admin\n', output)
                self.assertIn('roles:\n  - osmo-admin\n', output)

    def test_json_preserves_null_expiry(self):
        result = json.loads(self.run_list('--format-type', 'json'))
        self.assertEqual(result, self.response)
        self.assertIsNone(result['token']['expires_at'])


if __name__ == '__main__':
    unittest.main()
