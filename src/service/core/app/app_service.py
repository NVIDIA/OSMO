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

from typing import Dict, List

import fastapi
import fastapi.responses
import fastapi.staticfiles

from src.lib.data import storage
from src.lib.utils import common, osmo_errors
from src.utils.job import app, jobs
from src.service.core.app import helpers, objects
from src.service.core.workflow import objects as workflow_objects
from src.utils import connectors


router = fastapi.APIRouter(tags = ['Workflow App API'])


@router.get('/api/app', response_class=common.PrettyJSONResponse)
def list_apps(name: str | None = None,
              users: List[str] | None = fastapi.Query(default = None),
              all_users: bool = False,
              offset: int = 0,
              limit: int = 20,
              order: connectors.ListOrder = fastapi.Query(default=connectors.ListOrder.ASC),
              username: str = fastapi.Depends(connectors.parse_username)) \
              -> objects.ListResponse:
    postgres = connectors.PostgresConnector.get_instance()
    if limit > 1000:
        raise osmo_errors.OSMOUserError('Limit must be less than 1000.')

    entered_username = False
    if not users and not all_users:
        entered_username = True
    apps = helpers.list_apps(
        postgres, name, username if entered_username else None, users, offset, limit+1, order)
    if order == connectors.ListOrder.DESC:
        apps = apps[:limit]
    elif len(apps) > limit:
        apps = apps[1:]
    return objects.ListResponse(apps=apps, more_entries=len(apps) > limit)


@router.get('/api/app/user/{name}', response_class=common.PrettyJSONResponse)
def get_app(name: str,
            version: int | None = None,
            limit: int = 20,
            order: connectors.ListOrder = fastapi.Query(default=connectors.ListOrder.ASC)):
    postgres = connectors.PostgresConnector.get_instance()
    app_info = app.App.fetch_from_db(postgres, name)
    app_versions = helpers.get_app_versions(
        postgres, app_info.uuid, limit, order, version)

    return objects.GetAppResponse(
        uuid=app_info.uuid,
        name=app_info.name,
        description=app_info.description,
        created_date=app_info.created_date,
        owner=app_info.owner,
        versions=app_versions
    )


@router.get('/api/app/user/{name}/spec', response_class=common.PrettyJSONResponse)
def get_app_content(name: str,
                    version: int | None = None):
    postgres = connectors.PostgresConnector.get_instance()
    app_info = app.AppVersion.fetch_from_db(
        postgres, common.AppStructure.from_parts(name, version=version))
    if app_info.status != app.AppStatus.READY:
        raise osmo_errors.OSMOUserError('App version is not available.')

    context = workflow_objects.WorkflowServiceContext.get()
    workflow_config = context.database.get_workflow_configs()

    if workflow_config.workflow_app.credential is None:
        raise osmo_errors.OSMOServerError('Workflow app credential is not set')

    storage_client = storage.Client.create(
        data_credential=workflow_config.workflow_app.credential,
        scope_to_container=True,
    )

    return fastapi.responses.StreamingResponse(
        storage_client.get_object_stream(app_info.uri),
    )


@router.post('/api/app/user/{name}')
def create_app(name: str,
               description: str,
               app_content: str = fastapi.Body(...),
               username: str = fastapi.Depends(connectors.parse_username)):
    postgres = connectors.PostgresConnector.get_instance()

    app.validate_app_content(app_content)
    app_info = app.App.insert_into_db(postgres, name, username, description)
    upload_app = jobs.UploadApp(
        app_uuid=app_info.uuid,
        app_name=app_info.name,
        app_version=1,
        app_content=app_content,
        user=username)
    upload_app.send_job_to_queue()


@router.patch('/api/app/user/{name}')
def update_app(name: str,
               app_content: str = fastapi.Body(...),
               username: str = fastapi.Depends(connectors.parse_username)) \
               -> objects.EditResponse:
    postgres = connectors.PostgresConnector.get_instance()

    app.validate_app_content(app_content)
    app_info = app.AppVersion.insert_into_db(postgres, name, username)
    upload_app = jobs.UploadApp(
        app_uuid=app_info.uuid,
        app_version=app_info.version,
        app_content=app_content)
    upload_app.send_job_to_queue()

    return objects.EditResponse(
        uuid=app_info.uuid,
        version=app_info.version,
        name=name,
        created_by=username,
        created_date=app_info.created_date
    )


@router.delete('/api/app/user/{name}')
def delete_app(name: str,
               version: int | None = None,
               all_versions: bool = False,
               username: str = fastapi.Depends(connectors.parse_username)) \
               -> Dict[str, List[int]]:
    postgres = connectors.PostgresConnector.get_instance()

    if version and all_versions:
        raise osmo_errors.OSMOUserError('Cannot specify both version and all_versions.')

    if not version and not all_versions:
        raise osmo_errors.OSMOUserError('Must specify a version or all_versions.')

    app_info = app.App.fetch_from_db(postgres, name)

    if app_info.owner != username:
        raise osmo_errors.OSMOUserError('Deleting someone else\'s app is not supported yet.')

    app_versions = []
    if version:
        app_version_info = app.AppVersion.fetch_from_db(
            postgres, common.AppStructure.from_parts(name, version=version))
        if app_version_info.status != app.AppStatus.DELETED:
            app_version_info.update_status(postgres, app.AppStatus.PENDING_DELETE)
            app_versions.append(app_version_info.version)
    elif all_versions:
        app_list_info = app.AppVersion.list_from_db(postgres, name)
        for app_version in app_list_info:
            if app_version.status != app.AppStatus.DELETED:
                app_version.update_status(postgres, app.AppStatus.PENDING_DELETE)
                app_versions.append(app_version.version)

    delete_job = jobs.DeleteApp(
        app_uuid=app_info.uuid,
        app_versions=app_versions)
    delete_job.send_job_to_queue()

    return {
        'versions': app_versions
    }


@router.post('/api/app/user/{name}/rename')
def rename_app(name: str,
               new_name: str = fastapi.Body(...),
               username: str = fastapi.Depends(connectors.parse_username)) \
               -> str:
    postgres = connectors.PostgresConnector.get_instance()

    # Fetch the app and verify ownership
    app_info = app.App.fetch_from_db(postgres, name)

    if app_info.owner != username:
        raise osmo_errors.OSMOUserError('Renaming someone else\'s app is not supported.')

    # Check if the new name already exists
    try:
        app.App.fetch_from_db(postgres, new_name)
        raise osmo_errors.OSMOUserError(f'App with name "{new_name}" already exists.')
    except osmo_errors.OSMOUserError:
        # App doesn't exist, which is what we want
        pass

    # Rename the app
    app_info.rename(postgres, new_name)

    return new_name
