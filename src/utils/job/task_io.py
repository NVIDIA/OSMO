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

import pydantic

from src.utils.job import common as task_common
from src.utils import connectors


class DownloadTypeMetrics(enum.Enum):
    """ Type of Download Metrics use """
    DOWNLOAD = 'download'
    MOUNTPOINT = 'mountpoint-s3'
    MOUNTPOINT_FALLBACK = 'mountpoint-s3-fallback'
    MOUNTPOINT_FAILED = 'mountpoint-s3-failed'
    NOT_APPLICABLE = 'N/A'


class TaskIOMetrics(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """  Represents metrics submitted by each user task in a workflow
    """
    group_name: task_common.NamePattern
    task_name: task_common.NamePattern
    retry_id: int
    url: str
    type: str
    start_time: datetime.datetime
    end_time: datetime.datetime
    size_in_bytes: int
    operation_type: str
    number_of_files: int = 0
    download_type: DownloadTypeMetrics


class TaskIO(pydantic.BaseModel, extra=pydantic.Extra.forbid, arbitrary_types_allowed=True):
    """ Represents the task object . """
    workflow_id: task_common.NamePattern
    group_name: task_common.NamePattern
    task_name: task_common.NamePattern
    retry_id: int = 0
    uuid: str
    url: str
    type: str
    database: connectors.PostgresConnector
    storage_bucket: str
    start_time: datetime.datetime
    end_time: datetime.datetime
    size: float
    operation_type: str
    download_type: DownloadTypeMetrics
    number_of_files: int

    def insert_to_db(self):
        """ Creates an entry in the database for the task. """
        insert_cmd = '''
            INSERT INTO task_io
            (workflow_id, group_name, task_name, retry_id, uuid, url,
             type, storage_bucket, start_time, end_time, size, operation_type,
             download_type, number_of_files
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING;
        '''
        self.database.execute_commit_command(
            insert_cmd,
            (self.workflow_id, self.group_name, self.task_name, self.retry_id, self.uuid,
             self.url, self.type, self.storage_bucket,
             self.start_time, self.end_time, self.size, self.operation_type,
             self.download_type.value, self.number_of_files
            ))
