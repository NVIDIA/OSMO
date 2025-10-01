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

from typing import List

from src.utils.job import app
from src.service.core.app import objects
from src.utils import connectors


def list_apps(database: connectors.PostgresConnector, name: str | None,
              username: str | None, users: List[str] | None,
              offset: int, limit: int, order: connectors.ListOrder) \
    -> List[objects.ListEntry]:
    """ Fetches the list of apps from the apps table """
    fetch_cmd = '''
        SELECT apps.*, latest_version.version as latest_version FROM apps
        RIGHT JOIN (
            SELECT uuid, MAX(version) as version
            FROM app_versions
            WHERE status = %s
            GROUP BY uuid
        ) latest_version ON apps.uuid = latest_version.uuid
    '''
    fetch_input: List = [app.AppStatus.READY.value]
    commands: List = []
    if username:
        commands.append('''
            (apps.uuid IN (SELECT uuid from app_versions WHERE created_by = %s)
             OR apps.uuid IN (SELECT app_uuid from workflows WHERE submitted_by = %s))
        ''')
        fetch_input.extend([username, username])
    elif users:
        commands.append('apps.owner IN %s')
        fetch_input.append(tuple(database.fetch_user_names(users)))
    if name:
        # _ and % are special characters in postgres
        name = name.replace('_', r'\_').replace('%', r'\%')
        commands.append('apps.name LIKE %s')
        fetch_input.append(f'%{name}%')
    if commands:
        conditions = ' AND '.join(commands)
        fetch_cmd = f'{fetch_cmd} WHERE {conditions}'

    fetch_cmd += ' ORDER BY apps.created_date DESC LIMIT %s OFFSET %s'
    fetch_input.extend([limit, offset])

    fetch_cmd = f'SELECT * FROM ({fetch_cmd}) as wf'
    if order == connectors.ListOrder.ASC:
        fetch_cmd += ' ORDER BY created_date ASC'
    else:
        fetch_cmd += ' ORDER BY created_date DESC'
    fetch_cmd += ';'

    app_list = database.execute_fetch_command(fetch_cmd, tuple(fetch_input), True)

    return [objects.ListEntry(**app_row) for app_row in app_list]


def get_app_versions(database: connectors.PostgresConnector, app_uuid: str,
                     limit: int, order: connectors.ListOrder, version: int | None = None) \
    -> List[objects.GetVersionEntry]:
    """ Fetches the list of app versions from the app_versions table """
    fetch_cmd = '''
        SELECT * FROM app_versions WHERE uuid = %s
    '''
    if version:
        fetch_cmd += ' AND version = %s'
        fetch_input = [app_uuid, version, limit]
    else:
        fetch_input = [app_uuid, limit]
    fetch_cmd += ' ORDER BY created_date DESC LIMIT %s'
    fetch_cmd = f'SELECT * FROM ({fetch_cmd}) as app'
    if order == connectors.ListOrder.ASC:
        fetch_cmd += ' ORDER BY created_date ASC'
    else:
        fetch_cmd += ' ORDER BY created_date DESC'
    fetch_cmd += ';'
    app_versions = database.execute_fetch_command(fetch_cmd, tuple(fetch_input), True)
    return [objects.GetVersionEntry(**app_version_row) for app_version_row in app_versions]
