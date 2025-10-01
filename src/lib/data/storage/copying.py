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
Top level module for storage copy operations.
"""

import dataclasses
import logging
import os
from typing import Callable, Generator, List
from typing_extensions import override

import pydantic

from . import common
from .core import client, executor, provider, progress
from ...utils import common as utils_common


logger = logging.getLogger(__name__)


########################
#     Copy schemas     #
########################


CopyCallback = Callable[
    ['CopyWorkerInput', client.CopyResponse | client.ObjectExistsResponse],
    None,
]


@pydantic.dataclasses.dataclass(frozen=True)
class CopyParams:
    """
    Dataclass for copy parameters.
    """

    executor_params: executor.ExecutorParameters = pydantic.Field(
        ...,
        description='The executor parameters for the copy operation.',
    )

    source: List[common.RemotePath] = pydantic.Field(
        ...,
        description='The source path of the data.',
    )

    destination: common.RemotePath = pydantic.Field(
        ...,
        description='The destination path of the data.',
    )

    regex: str | None = pydantic.Field(
        default=None,
        description='The regular expression used to filter files (from source) to copy.',
    )

    enable_progress_tracker: bool = pydantic.Field(
        default=False,
        description='Whether to enable progress tracking.',
    )

    callback: CopyCallback | None = pydantic.Field(
        default=None,
        description='The callback to call (with CopyResponse or ObjectExistsResponse) after '
                    'each file is copied.',
    )


@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class CopyWorkerInput(executor.ThreadWorkerInput):
    """
    Data class for copy worker input.
    """
    source_bucket: str
    source_key: str
    source_checksum: str | None
    destination_bucket: str
    destination_key: str
    callback: CopyCallback | None = dataclasses.field(default=None)

    @override
    def error_key(self) -> str:
        return f'{self.source_bucket}/{self.source_key}'


@pydantic.dataclasses.dataclass(frozen=True, kw_only=True)
class CopySummary(common.TransferSummary):
    """
    Summary of a copy operation.
    """
    pass


###############################
#     Copy implementation     #
###############################


def copy_worker(
    copy_worker_input: CopyWorkerInput,
    client_provider: provider.StorageClientProvider,
    progress_updater: progress.ProgressUpdater
) -> common.TransferWorkerOutput:
    """
    Copy a single file or directory to a remote storage backend.

    :param CopyWorkerInput copy_worker_input: The input for the copy operation.
    :param provider.StorageClientProvider client_provider: The client provider to use.
    :param progress.ProgressUpdater progress_updater: The progress updater to use.

    :return: The output for the copy operation.
    :rtype: common.TransferWorkerOutput
    """
    with client_provider.get() as storage_client:
        exists_response = storage_client.object_exists(
            bucket=copy_worker_input.destination_bucket,
            key=copy_worker_input.destination_key,
            checksum=copy_worker_input.source_checksum,
        )

    if exists_response.result.exists:
        progress_updater.update(
            name=copy_worker_input.source_key,
            amount_change=copy_worker_input.size,
        )

        if copy_worker_input.callback:
            copy_worker_input.callback(copy_worker_input, exists_response.result)

        return common.TransferWorkerOutput(
            size=copy_worker_input.size,
            size_transferred=0,  # Copy was skipped
            count=1,
            count_transferred=0,  # Copy was skipped
            retries=exists_response.context.retries,
        )

    progress_updater.update(name=copy_worker_input.source_key)

    def progress_hook(b_transferred):
        progress_updater.update(amount_change=b_transferred)

    with client_provider.get() as storage_client:
        copy_response = storage_client.copy(
            source_bucket=copy_worker_input.source_bucket,
            source_key=copy_worker_input.source_key,
            destination_bucket=copy_worker_input.destination_bucket,
            destination_key=copy_worker_input.destination_key,
            progress_hook=progress_hook,
        )

    if copy_worker_input.callback:
        copy_worker_input.callback(copy_worker_input, copy_response.result)

    return common.TransferWorkerOutput(
        size=copy_response.result.size,
        size_transferred=copy_response.result.size,
        count=1,
        count_transferred=1,
        retries=copy_response.context.retries,
    )


def _copy_worker_input_generator(
    client_factory: provider.StorageClientFactory,
    source_locations: List[common.RemotePath],
    destination_path: common.RemotePath,
    regex: str | None = None,
) -> Generator[CopyWorkerInput, None, None]:
    """
    Generator for copy worker input.
    """
    with provider.CacheableClientProvider(client_factory) as client_provider:

        for source_location in source_locations:

            with client_provider.get() as storage_client:
                list_objects_response = storage_client.list_objects(
                    bucket=source_location.container,
                    prefix=source_location.prefix,
                    regex=regex,
                ).result

                for obj in list_objects_response.objects:
                    file_rel_path = common.get_upload_relative_path(
                        obj.key,
                        source_location.prefix or '',
                        has_asterisk=False,
                    )

                    if destination_path.name:
                        source_base_prefix = (source_location.prefix or '').rstrip(os.path.sep)
                        source_is_dir = obj.key != source_base_prefix

                        # Destination name remapping
                        file_rel_path = common.remap_destination_name(
                            file_rel_path,
                            source_is_dir,
                            destination_path.name,
                        )

                    new_key = os.path.join(
                        destination_path.prefix or '',
                        file_rel_path,
                    )

                    yield CopyWorkerInput(  # pylint: disable=unexpected-keyword-arg
                        source_bucket=source_location.container,
                        source_key=obj.key,
                        source_checksum=obj.checksum,
                        destination_bucket=destination_path.container,
                        destination_key=new_key,
                        size=obj.size,
                    )


############################
#     Copy Public APIs     #
############################


def copy_objects(
    client_factory: provider.StorageClientFactory,
    copy_params: CopyParams,
) -> CopySummary:
    """
    Copy one or more objects in the object storage container.

    :param client_factory: The client factory to use for the copy.
    :param copy_params: The parameters for the copy.

    :return: The result of the copy.
    :rtype: CopySummary

    Raises:
        common.OperationError: If the copy fails.
    """
    start_time = utils_common.current_time()

    try:
        return CopySummary.from_job_context(
            executor.run_job(
                copy_worker,
                _copy_worker_input_generator(
                    client_factory,
                    copy_params.source,
                    copy_params.destination,
                    copy_params.regex,
                ),
                client_factory,
                copy_params.enable_progress_tracker,
                copy_params.executor_params,
            ),
        )

    except executor.ExecutorError as error:
        raise common.OperationError(
            f'Error copying data: {error}',
            summary=CopySummary.from_job_context(error.job_context),
        ) from error

    except Exception as error:  # pylint: disable=broad-except
        raise common.OperationError(
            f'Error copying data: {error}',
            summary=CopySummary(  # pylint: disable=unexpected-keyword-arg
                start_time=start_time,
                end_time=utils_common.current_time(),
                failures=[str(error)],
            ),
        ) from error
