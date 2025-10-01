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
import datetime
import secrets
import time
from typing import List, Optional

import fastapi

from src.lib.utils import common, login, osmo_errors
from src.utils.job import task as task_lib
from src.service.core.auth import objects
from src.utils import auth, connectors


router = fastapi.APIRouter(
    tags = ['Auth API']
)


@router.get('/api/auth/login', include_in_schema=False)
def get_login_info() -> auth.LoginInfo:
    postgres = connectors.PostgresConnector.get_instance()
    service_config = postgres.get_service_configs()
    return service_config.service_auth.login_info


@router.get('/api/auth/keys', include_in_schema=False)
def get_keys():
    postgres = connectors.PostgresConnector.get_instance()
    service_config = postgres.get_service_configs()
    return service_config.service_auth.get_keyset()


@router.get('/api/auth/refresh_token')
@router.get('/api/auth/jwt/refresh_token')
def get_new_jwt_token(refresh_token: str, workflow_id: str,
                      group_name: str, task_name: str, retry_id: int = 0):
    """
    API to fetch for a new access token using a refresh token.
    """
    postgres = connectors.PostgresConnector.get_instance()
    service_config = postgres.get_service_configs()

    # Validate refresh token
    fetch_cmd = '''
        SELECT t.*, w.submitted_by
        FROM tasks t
        JOIN workflows w ON t.workflow_id = w.workflow_id
        WHERE t.workflow_id = %s \
        AND t.name = %s AND t.group_name = %s AND t.retry_id = %s;
    '''

    tasks = postgres.execute_fetch_command(fetch_cmd,
                                           (workflow_id, task_name, group_name, retry_id),
                                           True)
    # Check if there exists a task that satisfies these conditions
    if not tasks:
        raise osmo_errors.OSMOUserError(
            f'Workflow {workflow_id} with task {task_name} does not exist')
    task = tasks[0]
    if task['status'] == 'PENDING':
        payload= {'token': None,
                  'expires_at': None,
                  'error': 'PENDING'}
        raise fastapi.HTTPException(status_code=400, detail=payload)

    if task_lib.TaskGroupStatus(task['status']).finished():
        payload= {'token': None,
                  'expires_at': None,
                  'error': 'FINISHED'}
        raise fastapi.HTTPException(status_code=400, detail=payload)

    if task['refresh_token'] is None:
        raise osmo_errors.OSMOUserError(
            f'Workflow {workflow_id} task {task_name} is missing refresh token')
    # Check if the refresh token matches the one stored in the database
    hashed_refresh_token = bytes(task['refresh_token'])
    if auth.hash_access_token(refresh_token) != hashed_refresh_token:
        raise osmo_errors.OSMOUserError(
            f'Workflow {workflow_id} with task {task_name} refresh token is invalid')

    user = task['submitted_by']
    end_timeout = int(time.time() + common.ACCESS_TOKEN_TIMEOUT)
    token = service_config.service_auth.create_idtoken_jwt(end_timeout,
                                                           user,
                                                           service_config.service_auth.ctrl_roles,
                                                           workflow_id=workflow_id)
    return {'token': token,
            'expires_at': end_timeout,
            'error': None}


@router.get('/api/auth/jwt/access_token')
def get_jwt_token_from_access_token(access_token: str):
    """
    API to create a new jwt token from an access token.
    """
    postgres = connectors.PostgresConnector.get_instance()
    token = objects.AccessToken.validate_access_token(postgres, access_token)
    if not token:
        raise osmo_errors.OSMOUserError('Access Token is invalid')

    if token.expires_at.date() <= datetime.datetime.utcnow().date():
        raise osmo_errors.OSMOUserError('Access Token has expired')

    service_config = postgres.get_service_configs()

    end_timeout = int(time.time() + common.ACCESS_TOKEN_TIMEOUT)
    token = service_config.service_auth.create_idtoken_jwt(end_timeout, token.user_name,
                                                           roles=token.roles)
    return {'token': token,
            'expires_at': end_timeout,
            'error': None}


@router.get('/api/auth/access_token')
def get_access_token_info(access_token: str) -> objects.AccessToken:
    """
    API to get the info for an access token.
    """
    postgres = connectors.PostgresConnector.get_instance()
    token = objects.AccessToken.validate_access_token(postgres, access_token)
    if not token:
        raise osmo_errors.OSMOUserError('Access Token is invalid')
    return token


@router.post('/api/auth/access_token/user/{token_name}')
def create_access_token(token_name: str,
                        expires_at: str,
                        description: str = '',
                        user_header: Optional[str] =
                            fastapi.Header(alias=login.OSMO_USER_HEADER, default=None)):
    """
    API to create a new access token.
    """
    postgres = connectors.PostgresConnector.get_instance()

    user_name = connectors.parse_username(user_header)
    access_token = secrets.token_hex(task_lib.REFRESH_TOKEN_LENGTH)
    service_config = postgres.get_service_configs()
    objects.AccessToken.insert_into_db(postgres, user_name, token_name, access_token,
                                       expires_at, description,
                                       service_config.service_auth.user_roles,
                                       objects.AccessTokenType.USER)

    return access_token


@router.post('/api/auth/access_token/service/{token_name}')
def create_service_access_token(token_name: str,
                                expires_at: str,
                                roles: List[str] = fastapi.Query(default = []),
                                description: str = ''):
    """
    API to create a new service access token.
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Create serivce account name
    service_account_name = token_name
    access_token = secrets.token_hex(task_lib.REFRESH_TOKEN_LENGTH)

    config_roles_names = [role.name for role in connectors.Role.list_from_db(postgres)]
    for role in roles:
        if role not in config_roles_names:
            raise osmo_errors.OSMOUserError(f'Invalid role: {role}')

    objects.AccessToken.insert_into_db(postgres, service_account_name, token_name, access_token,
                                       expires_at, description, roles,
                                       objects.AccessTokenType.SERVICE)
    connectors.UserProfile.insert_default_profile(postgres, service_account_name)

    return access_token


@router.delete('/api/auth/access_token/user/{token_name}')
def delete_access_token(token_name: str,
                        user_header: Optional[str] =
                            fastapi.Header(alias=login.OSMO_USER_HEADER, default=None)):
    """
    API to delete an access token.
    """
    postgres = connectors.PostgresConnector.get_instance()
    user_name = connectors.parse_username(user_header)
    objects.AccessToken.delete_from_db(postgres, objects.AccessTokenType.USER, token_name,
                                       user_name)


@router.delete('/api/auth/access_token/service/{token_name}')
def delete_service_access_token(token_name: str):
    """
    API to delete a service access token.
    """
    postgres = connectors.PostgresConnector.get_instance()
    objects.AccessToken.delete_from_db(postgres, objects.AccessTokenType.SERVICE, token_name)


@router.get('/api/auth/access_token/user')
def list_access_tokens(user_header: Optional[str] =
                           fastapi.Header(alias=login.OSMO_USER_HEADER, default=None)) \
                       -> List[objects.AccessToken]:
    """
    API to list all access tokens for a user.
    """
    postgres = connectors.PostgresConnector.get_instance()
    user_name = connectors.parse_username(user_header)
    return objects.AccessToken.list_from_db(postgres, objects.AccessTokenType.USER, user_name)


@router.get('/api/auth/access_token/service')
def list_service_access_tokens() -> List[objects.AccessToken]:
    """
    API to list all service access tokens.
    """
    postgres = connectors.PostgresConnector.get_instance()
    return objects.AccessToken.list_from_db(postgres, objects.AccessTokenType.SERVICE)
