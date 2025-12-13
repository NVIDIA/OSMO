# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

"""
Common definitions for working with datasets.
"""

import contextlib
import dataclasses
import hashlib
import json
import logging
import os
import tempfile
import re
from typing import Dict, List, NamedTuple, Tuple, TypeAlias
from typing_extensions import NotRequired, TypedDict, assert_never

import diskcache
import pydantic

from .. import storage, constants
from ..storage.core import progress
from ...utils import client, client_configs, common, osmo_errors, paths


logger = logging.getLogger(__name__)


#############################
#     Schemas and Types     #
#############################


JSONValue: TypeAlias = (
    str |
    int |
    float |
    bool |
    None |
    List['JSONValue'] |
    Dict[str, 'JSONValue']
)


class DownloadResponse(TypedDict, total=False):
    """
    Response from the `api/bucket/{bucket-name}/dataset/{dataset-name}` API call.

    This should stay in sync with the `DataDownloadResponse` in `service/core/data/objects.py`.
    """
    dataset_names: List[str]
    dataset_versions: List[str]
    locations: List[str]
    new_locations: List[str]
    is_collection: bool


class LocationResponse(TypedDict):
    """
    Response from the `api/bucket/{bucket-name}/location` API call.
    """
    path: str
    region: NotRequired[str]


class UploadResponse(TypedDict):
    """
    Response from the `api/bucket/{bucket-name}/dataset/{dataset-name}` API call.
    """
    version_id: str
    storage_path: str
    manifest_path: str
    region: NotRequired[str]


@dataclasses.dataclass(frozen=True)
class DatasetInfo:
    """
    Basic information about a dataset.
    """
    name: str
    manifest_path: str


@dataclasses.dataclass(kw_only=True, slots=True)
class SortableEntry:
    """
    A base class for all entries that can be sorted.
    """

    relative_path: str

    # Tie breaker when relative paths are the same.
    # Lower the number, higher the priority...
    priority: int = dataclasses.field(default=0)

    def __lt__(self, other: 'SortableEntry', /) -> bool:
        return self.relative_path < other.relative_path or (
            self.relative_path == other.relative_path and
            self.priority < other.priority
        )

    def __eq__(self, other: object, /) -> bool:
        if not isinstance(other, SortableEntry):
            return NotImplemented
        return self.relative_path == other.relative_path and self.priority == other.priority


@dataclasses.dataclass(kw_only=True, slots=True)
class ManifestEntry(SortableEntry):
    """
    Entry in the manifest file.
    """
    storage_path: str
    url: str
    size: int
    etag: str

    def to_json(self) -> Dict:
        return {
            'relative_path': self.relative_path,
            'storage_path': self.storage_path,
            'url': self.url,
            'size': self.size,
            'etag': self.etag,
        }

    def to_tuple(self) -> Tuple[str, str, str, int, str]:
        return (
            self.relative_path,
            self.storage_path,
            self.url,
            self.size,
            self.etag,
        )

    @staticmethod
    def from_tuple(tuple_obj: Tuple[str, str, str, int, str]) -> 'ManifestEntry':
        return ManifestEntry(
            relative_path=tuple_obj[0],
            storage_path=tuple_obj[1],
            url=tuple_obj[2],
            size=tuple_obj[3],
            etag=tuple_obj[4],
        )


class LocalPath(NamedTuple):
    """
    Represents a user-provided upload path.
    """
    path: str
    has_asterisk: bool = False
    priority: int = 0


class RemotePath(NamedTuple):
    """
    Represents a user-provided upload path.
    """
    storage_backend: storage.StorageBackend
    has_asterisk: bool = False
    priority: int = 0


class LocalToRemoteMapping(NamedTuple):
    """
    Represents a mapping from a local path to a remote path.
    """
    source: LocalPath
    destination: str | None


class RemoteToRemoteMapping(NamedTuple):
    """
    Represents a mapping from a remote path to a remote path.
    """
    source: RemotePath
    destination: str | None


@pydantic.dataclasses.dataclass(
    config=pydantic.ConfigDict(
        extra=pydantic.Extra.forbid,
        frozen=True,
    ),
)
class UploadStartResult:
    """
    Response from the `upload_start` method.
    """
    upload_response: UploadResponse
    local_upload_paths: List[LocalPath]
    backend_upload_paths: List[RemotePath]


