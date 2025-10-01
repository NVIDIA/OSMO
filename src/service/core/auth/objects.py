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
import enum
import re
from typing import List, Optional

import pydantic

from src.lib.utils import common, osmo_errors
from src.utils import auth, connectors


class AccessTokenType(enum.Enum):
    """ Type of access token """
    USER = 'USER'
    SERVICE = 'SERVICE'


class AccessToken(pydantic.BaseModel):
    """ Single Pool Entry """
    user_name: str
    token_name: str
    expires_at: datetime.datetime
    description: str
    access_type: AccessTokenType
    roles: List[str]

    @classmethod
    def list_from_db(cls, database: connectors.PostgresConnector, access_type: AccessTokenType,
                     user_name: str | None = None) \
        -> List['AccessToken']:
        """ Fetches the list of access tokens from the access token table """
        fetch_cmd = 'SELECT * FROM access_token WHERE access_type = %s'
        fetch_params = [access_type.value]
        if user_name:
            fetch_cmd += ' AND user_name = %s;'
            fetch_params.append(user_name)
        spec_rows = database.execute_fetch_command(fetch_cmd, tuple(fetch_params), True)

        return [AccessToken(**spec_row) for spec_row in spec_rows]

    @classmethod
    def fetch_from_db(cls, database: connectors.PostgresConnector, access_type: AccessTokenType,
                      token_name: str, user_name: str | None = None) -> 'AccessToken':
        """ Fetches the access token from the access token table """
        fetch_cmd = 'SELECT * FROM access_token WHERE access_type = %s AND token_name = %s'
        fetch_params = [access_type.value, token_name]
        if user_name:
            fetch_cmd += ' AND user_name = %s;'
            fetch_params.append(user_name)
        spec_rows = database.execute_fetch_command(fetch_cmd, tuple(fetch_params), True)
        if not spec_rows:
            if access_type == AccessTokenType.USER:
                type_str = 'User'
            else:
                type_str = 'Service'
            raise osmo_errors.OSMOUserError(f'{type_str} access token {token_name} does not exist.')

        spec_row = spec_rows[0]

        return AccessToken(**spec_row)

    @classmethod
    def delete_from_db(cls, database: connectors.PostgresConnector, access_type: AccessTokenType,
                       token_name: str, user_name: str | None = None):
        """ Delete an entry from the access token table """
        cls.fetch_from_db(database, access_type, token_name, user_name)
        if access_type == AccessTokenType.USER:
            delete_cmd = '''
                DELETE FROM access_token
                WHERE access_type = %s
                    AND token_name = %s
                    AND user_name = %s;
                '''
            delete_params = [access_type.value, token_name, user_name]
        else:
            delete_cmd = '''
                BEGIN;
                    DELETE FROM profile where user_name = (
                        SELECT user_name FROM access_token
                        WHERE access_type = %s AND token_name = %s);
                    DELETE FROM ueks where uid = (
                        SELECT user_name FROM access_token
                        WHERE access_type = %s AND token_name = %s);
                    DELETE FROM credential where user_name = (
                        SELECT user_name FROM access_token
                        WHERE access_type = %s AND token_name = %s);
                    DELETE FROM access_token WHERE access_type = %s AND token_name = %s;
                COMMIT;
                '''
            delete_params = [access_type.value, token_name, access_type.value, token_name,
                             access_type.value, token_name, access_type.value, token_name]
        database.execute_commit_command(delete_cmd, tuple(delete_params))

    @classmethod
    def insert_into_db(cls, database: connectors.PostgresConnector, user_name: str, token_name: str,
                       access_token: str, expires_at: str, description: str, roles: List[str],
                       access_type: AccessTokenType):
        """ Create/update an entry in the access token table """
        if not re.fullmatch(common.TOKEN_NAME_REGEX, token_name):
            raise osmo_errors.OSMOUserError(
                f'Token name {token_name} must match regex {common.TOKEN_NAME_REGEX}')

        if not common.valid_date_format(expires_at, '%Y-%m-%d'):
            raise osmo_errors.OSMOUserError(
                f'Invalid date format {expires_at}. Date must be in '
                'YYYY-MM-DD format (e.g. 2025-12-31)')

        # Convert YYYY-MM-DD string to datetime and validate it's in the future
        expires_date = common.convert_str_to_time(expires_at, '%Y-%m-%d')
        current_date = datetime.datetime.utcnow().date()
        if expires_date.date() <= current_date:
            raise osmo_errors.OSMOUserError(
                f'Expiration date must be past the current date ({current_date})')
        max_token_duration = database.get_service_configs().service_auth.max_token_duration
        max_date = current_date + common.to_timedelta(max_token_duration)
        if expires_date.date() > max_date:
            raise osmo_errors.OSMOUserError(
                f'Access token cannot last longer than {max_token_duration}')

        insert_cmd = '''
            INSERT INTO access_token
            (user_name, token_name, access_token, expires_at, description, access_type, roles)
            VALUES (%s, %s, %s, %s, %s, %s, %s);
            '''
        try:
            database.execute_commit_command(
                insert_cmd,
                (user_name, token_name, auth.hash_access_token(access_token), expires_at,
                 description, access_type.value, roles))
        except osmo_errors.OSMODatabaseError as e:
            raise osmo_errors.OSMOUserError(f'Token name {token_name} already exists.') from e

    @classmethod
    def validate_access_token(cls, database: connectors.PostgresConnector, access_token: str) \
        -> Optional['AccessToken']:
        """ Validate the access token """
        fetch_cmd = 'SELECT * FROM access_token WHERE access_token = %s;'
        spec_rows = database.execute_fetch_command(
            fetch_cmd, (auth.hash_access_token(access_token),), True)
        if not spec_rows:
            return None
        return AccessToken(**spec_rows[0])
