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
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

import yaml

from src.lib.utils import client, common, login, osmo_errors, version


def _make_jwt(claims: dict) -> str:
    """Build an unsigned JWT whose payload base64url-decodes to ``claims``."""
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').decode().rstrip('=')
    payload = base64.urlsafe_b64encode(
        json.dumps(claims).encode()).decode().rstrip('=')
    return f'{header}.{payload}.sig'


class FakeResponse:
    """Minimal stand-in for requests.Response usable by handle_response."""

    def __init__(self, status_code: int = 200, text: str = '',
                 content: bytes = b'', headers: dict | None = None):
        self.status_code = status_code
        self.text = text
        self.content = content
        self.headers = headers if headers is not None else {}


class HandleResponseSuccessTests(unittest.TestCase):
    """Tests for the success-path branches of handle_response."""

    def test_default_mode_returns_parsed_json(self):
        response = FakeResponse(status_code=200, text='{"foo": "bar"}')

        result = client.handle_response(response)

        self.assertEqual(result, {'foo': 'bar'})

    def test_explicit_json_mode_returns_parsed_json(self):
        response = FakeResponse(status_code=200, text='{"value": 42}')

        result = client.handle_response(response, mode=client.ResponseMode.JSON)

        self.assertEqual(result, {'value': 42})

    def test_plain_text_mode_returns_text(self):
        response = FakeResponse(status_code=200, text='hello world')

        result = client.handle_response(response, mode=client.ResponseMode.PLAIN_TEXT)

        self.assertEqual(result, 'hello world')

    def test_binary_mode_returns_content(self):
        response = FakeResponse(status_code=200, content=b'\x00\x01\x02')

        result = client.handle_response(response, mode=client.ResponseMode.BINARY)

        self.assertEqual(result, b'\x00\x01\x02')

    def test_streaming_mode_returns_response_object(self):
        response = FakeResponse(status_code=200, text='ignored')

        result = client.handle_response(response, mode=client.ResponseMode.STREAMING)

        self.assertIs(result, response)


class HandleResponseWarningHeaderTests(unittest.TestCase):
    """Tests for the warning-header decoding and printing."""

    def test_warning_header_decoded_and_printed_to_stderr(self):
        warning_text = 'deprecated client'
        encoded = base64.b64encode(warning_text.encode()).decode()
        response = FakeResponse(
            status_code=200,
            text='{}',
            headers={version.WARNING_HEADER: encoded},
        )

        captured = io.StringIO()
        with mock.patch.object(sys, 'stderr', captured):
            client.handle_response(response)

        self.assertIn(warning_text, captured.getvalue())

    def test_warning_header_absent_writes_nothing_to_stderr(self):
        response = FakeResponse(status_code=200, text='{}')

        captured = io.StringIO()
        with mock.patch.object(sys, 'stderr', captured):
            client.handle_response(response)

        self.assertEqual(captured.getvalue(), '')


