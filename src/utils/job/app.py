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
from typing import List

import pydantic

from src.lib.utils import common, osmo_errors, workflow as workflow_utils
from src.utils.job import common as job_common
from src.utils import connectors


class AppStatus(enum.Enum):
    """ Enum representing the different states an app can be in.

    The app status transitions through these states during its lifecycle:
    - PENDING: Initial state after allocation but before upload
    - READY: App is uploaded and available for use
    - PENDING_DELETE: App is marked for deletion but not yet deleted
    - DELETED: App has been fully deleted

    The status helps track where an app is in its lifecycle and what operations
    can be performed on it.
    """
    # The app has been "allocated" but needs to be uploaded
    PENDING = 'PENDING'
    # The app has been uploaded and is ready to use
    READY = 'READY'
    # The app has been marked for delete but needs to be deleted
    PENDING_DELETE = 'PENDING_DELETE'
    # The app has been deleted
    DELETED = 'DELETED'

    def deleted(self) -> bool:
        """ Returns true if the app has been deleted. """
        return self.name in ['DELETED', 'PENDING_DELETE']


class App(pydantic.BaseModel):
    """ App class represents a workflow application in the system.

    This class models a workflow application with its basic metadata including UUID,
    name, description, owner and creation date. It provides functionality to list
    apps from the database with optional filtering by name and users.

    Attributes:
        uuid (str): Unique identifier for the app
        name (str): Name of the app
        description (str): Description of the app
        owner (str): Username of the app owner
        created_date (datetime): Timestamp when the app was created
    """
    uuid: str
    name: str
    description: str
    owner: str
    created_date: datetime.datetime

    @classmethod
    def fetch_from_db(cls, database: connectors.PostgresConnector,
                      app_name: str) -> 'App':
        """ Fetches the app from the apps table """
        fetch_cmd = '''
            SELECT * FROM apps WHERE name = %s
            '''
        spec_rows = database.execute_fetch_command(fetch_cmd,
                                                   (app_name,), True)
        if not spec_rows:
            raise osmo_errors.OSMOUserError(
                f'App {app_name} does not exist.')
        spec_row = spec_rows[0]

        return App(**spec_row)

    @classmethod
    def fetch_from_db_from_uuid(cls, database: connectors.PostgresConnector,
                                app_uuid: str) -> 'App':
        """ Fetches the app from the apps table """
        fetch_cmd = '''
            SELECT * FROM apps WHERE uuid = %s
            '''
        spec_rows = database.execute_fetch_command(fetch_cmd,
                                                   (app_uuid,), True)
        if not spec_rows:
            raise osmo_errors.OSMOUserError(
                f'App {app_uuid} does not exist.')
        spec_row = spec_rows[0]

        return App(**spec_row)

    @classmethod
    def delete_from_db(cls, database: connectors.PostgresConnector,
                       app_name: str):
        """ Delete an entry from the apps table """
        cls.fetch_from_db(database, app_name)
        delete_cmd = '''
            DELETE FROM apps
            WHERE name = %s;
            '''
        database.execute_commit_command(delete_cmd, (app_name,))

    @classmethod
    def insert_into_db(cls, database: connectors.PostgresConnector, name: str, user_name: str,
                       description: str) -> 'App':
        """ Create/update an entry in the apps table """
        current_time = common.current_time()
        app_uuid = common.generate_unique_id()
        version = 1
        app_path = job_common.get_workflow_app_path(
            app_uuid, version, job_common.get_app_path(database.get_workflow_configs()))

        insert_cmd = '''
            BEGIN;
            INSERT INTO apps
            (uuid, name, owner, created_date, description)
            VALUES (%s, %s, %s, %s, %s);

            INSERT INTO app_versions
            (uuid, version, created_by, created_date, uri, status)
            VALUES (%s, %s, %s, %s, %s, %s);
            COMMIT;
            '''
        try:
            database.execute_commit_command(
                insert_cmd,
                (app_uuid, name, user_name, current_time, description,
                 app_uuid, version, user_name, current_time, app_path, AppStatus.PENDING.value))
        except osmo_errors.OSMODatabaseError as e:
            raise osmo_errors.OSMOUserError(
                f'App name {name} already exists.') from e
        return App(uuid=app_uuid, name=name, description=description, owner=user_name,
                   created_date=current_time)

    def rename(self, database: connectors.PostgresConnector, new_name: str):
        """ Rename the app in the database """
        rename_cmd = '''
            UPDATE apps
            SET name = %s
            WHERE uuid = %s;
            '''
        database.execute_commit_command(rename_cmd, (new_name, self.uuid))
        self.name = new_name


