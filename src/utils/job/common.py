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
import os
from typing import Annotated, Optional

import pydantic

from src.lib.data import storage
from src.lib.utils import common, osmo_errors
from src.utils import connectors


NAMEREGEX = r'[a-zA-Z]([a-zA-Z0-9_-]*[a-zA-Z0-9])?'
# Allow names to be task_name or workflow_id:task_name
TASKNAMEREGEX = fr'(?P<workflow_id_or_task>{NAMEREGEX})(:(?P<previous_task>{NAMEREGEX}))?'
LOGIN_LOCATION = '/osmo/login'
USER_BIN_LOCATION = '/osmo/usr/bin'
RUN_LOCATION = '/osmo/run'

NamePattern = Annotated[str, pydantic.Field(regex=f'^{NAMEREGEX}$')]
TaskNamePattern = Annotated[str, pydantic.Field(regex=f'^{TASKNAMEREGEX}$')]


def get_log_path(workflow_config: connectors.WorkflowConfig) -> storage.StoragePath:
    """ Get the S3 Path that is constructed from the dynamic configs. """
    if workflow_config.workflow_log.credential is None:
        raise osmo_errors.OSMOServerError('Log config credential is not set')

    storage_backend = storage.construct_storage_backend(
        uri=workflow_config.workflow_log.credential.endpoint,
    )
    return storage_backend.to_storage_path(
        region=workflow_config.workflow_log.credential.region,
    )


def get_app_path(workflow_config: connectors.WorkflowConfig) -> storage.StoragePath:
    """ Get the S3 Path that is constructed from the dynamic configs. """
    if workflow_config.workflow_app.credential is None:
        raise osmo_errors.OSMOServerError('App config credential is not set')

    storage_backend = storage.construct_storage_backend(
        uri=workflow_config.workflow_app.credential.endpoint,
    )

    return storage_backend.to_storage_path(
        region=workflow_config.workflow_app.credential.region,
    )


def get_workflow_logs_path(workflow_id: str, file_name: str):
    """ Return the path to the corresponding workflow file. """
    return os.path.join(workflow_id, file_name)


def get_workflow_app_path(app_uuid: str, app_version: int, path_params: storage.StoragePath):
    """ Return the path to the corresponding workflow file. """
    if not path_params.prefix:
        return os.path.join(app_uuid, str(app_version), common.WORKFLOW_APP_FILE_NAME)
    return os.path.join(
        path_params.prefix,
        app_uuid,
        str(app_version),
        common.WORKFLOW_APP_FILE_NAME,
    )


def calculate_total_timeout(workflow_id: str,
                            queue_timeout: Optional[datetime.timedelta] = None,
                            exec_timeout: Optional[datetime.timedelta] = None) -> int:
    """
    Calculates total timeout for a workflow.

    Args:
        workflow_id (str): workflow_id.
        queue_timeout (Optional[datetime.timedelta], optional): Queue timeout. Defaults to None.
        exec_timeout (Optional[datetime.timedelta], optional): Exec timeout. Defaults to None.

    Raises:
        osmo_errors.OSMODatabaseError: Missing timeout.

    Returns:
        int: Total timeout in seconds.
    """
    if not exec_timeout:
        raise osmo_errors.OSMODatabaseError(f'Exec timeout not found for workflow {workflow_id}')

    if not queue_timeout:
        raise osmo_errors.OSMODatabaseError(f'Queue timeout not found for workflow {workflow_id}')

    return int(exec_timeout.total_seconds()) + int(queue_timeout.total_seconds())


def barrier_key(workflow_id: str, group_name: str, barrier_name: str) -> str:
    return f'client-connections:{workflow_id}:{group_name}:barrier-{barrier_name}'


class WorkflowPlugins(pydantic.BaseModel):
    """ Represents the state of plugins in a workflow upon submission. """
    rsync: bool = False
