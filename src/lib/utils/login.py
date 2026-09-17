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

import base64
import hashlib
import json
import os
import secrets
import time
from typing import List, Literal
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import pydantic
import requests  # type: ignore
import urllib3

from . import osmo_errors


# The authorization header used by OSMO.
OSMO_AUTH_HEADER = 'Authorization'
# If developer mode, the header to pass the osmo user in
OSMO_USER_HEADER = 'x-osmo-user'
OSMO_USER_ROLES = 'x-osmo-roles'
OSMO_TOKEN_NAME_HEADER = 'x-osmo-token-name'
OSMO_ALLOWED_POOLS = 'x-osmo-allowed-pools'
# Don't use a token that will expire within the next N seconds
EXPIRE_WINDOW = 3
TIMEOUT = 60
DEFAULT_TOKEN_AUTH_PATH = 'realms/osmo/protocol/openid-connect/token'
DEFAULT_OAUTH_SCOPE = 'openid offline_access profile'
PKCE_CODE_CHALLENGE_METHOD = 'S256'
PKCE_CODE_VERIFIER_BYTES = 64


def fetch_login_info(url: str):
    login_url = os.path.join(url, 'api/auth/login')
    result = requests.get(login_url, timeout=TIMEOUT)
    if result.status_code >= 300 or result.status_code < 200:
        raise osmo_errors.OSMOUserError(f'Unexpected status code ({result.status_code}) when ' \
                                        f'fetching login info from {login_url}: {result.text}')
    return result.json()


def generate_pkce_code_verifier() -> str:
    """Generate an RFC 7636 code verifier using URL-safe characters."""
    return secrets.token_urlsafe(PKCE_CODE_VERIFIER_BYTES)


def create_pkce_code_challenge(code_verifier: str) -> str:
    """Derive an S256 PKCE challenge from a code verifier."""
    digest = hashlib.sha256(code_verifier.encode('ascii')).digest()
    return base64.urlsafe_b64encode(digest).decode('ascii').rstrip('=')


def generate_oauth_state() -> str:
    """Generate state used to bind the authorization response to the request."""
    return secrets.token_urlsafe(32)


def generate_oidc_nonce() -> str:
    """Generate a nonce used to bind an ID token to an authorization request."""
    return secrets.token_urlsafe(32)


def construct_pkce_authorization_url(browser_endpoint: str, client_id: str,
                                     redirect_uri: str, state: str,
                                     nonce: str, code_challenge: str) -> str:
    """Construct an OAuth authorization URL for an S256 PKCE flow."""
    parsed_endpoint = urlparse(browser_endpoint)
    query = parse_qsl(parsed_endpoint.query, keep_blank_values=True)
    query.extend([
        ('client_id', client_id),
        ('response_type', 'code'),
        ('redirect_uri', redirect_uri),
        ('response_mode', 'query'),
        ('scope', DEFAULT_OAUTH_SCOPE),
        ('state', state),
        ('nonce', nonce),
        ('code_challenge', code_challenge),
        ('code_challenge_method', PKCE_CODE_CHALLENGE_METHOD),
    ])
    return urlunparse(parsed_endpoint._replace(query=urlencode(query)))


def validate_oauth_endpoint(endpoint: str, endpoint_name: str) -> None:
    """Require OAuth authorization and token endpoints to use HTTPS."""
    if not isinstance(endpoint, str):
        raise osmo_errors.OSMOUserError(
            f'The OAuth {endpoint_name} must use HTTPS')
    parsed_endpoint = urlparse(endpoint)
    if parsed_endpoint.scheme.lower() != 'https' or not parsed_endpoint.netloc:
        raise osmo_errors.OSMOUserError(
            f'The OAuth {endpoint_name} must use HTTPS')


class LoginConfig(pydantic.BaseModel):
    """ Manages configuration specific to the login """
    username: str | None = pydantic.Field(
        default=None,
        description='The username to sign in with.',
        json_schema_extra={'command_line': 'username'})
    password: str | None = pydantic.Field(
        default=None,
        description='The password to sign in with.',
        json_schema_extra={'command_line': 'password', 'env': 'OSMO_LOGIN_PASSWORD'})
    password_file: str | None = pydantic.Field(
        default=None,
        description='The password stored in a file to sign in with.',
        json_schema_extra={'command_line': 'password_file'})
    token: str | None = pydantic.Field(
        default=None,
        description='The access token to sign in with.',
        json_schema_extra={'command_line': 'token', 'env': 'OSMO_LOGIN_TOKEN'})
    token_file: str | None = pydantic.Field(
        default=None,
        description='The file containing the access token to sign in with.',
        json_schema_extra={'command_line': 'token_file'})
    token_endpoint: str | None = pydantic.Field(
        default = None,
        description='The url to get a token from device auth, client auth, or refresh token.',
        json_schema_extra={'command_line': 'token_endpoint'})
    client_id: str | None = pydantic.Field(
        default=None,
        description='The client id for the OSMO application.',
        json_schema_extra={'command_line': 'client_id'})
    login_method: Literal['password', 'token'] | None = pydantic.Field(
        default='password',
        description='The method to use to login, either "password" or "token". '
                    'Defaults to "password".',
        json_schema_extra={'command_line': 'login_method'})

    def token_or_default(self, login_url: str) -> str:
        if self.token_endpoint is not None:
            return self.token_endpoint
        login_info = fetch_login_info(login_url)
        return login_info['token_endpoint']