@pydantic.dataclasses.dataclass(
    config=pydantic.ConfigDict(
        extra=pydantic.Extra.forbid,
        frozen=True,
    ),
)
class UploadResult:
    """
    Results of the upload.
    """
    upload_response: UploadResponse
    upload_summary: storage.UploadSummary


@pydantic.dataclasses.dataclass(
    config=pydantic.ConfigDict(
        extra=pydantic.Extra.forbid,
        frozen=True,
    ),
)
class UpdateStartResult:
    """
    Response from the `update_start` method.
    """
    upload_response: UploadResponse
    current_manifest_path: str
    local_update_paths: List[LocalToRemoteMapping] | None
    backend_update_paths: List[RemoteToRemoteMapping] | None
    remove_regex: str | None


@pydantic.dataclasses.dataclass(
    config=pydantic.ConfigDict(
        extra=pydantic.Extra.forbid,
        frozen=True,
    ),
)
class MigrateResult:
    """
    Results of the migration.
    """
    migrate_response: DownloadResponse
    summaries: Dict[str, storage.CopySummary] = pydantic.Field(default_factory=dict)


############################
#     API Path Helpers     #
############################


def construct_info_api_path(dataset: common.DatasetStructure) -> str:
    return f'api/bucket/{dataset.bucket}/dataset/{dataset.name}/info'


def construct_download_api_path(dataset: common.DatasetStructure) -> str:
    return f'api/bucket/{dataset.bucket}/dataset/{dataset.name}'


def construct_location_api_path(dataset: common.DatasetStructure) -> str:
    return f'api/bucket/{dataset.bucket}/location'


def construct_upload_api_path(dataset: common.DatasetStructure) -> str:
    return f'api/bucket/{dataset.bucket}/dataset/{dataset.name}'


def construct_migrate_api_path(dataset: common.DatasetStructure) -> str:
    return f'api/bucket/{dataset.bucket}/dataset/{dataset.name}/migrate'


#############################
#     Utility Functions     #
#############################


def get_user_bucket(service_client: client.ServiceClient) -> str:
    params = {'default_only': True}
    bucket = service_client.request(
        client.RequestMethod.GET, 'api/bucket', params=params)['default']
    if not bucket:
        raise osmo_errors.OSMOUserError(
            'No default bucket set. Specify default bucket using the '
            '"osmo profile set" CLI.')
    return bucket


def _validate_source_path(
    source_path: str,
    has_asterisk: bool,
    priority: int,
) -> LocalPath | RemotePath:
    """
    Validate and return a LocalPath or RemotePath.
    """
    if re.fullmatch(constants.STORAGE_BACKEND_REGEX, source_path):
        # Remote path logic
        path_components = storage.construct_storage_backend(source_path)
        user_credentials = client_configs.get_credentials(path_components.profile)
        path_components.data_auth(
            user_credentials.access_key_id,
            user_credentials.get_access_key_value(),
            user_credentials.region,
            storage.AccessType.READ,
        )

        return RemotePath(path_components, has_asterisk, priority)
    else:
        # Local path logic
        local_path = paths.resolve_local_path(source_path)

        if has_asterisk and not os.path.isdir(local_path):
            raise osmo_errors.OSMOUserError(f'Path does not exist: {source_path}/*.')
        if not os.path.isdir(local_path) and not os.path.isfile(local_path):
            raise osmo_errors.OSMOUserError(f'Path does not exist: {source_path}.')

        return LocalPath(local_path, has_asterisk, priority)


def parse_upload_paths(
    input_paths: List[str],
) -> Tuple[List[LocalPath], List[RemotePath]]:
    """
    Helper function for splitting local and remote paths.

    Args:
        input_paths: list of paths

    Raises:
        OSMOUserError: Path is invalid

    Returns:
        Tuple[List[LocalPath], List[RemotePath]]: local and remote paths
    """
    local_paths: List[LocalPath] = []
    remote_paths: List[RemotePath] = []

    for priority, path in enumerate(input_paths):
        has_asterisk = path.endswith('/*')
        source_path = path.rstrip('/*') if has_asterisk else path

        validated_source_path = _validate_source_path(source_path, has_asterisk, priority)
        match validated_source_path:
            case RemotePath():
                remote_paths.append(validated_source_path)
            case LocalPath():
                local_paths.append(validated_source_path)
            case _ as unreachable:
                assert_never(unreachable)

    return local_paths, remote_paths