class HandleResponseClientErrorTests(unittest.TestCase):
    """Tests for 4xx response handling."""

    def test_invalid_json_4xx_raises_user_error_with_text(self):
        response = FakeResponse(status_code=404, text='not json at all')

        with self.assertRaises(osmo_errors.OSMOUserError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.message, 'not json at all')
        self.assertEqual(cm.exception.status_code, 404)

    def test_4xx_without_error_code_raises_user_error_with_text(self):
        response = FakeResponse(status_code=400, text='{"message": "bad"}')

        with self.assertRaises(osmo_errors.OSMOUserError) as cm:
            client.handle_response(response)

        # The function uses response.text (not payload['message']) when
        # 'error_code' is absent.
        self.assertEqual(cm.exception.message, '{"message": "bad"}')
        self.assertEqual(cm.exception.status_code, 400)

    def test_4xx_with_unknown_error_code_raises_user_error_with_message(self):
        payload = {'error_code': 'OTHER', 'message': 'bad input'}
        response = FakeResponse(status_code=422, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOUserError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.message, 'bad input')
        self.assertEqual(cm.exception.status_code, 422)

    def test_4xx_with_credential_error_code_raises_credential_error(self):
        payload = {
            'error_code': 'CREDENTIAL',
            'message': 'bad creds',
            'workflow_id': 'wf-1',
        }
        response = FakeResponse(status_code=401, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOCredentialError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.message, 'bad creds')
        self.assertEqual(cm.exception.workflow_id, 'wf-1')
        self.assertEqual(cm.exception.status_code, 401)

    def test_4xx_with_credential_error_code_without_workflow_id_uses_default(self):
        payload = {'error_code': 'CREDENTIAL', 'message': 'bad creds'}
        response = FakeResponse(status_code=401, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOCredentialError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.workflow_id, '')

    def test_4xx_with_usage_error_code_raises_submission_error(self):
        payload = {
            'error_code': 'USAGE',
            'message': 'invalid usage',
            'workflow_id': 'wf-2',
        }
        response = FakeResponse(status_code=400, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOSubmissionError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.message, 'invalid usage')
        self.assertEqual(cm.exception.workflow_id, 'wf-2')
        self.assertEqual(cm.exception.status_code, 400)

    def test_4xx_with_resource_error_code_raises_submission_error(self):
        payload = {'error_code': 'RESOURCE', 'message': 'no resources'}
        response = FakeResponse(status_code=409, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOSubmissionError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.message, 'no resources')
        self.assertEqual(cm.exception.workflow_id, '')
        self.assertEqual(cm.exception.status_code, 409)

    def test_lower_boundary_400_routes_to_client_error_branch(self):
        response = FakeResponse(status_code=400, text='boundary')

        with self.assertRaises(osmo_errors.OSMOUserError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.status_code, 400)

    def test_upper_boundary_499_routes_to_client_error_branch(self):
        response = FakeResponse(status_code=499, text='boundary')

        with self.assertRaises(osmo_errors.OSMOUserError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.status_code, 499)


class HandleResponseServerErrorTests(unittest.TestCase):
    """Tests for 5xx response handling."""

    def test_500_raises_server_error_with_status_and_body(self):
        response = FakeResponse(
            status_code=500,
            text='something broke',
            headers={'X-Trace': 'abc'},
        )

        with self.assertRaises(osmo_errors.OSMOServerError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.status_code, 500)
        self.assertIn('Status Code: 500', cm.exception.message)
        self.assertIn('X-Trace: abc', cm.exception.message)
        self.assertIn('something broke', cm.exception.message)

    def test_503_raises_server_error(self):
        response = FakeResponse(status_code=503, text='unavailable')

        with self.assertRaises(osmo_errors.OSMOServerError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.status_code, 503)