class Jwt:
    """ Class to represent a json web token. """
    def __init__(self, token: str):
        self.token = token
        _, payload, _ = token.split('.')
        self.claims = json.loads(base64.urlsafe_b64decode(payload + '==').decode('utf-8'))

    @property
    def expired(self) -> bool:
        return self.claims['exp'] - EXPIRE_WINDOW < time.time()

    def __str__(self) -> str:
        return self.token


class TokenLoginStorage(pydantic.BaseModel):
    """Stores id_token and refresh_token for logging in"""
    refresh_token: str | None = None
    id_token: str
    refresh_url: str | None = None
    username: str | None = None
    client_id: str | None = None
    _id_token_jwt: Jwt | None = pydantic.PrivateAttr(None)

    @property
    def id_token_jwt(self) -> Jwt:
        if self._id_token_jwt is None:
            self._id_token_jwt = Jwt(self.id_token)
        return self._id_token_jwt

    def update_id_token(self, id_token: str) -> None:
        self.id_token = id_token
        self._id_token_jwt = None


class DevLoginStorage(pydantic.BaseModel):
    """Stores info trying to provide username directly as developer"""
    username: str


class LoginStorage(pydantic.BaseModel):
    """Stores information needed to login and reach out to server"""
    token_login: TokenLoginStorage | None = None
    dev_login: DevLoginStorage | None = None
    url: str
    osmo_token: bool = False

    @pydantic.field_validator('url')
    @classmethod
    def replace_url_without_slash(cls, login_url: str):
        return login_url.rstrip('/')

    @pydantic.model_validator(mode='before')
    @classmethod
    def validate_one_login_type(cls, values):
        if not isinstance(values, dict):
            return values
        fields = ('token_login', 'dev_login')
        login_fields = [field for field in fields if values.get(field) is not None]
        if len(login_fields) != 1:
            raise ValueError(f'Invalid login info, must contain exactly one of {fields}')
        return values

    @property
    def name(self) -> str:
        if self.token_login is not None and \
            'name' in self.token_login.id_token_jwt.claims:
            return self.token_login.id_token_jwt.claims['name']
        elif self.dev_login is not None:
            return self.dev_login.username
        else:
            return ''


def dev_login( url: str, username: str) -> LoginStorage:
    return LoginStorage(
        url=url,
        dev_login=DevLoginStorage(
            username=username
        )
    )


def owner_password_login(config: LoginConfig,
                         url: str,
                         username: str,
                         password: str,
                         user_agent: str| None,) -> LoginStorage:
    """ Log in using OAUTH2 resource owner password flow """
    # Do not allow IPV6 which doesn't work in some of our configurations
    urllib3.util.connection.HAS_IPV6 = False

    headers = {}
    if user_agent:
        headers['User-Agent'] = user_agent
    login_info = fetch_login_info(url)
    token_endpoint = config.token_endpoint or login_info['token_endpoint']
    result = requests.post(token_endpoint, data={
        'client_id': config.client_id or login_info['device_client_id'],
        'username': username,
        'password': password,
        'grant_type': 'password',
        'scope': DEFAULT_OAUTH_SCOPE
    }, timeout=TIMEOUT, headers=headers)
    if result.status_code != 200:
        raise osmo_errors.OSMOServerError(f'Failed to log in: {result.text}')
    result_json = result.json()

    # Save the results
    return LoginStorage(
        url=url,
        token_login=TokenLoginStorage(
            id_token=result_json['id_token'],
            refresh_token=result_json['refresh_token'],
            refresh_url=token_endpoint
        )
    )


