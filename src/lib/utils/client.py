"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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
import dataclasses
import enum
import http.server
import json
import logging
import os
import ssl
import sys
import time
from typing import Dict, List, Optional, cast
from typing_extensions import assert_never
from urllib.parse import parse_qs, urlparse
import webbrowser

import certifi
import requests
import urllib3
import websockets
import websockets.client
import yaml

from . import client_configs, login, osmo_errors, version

CLIENT_USER_AGENT_PREFIX = 'osmo-cli'
LIB_USER_AGENT_PREFIX = 'osmo-lib'
PKCE_CALLBACK_TIMEOUT_SECONDS = 300


@dataclasses.dataclass
class BrowserAuthorizationCallback:
    """Authorization response delivered to the CLI loopback listener."""
    code: str | None = None
    error: str | None = None
    error_description: str | None = None


class _BrowserAuthorizationCallbackServer(http.server.HTTPServer):
    """Single-use loopback server for an OAuth authorization response."""

    def __init__(self, callback_port: int, expected_state: str,
                 timeout_seconds: float = PKCE_CALLBACK_TIMEOUT_SECONDS):
        super().__init__(('127.0.0.1', callback_port),
                         _BrowserAuthorizationCallbackHandler)
        self.callback: BrowserAuthorizationCallback | None = None
        self.expected_state = expected_state
        self.timeout_seconds = timeout_seconds

    @property
    def redirect_uri(self) -> str:
        return f'http://localhost:{self.server_port}'

    def wait_for_callback(self) -> BrowserAuthorizationCallback:
        deadline = time.monotonic() + self.timeout_seconds
        while self.callback is None:
            remaining_seconds = deadline - time.monotonic()
            if remaining_seconds <= 0:
                raise osmo_errors.OSMOUserError(
                    'Timed out waiting for browser authentication to complete. '
                    'If this environment cannot receive localhost callbacks, '
                    'retry with "--method code".')
            self.timeout = remaining_seconds
            self.handle_request()
        return self.callback


class _BrowserAuthorizationCallbackHandler(http.server.BaseHTTPRequestHandler):
    """Capture the authorization response without logging request details."""

    def do_GET(self):  # pylint: disable=invalid-name
        parsed_request = urlparse(self.path)
        if parsed_request.path != '/':
            self.send_error(404)
            return

        callback_server = cast(_BrowserAuthorizationCallbackServer, self.server)
        query = parse_qs(parsed_request.query, keep_blank_values=True)
        returned_state = query.get('state', [None])[0]
        error = query.get('error', [None])[0]
        error_description = query.get('error_description', [None])[0]
        code = query.get('code', [None])[0]

        if returned_state != callback_server.expected_state:
            self._send_browser_response(
                400, b'Authentication response rejected. Return to the OSMO CLI.')
            return
        if error:
            callback_server.callback = BrowserAuthorizationCallback(
                error=error,
                error_description=error_description,
            )
        elif code:
            callback_server.callback = BrowserAuthorizationCallback(code=code)
        else:
            callback_server.callback = BrowserAuthorizationCallback(
                error='invalid_response',
                error_description='The authorization response did not contain a code.',
            )

        callback = callback_server.callback
        success = callback.code is not None
        response = (
            b'Authentication complete. You can close this window.'
            if success else
            b'Authentication failed. Return to the OSMO CLI for details.'
        )
        self._send_browser_response(200 if success else 400, response)

    def _send_browser_response(self, status_code: int, response: bytes):
        self.send_response(status_code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format, *args):  # pylint: disable=redefined-builtin
        del format, args


class RequestMethod(enum.Enum):
    """ Represents a method for making http requests """
    PUT = 'PUT'
    POST = 'POST'
    GET = 'GET'
    DELETE = 'DELETE'
    PATCH = 'PATCH'


class ResponseMode(enum.Enum):
    # Return json from the response
    JSON = 'JSON'
    # Return the content of the response as text
    PLAIN_TEXT = 'PLAIN_TEXT'
    # Return the content of the response as binary
    BINARY = 'BINARY'
    # Return the response directly
    STREAMING = 'STREAMING'