def _split_string(text: str) -> Tuple[str, str | None]:
    """
    Splits a path into its local and remote components by
    splitting on ':' once only if it is not '://'.

    Args:
        text: The path to split.

    Returns:
        Tuple[str, str | None]: The local and remote components of the path.

    Raises:
        osmo_errors.OSMOUserError: The path is invalid.
    """
    parts = re.split(r'(?<!\\):(?!//)', text, maxsplit=1)
    left_part = parts[0].replace(r'\:', ':')
    right_part = parts[1].replace(r'\:', ':') if len(parts) == 2 else None

    return left_part, right_part


def parse_update_paths(
    input_paths: List[str],
) -> Tuple[List[LocalToRemoteMapping], List[RemoteToRemoteMapping]]:
    """
    Helper function for splitting local and backend paths that are stored in the format
    local/path:remote/path and s3://backend/path:remote/path

    Args:
        input_paths: list of paths

    Raises:
        OSMOUserError: Path is invalid

    Returns:
        Tuple(List[LocalToRemoteMapping], List[RemoteToRemoteMapping]): Path mappings separated
                                                                        by local and remote sources.
    """
    local_to_remote_mappings: List[LocalToRemoteMapping] = []
    remote_to_remote_mappings: List[RemoteToRemoteMapping] = []

    for priority, path in enumerate(input_paths):
        source_path, destination_path = _split_string(path)

        has_asterisk = source_path.endswith('/*')
        source_path = source_path[:-2] if has_asterisk else source_path

        validated_source_path = _validate_source_path(source_path, has_asterisk, priority)

        if destination_path:
            # Validate the destination path
            destination_path = os.path.normpath(destination_path)
            if destination_path.startswith('..'):
                raise osmo_errors.OSMOUserError(
                    f'Destination path cannot start with "..": {destination_path}')

        match validated_source_path:
            case RemotePath():
                remote_to_remote_mappings.append(
                    RemoteToRemoteMapping(
                        source=validated_source_path,
                        destination=destination_path,
                    ),
                )
            case LocalPath():
                local_to_remote_mappings.append(
                    LocalToRemoteMapping(
                        source=validated_source_path,
                        destination=destination_path,
                    ),
                )
            case _ as unreachable:
                assert_never(unreachable)

    return local_to_remote_mappings, remote_to_remote_mappings


def finalize_manifest(
    manifest_cache: diskcache.Index,
    manifest_path: str,
    enable_progress_tracker: bool,
) -> str:
    """
    Finalizes and uploads the manifest file.

    Args:
        manifest_cache: The cache of manifest entries.
        manifest_path: The path to the manifest file.
        enable_progress_tracker: Whether to enable progress tracking.

    Returns:
        The checksum of the manifest file.
    """
    if len(manifest_cache) == 0:
        return ''

    logger.info('Writing manifest file...')

    successful_indices = sorted(manifest_cache.keys())
    checksum = hashlib.md5()

    tracker_ctx: contextlib.AbstractContextManager
    progress_updater: progress.ProgressUpdater

    if not enable_progress_tracker:
        tracker_ctx, progress_updater = contextlib.nullcontext(), progress.NoOpProgressUpdater()
    else:
        tracker_ctx, progress_updater = progress.create_single_thread_progress(
            total=len(successful_indices),
            increment_counter=50,
            unit='it',
            unit_scale=False,
        )

    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8') as manifest_file:
        with tracker_ctx as _:
            manifest_file.write('[\n')
            for i, index in enumerate(successful_indices):
                if i > 0:
                    manifest_file.write(',\n')

                manifest_entry = ManifestEntry.from_tuple(manifest_cache[index])
                manifest_file.write(json.dumps(manifest_entry.to_json(), indent=4))
                checksum.update(
                    f'{manifest_entry.relative_path} {manifest_entry.etag}'.encode(),
                )
                progress_updater.update(amount_change=1)
            manifest_file.write('\n]')
            manifest_file.flush()

        # Push the manifest file to the destination storage backend.
        object_client = storage.SingleObjectClient.create(storage_uri=manifest_path)
        object_client.upload_object(manifest_file.name)

    return checksum.hexdigest()