class LoginManagerInitTests(unittest.TestCase):
    """Tests for LoginManager construction and read-only properties."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        env_patch = mock.patch.dict(
            os.environ, {common.OSMO_CONFIG_OVERRIDE: self.tmpdir})
        env_patch.start()
        self.addCleanup(env_patch.stop)
        self.addCleanup(lambda: shutil.rmtree(self.tmpdir, ignore_errors=True))

    def test_user_agent_built_from_prefix_and_version(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        self.assertEqual(manager.user_agent, f'osmo-cli/{version.VERSION}')

    def test_login_config_property_returns_input_config(self):
        config = login.LoginConfig()

        manager = client.LoginManager(config, 'osmo-cli')

        self.assertIs(manager.login_config, config)

    def test_login_storage_without_file_raises(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        with self.assertRaises(osmo_errors.OSMOUserError):
            _ = manager.login_storage

    def test_url_property_without_storage_raises(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        with self.assertRaises(osmo_errors.OSMOUserError):
            _ = manager.url

    def test_netloc_property_without_storage_raises(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        with self.assertRaises(osmo_errors.OSMOUserError):
            _ = manager.netloc

    def test_init_with_non_dict_yaml_leaves_storage_unset(self):
        login_path = os.path.join(self.tmpdir, 'login.yaml')
        with open(login_path, 'w', encoding='utf-8') as fh:
            yaml.dump(['not', 'a', 'dict'], fh)

        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        with self.assertRaises(osmo_errors.OSMOUserError):
            _ = manager.login_storage

    def test_init_with_dev_login_yaml_loads_storage(self):
        login_path = os.path.join(self.tmpdir, 'login.yaml')
        with open(login_path, 'w', encoding='utf-8') as fh:
            yaml.dump({
                'url': 'https://example.com',
                'dev_login': {'username': 'alice'},
            }, fh)

        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        self.assertEqual(manager.url, 'https://example.com')
        self.assertEqual(manager.netloc, 'example.com')
        dev_login = manager.login_storage.dev_login
        self.assertIsNotNone(dev_login)
        self.assertEqual(dev_login.username, 'alice')  # type: ignore[union-attr]


class LoginManagerLoginAndLogoutTests(unittest.TestCase):
    """Tests for dev_login, logout, using_osmo_token, get_access_token."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        env_patch = mock.patch.dict(
            os.environ, {common.OSMO_CONFIG_OVERRIDE: self.tmpdir})
        env_patch.start()
        self.addCleanup(env_patch.stop)
        self.addCleanup(lambda: shutil.rmtree(self.tmpdir, ignore_errors=True))
        self.login_path = os.path.join(self.tmpdir, 'login.yaml')

    def test_dev_login_writes_login_yaml(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        with mock.patch('builtins.print'):
            manager.dev_login('https://example.com/', 'alice')

        with open(self.login_path, 'r', encoding='utf-8') as fh:
            saved = yaml.safe_load(fh)
        # url validator strips trailing slash
        self.assertEqual(saved['url'], 'https://example.com')
        self.assertEqual(saved['dev_login']['username'], 'alice')
        self.assertEqual(saved['name'], 'alice')

    def test_dev_login_prints_welcome_message(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        with mock.patch('builtins.print') as mock_print:
            manager.dev_login('https://example.com', 'alice')

        printed = ' '.join(
            str(arg) for call in mock_print.call_args_list for arg in call.args
        )
        self.assertIn('alice', printed)

    def test_logout_removes_login_file(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')
        with mock.patch('builtins.print'):
            manager.dev_login('https://example.com', 'alice')
        self.assertTrue(os.path.exists(self.login_path))

        manager.logout()

        self.assertFalse(os.path.exists(self.login_path))

    def test_logout_when_file_missing_does_not_raise(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        # No login file present; should be a no-op
        manager.logout()

        self.assertFalse(os.path.exists(self.login_path))

    def test_using_osmo_token_returns_storage_value(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')
        with mock.patch('builtins.print'):
            manager.dev_login('https://example.com', 'alice')

        # dev_login does not flag osmo_token, so default False
        self.assertFalse(manager.using_osmo_token())

    def test_using_osmo_token_without_storage_raises(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        with self.assertRaises(osmo_errors.OSMOUserError):
            manager.using_osmo_token()

    def test_get_access_token_without_storage_raises(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        with self.assertRaises(osmo_errors.OSMOUserError):
            manager.get_access_token()

    def test_get_access_token_without_token_login_raises(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')
        with mock.patch('builtins.print'):
            manager.dev_login('https://example.com', 'alice')

        with self.assertRaises(osmo_errors.OSMOUserError):
            manager.get_access_token()

    def test_get_access_token_returns_refresh_token_when_present(self):
        token_jwt = _make_jwt({'exp': 9_999_999_999, 'name': 'TokenUser'})
        login_path = os.path.join(self.tmpdir, 'login.yaml')
        with open(login_path, 'w', encoding='utf-8') as fh:
            yaml.dump({
                'url': 'https://example.com',
                'token_login': {
                    'id_token': token_jwt,
                    'refresh_token': 'refresh-abc',
                },
            }, fh)
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        self.assertEqual(manager.get_access_token(), 'refresh-abc')


class LoginManagerRefreshTests(unittest.TestCase):
    """Tests for LoginManager.refresh_id_token."""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        env_patch = mock.patch.dict(
            os.environ, {common.OSMO_CONFIG_OVERRIDE: self.tmpdir})
        env_patch.start()
        self.addCleanup(env_patch.stop)
        self.addCleanup(lambda: shutil.rmtree(self.tmpdir, ignore_errors=True))

    def test_refresh_without_storage_raises(self):
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')

        with self.assertRaises(osmo_errors.OSMOUserError):
            manager.refresh_id_token()

    def test_refresh_with_dev_login_returns_without_writing(self):
        # dev_login storage has no token_login → login.refresh_id_token
        # short-circuits and returns None, so the manager should not rewrite
        # the file.
        manager = client.LoginManager(login.LoginConfig(), 'osmo-cli')
        with mock.patch('builtins.print'):
            manager.dev_login('https://example.com', 'alice')
        login_path = os.path.join(self.tmpdir, 'login.yaml')
        with open(login_path, 'rb') as fh:
            before = fh.read()

        manager.refresh_id_token()

        with open(login_path, 'rb') as fh:
            after = fh.read()
        self.assertEqual(before, after)


class ServiceClientInitTests(unittest.TestCase):
    """Tests for ServiceClient construction and login_manager property."""

    def test_init_exposes_login_manager(self):
        manager = mock.MagicMock()
        manager.user_agent = 'osmo-cli/test'

        service = client.ServiceClient(manager)

        self.assertIs(service.login_manager, manager)


class ServiceClientRequestTests(unittest.TestCase):
    """Tests for ServiceClient.request — covers HTTP method dispatch and
    header/URL construction."""

    def setUp(self):
        self.manager = mock.MagicMock()
        self.manager.url = 'https://example.com'
        self.manager.user_agent = 'osmo-cli/test'
        self.manager.login_storage.token_login = None
        self.manager.login_storage.dev_login = None
        self.service = client.ServiceClient(self.manager)

        session_patch = mock.patch('src.lib.utils.client.requests.Session')
        self.session_cls = session_patch.start()
        self.addCleanup(session_patch.stop)
        self.session = self.session_cls.return_value

        self.response = mock.MagicMock()
        self.response.status_code = 200
        self.response.text = '{"ok": true}'
        self.response.headers = {}

    def _wire(self, method_name: str):
        getattr(self.session, method_name).return_value = self.response

    def test_get_returns_parsed_json(self):
        self._wire('get')

        result = self.service.request(client.RequestMethod.GET, 'foo')

        self.assertEqual(result, {'ok': True})
        self.session.get.assert_called_once()

    def test_post_dispatches_to_session_post(self):
        self._wire('post')

        self.service.request(client.RequestMethod.POST, 'foo',
                             payload={'a': 1})

        self.session.post.assert_called_once()

    def test_put_dispatches_to_session_put(self):
        self._wire('put')

        self.service.request(client.RequestMethod.PUT, 'foo')

        self.session.put.assert_called_once()

    def test_delete_dispatches_to_session_delete(self):
        self._wire('delete')

        self.service.request(client.RequestMethod.DELETE, 'foo')

        self.session.delete.assert_called_once()

    def test_patch_dispatches_to_session_patch(self):
        self._wire('patch')

        self.service.request(client.RequestMethod.PATCH, 'foo')

        self.session.patch.assert_called_once()

    def test_url_built_from_login_manager_url_and_endpoint(self):
        self._wire('get')

        self.service.request(client.RequestMethod.GET, 'workflows/123')

        url = self.session.get.call_args.args[0]
        self.assertEqual(url, 'https://example.com/workflows/123')

    def test_default_headers_include_version_user_agent_and_content_type(self):
        self._wire('get')

        self.service.request(client.RequestMethod.GET, 'foo')

        headers = self.session.get.call_args.kwargs['headers']
        self.assertEqual(headers[version.VERSION_HEADER], str(version.VERSION))
        self.assertEqual(headers['User-Agent'], 'osmo-cli/test')
        self.assertEqual(headers['Content-Type'], 'application/json')

    def test_dev_login_sets_user_header(self):
        self._wire('get')
        dev = mock.MagicMock()
        dev.username = 'alice'
        self.manager.login_storage.dev_login = dev
        self.manager.login_storage.token_login = None

        self.service.request(client.RequestMethod.GET, 'foo')

        headers = self.session.get.call_args.kwargs['headers']
        self.assertEqual(headers[login.OSMO_USER_HEADER], 'alice')

    def test_token_login_sets_authorization_header(self):
        self._wire('get')
        token = mock.MagicMock()
        token.id_token = 'abc'
        token.username = None
        self.manager.login_storage.token_login = token
        self.manager.login_storage.dev_login = None

        self.service.request(client.RequestMethod.GET, 'foo')

        headers = self.session.get.call_args.kwargs['headers']
        self.assertEqual(headers[login.OSMO_AUTH_HEADER], 'Bearer abc')

    def test_token_login_with_osmo_login_dev_env_sets_user_header(self):
        self._wire('get')
        token = mock.MagicMock()
        token.id_token = 'abc'
        token.username = 'alice'
        self.manager.login_storage.token_login = token
        self.manager.login_storage.dev_login = None

        with mock.patch.dict(os.environ, {'OSMO_LOGIN_DEV': 'true'}):
            self.service.request(client.RequestMethod.GET, 'foo')

        headers = self.session.get.call_args.kwargs['headers']
        self.assertEqual(headers[login.OSMO_USER_HEADER], 'alice')

    def test_streaming_mode_returns_response_and_passes_stream_arg(self):
        self._wire('get')

        result = self.service.request(
            client.RequestMethod.GET, 'foo',
            mode=client.ResponseMode.STREAMING,
        )

        self.assertIs(result, self.response)
        kwargs = self.session.get.call_args.kwargs
        self.assertTrue(kwargs.get('stream'))
        self.assertIsNone(kwargs['timeout'])

    def test_request_calls_refresh_id_token(self):
        self._wire('get')

        self.service.request(client.RequestMethod.GET, 'foo')

        self.manager.refresh_id_token.assert_called_once()


class ServiceClientWebSocketTests(unittest.IsolatedAsyncioTestCase):
    """Tests for ServiceClient.create_websocket."""

    async def test_create_websocket_with_token_login_sets_auth_header(self):
        manager = mock.MagicMock()
        manager.user_agent = 'osmo-cli/test'
        token = mock.MagicMock()
        token.id_token = 'tok'
        manager.login_storage.token_login = token
        manager.login_storage.dev_login = None
        service = client.ServiceClient(manager)

        with mock.patch(
            'websockets.client.connect',
            new=mock.AsyncMock(return_value='WS'),
        ) as connect:
            result = await service.create_websocket(
                'wss://example.com', 'stream',
                params={'a': 'b'}, timeout=5,
            )

        self.assertEqual(result, 'WS')
        self.assertEqual(connect.call_args.args[0],
                         'wss://example.com/stream?a=b')
        kwargs = connect.call_args.kwargs
        self.assertEqual(kwargs['extra_headers'][login.OSMO_AUTH_HEADER],
                         'Bearer tok')
        self.assertIsNotNone(kwargs['ssl'])
        manager.refresh_id_token.assert_called_once()

    async def test_create_websocket_with_dev_login_uses_user_header(self):
        manager = mock.MagicMock()
        manager.user_agent = 'osmo-cli/test'
        manager.login_storage.token_login = None
        dev = mock.MagicMock()
        dev.username = 'alice'
        manager.login_storage.dev_login = dev
        service = client.ServiceClient(manager)

        with mock.patch(
            'websockets.client.connect',
            new=mock.AsyncMock(return_value='WS'),
        ) as connect:
            await service.create_websocket('ws://example.com', 'stream')

        self.assertEqual(connect.call_args.args[0], 'ws://example.com/stream')
        kwargs = connect.call_args.kwargs
        self.assertEqual(kwargs['extra_headers'][login.OSMO_USER_HEADER],
                         'alice')
        self.assertIsNone(kwargs['ssl'])


if __name__ == '__main__':
    unittest.main()