def handle_response(response, mode: ResponseMode = ResponseMode.JSON):
    if response.headers.get(version.WARNING_HEADER) is not None:
        warning = base64.b64decode(
            response.headers.get(version.WARNING_HEADER)).decode()
        print(warning, file=sys.stderr)
    if response.status_code != 200:
        logging.error('Server responded with status code %s', response.status_code)

    if response.status_code >= 400 and response.status_code < 500:
        try:
            payload = json.loads(response.text)
        except json.decoder.JSONDecodeError as err:
            raise osmo_errors.OSMOUserError(
                response.text, status_code=response.status_code) from err

        if 'error_code' in payload:
            if payload['error_code'] in \
                    [member.value for member in osmo_errors.SubmissionErrorCode]:
                raise osmo_errors.OSMOSubmissionError(payload['message'],
                                                      workflow_id=payload.get('workflow_id', ''),
                                                      status_code=response.status_code)
            if payload['error_code'] == 'CREDENTIAL':
                raise osmo_errors.OSMOCredentialError(payload['message'],
                                                      workflow_id=payload.get('workflow_id', ''),
                                                      status_code=response.status_code)

            raise osmo_errors.OSMOUserError(payload['message'], status_code=response.status_code)
        else:
            raise osmo_errors.OSMOUserError(response.text, status_code=response.status_code)

    # Check for a 500 status code, indicating a server error
    if response.status_code >= 500:
        error_message = f'Status Code: {response.status_code}\nHeader:\n'
        for key, value in response.headers.items():
            error_message += f'  {key}: {value}\n'
        error_message += f'Body:\n{response.text}'
        raise osmo_errors.OSMOServerError(error_message, status_code=response.status_code)

    if mode == ResponseMode.PLAIN_TEXT:
        return response.text
    elif mode == ResponseMode.BINARY:
        return response.content
    elif mode == ResponseMode.STREAMING:
        return response
    else:
        return json.loads(response.text)


