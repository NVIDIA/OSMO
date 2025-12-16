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
Module for downloading datasets.
"""

import dataclasses
import logging
import os
import re
from typing import Dict, Generator, List, overload
from typing_extensions import assert_never

import ijson

from . import common
from .. import storage
from ..storage import backends, downloading, mux
from ..storage.core import executor
from ...utils import cache, osmo_errors


logger = logging.getLogger(__name__)


############################
#     Download schemas     #
############################

@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class DatasetDownloadWorkerInput(
    mux.MuxThreadWorkerInput[downloading.DownloadWorkerInput],
):
    """
    A download worker input that uses a dataset manifest.
    """
    pass


###################################
#     Download implementation     #
###################################


def _dataset_download_worker_input_generator(
    source: common.DatasetInfo,
    destination: str,
    regex: str | None,
    resume: bool,
    cache_config: cache.CacheConfig | None,
) -> Generator[DatasetDownloadWorkerInput, None, None]:
    """
    Generates download worker inputs from a dataset manifest.
    """
    regex_check = re.compile(regex) if regex else None
    returned_entries = False

    storage_client = storage.SingleObjectClient.create(storage_uri=source.manifest_path)

    with storage_client.get_object_stream(as_io=True) as bytes_io:
        manifest_iter = ijson.items(bytes_io, 'item')

        try:
            for obj in manifest_iter:
                manifest_entry = common.ManifestEntry(**obj)

                if regex_check and not regex_check.match(manifest_entry.relative_path):
                    continue

                output_path = os.path.join(
                    destination,
                    source.name,
                    manifest_entry.relative_path,
                )

                storage_backend = backends.construct_storage_backend(
                    manifest_entry.storage_path,
                    cache_config=cache_config,
                )

                returned_entries = True

                yield DatasetDownloadWorkerInput(  # pylint: disable=unexpected-keyword-arg, missing-kwoa
                    storage_profile=storage_backend.profile,
                    worker_input=downloading.DownloadWorkerInput(
                        container=storage_backend.container,
                        source=storage_backend.path,
                        destination=output_path,
                        checksum=manifest_entry.etag,
                        resume=resume,
                        size=manifest_entry.size,
                    ),
                )

        finally:
            if not returned_entries and regex:
                logger.warning('No entries matched regex %s.', regex)


def _download_dataset(
    dataset_info: common.DatasetInfo,
    enable_progress_tracker: bool,
    executor_params: executor.ExecutorParameters,
    destination: str,
    regex: str | None,
    resume: bool,
    cache_config: cache.CacheConfig | None,
) -> storage.DownloadSummary:
    """
    Downloads a dataset to a destination directory.

    It is possible for 1 dataset to point to objects stored across different storage URIs. As a
    result, we need to **multiplex** storage clients.

    :return: The download summary.
    :rtype: storage.DownloadSummary

    Raises:
        OSMODatasetError: If the download fails.
    """
    client_factory = mux.MuxStorageClientFactory()

    thread_worker_input_gen = _dataset_download_worker_input_generator(
        dataset_info,
        destination,
        regex,
        resume,
        cache_config,
    )

    try:
        job_ctx = mux.run_multiplexed_job(
            downloading.download_worker,
            thread_worker_input_gen,
            client_factory,
            enable_progress_tracker,
            executor_params,
        )
        return storage.DownloadSummary.from_job_context(job_ctx)

    except Exception as error:  # pylint: disable=broad-except
        raise osmo_errors.OSMODatasetError(
            f'Error downloading dataset {dataset_info.name}: {error}',
        ) from error


################################
#     Download public APIs     #
################################


@overload
def download(
    source: common.DatasetInfo,
    destination: str,
    *,
    regex: str | None = None,
    resume: bool = False,
    enable_progress_tracker: bool = False,
    executor_params: executor.ExecutorParameters | None = None,
    cache_config: cache.CacheConfig | None = None,
) -> storage.DownloadSummary:
    """
    Download a single dataset to a destination directory.

    :param common.DatasetInfo source: The dataset to download.
    :param str destination: The destination directory to download the dataset to.
    :param str | None regex: A regex to filter the dataset by.
    :param bool resume: Whether to resume the download from a previous attempt.
    :param executor.ExecutorParameters | None executor_parameters: The executor parameters
                                                                   to use for the download.

    :return: The download summary.
    :rtype: storage.DownloadSummary
    """
    pass


@overload
def download(
    source: List[common.DatasetInfo],
    destination: str,
    *,
    regex: str | None = None,
    resume: bool = False,
    enable_progress_tracker: bool = False,
    executor_params: executor.ExecutorParameters | None = None,
    cache_config: cache.CacheConfig | None = None,
) -> Dict[str, storage.DownloadSummary]:
    """
    Download multiple datasets to a destination directory.

    :param List[common.DatasetInfo] source: The datasets to download.
    :param str destination: The destination directory to download the datasets to.
    :param str | None regex: A regex to filter the datasets by.
    :param bool resume: Whether to resume the download from a previous attempt.
    :param executor.ExecutorParameters | None executor_parameters: The executor parameters
                                                                   to use for the download.

    :return: The download summaries.
    :rtype: Dict[str, storage.DownloadSummary]
    """
    pass


def download(
    source: common.DatasetInfo | List[common.DatasetInfo],
    destination: str,
    *,
    regex: str | None = None,
    resume: bool = False,
    enable_progress_tracker: bool = False,
    executor_params: executor.ExecutorParameters | None = None,
    cache_config: cache.CacheConfig | None = None,
) -> storage.DownloadSummary | Dict[str, storage.DownloadSummary]:
    """
    Downloads one or more datasets to a destination directory.
    """
    if executor_params is None:
        executor_params = executor.ExecutorParameters()

    match source:
        case []:
            raise osmo_errors.OSMODatasetError('No datasets to download.')

        case common.DatasetInfo():
            return _download_dataset(
                source,
                enable_progress_tracker,
                executor_params,
                destination,
                regex,
                resume,
                cache_config,
            )

        case list():
            return {
                dataset_info.name: _download_dataset(
                    dataset_info,
                    enable_progress_tracker,
                    executor_params,
                    destination,
                    regex,
                    resume,
                    cache_config,
                )
                for dataset_info in source
            }

        case _ as unreachable:
            assert_never(unreachable)
