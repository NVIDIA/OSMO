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
from typing import Annotated, Dict, List, Optional

import pydantic

from src.lib.utils import common


DatasetPattern = Annotated[str, pydantic.Field(regex=common.DATASET_NAME_REGEX)]
DatasetTagPattern = Annotated[str, pydantic.Field(regex=common.DATASET_BUCKET_TAG_REGEX)]


class DatasetType(enum.Enum):
    COLLECTION = 'COLLECTION'
    DATASET = 'DATASET'


class DatasetQueryType(enum.Enum):
    VERSION = 'VERSION'
    DATASET = 'DATASET'


class DatasetStatus(enum.Enum):
    """
    The status of a dataset / dataset version.
    """
    # The dataset has been "allocated" but needs to be uploaded
    PENDING = 'PENDING'
    # The dataset has been uploaded and is ready to use
    READY = 'READY'
    # The dataset has been marked for delete but needs to be deleted
    PENDING_DELETE = 'PENDING_DELETE'
    # The dataset version has been deleted. When the all versions are DELETED, the dataset will be
    # removed from the table
    DELETED = 'DELETED'

    @staticmethod
    def is_active(name: str) -> bool:
        return name not in [DatasetStatus.PENDING_DELETE.value, DatasetStatus.DELETED.value]


class DatasetStructure(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing execution cluster node resource information. """
    name: DatasetPattern
    tag: DatasetTagPattern


class BucketInfoEntry(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Upload Response. """
    path: str
    description: str
    mode: str
    default_cred: bool


class BucketInfoResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Upload Response. """
    default: Optional[str]
    buckets: Dict[str, BucketInfoEntry]


class DataUploadResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Upload Response. """
    version_id: str
    region: str = ''
    storage_path: str = ''
    manifest_path: str = ''


class DataDownloadResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Download Response. """
    dataset_names: List[str]
    dataset_versions: List[str]
    locations: List[str]
    new_locations: List[str] # Used to migrate old locations to new location in manifest
    is_collection: bool


class DataDeleteResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Download Response. """
    versions: List[str] = []
    delete_locations: List[str] = []
    cleaned_size: int = 0


class DataInfoDatasetEntry(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Info Element. """
    name: str
    version: str
    status: DatasetStatus
    created_by: str
    created_date: datetime.datetime
    last_used: datetime.datetime
    retention_policy: datetime.timedelta
    size: int
    checksum: str
    location: str
    uri: str
    metadata: Dict
    tags: List[str]
    collections: List[str]


class DataInfoCollectionEntry(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Info Element. """
    name: str
    version: str
    location: str
    uri: str
    hash_location: str | None
    size: int


class DataInfoResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Data Info Elements. """
    name: str
    id: str
    bucket: str
    created_by: str | None
    created_date: datetime.datetime | None
    hash_location: str | None
    hash_location_size: int | None
    labels: Dict
    type: DatasetType
    versions: List[DataInfoDatasetEntry | DataInfoCollectionEntry]


class DataQueryResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Dataset and Dataset Version Info. """
    type: DatasetQueryType
    datasets: List[DataInfoResponse | DataInfoDatasetEntry]


class DataListEntry(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Data List Element. """
    name: str
    id: str
    bucket: str
    create_time: datetime.datetime
    last_created: datetime.datetime | None
    hash_location: str | None
    hash_location_size: int | None
    version_id: str | None
    type: DatasetType


class DataListResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Data List Elements. """
    datasets: List[DataListEntry]


class DataTagResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Tag Response. """
    version_id: str
    tags: List[str]


class DataCopyResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Inspect Response. """
    inital_datasets: List[DatasetStructure]
    created_datasets: List[DatasetStructure]


class DataMetadataResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Label/Metadata Response. """
    metadata: Dict


class DataAttributeResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Tag/Label/Metadata Response. """
    tag_response: DataTagResponse | None
    label_response: DataMetadataResponse | None
    metadata_response: DataMetadataResponse | None

class DataLocationResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Label/Metadata Response. """
    path: str
    region: str

class DataUpdateEntry(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Info Element. """
    dataset_name: str
    version: str

class DataUpdateResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Info Element. """
    versions: List[DataUpdateEntry]

class DataShareResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Shared Failure Datasets. """
    duplicates: List[str]
    success: List[str]
