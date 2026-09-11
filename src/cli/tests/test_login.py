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

import base64
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

from src.cli import login, main_parser
from src.lib.utils import client, common
from src.lib.utils import login as login_utils


class LoginCommandTests(unittest.TestCase):
    """Tests for CLI login flow selection."""

    def test_bootstrap_token_file_login_without_identity_provider(self):
        """The default-admin Secret is an OSMO token, not an OAuth password."""
        bootstrap_token = 'a' * 43
        claims = base64.urlsafe_b64encode(
            json.dumps({'name': 'admin', 'exp': 9_999_999_999}).encode()).decode().rstrip('=')
        issued_token = f'eyJhbGciOiJub25lIn0.{claims}.signature'
        requests_received = []

        class Handler(http.server.BaseHTTPRequestHandler):
            """Expose the managed-auth endpoints without an external IdP."""

            def do_GET(self):  # pylint: disable=invalid-name
                requests_received.append(('GET', self.path, None))
                self.respond({'token_endpoint': None, 'device_client_id': None})

            def do_POST(self):  # pylint: disable=invalid-name
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                requests_received.append(('POST', self.path, body))
                self.respond({'token': issued_token})

            def respond(self, body):
                encoded = json.dumps(body).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, format, *args):  # pylint: disable=redefined-builtin
                pass

        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, {
                    common.OSMO_CONFIG_OVERRIDE: directory,
                    'no_proxy': '127.0.0.1',
                }), \
                http.server.HTTPServer(('127.0.0.1', 0), Handler) as server:
            server_thread = threading.Thread(target=server.serve_forever, daemon=True)
            server_thread.start()
            try:
                url = f'http://127.0.0.1:{server.server_port}'
                self.assertIsNone(login_utils.fetch_login_info(url)['token_endpoint'])
                token_file = Path(directory) / 'bootstrap-token'
                token_file.write_text(bootstrap_token + '\n', encoding='utf-8')
                arguments = main_parser.create_cli_parser().parse_args([
                    'login', url, '--method', 'token', '--token-file', str(token_file),
                ])
                manager = client.LoginManager(login_utils.LoginConfig(), 'osmo-cli-test')

                arguments.func(client.ServiceClient(manager), arguments)

                self.assertEqual(requests_received, [
                    ('GET', '/api/auth/login', None),
                    ('POST', '/api/auth/jwt/access_token', {'token': bootstrap_token}),
                ])
                # Reopen storage to verify the real login path persisted token auth.
                restored = client.LoginManager(login_utils.LoginConfig(), 'osmo-cli-test')
                self.assertTrue(restored.using_osmo_token())
                self.assertEqual(restored.get_access_token(), bootstrap_token)
                token_storage = restored.login_storage.token_login
                assert token_storage is not None
                self.assertEqual(token_storage.id_token, issued_token)
                self.assertEqual(restored.url, url)
            finally:
                server.shutdown()
                server_thread.join(timeout=5)

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
