"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import json
import os
import time
from typing import List, Literal
from urllib.parse import urlencode, urlparse

import pydantic
import requests  # type: ignore
import urllib3

from . import osmo_errors


# The authorization header used by OSMO.
# TODO: Use 'Authorization: Bearer ...'  header envoy is configuredto use this
OSMO_AUTH_HEADER = 'x-osmo-auth'
# If developer mode, the header to pass the osmo user in
OSMO_USER_HEADER = 'x-osmo-user'
OSMO_USER_ROLES = 'x-osmo-roles'
# Don't use a token that will expire within the next N seconds
EXPIRE_WINDOW = 3
TIMEOUT = 60
DEFAULT_TOKEN_AUTH_PATH = 'realms/osmo/protocol/openid-connect/token'


def fetch_login_info(url: str):
    login_url = os.path.join(url, 'api/auth/login')
    result = requests.get(login_url, timeout=TIMEOUT)
    if result.status_code >= 300 or result.status_code < 200:
        raise osmo_errors.OSMOUserError(f'Unexpected status code ({result.status_code}) when ' \
                                        f'fetching login info from {login_url}: {result.text}')
    return result.json()


class LoginConfig(pydantic.BaseModel):
    """ Manages configuration specific to the login """
    username: str | None = pydantic.Field(
        command_line='username',
        description='The username to sign in with.')
    password: str | None = pydantic.Field(
        command_line='password',
        default=None,
        env='OSMO_LOGIN_PASSWORD',
        description='The password to sign in with.')
    password_file: str | None = pydantic.Field(
        command_line='password_file',
        default=None,
        description='The password stored in a file to sign in with.')
    token: str | None = pydantic.Field(
        command_line='token',
        default=None,
        env='OSMO_LOGIN_TOKEN',
        description='The access token to sign in with.')
    token_file: str | None = pydantic.Field(
        command_line='token_file',
        default=None,
        description='The file containing the access token to sign in with.')
    token_endpoint: str | None = pydantic.Field(
        command_line='token_endpoint',
        default = None,
        description='The url to get a token from device auth, client auth, or refresh token.')
    client_id: str = pydantic.Field(
        command_line='client_id',
        default='osmo-device',
        description='The client id for the OSMO application.')
    login_method: Literal['password', 'token'] | None = pydantic.Field(
        command_line='login_method',
        default='password',
        description='The method to use to login, either "password" or "token". '
                    'Defaults to "password".')

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
    refresh_token: str | None
    id_token: str
    refresh_url: str | None
    username: str | None
    _id_token_jwt: Jwt | None = pydantic.PrivateAttr(None)

    @property
    def id_token_jwt(self) -> Jwt:
        if self._id_token_jwt is None:
            self._id_token_jwt = Jwt(self.id_token)
        return self._id_token_jwt


class DevLoginStorage(pydantic.BaseModel):
    """Stores info trying to provide username directly as developer"""
    username: str


class LoginStorage(pydantic.BaseModel):
    """Stores information needed to login and reach out to server"""
    token_login: TokenLoginStorage | None = None
    dev_login: DevLoginStorage | None = None
    url: str
    osmo_token: bool = False

    @pydantic.validator('url')
    @classmethod
    def replace_url_without_slash(cls, login_url: str):
        return login_url.rstrip('/')

    @classmethod
    @pydantic.root_validator
    def validate_one_login_type(cls, values):
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
                         user_agent: str| None) -> LoginStorage:
    """ Log in using OAUTH2 resource owner password flow """
    # Do not allow IPV6 which doesn't work in some of our configurations
    urllib3.util.connection.HAS_IPV6 = False

    headers = {}
    if user_agent:
        headers['User-Agent'] = user_agent
    token_endpoint = config.token_or_default(url)
    result = requests.post(token_endpoint, data={
        'client_id': config.client_id,
        'username': username,
        'password': password,
        'grant_type': 'password',
        'scope': 'openid offline_access profile'
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


def construct_token_refresh_url(url: str, token: str) -> str:
    return os.path.join(url, f'api/auth/jwt/access_token?{urlencode({"access_token": token})}')


def token_login(url: str,
                refresh_url: str,
                user_agent: str| None) -> LoginStorage:
    headers = {}
    if user_agent:
        headers['User-Agent'] = user_agent
    result = requests.get(refresh_url, timeout=TIMEOUT, headers=headers)
    if result.status_code >= 300:
        raise osmo_errors.OSMOServerError('Unable to refresh login token (status code ' \
            f'{result.status_code}): {result.text}\n' \
            f'Please re-login with "osmo login"')
    result = result.json()
    return LoginStorage(
        url=url,
        token_login=TokenLoginStorage(
            id_token=result['token'],
            refresh_url=refresh_url
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
        result = requests.get(token_login_storage.refresh_url, timeout=TIMEOUT, headers=headers)
    else:
        result = requests.post(token_endpoint, data={
            'grant_type': 'refresh_token',
            'refresh_token': token_login_storage.refresh_token,
            'client_id': config.client_id,
        }, timeout=TIMEOUT, headers=headers)

    if result.status_code >= 300:
        raise osmo_errors.OSMOServerError('Unable to refresh login token (status code ' \
            f'{result.status_code}): {result.text}\n' \
            f'Please re-login with "osmo login"')
    result_json = result.json()
    if not osmo_token:
        token_login_storage.refresh_token = result_json['refresh_token']
        token_login_storage.id_token = result_json['id_token']
    else:
        token_login_storage.id_token = result_json['token']
    return token_login_storage


def construct_roles_list(roles_header: str | None) -> List[str]:
    return roles_header.split(',') if roles_header else []


def fetch_token_from_refresh_url(refresh_url: str) -> str | None:
    parsed = urlparse(refresh_url)
    query_params = dict(param.split('=') for param in parsed.query.split('&'))
    return query_params.get('access_token', None)