class LoginManager():
    """ Manages user login and allows making authenticated requests to OSMO """
    _login_storage: Optional[login.LoginStorage] = None
    _login_config: login.LoginConfig
    user_agent: str

    def __init__(self, config: login.LoginConfig, user_agent_prefix: str):
        self._login_config = config
        self.user_agent = f'{user_agent_prefix}/{version.VERSION}'

        # Do not allow IPV6 which doesn't work in some of our configurations
        urllib3.util.connection.HAS_IPV6 = False

        # Try to read the refresh token from the storage file
        login_dir = client_configs.get_client_config_dir()
        login_file = login_dir  + '/login.yaml'
        try:
            with open(os.path.expanduser(login_file), 'r', encoding='utf-8') as file:
                data = yaml.safe_load(file)
                if not isinstance(data, dict):
                    return
                self._login_storage = login.LoginStorage(**data)
        except FileNotFoundError:
            pass

    @property
    def netloc(self):
        if self._login_storage is None:
            raise osmo_errors.OSMOUserError('Must login first with "login" command')
        return urlparse(self._login_storage.url).netloc

    @property
    def url(self):
        if self._login_storage is None:
            raise osmo_errors.OSMOUserError('Must login first with "login" command')
        return self._login_storage.url

    @property
    def login_storage(self) -> login.LoginStorage:
        if self._login_storage is None:
            raise osmo_errors.OSMOUserError('Must login first with "login" command')
        return self._login_storage

    @property
    def login_config(self) -> login.LoginConfig:
        return self._login_config

    def device_code_login(self, url: str, device_endpoint: str | None):
        """ Log in using OAUTH2 device flow """
        # Generate a user code
        login_info = login.fetch_login_info(url)
        device_endpoint = device_endpoint or login_info['device_endpoint']
        client_id = self._login_config.client_id or login_info['device_client_id']

        response = requests.post(device_endpoint, data={
            'client_id': client_id,
            'scope': login.DEFAULT_OAUTH_SCOPE
        }, timeout=login.TIMEOUT, headers={'User-Agent': self.user_agent})

        result = handle_response(response)

        device_code  = result['device_code']
        user_code  = result['user_code']
        user_url = result['verification_uri']
        interval = result['interval']
        expire_time  = time.time() + int(result['expires_in'])

        # Prompt the user to visit the url and log in
        if 'message' in result:
            print(result['message'], flush=True)
        elif 'verification_uri_complete' in result:
            print(f'Visit {result['verification_uri_complete']} and complete authentication.')
        else:
            print(f'Visit {user_url} and enter the following code: {user_code}', flush=True)

        # Keep polling until the user finishes authenticating
        error = 'authorization_pending'
        while error == 'authorization_pending':
            # Check for timeout
            if time.time() > expire_time:
                raise osmo_errors.OSMOServerError('Did not complete device authentication in time!')

            # Try to get the credentials
            token_endpoint = self._login_config.token_or_default(url)
            result = requests.post(token_endpoint, data={
                'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
                'device_code': device_code,
                'client_id': client_id
            }, timeout=login.TIMEOUT, headers={'User-Agent': self.user_agent})
            result = result.json()
            error = result.get('error')

            # If still waiting on the user, sleep a while
            if error == 'authorization_pending':
                time.sleep(int(interval))

        # If we got some other error, raise an exception
        if error:
            raise osmo_errors.OSMOServerError(f'Unexpected error during device auth flow {error}')

        # Save the tokens
        self._login_storage = login.LoginStorage(
            url=url,
            token_login=login.TokenLoginStorage(
                id_token=result['id_token'],
                refresh_token=result['refresh_token'],
                refresh_url=token_endpoint,
                client_id=client_id
            )
        )
        self._save_login_info(self._login_storage, welcome=True)

    def pkce_login(self, url: str, browser_endpoint: str | None,
                   callback_port: int = 0):
        """Log in using OAuth authorization code flow with S256 PKCE."""
        if callback_port < 0 or callback_port > 65535:
            raise osmo_errors.OSMOUserError(
                'PKCE callback port must be between 0 and 65535')

        login_info = login.fetch_login_info(url)
        browser_endpoint = browser_endpoint or login_info.get('browser_endpoint')
        client_id = self._login_config.client_id or login_info.get('browser_client_id')
        token_endpoint = self._login_config.token_endpoint or login_info.get('token_endpoint')
        if not browser_endpoint:
            raise osmo_errors.OSMOUserError(
                'The OSMO service does not provide a browser endpoint for PKCE login')
        if not client_id:
            raise osmo_errors.OSMOUserError(
                'The OSMO service does not provide a browser client ID for PKCE login')
        if not token_endpoint:
            raise osmo_errors.OSMOUserError(
                'The OSMO service does not provide a token endpoint for PKCE login')
        login.validate_oauth_endpoint(browser_endpoint, 'authorization endpoint')
        login.validate_oauth_endpoint(token_endpoint, 'token endpoint')

        code_verifier = login.generate_pkce_code_verifier()
        code_challenge = login.create_pkce_code_challenge(code_verifier)
        state = login.generate_oauth_state()
        nonce = login.generate_oidc_nonce()
        try:
            callback_server = _BrowserAuthorizationCallbackServer(callback_port, state)
        except OSError as error:
            raise osmo_errors.OSMOUserError(
                f'Unable to listen for the PKCE callback on port {callback_port}: {error}') \
                from error

        with callback_server:
            authorization_url = login.construct_pkce_authorization_url(
                browser_endpoint=browser_endpoint,
                client_id=client_id,
                redirect_uri=callback_server.redirect_uri,
                state=state,
                nonce=nonce,
                code_challenge=code_challenge,
            )
            print('Complete authentication in your browser. If it does not open, visit:')
            print(authorization_url, flush=True)
            webbrowser.open(authorization_url)
            callback = callback_server.wait_for_callback()

        if callback.error:
            error_message = callback.error
            if callback.error_description:
                error_message += f': {callback.error_description}'
            raise osmo_errors.OSMOUserError(
                f'Browser authentication failed ({error_message})')
        if callback.code is None:
            raise osmo_errors.OSMOUserError(
                'Browser authentication did not return an authorization code')

        self._login_storage = login.authorization_code_login(
            url=url,
            token_endpoint=token_endpoint,
            client_id=client_id,
            authorization_code=callback.code,
            code_verifier=code_verifier,
            redirect_uri=callback_server.redirect_uri,
            expected_nonce=nonce,
            user_agent=self.user_agent,
        )
        self._save_login_info(self._login_storage, welcome=True)

    def owner_password_login(self, url: str, username: str, password: str):
        """ Log in using OAUTH2 resource owner password flow """
        self._login_storage = login.owner_password_login(self._login_config,
                                                         url, username, password, self.user_agent)
        self._save_login_info(self._login_storage, welcome=True)

    def dev_login(self, url: str, username: str):
        self._login_storage = login.dev_login(url, username)
        self._save_login_info(self._login_storage, welcome=True)

    def token_login(self, url: str, refresh_url: str, refresh_token: str):
        self._login_storage = login.token_login(url, refresh_url, refresh_token, self.user_agent)
        self._save_login_info(self._login_storage, welcome=True)

    def logout(self):
        self._token = None
        self._refresh_token = None
        try:
            login_dir = client_configs.get_client_config_dir()
            login_file = login_dir  + '/login.yaml'
            os.remove(os.path.expanduser(login_file))
        except FileNotFoundError:
            pass

    def _save_login_info(self, login_storage: login.LoginStorage, welcome: bool = False):
        login_dir = client_configs.get_client_config_dir()
        login_file = login_dir  + '/login.yaml'
        expanded_login_file = os.path.expanduser(login_file)
        file_descriptor = os.open(
            expanded_login_file,
            os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
            0o600,
        )
        try:
            os.fchmod(file_descriptor, 0o600)
        except OSError:
            os.close(file_descriptor)
            raise
        with os.fdopen(file_descriptor, 'w', encoding='utf-8') as file:
            login_dict = login_storage.model_dump()
            login_dict['name'] = login_storage.name
            yaml.dump(login_dict, file)

        if welcome:
            print(f'Successfully logged in. Welcome {login_storage.name}.')

    def refresh_id_token(self):
        # If there is no login information, prompt the user to login
        if self._login_storage is None:
            raise osmo_errors.OSMOUserError('Must login first with "login" command')
        new_token = login.refresh_id_token(self._login_config, self.user_agent,
                                           self._login_storage.token_login,
                                           self._login_storage.osmo_token)
        if not new_token:
            return
        self._login_storage.token_login = new_token

        self._save_login_info(self._login_storage)

    def using_osmo_token(self):
        if self._login_storage is None:
            raise osmo_errors.OSMOUserError('Must login first with "login" command')
        return self._login_storage.osmo_token

    def get_access_token(self) -> str | None:
        if self._login_storage is None:
            raise osmo_errors.OSMOUserError('Must login first with "login" command')
        if self._login_storage.token_login is None:
            raise osmo_errors.OSMOUserError('Must login first with token')
        return self._login_storage.token_login.refresh_token