def authorization_code_login(url: str, token_endpoint: str, client_id: str,
                             authorization_code: str, code_verifier: str,
                             redirect_uri: str, expected_nonce: str,
                             user_agent: str | None) -> LoginStorage:
    """Exchange an OAuth authorization code using an RFC 7636 verifier."""
    validate_oauth_endpoint(token_endpoint, 'token endpoint')
    headers = {}
    if user_agent:
        headers['User-Agent'] = user_agent
    result = requests.post(token_endpoint, data={
        'grant_type': 'authorization_code',
        'client_id': client_id,
        'code': authorization_code,
        'code_verifier': code_verifier,
        'redirect_uri': redirect_uri,
        'scope': DEFAULT_OAUTH_SCOPE,
    }, timeout=TIMEOUT, headers=headers, allow_redirects=False)
    if result.status_code != 200:
        raise osmo_errors.OSMOServerError(
            f'Failed to exchange authorization code: {result.text}')
    result_json = result.json()
    id_token = result_json.get('id_token')
    if not id_token:
        raise osmo_errors.OSMOServerError(
            'The identity provider did not return an ID token')
    if Jwt(id_token).claims.get('nonce') != expected_nonce:
        raise osmo_errors.OSMOServerError(
            'The identity provider returned an ID token with an invalid nonce')

    return LoginStorage(
        url=url,
        token_login=TokenLoginStorage(
            id_token=id_token,
            refresh_token=result_json.get('refresh_token'),
            refresh_url=token_endpoint,
            client_id=client_id,
        )
    )


def construct_token_refresh_url(url: str) -> str:
    return os.path.join(url, 'api/auth/jwt/access_token')


def token_login(url: str,
                refresh_url: str,
                refresh_token: str,
                user_agent: str | None) -> LoginStorage:
    headers = {}
    if user_agent:
        headers['User-Agent'] = user_agent
    result = requests.post(refresh_url, json={'token': refresh_token},
                           timeout=TIMEOUT, headers=headers)
    if result.status_code >= 300:
        raise osmo_errors.OSMOServerError('Unable to refresh login token (status code ' \
            f'{result.status_code}): {result.text}\n' \
            f'Please re-login with "osmo login"')
    result = result.json()
    return LoginStorage(
        url=url,
        token_login=TokenLoginStorage(
            id_token=result['token'],
            refresh_url=refresh_url,
            refresh_token=refresh_token
        ),
        osmo_token=True
    )


def refresh_id_token(config: LoginConfig, user_agent: str | None,
                     token_login_storage: TokenLoginStorage | None,
                     osmo_token: bool = False) -> TokenLoginStorage | None:
    # If a refresh token is not used, then exit
    if token_login_storage is None:
        return None

    # If the token isn't expired, then no need to refresh
    if not token_login_storage.id_token_jwt.expired:
        return None

    if not osmo_token and token_login_storage.refresh_token is None:
        raise osmo_errors.OSMOUserError('Token is expired, but no refresh token is present')

    if token_login_storage.refresh_url is None:
        raise osmo_errors.OSMOUserError('No token refresh url provided, please login again')

    token_endpoint = token_login_storage.refresh_url

    headers = {}
    if user_agent:
        headers['User-Agent'] = user_agent

    if osmo_token:
        result = requests.post(token_login_storage.refresh_url,
                               json={'token': token_login_storage.refresh_token},
                               timeout=TIMEOUT, headers=headers)
    else:
        validate_oauth_endpoint(token_endpoint, 'token endpoint')
        result = requests.post(token_endpoint, data={
            'grant_type': 'refresh_token',
            'refresh_token': token_login_storage.refresh_token,
            'client_id': token_login_storage.client_id or config.client_id,
        }, timeout=TIMEOUT, headers=headers, allow_redirects=False)

    if result.status_code >= 300:
        raise osmo_errors.OSMOServerError('Unable to refresh login token (status code ' \
            f'{result.status_code}): {result.text}\n' \
            f'Please re-login with "osmo login"')
    result_json = result.json()
    if not osmo_token:
        refreshed_id_token = result_json.get('id_token')
        if not refreshed_id_token:
            raise osmo_errors.OSMOServerError(
                'The identity provider did not return an ID token while refreshing login.\n'
                'Please re-login with "osmo login"')
        token_login_storage.refresh_token = result_json.get(
            'refresh_token', token_login_storage.refresh_token)
        token_login_storage.update_id_token(refreshed_id_token)
    else:
        token_login_storage.update_id_token(result_json['token'])
    return token_login_storage


def construct_roles_list(roles_header: str | None) -> List[str]:
    return roles_header.split(',') if roles_header else []


def parse_allowed_pools(allowed_pools_header: str | None) -> List[str]:
    if not allowed_pools_header:
        return []
    return [pool.strip() for pool in allowed_pools_header.split(',') if pool.strip()]
