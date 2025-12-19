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
Module for migrating legacy datasets to manifest based datasets.
"""

import dataclasses
import os
import re
from typing import Generator, List
from typing_extensions import override

import diskcache

from . import common
from .. import storage
from ..storage import common as storage_common, copying
from ..storage.core import client, executor, progress, provider
from ...utils import cache, client_configs, osmo_errors


MANIFEST_REGEX_PATTERN = re.compile(r'.*\/manifests\/[0-9]+\.json$')


###########################
#     Migrate schemas     #
###########################


class MigrateInputGeneratorError(osmo_errors.OSMODatasetError):
    """
    Error for generating input for migrating a dataset.
    """
    pass


@dataclasses.dataclass(kw_only=True, slots=True)
class DatasetMigrateEntry(common.SortableEntry):
    """
    An entry for migrating a dataset.
    """
    size: int
    source_bucket: str
    source_key: str
    source_checksum: str
    destination_backend: storage.StorageBackend
    destination_region: str


@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class DatasetMigrateInput(executor.ThreadWorkerInput):
    """
    A worker input for migrating a dataset.
    """
    index: int
    entry: DatasetMigrateEntry
    manifest_cache: diskcache.Index

    size: int = dataclasses.field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, 'size', self.entry.size)

    @override
    def error_key(self) -> str:
        return self.entry.relative_path


@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class MigrateOperationResult:
    """
    Result of a dataset migration operation.
    """
    checksum: str
    summary: copying.CopySummary


##################################
#     Migrate implementation     #
##################################


def _dataset_migrate_input_generator(
    source_backend: storage.StorageBackend,
    destination_backend: storage.StorageBackend,
    destination_region: str,
    manifest_cache: diskcache.Index,
) -> Generator[DatasetMigrateInput, None, List[BaseException]]:
    """
    Generates copy worker inputs for migrating a legacy dataset to a manifest-based dataset.
    """
    errors: List[BaseException] = []

    source_client = storage.Client.create(storage_backend=source_backend)

    index = -1
    for obj in source_client.list_objects():
        if not obj.checksum:
            errors.append(MigrateInputGeneratorError(f'Source object ({obj.key}) has no checksum'))
            continue

        relative_path = storage_common.get_download_relative_path(
            object_key=obj.key,
            storage_base_path=source_backend.path,
        )

        index += 1

        yield DatasetMigrateInput(
            index=index,
            entry=DatasetMigrateEntry(
                relative_path=relative_path,
                size=obj.size,
                source_bucket=source_backend.container,
                source_key=obj.key,
                source_checksum=obj.checksum,
                destination_backend=destination_backend,
                destination_region=destination_region,
            ),
            manifest_cache=manifest_cache,
        )

    return errors


def _dataset_migrate_worker(
    worker_input: DatasetMigrateInput,
    client_provider: provider.StorageClientProvider,
    progress_updater: progress.ProgressUpdater,
) -> storage_common.TransferWorkerOutput:
    """
    A worker for migrating a dataset.

    Uses the source checksum as the object key in the destination storage backend.
    """
    migrate_entry: DatasetMigrateEntry = worker_input.entry
    destination_backend = migrate_entry.destination_backend
    destination_region = migrate_entry.destination_region

    def _callback(
        copy_input: copying.CopyWorkerInput,
        copy_response: client.CopyResponse | client.ObjectExistsResponse,
    ) -> None:
        # pylint: disable=unused-argument
        manifest_entry = common.ManifestEntry(
            relative_path=migrate_entry.relative_path,
            storage_path=os.path.join(destination_backend.uri, migrate_entry.source_checksum),
            url=os.path.join(
                destination_backend.parse_uri_to_link(destination_region),
                migrate_entry.source_checksum,
            ),
            size=migrate_entry.size,
            etag=migrate_entry.source_checksum,
        )
        worker_input.manifest_cache[worker_input.index] = manifest_entry.to_tuple()

    return copying.copy_worker(
        copy_worker_input=copying.CopyWorkerInput(
            size=migrate_entry.size,
            source_bucket=migrate_entry.source_bucket,
            source_key=migrate_entry.source_key,
            source_checksum=migrate_entry.source_checksum,
            destination_bucket=destination_backend.container,
            destination_key=os.path.join(destination_backend.path, migrate_entry.source_checksum),
            callback=_callback,
        ),
        client_provider=client_provider,
        progress_updater=progress_updater,
    )


##################################
#     Migrate public APIs        #
##################################


def migrate(
    source_uri: str,
    destination_uri: str,
    destination_manifest_uri: str,
    *,
    enable_progress_tracker: bool = False,
    executor_params: executor.ExecutorParameters | None = None,
    cache_config: cache.CacheConfig | None = None,
) -> MigrateOperationResult:
    """
    Migrates a legacy dataset to a manifest-based dataset.
    """
    if not MANIFEST_REGEX_PATTERN.match(destination_manifest_uri):
        raise osmo_errors.OSMODatasetError(
            f'Destination manifest URI ({destination_manifest_uri}) must '
            f'match {MANIFEST_REGEX_PATTERN.pattern}',
        )

    if executor_params is None:
        executor_params = executor.ExecutorParameters()

    source_backend = storage.construct_storage_backend(
        uri=source_uri,
        cache_config=cache_config,
    )
    destination_backend = storage.construct_storage_backend(
        uri=destination_uri,
        cache_config=cache_config,
    )

    # Resolve the region for the destination storage backend.
    # This is necessary for generating a valid regional HTTP URL for uploaded objects
    # for certain storage backends (e.g. AWS S3).
    destination_creds = client_configs.get_credentials(destination_backend.profile)
    destination_region = destination_backend.region(
        destination_creds.access_key_id,
        destination_creds.get_access_key_value(),
    )

    client_factory = destination_backend.client_factory(
        access_key_id=destination_creds.access_key_id,
        access_key=destination_creds.get_access_key_value(),
        region=destination_region,
    )

    manifest_cache = diskcache.Index()

    worker_input_gen = _dataset_migrate_input_generator(
        source_backend=source_backend,
        destination_backend=destination_backend,
        destination_region=destination_region,
        manifest_cache=manifest_cache,
    )

    try:
        job_ctx = executor.run_job(
            thread_worker=_dataset_migrate_worker,
            thread_worker_input_gen=worker_input_gen,
            client_factory=client_factory,
            enable_progress_tracker=enable_progress_tracker,
            executor_params=executor_params,
        )

    except Exception as error:  # pylint: disable=broad-except
        raise osmo_errors.OSMODatasetError(
            f'Error migrating dataset: {error}',
        ) from error

    finally:
        # Write the manifest file to the destination storage backend,
        # even if we only have partial uploads.
        checksum = common.finalize_manifest(
            manifest_cache=manifest_cache,
            manifest_path=destination_manifest_uri,
            enable_progress_tracker=enable_progress_tracker,
        )
        manifest_cache.clear()

    return MigrateOperationResult(
        checksum=checksum,
        summary=copying.CopySummary.from_job_context(job_ctx),
    )
