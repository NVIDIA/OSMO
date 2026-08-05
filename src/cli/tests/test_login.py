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

import unittest
from unittest import mock

from src.cli import login, main_parser


class LoginCommandTests(unittest.TestCase):
    """Tests for CLI login flow selection."""

    def test_pkce_method_passes_browser_and_callback_options(self):
        parser = main_parser.create_cli_parser()
        arguments = parser.parse_args([
            'login',
            'https://osmo.example.com',
            '--method', 'pkce',
            '--browser-endpoint', 'https://idp.example.com/authorize',
            '--callback-port', '49152',
        ])
        service_client = mock.MagicMock()

        login._login(service_client, arguments)

        service_client.login_manager.pkce_login.assert_called_once_with(
            url='https://osmo.example.com',
            browser_endpoint='https://idp.example.com/authorize',
            callback_port=49152,
        )
        service_client.login_manager.device_code_login.assert_not_called()

    def test_pkce_method_is_default(self):
        parser = main_parser.create_cli_parser()
        arguments = parser.parse_args([
            'login',
            'https://osmo.example.com',
        ])
        service_client = mock.MagicMock()

        login._login(service_client, arguments)

        service_client.login_manager.pkce_login.assert_called_once_with(
            url='https://osmo.example.com',
            browser_endpoint=None,
            callback_port=0,
        )
        service_client.login_manager.device_code_login.assert_not_called()

    def test_device_method_remains_available(self):
        parser = main_parser.create_cli_parser()
        arguments = parser.parse_args([
            'login',
            'https://osmo.example.com',
            '--method', 'code',
        ])
        service_client = mock.MagicMock()

        login._login(service_client, arguments)

        service_client.login_manager.device_code_login.assert_called_once_with(
            'https://osmo.example.com',
            None,
        )
        service_client.login_manager.pkce_login.assert_not_called()


if __name__ == '__main__':
    unittest.main()
