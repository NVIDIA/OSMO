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

import asyncio
import logging
import os
from typing import Dict, Tuple

import requests  # type: ignore

from src.lib.utils import login, osmo_errors, version
from src.operator.utils import objects

OPERATOR_USER_AGENT_PREFIX = 'osmo-operator'

def get_login_info(
        config: objects.BackendBaseConfig
    ) -> login.LoginStorage:
    # For developers, simply send username as a header
    user_agent=f'{OPERATOR_USER_AGENT_PREFIX}/{version.VERSION}'
    if config.method == 'dev':
        if config.username is None:
            raise osmo_errors.OSMOUserError('Must provide username for dev')
        return login.dev_login(config.service_url, config.username)
    else:
        if config.login_method == 'password':
            if config.username is None:
                raise osmo_errors.OSMOUserError('Must provide username')
            if config.password_file is not None:
                if not os.path.exists(config.password_file):
                    raise osmo_errors.OSMOUserError(
                        f'The file {config.password_file} does not exist!')
                with open(config.password_file, 'r', encoding='utf-8') as f:
                    password = f.read().strip('\n')
            elif config.password is not None:
                password = config.password
            else:
                raise osmo_errors.OSMOUserError('Must provide password')
            return login.owner_password_login(
                config, config.service_url, config.username, password, user_agent=user_agent)
        elif config.login_method == 'token':
            if config.token_file is not None:
                if not os.path.exists(config.token_file):
                    raise osmo_errors.OSMOUserError(
                        f'The file {config.token_file} does not exist!')
                with open(config.token_file, 'r', encoding='utf-8') as f:
                    token = f.read().strip('\n')
            elif config.token is not None:
                token = config.token
            else:
                raise osmo_errors.OSMOUserError('Must provide token')
            return login.token_login(
                config.service_url,
                login.construct_token_refresh_url(config.service_url, token),
                user_agent=user_agent,
            )
        else:
            raise osmo_errors.OSMOError(f'Invalid login method: {config.login_method}')


def refresh_id_token(
        config: objects.BackendBaseConfig,
        login_info: login.LoginStorage
    ) -> login.LoginStorage:
    new_login = login.refresh_id_token(
        config,
        user_agent=f'{OPERATOR_USER_AGENT_PREFIX}/{version.VERSION}',
        token_login_storage=login_info.token_login
    )
    if new_login:
        login_info.token_login = new_login
    return login_info


def get_headers_and_login_info(
        config: objects.BackendBaseConfig,
        login_info: login.LoginStorage | None = None
    ) -> Tuple[login.LoginStorage, Dict]:
    if login_info:
        login_info = refresh_id_token(config, login_info)
    else:
        login_info = get_login_info(config)

    # For developers, simply send username as a header
    headers = {}
    if config.method == 'dev' and login_info.dev_login:
        headers[login.OSMO_USER_HEADER] = login_info.dev_login.username
    elif login_info.token_login:
        headers[login.OSMO_AUTH_HEADER] = login_info.token_login.id_token
    return login_info, headers


async def get_headers(config: objects.BackendBaseConfig,
                      login_info: login.LoginStorage | None = None) \
    -> Tuple[login.LoginStorage, Dict]:
    while True:
        try:
            login_info, headers = get_headers_and_login_info(config, login_info)
            return login_info, headers
        except (osmo_errors.OSMOUserError,
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
            requests.exceptions.TooManyRedirects) as err:
            logging.info('Connection failed with error: %s\nWaiting and reconnecting...', {err})
        await asyncio.sleep(5)  # Wait before reconnecting
