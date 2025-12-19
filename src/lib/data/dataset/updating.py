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
Module for updating datasets.
"""

import heapq
import os
import re
from typing import Generator, List

import diskcache
import ijson

from . import common, uploading
from .. import storage
from ..storage.core import executor
from ...utils import cache, client_configs, osmo_errors


#################################
#     Update implementation     #
#################################


def _dataset_update_existing_entry_generator(
    manifest_path: str,
    remove_regex_pattern: re.Pattern | None,
    priority: int,
) -> Generator[common.ManifestEntry, None, None]:
    """
    Generates manifest entries for existing files we want to retain.
    """
    storage_client = storage.SingleObjectClient.create(storage_uri=manifest_path)

    with storage_client.get_object_stream(as_io=True) as bytes_io:
        manifest_iter = ijson.items(bytes_io, 'item')

        for obj in manifest_iter:
            if remove_regex_pattern and remove_regex_pattern.match(obj['relative_path']):
                # Entry should be removed
                continue

            obj['priority'] = priority
            yield common.ManifestEntry(**obj)


def _dataset_update_local_file_entry_generator(
    destination: storage.StorageBackend,
    destination_region: str,
    local_to_remote_mapping: common.LocalToRemoteMapping,
    errors: List[BaseException],
) -> Generator[uploading.UploadLocalFileEntry, None, None]:
    """
    Generates update local file entries for a local path.
    """
    for local_file_entry in uploading.dataset_upload_local_file_entry_generator(
        destination=destination,
        destination_region=destination_region,
        local_path=local_to_remote_mapping.source,
        regex_pattern=None,
        errors=errors,
    ):
        # Remaps the relative path to the destination path if provided.
        if local_to_remote_mapping.destination:
            local_file_entry.relative_path = os.path.join(
                local_to_remote_mapping.destination,
                local_file_entry.relative_path,
            )

        yield local_file_entry


def _dataset_update_remote_file_entry_generator(
    remote_to_remote_mapping: common.RemoteToRemoteMapping,
    errors: List[BaseException],
) -> Generator[common.ManifestEntry, None, None]:
    """
    Generates update remote file entries for a remote path.
    """
    for remote_file_entry in uploading.dataset_upload_remote_file_entry_generator(
        remote_path=remote_to_remote_mapping.source,
        regex_pattern=None,
        errors=errors,
    ):
        # Remaps the relative path to the destination path if provided.
        if remote_to_remote_mapping.destination:
            remote_file_entry.relative_path = os.path.join(
                remote_to_remote_mapping.destination,
                remote_file_entry.relative_path,
            )

        yield remote_file_entry


def _dataset_update_worker_input_generator(
    manifest_path: str,
    local_to_remote_mappings: List[common.LocalToRemoteMapping],
    remote_to_remote_mappings: List[common.RemoteToRemoteMapping],
    destination: storage.StorageBackend,
    destination_region: str,
    remove_regex: str | None,
    manifest_cache: diskcache.Index,
) -> Generator[uploading.DatasetUploadWorkerInput, None, List[BaseException]]:
    """
    Generates upload worker inputs for updating a dataset.

    Uses the combination of local, remote, and existing entries to generate inputs
    for the updated dataset version.
    """
    generators: List[Generator[uploading.UploadEntry, None, None]] = []
    generator_errors: List[BaseException] = []

    for local_to_remote_mapping in local_to_remote_mappings:
        generators.append(
            _dataset_update_local_file_entry_generator(
                destination=destination,
                destination_region=destination_region,
                local_to_remote_mapping=local_to_remote_mapping,
                errors=generator_errors,
            ),
        )

    for remote_to_remote_mapping in remote_to_remote_mappings:
        generators.append(
            _dataset_update_remote_file_entry_generator(
                remote_to_remote_mapping=remote_to_remote_mapping,
                errors=generator_errors,
            ),
        )

    # Add the existing manifest entries at the end.
    # This ensures that they are at the lowest priority.
    generators.append(
        _dataset_update_existing_entry_generator(
            manifest_path=manifest_path,
            remove_regex_pattern=re.compile(remove_regex) if remove_regex else None,
            priority=len(generators),
        ),
    )

    sorted_generator = heapq.merge(*generators)
    index = -1

    # Keep track of seen paths to avoid duplicates.
    #
    # Entries are generated in lexicographic order with priority, so duplicates can be assumed
    # to be at a lower priority and should be ignored.
    paths_seen = diskcache.Index()

    try:
        for entry in sorted_generator:
            if entry.relative_path in paths_seen:
                # Duplicate entry detected, skip.
                continue

            paths_seen[entry.relative_path] = True
            index += 1

            yield uploading.DatasetUploadWorkerInput(
                index=index,
                entry=entry,
                manifest_cache=manifest_cache,
            )

        return generator_errors
    finally:
        paths_seen.clear()


#################################
#     Update public APIs        #
#################################


def update(
    update_start_result: common.UpdateStartResult,
    *,
    enable_progress_tracker: bool = False,
    executor_params: executor.ExecutorParameters | None = None,
    request_headers: List[storage.RequestHeaders] | None = None,
    cache_config: cache.CacheConfig | None = None,
) -> uploading.UploadOperationResult:
    """
    Updates a dataset to a destination storage backend.

    This function orchestrates the dataset update process by:
    1. Reading existing manifest entries (filtered by remove_regex if provided)
    2. Adding new local and remote file entries (if provided)
    3. Generating an updated manifest

    :param common.UpdateStartResult update_start_result: The update start result.
    :param bool enable_progress_tracker: Whether to enable progress tracking.
    :param executor.ExecutorParameters | None executor_params: The executor parameters.
    :param List[storage.RequestHeaders] | None request_headers: The request headers.
    :param cache.CacheConfig | None cache_config: The cache config.

    :return: The update operation result.
    :rtype: uploading.UploadOperationResult
    """
    if executor_params is None:
        executor_params = executor.ExecutorParameters()

    storage_path = update_start_result.upload_response['storage_path']
    destination = storage.construct_storage_backend(
        storage_path,
        cache_config=cache_config,
    )

    # Resolve the region for the destination storage backend.
    # This is necessary for generating a valid regional HTTP URL for uploaded objects
    # for certain storage backends (e.g. AWS S3).
    destination_creds = client_configs.get_credentials(destination.profile)
    destination_region = destination.region(
        destination_creds.access_key_id,
        destination_creds.get_access_key_value(),
    )

    client_factory = destination.client_factory(
        access_key_id=destination_creds.access_key_id,
        access_key=destination_creds.get_access_key_value(),
        region=destination_region,
        request_headers=request_headers,
    )

    manifest_cache = diskcache.Index()

    worker_input_gen = _dataset_update_worker_input_generator(
        manifest_path=update_start_result.current_manifest_path,
        local_to_remote_mappings=update_start_result.local_update_paths or [],
        remote_to_remote_mappings=update_start_result.backend_update_paths or [],
        destination=destination,
        destination_region=destination_region,
        remove_regex=update_start_result.remove_regex,
        manifest_cache=manifest_cache,
    )

    try:
        job_ctx = executor.run_job(
            thread_worker=uploading.dataset_upload_worker,
            thread_worker_input_gen=worker_input_gen,
            client_factory=client_factory,
            enable_progress_tracker=enable_progress_tracker,
            executor_params=executor_params,
        )

    except Exception as error:  # pylint: disable=broad-except
        raise osmo_errors.OSMODatasetError(
            f'Error updating dataset: {error}',
        ) from error

    finally:
        # Write the manifest file to the destination storage backend,
        # even if we only have partial uploads.
        checksum = common.finalize_manifest(
            manifest_cache=manifest_cache,
            manifest_path=update_start_result.upload_response['manifest_path'],
            enable_progress_tracker=enable_progress_tracker,
        )

    return uploading.UploadOperationResult(
        checksum=checksum,
        summary=storage.UploadSummary.from_job_context(job_ctx),
    )