class ServiceClient():
    """ OSMO Service Client that can make authenticated requests using a LoginManager """
    _login_manager: LoginManager
    _user_agent: str

    def __init__(self, login_manager: LoginManager):
        self._login_manager = login_manager
        self._user_agent = login_manager.user_agent

        # Do not allow IPV6 which doesn't work in some of our configurations
        urllib3.util.connection.HAS_IPV6 = False

    @property
    def login_manager(self) -> LoginManager:
        return self._login_manager

    def request(self, method: RequestMethod, endpoint: str,
                headers: Dict | None = None, payload: Dict | List | str | None = None,
                params: Dict | None = None, mode: ResponseMode = ResponseMode.JSON,
                version_header: bool = True):
        # Build the request URL
        url = f'{self._login_manager.url}/{endpoint}'

        # Make sure the tokens are up to date
        self._login_manager.refresh_id_token()

        # Add appropriate headers based on login method
        if not headers:
            headers = {}
        if self._login_manager.login_storage.token_login is not None:
            token = self._login_manager.login_storage.token_login.id_token
            headers[login.OSMO_AUTH_HEADER] = f'Bearer {token}'
            dev_env_var = os.getenv('OSMO_LOGIN_DEV') in ['true', 'True']
            if dev_env_var and \
                self._login_manager.login_storage.token_login.username:
                headers[login.OSMO_USER_HEADER] = \
                    self._login_manager.login_storage.token_login.username
        if self._login_manager.login_storage.dev_login is not None:
            headers[login.OSMO_USER_HEADER] = self._login_manager.login_storage.dev_login.username
        if version_header:
            headers[version.VERSION_HEADER] = str(version.VERSION)
        headers['Content-Type'] = 'application/json'
        headers['User-Agent'] = self._user_agent

        # Enable streaming for chunked transfer encoding
        extra_args = {}
        timeout: Optional[int] = login.TIMEOUT
        if mode == ResponseMode.STREAMING:
            extra_args['stream'] = True
            timeout = None

        retry_count = 0
        if version_header:
            retry_count = 5
        retry_strategy = urllib3.util.retry.Retry(
            total=retry_count
        )
        session = requests.Session()
        netloc = urlparse(url).scheme
        session.mount(
            f'{netloc}://',
            requests.adapters.HTTPAdapter(max_retries=retry_strategy)
        )

        # Call the request method
        match method:
            case RequestMethod.GET:
                response = session.get(
                    url,
                    params=params,
                    json=payload,
                    headers=headers,
                    timeout=timeout,
                    **extra_args,
                )
            case RequestMethod.POST:
                response = session.post(
                    url,
                    params=params,
                    json=payload,
                    headers=headers,
                    timeout=timeout,
                    **extra_args,
                )
            case RequestMethod.PUT:
                response = session.put(
                    url,
                    params=params,
                    json=payload,
                    headers=headers,
                    timeout=timeout,
                    **extra_args,
                )
            case RequestMethod.DELETE:
                response = session.delete(
                    url,
                    params=params,
                    json=payload,
                    headers=headers,
                    timeout=timeout,
                    **extra_args,
                )
            case RequestMethod.PATCH:
                response = session.patch(
                    url,
                    params=params,
                    json=payload,
                    headers=headers,
                    timeout=timeout,
                    **extra_args,
                )
            case _ as unreachable:
                assert_never(unreachable)

        resp = handle_response(response, mode)
        return resp

    async def create_websocket(
            self, address: str, endpoint: str, headers: Dict | None = None,
            params: Dict | None = None, timeout: int = 10
        ) -> websockets.WebSocketClientProtocol: # type: ignore
        # Make sure the tokens are up to date
        self._login_manager.refresh_id_token()

        query_string = ''
        if params is not None:
            query_string = '&'.join([f'{key}={value}' for key, value in params.items()])
            query_string = f'?{query_string}'
        url = f'{address}/{endpoint}{query_string}'

        # Add appropriate headers based on login method
        if not headers:
            headers = {}
        if self._login_manager.login_storage.token_login is not None:
            token = self._login_manager.login_storage.token_login.id_token
            headers[login.OSMO_AUTH_HEADER] = f'Bearer {token}'
        if self._login_manager.login_storage.dev_login is not None:
            headers[login.OSMO_USER_HEADER] = self._login_manager.login_storage.dev_login.username
        headers[version.VERSION_HEADER] = str(version.VERSION)
        headers['User-Agent'] = self._user_agent

        ssl_context = None
        if url.startswith('wss'):
            ssl_context = ssl.create_default_context(cafile=certifi.where())
        client_websocket = await websockets.client.connect(
            url, extra_headers=headers, open_timeout=timeout, ssl=ssl_context)
        return client_websocket
