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
Module for uploading datasets.
"""

import dataclasses
import heapq
import os
import re
from typing import Generator, List
from typing_extensions import override, assert_never

import diskcache

from . import common
from .. import storage
from ..storage import common as storage_common, uploading
from ..storage.core import client, executor, progress, provider
from ...utils import cache, client_configs, common as utils_common, osmo_errors


##########################
#     Upload schemas     #
##########################


@dataclasses.dataclass(kw_only=True, slots=True)
class UploadLocalFileEntry(common.SortableEntry):
    """
    An upload manifest entry for a local file.
    """

    source: str
    destination: storage.StorageBackend
    destination_region: str
    size: int


UploadEntry = UploadLocalFileEntry | common.ManifestEntry


@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class DatasetUploadWorkerInput(executor.ThreadWorkerInput):
    """
    A worker input for uploading a dataset.
    """
    index: int
    entry: UploadEntry
    manifest_cache: diskcache.Index

    size: int = dataclasses.field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, 'size', self.entry.size)

    @override
    def error_key(self) -> str:
        return self.entry.relative_path


class UploadListFileError(osmo_errors.OSMODatasetError):
    """
    An error that occurs when listing files for an upload.
    """
    pass


@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class UploadOperationResult:
    """
    Result of a dataset upload operation.
    """
    checksum: str
    summary: storage.UploadSummary


#################################
#     Upload implementation     #
#################################


def dataset_upload_local_file_entry_generator(
    destination: storage.StorageBackend,
    destination_region: str,
    local_path: common.LocalPath,
    regex_pattern: re.Pattern | None,
    errors: List[BaseException],
) -> Generator[UploadLocalFileEntry, None, None]:
    """
    Generates upload local file entries from a local path.
    """
    local_files_gen = storage.list_local_files(
        local_path=local_path.path,
        has_asterisk=local_path.has_asterisk,
        regex_pattern=regex_pattern,
    )

    while True:
        try:
            local_file_result = next(local_files_gen)
            yield UploadLocalFileEntry(
                relative_path=local_file_result.rel_path,
                priority=local_path.priority,
                source=local_file_result.abs_path,
                destination=destination,
                destination_region=destination_region,
                size=local_file_result.size,
            )
        except StopIteration as stop_err:
            errors.extend(stop_err.value)
            break


def dataset_upload_remote_file_entry_generator(
    remote_path: common.RemotePath,
    regex_pattern: re.Pattern | None,
    errors: List[BaseException],
) -> Generator[common.ManifestEntry, None, None]:
    """
    Generates manifest entries for matching objects from a remote path.
    """
    storage_backend = remote_path.storage_backend
    storage_client = storage.Client.create(storage_backend=storage_backend)

    # Fetch the list of objects from the remote path.
    list_stream = storage_client.list_objects(
        regex=regex_pattern.pattern if regex_pattern else None,
    )

    # Create the base to be used for objects' HTTP URLs.
    data_creds = storage_client.data_credential
    url_base = storage_backend.parse_uri_to_link(
        storage_backend.region(
            data_creds.access_key_id,
            data_creds.get_access_key_value(),
        ),
    )

    # Iterate over the objects in the remote path.
    for obj in list_stream:
        if obj.is_directory:
            # Ignore directory markers
            continue

        if not obj.checksum:
            errors.append(
                UploadListFileError(
                    f'Object {obj.key} has no checksum. This is not supported for uploads.',
                ),
            )
            continue

        relative_path = storage_common.get_upload_relative_path(
            file_abs_path=obj.key,
            file_base_path=storage_backend.path,
            has_asterisk=remote_path.has_asterisk,
        )

        if regex_pattern and not regex_pattern.match(relative_path):
            continue

        # Object key may contain storage_backend.path as a prefix, so we need to dedupe.
        if obj.key.startswith(storage_backend.path):
            rel_key = obj.key.lstrip(storage_backend.path).lstrip('/')
        else:
            rel_key = obj.key

        yield common.ManifestEntry(
            relative_path=relative_path,
            priority=remote_path.priority,
            storage_path=os.path.join(storage_backend.uri, rel_key),
            url=os.path.join(url_base, rel_key),
            size=obj.size,
            etag=obj.checksum,
        )


def _dataset_upload_worker_input_generator(
    local_paths: List[common.LocalPath],
    remote_paths: List[common.RemotePath],
    destination: storage.StorageBackend,
    destination_region: str,
    manifest_cache: diskcache.Index,
    regex: str | None,
) -> Generator[DatasetUploadWorkerInput, None, List[BaseException]]:
    """
    Generates upload worker inputs in lexicographic order.
    """
    regex_check = re.compile(regex) if regex else None

    generators: List[Generator[UploadEntry, None, None]] = []
    generator_errors: List[BaseException] = []

    for local_path in local_paths:
        generators.append(
            dataset_upload_local_file_entry_generator(
                destination,
                destination_region,
                local_path,
                regex_check,
                generator_errors,
            ),
        )

    for remote_path in remote_paths:
        generators.append(
            dataset_upload_remote_file_entry_generator(
                remote_path,
                regex_check,
                generator_errors,
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

            yield DatasetUploadWorkerInput(
                index=index,
                entry=entry,
                manifest_cache=manifest_cache,
            )

        return generator_errors
    finally:
        paths_seen.clear()


def dataset_upload_worker(
    worker_input: DatasetUploadWorkerInput,
    client_provider: provider.StorageClientProvider,
    progress_updater: progress.ProgressUpdater,
) -> storage_common.TransferWorkerOutput:
    """
    A worker for operating on a single dataset upload input.
    """
    upload_entry: UploadEntry = worker_input.entry

    def _write_to_manifest_cache(
        manifest_entry: common.ManifestEntry,
    ) -> None:
        """
        Writes a manifest entry to the manifest cache, indicating that the entry
        has been successfully processed.
        """
        worker_input.manifest_cache[worker_input.index] = manifest_entry.to_tuple()

    match upload_entry:
        case UploadLocalFileEntry():
            # Entry is for a local file. We need to:
            #
            # 1. Hash the file and use it as the filename.
            # 2. Upload the file to the destination storage backend.
            # 3. Record the upload in the manifest cache.

            etag = utils_common.etag_checksum(upload_entry.source)

            destination: storage.StorageBackend = upload_entry.destination

            def _callback(
                upload_input: uploading.UploadWorkerInput,
                upload_response: client.UploadResponse | client.ObjectExistsResponse,
            ) -> None:
                # pylint: disable=unused-argument
                # Create a manifest entry for the uploaded file.
                manifest_entry = common.ManifestEntry(
                    relative_path=upload_entry.relative_path,
                    storage_path=os.path.join(destination.uri, etag),
                    url=os.path.join(
                        destination.parse_uri_to_link(upload_entry.destination_region),
                        etag,
                    ),
                    size=upload_entry.size,
                    etag=etag,
                )

                # Write to the manifest cache.
                _write_to_manifest_cache(manifest_entry)

            # Delegate to an upload worker.
            return uploading.upload_worker(
                upload_input=uploading.UploadWorkerInput(
                    size=upload_entry.size,
                    source=upload_entry.source,
                    container=destination.container,
                    destination=os.path.join(destination.path, etag),

                    # Don't check the checksum because the filename is the checksum.
                    checksum=None,
                    check_checksum=False,

                    # Always resume because the file is content-addressed.
                    resume=True,

                    # Write back to the manifest cache after upload.
                    callback=_callback,
                ),
                client_provider=client_provider,
                progress_updater=progress_updater,
            )

        case common.ManifestEntry():
            # Entry is a materialized manifest entry, either from a previous dataset
            # version or a symlink to remote file. We can write to the manifest cache directly
            # without performing data operations.

            _write_to_manifest_cache(upload_entry)

            progress_updater.update(
                name=upload_entry.relative_path,
                amount_change=upload_entry.size,
            )

            return storage_common.TransferWorkerOutput(
                retries=0,
                size=upload_entry.size,
                size_transferred=0,
                count=1,
                count_transferred=0,
            )

        case _ as unreachable:
            assert_never(unreachable)


#################################
#     Upload public APIs        #
#################################


def upload(
    upload_start_result: common.UploadStartResult,
    *,
    regex: str | None = None,
    enable_progress_tracker: bool = False,
    executor_params: executor.ExecutorParameters | None = None,
    request_headers: List[storage.RequestHeaders] | None = None,
    cache_config: cache.CacheConfig | None = None,
) -> UploadOperationResult:
    """
    Uploads a dataset to a destination storage backend.
    """
    if executor_params is None:
        executor_params = executor.ExecutorParameters()

    storage_path = upload_start_result.upload_response['storage_path']
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

    worker_input_gen = _dataset_upload_worker_input_generator(
        local_paths=upload_start_result.local_upload_paths,
        remote_paths=upload_start_result.backend_upload_paths,
        destination=destination,
        destination_region=destination_region,
        regex=regex,
        manifest_cache=manifest_cache,
    )

    try:
        job_ctx = executor.run_job(
            thread_worker=dataset_upload_worker,
            thread_worker_input_gen=worker_input_gen,
            client_factory=client_factory,
            enable_progress_tracker=enable_progress_tracker,
            executor_params=executor_params,
        )

    except Exception as error:  # pylint: disable=broad-except
        raise osmo_errors.OSMODatasetError(
            f'Error uploading dataset: {error}',
        ) from error

    finally:
        # Write the manifest file to the destination storage backend,
        # even if we only have partial uploads.
        checksum = common.finalize_manifest(
            manifest_cache=manifest_cache,
            manifest_path=upload_start_result.upload_response['manifest_path'],
            enable_progress_tracker=enable_progress_tracker,
        )
        manifest_cache.clear()

    return UploadOperationResult(
        checksum=checksum,
        summary=storage.UploadSummary.from_job_context(job_ctx),
    )