class AppVersion(pydantic.BaseModel):
    """ Represents a version of an app in the database.

    Attributes:
        uuid: Unique identifier for the app
        version: Version number of this app version
        created_by: Username of who created this version
        created_date: Timestamp when this version was created
        uri: S3 URI where the app spec is stored
        status: Current status of this app version
    """
    uuid: str
    version: int
    created_by: str
    created_date: datetime.datetime
    uri: str
    status: AppStatus

    @classmethod
    def list_from_db(cls, database: connectors.PostgresConnector,
                     app_name: str) \
        -> List['AppVersion']:
        """ Fetches the list of apps from the apps table """
        # TODO: Also check for apps where the user has access to
        fetch_cmd = '''
            SELECT * FROM app_versions
            WHERE uuid = (select uuid from apps where name = %s)
            ORDER BY version DESC
            '''
        spec_rows = database.execute_fetch_command(fetch_cmd, (app_name,), True)

        return [AppVersion(**spec_row) for spec_row in spec_rows]

    @classmethod
    def fetch_from_db(cls, database: connectors.PostgresConnector,
                      app_info: common.AppStructure) -> 'AppVersion':
        """ Fetches the app from the apps table """
        fetch_cmd = '''
            SELECT * FROM app_versions
            WHERE uuid = (select uuid from apps where name = %s)
            '''
        fetch_input: List = [app_info.name]
        if app_info.version:
            fetch_cmd += ' AND version = %s'
            fetch_input.append(app_info.version)
        else:
            # If no version is specified, return the latest ready version
            fetch_cmd += ' AND status = %s'
            fetch_input.append(AppStatus.READY.value)
        fetch_cmd += ' ORDER BY version DESC LIMIT 1;'

        spec_rows = database.execute_fetch_command(fetch_cmd, tuple(fetch_input), True)
        if not spec_rows:
            raise osmo_errors.OSMOUserError(
                f'App {app_info.name} does not exist.')
        spec_row = spec_rows[0]

        return AppVersion(**spec_row)

    @classmethod
    def fetch_from_db_with_uuid(cls, database: connectors.PostgresConnector,
                                app_uuid: str, app_version: int) -> 'AppVersion':
        """ Fetches the app from the apps table """
        fetch_cmd = '''
            SELECT * FROM app_versions
            WHERE uuid = %s AND version = %s
            '''
        spec_rows = database.execute_fetch_command(fetch_cmd,
                                                   (app_uuid, app_version), True)
        if not spec_rows:
            raise osmo_errors.OSMOUserError(
                f'App {app_uuid} with version {app_version} does not exist.')
        spec_row = spec_rows[0]

        return AppVersion(**spec_row)

    @classmethod
    def insert_into_db(cls, database: connectors.PostgresConnector, name: str, user_name: str)\
         -> 'AppVersion':
        """ Create/update an entry in the apps table """
        current_time = common.current_time()

        insert_cmd = '''
            WITH app_uuid AS (
                SELECT uuid FROM apps WHERE name = %s
            ),
            next_version AS (
                SELECT COALESCE(MAX(version), 0) + 1 as version
                FROM app_versions
                WHERE uuid = (SELECT uuid FROM app_uuid)
            )
            INSERT INTO app_versions
            (uuid, version, created_by, created_date, status)
            SELECT
                (SELECT uuid FROM app_uuid),
                (SELECT version FROM next_version),
                %s, %s, %s
            RETURNING uuid, version;
            '''
        update_path_cmd = '''
            UPDATE app_versions
            SET uri = %s
            WHERE uuid = %s AND version = %s
            '''
        try:
            app_info = database.execute_fetch_command(
                insert_cmd,
                (name, user_name, current_time, AppStatus.PENDING.value), True)

            app_path = job_common.get_workflow_app_path(
                app_info[0]['uuid'], app_info[0]['version'],
                job_common.get_app_path(database.get_workflow_configs()))

            database.execute_commit_command(
                update_path_cmd,
                (app_path, app_info[0]['uuid'], app_info[0]['version']))
        except osmo_errors.OSMODatabaseError as e:
            raise osmo_errors.OSMOUserError(
                f'App name {name} does not exist.') \
                from e
        return AppVersion(uuid=app_info[0]['uuid'], version=app_info[0]['version'],
                          created_by=user_name, created_date=current_time, uri=app_path,
                          status=AppStatus.PENDING)

    def update_status(self, database: connectors.PostgresConnector, status: AppStatus):
        """ Update the status of an app version """
        update_cmd = '''
            UPDATE app_versions SET status = %s WHERE uuid = %s AND version = %s
            '''
        database.execute_commit_command(update_cmd, (status.value, self.uuid, self.version))


def validate_app_content(app_content: str):
    """ Validate the app content """
    workflow_utils.parse_workflow_spec(app_content)
