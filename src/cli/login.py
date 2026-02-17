"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES.
All rights reserved.

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

import pydantic
import shtab

from src.lib.utils import client, login, osmo_errors


# The url to get an id_token using device flow
DEFAULT_DEVICE_AUTH_PATH = 'realms/osmo/protocol/openid-connect/auth/device'


def setup_parser(parser: argparse._SubParsersAction):
    '''
    Configures parser to be ready to handle login.

    Args:
        parser: The parser to be configured.
    '''
    login_parser = parser.add_parser('login',
                                     help='Log in with device flow or client credentials flow.')
    login_parser.set_defaults(func=_login)
    login_parser.add_argument('url', nargs='?', default=None,
                              help='The url of the osmo server to connect to. '
                                   'If not provided, uses the last used url.')
    login_parser.add_argument('--device-endpoint',
                              help='The url to use to completed device flow authentication. ' +
                                   'If not provided, it will be fetched from the service.')
    login_parser.add_argument('--method', default='code', type=str,
                              choices=('code', 'password', 'token', 'dev'),
                              help='code: Get a device code and url to log in securely ' +
                                   'through browser. ' +
                                   'password: Provide username and password directly ' +
                                   'through CLI. ' +
                                   'token: Read an idToken directly from a file.')
    login_parser.add_argument('--username',
                              help='Username if logging in with credentials. This should ' +
                                   'only be used for service accounts that cannot ' +
                                   'authenticate via web browser.')
    password_group = login_parser.add_mutually_exclusive_group()
    password_group.add_argument('--password', help='Password if logging in with credentials.')
    password_group.add_argument('--password-file', type=argparse.FileType('r'),
                                help='File containing password if '\
                                     'logging in with credentials.').complete = shtab.FILE

    token_group = login_parser.add_mutually_exclusive_group()
    token_group.add_argument('--token', help='Token if logging in with credentials.')
    token_group.add_argument('--token-file', type=argparse.FileType('r'),
                             help='File containing the refresh token.').complete = shtab.FILE

    logout_parser = parser.add_parser('logout',
        help='Remove stored access tokens.')
    logout_parser.set_defaults(func=_logout)


def _login(service_client: client.ServiceClient, args: argparse.Namespace):
    # Get the url from args or fall back to last used url
    try:
        url = args.url or service_client.login_manager.login_storage.url
    except osmo_errors.OSMOUserError as error:
        raise osmo_errors.OSMOUserError(
            'No url provided and no previous login found. '
            'Please provide a url: osmo login <url>') from error

    # Validate the url
    class UrlValidator(pydantic.BaseModel):
        url: pydantic.AnyHttpUrl
    try:
        _ = UrlValidator(url=url)
    except pydantic.error_wrappers.ValidationError as error:
        raise osmo_errors.OSMOUserError(f'Bad url {url}: {error}')

    print(f'Logging in to {url}')

    # Parse out the password and username
    username = args.username
    password = args.password
    if args.password_file is not None:
        password = args.password_file.read().strip('\n')
        args.password_file.close()

    # Construct device endpoint
    device_endpoint = args.device_endpoint
    client_id: str | None = None
    if not device_endpoint:
        login_info = login.fetch_login_info(url)
        device_endpoint = login_info['device_endpoint']
        client_id = login_info['device_client_id']

    # Login through device code flow
    if args.method == 'code':
        service_client.login_manager.device_code_login(url, device_endpoint, client_id)

    # Login through resource owner password flow
    elif args.method == 'password':
        if username is None:
            raise osmo_errors.OSMOUserError('Must provide username')
        if password is None:
            raise osmo_errors.OSMOUserError('Must provide password')
        service_client.login_manager.owner_password_login(url, username, password)

    # Login by directly reading the refresh token from a file or argument
    elif args.method == 'token':
        if args.token_file:
            token = args.token_file.read().strip()
            args.token_file.close()
        elif args.token:
            token = args.token
        else:
            raise osmo_errors.OSMOUserError('Must provide token file with --token_file or --token')
        refresh_url = login.construct_token_refresh_url(url, token)
        service_client.login_manager.token_login(url, refresh_url)

    # For developers, simply send username as a header
    else:
        if username is None:
            raise osmo_errors.OSMOUserError('Must provide username')
        service_client.login_manager.dev_login(url, username)


def _logout(service_client: client.ServiceClient, args: argparse.Namespace):
    # pylint: disable=unused-argument
    service_client.login_manager.logout()
    print('Successfully logged out.')
