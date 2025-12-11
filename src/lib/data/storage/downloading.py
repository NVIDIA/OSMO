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
Top level module for storage download operations.
"""

import dataclasses
import logging
import os
from typing import Generator, List
from typing_extensions import override

import pydantic

from . import common
from .core import executor, provider, progress
from ...utils import common as utils_common, osmo_errors


logger = logging.getLogger(__name__)


############################
#     Download schemas     #
############################


@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class DownloadWorkerInput(executor.ThreadWorkerInput):
    """
    Data class for the input for a download worker execution.
    """
    container: str
    source: str
    destination: str

    checksum: str | None = dataclasses.field(default=None)
    resume: bool = dataclasses.field(default=False)

    @override
    def error_key(self) -> str:
        return f'{self.container}/{self.source}'


@pydantic.dataclasses.dataclass(
    config=pydantic.dataclasses.ConfigDict(
        frozen=True,
    ),
)
class DownloadPath:
    """
    Data class for a single download path mapping.

    :param common.RemotePath source: The source path of the data.
    :param str destination: The destination path of the data.
    """
    source: common.RemotePath = pydantic.Field(
        ...,
        description='The source path of the data, must be a valid remote path.',
    )

    destination: str = pydantic.Field(
        ...,
        min_length=1,
        description='The destination path of the data, must be a valid local path.',
    )


@pydantic.dataclasses.dataclass(
    config=pydantic.dataclasses.ConfigDict(
        arbitrary_types_allowed=True,
        frozen=True,
    ),
)
class DownloadParams:
    """
    Parameters for a download operation.

    :param executor.ExecutorParameters executor_params: The executor parameters.
    :param List[DownloadPath] download_paths: The list of data paths to download.
    :param str regex: The regular expression used to filter files to download.
    :param bool resume: Whether a previous download was resumed.
    :param List[DownloadWorkerInput] download_worker_inputs: The list of download worker inputs
                                                             to use for the download job.
    :param bool enable_progress_tracker: Whether to enable the progress tracker.
    """
    executor_params: executor.ExecutorParameters = pydantic.Field(
        ...,
        description='The executor parameters to use for the download.',
    )

    download_paths: List[DownloadPath] | None = pydantic.Field(
        default=None,
        description='The list of data paths to download. Either download_paths or '
                    'download_worker_inputs must be provided (not both).',
    )

    regex: str | None = pydantic.Field(
        default=None,
        description='The regular expression used to filter files to download. Defaults to None.',
    )

    resume: bool = pydantic.Field(
        default=False,
        description='Whether a previous download was resumed. Defaults to False.',
    )

    download_worker_inputs: List[DownloadWorkerInput] | None = pydantic.Field(
        default=None,
        description='The list of download worker inputs to use for the download job. Either '
                    'download_paths or download_worker_inputs must be provided (not both). '
                    'If provided, regex and resume are ignored.',
    )

    download_worker_inputs_generator: Generator[
        DownloadWorkerInput, None, None
    ] | None = pydantic.Field(
        default=None,
        description='A generator of download worker inputs to use for the download job. If '
                    'DownloadWorkerInput is used as input, either download_worker_inputs or '
                    'download_worker_inputs_generator should be provided (not both).',
    )

    enable_progress_tracker: bool = pydantic.Field(
        default=False,
        description='Whether to enable the progress tracker. Defaults to False.',
    )

    @pydantic.root_validator
    @classmethod
    def validate_download_sources(cls, values):
        """
        Validate that exactly one of download_paths, download_worker_inputs, or
        download_worker_inputs_generator is provided.
        """
        if sum([
            values.get('download_paths') is not None,
            values.get('download_worker_inputs') is not None,
            values.get('download_worker_inputs_generator') is not None,
        ]) != 1:
            raise ValueError(
                'Exactly one of download_paths, download_worker_inputs, or '
                'download_worker_inputs_generator must be provided.')

        return values


@pydantic.dataclasses.dataclass(frozen=True, kw_only=True)
class DownloadSummary(common.TransferSummary):
    """
    Summary of a download operation.

    :ivar datetime.datetime start_time: The start time of the download.
    :ivar datetime.datetime end_time: The end time of the download.
    :ivar int retries: The number of retries that were made during the download.
    :ivar List[str] failures: A list of messages describing failed downloads.
    :ivar int size: The total size of the downloaded data.
    :ivar int size_transferred: The total size of the downloaded data that was transferred
                                (instead of skipped due to resumable download).
    :ivar int count: The total number of files that were downloaded.
    :ivar int count_transferred: The total number of files that were transferred
                                 (instead of skipped due to resumable download).
    """
    pass


###################################
#     Download implementation     #
###################################


def download_worker(
    download_worker_input: DownloadWorkerInput,
    client_provider: provider.StorageClientProvider,
    progress_updater: progress.ProgressUpdater,
) -> common.TransferWorkerOutput:
    """
    Downloads a single file from remote storage.

    :param DownloadWorkerInput download_worker_input: The input for the download operation.
    :param provider.StorageClientProvider client_provider: The client provider to use.
    :param progress.ProgressUpdater progress_updater: The progress updater to use. (Optional)

    :return: The output for the download operation.
    :rtype: common.TransferWorkerOutput
    """
    # Ensure the directory path exists
    exists = os.path.exists(download_worker_input.destination)

    if download_worker_input.resume and exists:
        try:
            if (
                # Simple size check to avoid unnecessary checksum validation
                os.path.getsize(
                    download_worker_input.destination,
                ) == download_worker_input.size

                # Validate the checksum of the local file
                and utils_common.etag_checksum(
                    download_worker_input.destination,
                ) == download_worker_input.checksum
            ):
                # Local file already matches the remote file
                progress_updater.update(
                    name=download_worker_input.source,
                    amount_change=download_worker_input.size,
                )

                return common.TransferWorkerOutput(
                    retries=0,
                    size=download_worker_input.size,
                    size_transferred=0,  # Download was skipped
                    count=1,
                    count_transferred=0,  # Download was skipped
                )
            else:
                # If the checksums are different, delete file
                os.remove(download_worker_input.destination)
        except FileNotFoundError:
            pass
        except OSError as error:
            logger.warning(error)

    if not exists:
        destination_dir = os.path.dirname(download_worker_input.destination)
        os.makedirs(destination_dir, exist_ok=True)

    progress_updater.update(name=download_worker_input.source)

    def progress_hook(b_transferred):
        progress_updater.update(amount_change=b_transferred)

    with client_provider.get() as storage_client:
        download_api_response = storage_client.download(
            bucket=download_worker_input.container,
            key=download_worker_input.source,
            filename=download_worker_input.destination,
            progress_hook=progress_hook,
        )

    return common.TransferWorkerOutput(
        retries=download_api_response.context.retries,
        size=download_api_response.result.size,
        size_transferred=download_api_response.result.size,
        count=1,
        count_transferred=1,
    )


def _download_worker_input_generator(
    client_factory: provider.StorageClientFactory,
    download_paths: List[DownloadPath],
    regex: str | None,
    resume: bool,
) -> Generator[DownloadWorkerInput, None, None]:
    """
    Generate the input for a download worker by listing object(s) from download source paths.
    """
    with client_factory.to_provider() as client_provider:

        for download_path in download_paths:
            with client_provider.get() as storage_client:
                # List objects in the remote path using the client provider
                list_objects_response = storage_client.list_objects(
                    bucket=download_path.source.container,
                    prefix=download_path.source.prefix,
                    regex=regex,
                ).result

            for obj in list_objects_response.objects:
                # Create the local path corresponding to the remote location
                target = os.path.join(
                    download_path.destination,
                    common.get_download_relative_path(
                        obj.key,
                        download_path.source.prefix,
                    ),
                )

                yield DownloadWorkerInput(  # pylint: disable=unexpected-keyword-arg
                    size=obj.size,
                    container=download_path.source.container,
                    source=obj.key,
                    destination=target,
                    checksum=obj.checksum,
                    resume=resume,
                )


################################
#     Download public APIs     #
################################


def download_objects(
    client_factory: provider.StorageClientFactory,
    download_params: DownloadParams,
) -> DownloadSummary:
    """
    Top level entry point for downloading data from a storage client.

    :param client_factory: The client factory to use for the download.
    :param download_params: The download parameters.

    :return: The download result.
    :rtype: DownloadSummary

    Raises:
        common.OperationError: If the download fails.
    """
    if download_params.download_paths:
        # Caller is downloading from a list of download paths
        worker_inputs = _download_worker_input_generator(
            client_factory,
            download_params.download_paths,
            download_params.regex,
            download_params.resume,
        )

    elif download_params.download_worker_inputs:
        # Caller is downloading from a list of download worker inputs
        worker_inputs = (worker_input for worker_input in download_params.download_worker_inputs)

    elif download_params.download_worker_inputs_generator:
        # Caller is downloading from a generator of download worker inputs
        worker_inputs = download_params.download_worker_inputs_generator

    else:
        raise osmo_errors.OSMOUsageError(
            'No download worker inputs provided. Either download_paths, '
            'download_worker_inputs, or download_worker_inputs_generator must be provided.',
        )

    start_time = utils_common.current_time()

    try:
        return DownloadSummary.from_job_context(
            executor.run_job(
                download_worker,
                worker_inputs,
                client_factory,
                download_params.enable_progress_tracker,
                download_params.executor_params,
            ),
        )

    except executor.ExecutorError as error:
        raise common.OperationError(
            f'Error downloading data: {error}',
            summary=DownloadSummary.from_job_context(error.job_context),
        ) from error

    except Exception as error:  # pylint: disable=broad-except
        raise common.OperationError(
            f'Error downloading data: {error}',
            summary=DownloadSummary(  # pylint: disable=unexpected-keyword-arg
                start_time=start_time,
                end_time=utils_common.current_time(),
                failures=[str(error)],
            ),
        ) from error
