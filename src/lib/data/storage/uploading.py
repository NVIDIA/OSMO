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
Top level module for storage upload operations.
"""

import dataclasses
import logging
import os
import re
from typing import Callable, Generator, List, Protocol, runtime_checkable
from typing_extensions import override

import pydantic

from . import common
from .core import client, executor, provider, progress
from ...utils import common as utils_common, osmo_errors


logger = logging.getLogger(__name__)


##########################
#     Upload schemas     #
##########################


class UploadInputGeneratorError(osmo_errors.OSMODataStorageError):
    """
    Error class for upload input generator errors.
    """
    pass


class UploadWorkerError(osmo_errors.OSMODataStorageError):
    """
    Error class for upload worker errors.
    """
    pass


@runtime_checkable
class UploadCallback(Protocol):
    """
    A callback function for upload operations. Implementations *MUST* be picklable if used in
    multiprocessing-based upload operations.

    Important: Avoid closures that capture local variables. Use classes with __call__ method or
    module-level functions instead.

    Example of picklable callback:

    ```python
    import multiprocessing

    class CounterCallback(UploadCallback):
        def __init__(
            self,
            counter: multiprocessing.Value,
            lock: multiprocessing.Lock,
        ):
            self.counter = counter
            self.lock = lock

        def __call__(
            self,
            upload_input: UploadWorkerInput,
            response: client.UploadResponse | client.ObjectExistsResponse,
        ):
            with self.lock:
                self.counter.value += 1

    with multiprocessing.Manager() as manager:
        counter = manager.Value('i', 0)
        lock = manager.Lock()
        callback = CounterCallback(counter, lock)

        upload(
            client_factory,
            UploadParams(
                ...
                callback=callback,
            ),
        )

        assert counter.value > 0
    ```
    """

    def __call__(
        self,
        upload_input: 'UploadWorkerInput',
        response: client.UploadResponse | client.ObjectExistsResponse,
    ) -> None:
        ...


# UploadCallback as a function type, useful when the callback does not need to be
# pickled for multiprocess operations.
UploadCallbackFn = Callable[
    ['UploadWorkerInput', client.UploadResponse | client.ObjectExistsResponse],
    None,
]

UploadCallbackLike = UploadCallback | UploadCallbackFn


@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class UploadWorkerInput(executor.ThreadWorkerInput):
    """
    A class for storing the input for an upload operation.
    """
    source: str
    container: str
    destination: str

    checksum: str | None = dataclasses.field(default=None)
    check_checksum: bool = dataclasses.field(default=True)
    resume: bool = dataclasses.field(default=False)
    callback: UploadCallbackLike | None = dataclasses.field(default=None)

    @override
    def error_key(self) -> str:
        return self.source


@pydantic.dataclasses.dataclass(
    config=pydantic.dataclasses.ConfigDict(
        frozen=True,
    ),
)
class UploadPath:
    """
    Data class for a single upload path mapping.

    :param str source: The source path of the data.
    :param common.RemotePath destination: The destination path of the data.
    """
    source: str = pydantic.Field(
        ...,
        description='The source path of the data, must be a valid local path.',
    )

    destination: common.RemotePath = pydantic.Field(
        ...,
        description='The destination path of the data, must be a valid remote path.',
    )


@pydantic.dataclasses.dataclass(
    config=pydantic.dataclasses.ConfigDict(
        arbitrary_types_allowed=True,
        frozen=True,
    ),
)
class UploadParams:
    """
    A class for storing the parameters for an upload operation.
    """

    executor_params: executor.ExecutorParameters = pydantic.Field(
        ...,
        description='The executor parameters to use for the upload.',
    )

    upload_paths: List[UploadPath] | None = pydantic.Field(
        default=None,
        description='The list of upload paths to use for the upload job. Either '
                    'upload_paths or upload_worker_inputs must be provided (not both). '
                    'If provided, regex and resume are ignored.',
    )

    regex: str | None = pydantic.Field(
        default=None,
        description='The regular expression used to filter files to upload. Defaults to None.',
    )

    resume: bool = pydantic.Field(
        default=False,
        description='Whether a previous upload was resumed. Defaults to False.',
    )

    upload_worker_inputs: List[UploadWorkerInput] | None = pydantic.Field(
        default=None,
        description='The list of upload worker inputs to use for the upload job. Either '
                    'upload_paths or upload_worker_inputs must be provided (not both). '
                    'If provided, regex and resume are ignored.',
    )

    upload_worker_inputs_generator: Generator[
        UploadWorkerInput, None, None
    ] | None = pydantic.Field(
        default=None,
        description='A generator of upload worker inputs to use for the upload job. If '
                    'UploadWorkerInput is used as input, either upload_worker_inputs or '
                    'upload_worker_inputs_generator should be provided (not both).',
    )

    enable_progress_tracker: bool = pydantic.Field(
        default=False,
        description='Whether to enable the progress tracker. Defaults to False.',
    )

    callback: UploadCallbackLike | None = pydantic.Field(
        default=None,
        description='The callback to call (with either UploadResponse or ObjectExistsResponse) '
                    'after each file is uploaded.',
    )

    @pydantic.root_validator
    @classmethod
    def validate_upload_sources(cls, values):
        """
        Validate that exactly one of upload_paths, upload_worker_inputs, or
        upload_worker_inputs_generator is provided.
        """
        if sum([
            values.get('upload_paths') is not None,
            values.get('upload_worker_inputs') is not None,
            values.get('upload_worker_inputs_generator') is not None,
        ]) != 1:
            raise ValueError(
                'Exactly one of upload_paths, upload_worker_inputs, or '
                'upload_worker_inputs_generator must be provided.')

        return values


@pydantic.dataclasses.dataclass(frozen=True, kw_only=True)
class UploadSummary(common.TransferSummary):
    """
    Summary of an upload operation.
    """
    pass


#################################
#     Upload implementation     #
#################################


def upload_worker(
    upload_input: UploadWorkerInput,
    client_provider: provider.StorageClientProvider,
    progress_updater: progress.ProgressUpdater
) -> common.TransferWorkerOutput:
    """
    Upload a single file or directory to a remote storage backend.

    :param UploadWorkerInput upload_input: The input for the upload operation.
    :param provider.StorageClientProvider client_provider: The client provider to use.
    :param progress.ProgressUpdater progress_updater: The progress updater to use.

    :return: The output for the upload operation.
    :rtype: common.TransferWorkerOutput
    """
    if upload_input.resume:

        checksum = upload_input.checksum
        if upload_input.check_checksum and not upload_input.checksum:
            try:
                checksum = utils_common.etag_checksum(upload_input.source)
            except (FileNotFoundError, PermissionError) as err:
                raise UploadWorkerError(
                    f'{upload_input.source}: Unable to read file to calculate checksum: {err}'
                ) from err

        with client_provider.get() as storage_client:
            exists_response = storage_client.object_exists(
                bucket=upload_input.container,
                key=upload_input.destination,
                checksum=checksum,
            )

        if exists_response.result.exists:
            progress_updater.update(
                name=upload_input.source,
                amount_change=upload_input.size,
            )

            if upload_input.callback:
                upload_input.callback(upload_input, exists_response.result)

            return common.TransferWorkerOutput(
                retries=exists_response.context.retries,
                size=upload_input.size,
                size_transferred=0,  # Upload was skipped
                count=1,
                count_transferred=0,  # Upload was skipped
            )

    progress_updater.update(name=upload_input.source)

    def progress_hook(b_transferred):
        progress_updater.update(amount_change=b_transferred)

    try:
        with client_provider.get() as storage_client:
            upload_response = storage_client.upload(
                filename=upload_input.source,
                bucket=upload_input.container,
                key=upload_input.destination,
                progress_hook=progress_hook,
            )

        if upload_input.callback:
            upload_input.callback(upload_input, upload_response.result)

        return common.TransferWorkerOutput(
            retries=upload_response.context.retries,
            size=upload_response.result.size,
            size_transferred=upload_response.result.size,
            count=1,
            count_transferred=1,
        )
    except (FileNotFoundError, PermissionError) as err:
        raise UploadWorkerError(
            f'{upload_input.source}: Unable to read file to upload: {err}'
        ) from err


def _upload_worker_input_generator(
    upload_paths: List[UploadPath],
    regex: str | None,
    resume: bool,
    callback: UploadCallbackLike | None,
) -> Generator[UploadWorkerInput, None, List[BaseException]]:
    """
    Collect input objects passed as inputs
    - can be single or multiple objects
    - can be a directory
    """
    generator_errors: List[BaseException] = []

    regex_check = re.compile(regex) if regex else None
    for upload_path in upload_paths:
        local_path = upload_path.source
        remote_path = upload_path.destination

        has_asterisk = local_path.endswith('/*')
        local_path = local_path[:-2] if has_asterisk else local_path

        local_files_gen = common.list_local_files(
            local_path=local_path,
            has_asterisk=has_asterisk,
            regex_pattern=regex_check,
        )
        source_is_dir = os.path.isdir(local_path)

        while True:
            try:
                local_file_result = next(local_files_gen)

                if remote_path.name:
                    # Destination name remapping
                    local_file_rel_path = common.remap_destination_name(
                        local_file_result.rel_path,
                        source_is_dir,
                        remote_path.name,
                    )
                else:
                    local_file_rel_path = local_file_result.rel_path

                yield UploadWorkerInput(  # pylint: disable=unexpected-keyword-arg
                    size=local_file_result.size,
                    source=local_file_result.abs_path,
                    container=remote_path.container,
                    destination=os.path.join(remote_path.prefix or '', local_file_rel_path),
                    resume=resume,
                    callback=callback,
                )
            except StopIteration as stop_err:
                generator_errors.extend(stop_err.value)
                break

    return generator_errors


##############################
#     Upload public APIs     #
##############################


def upload_objects(
    client_factory: provider.StorageClientFactory,
    upload_params: UploadParams,
) -> UploadSummary:
    """
    Upload files/folders from a list of upload entries

    :param client_factory: The client factory to use for the upload.
    :param upload_params: The parameters for the upload.

    :return: The result of the upload.
    :rtype: UploadSummary

    Raises:
        common.OperationError: If the upload fails.
    """
    worker_inputs: executor.WorkerInputGenerator[UploadWorkerInput]

    if upload_params.upload_paths:
        # Caller is uploading from a list of upload paths
        worker_inputs = _upload_worker_input_generator(
            upload_params.upload_paths,
            upload_params.regex,
            upload_params.resume,
            upload_params.callback,
        )

    elif upload_params.upload_worker_inputs_generator:
        worker_inputs = upload_params.upload_worker_inputs_generator

    elif upload_params.upload_worker_inputs:
        worker_inputs = (worker_input for worker_input in upload_params.upload_worker_inputs)

    else:
        raise osmo_errors.OSMOUsageError(
            'No upload worker inputs provided. Either upload_paths, '
            'upload_worker_inputs, or upload_worker_inputs_generator must be provided.',
        )

    start_time = utils_common.current_time()

    try:
        return UploadSummary.from_job_context(
            executor.run_job(
                upload_worker,
                worker_inputs,
                client_factory,
                upload_params.enable_progress_tracker,
                upload_params.executor_params,
            ),
        )

    except executor.ExecutorError as error:
        raise common.OperationError(
            f'Error uploading data: {error}',
            summary=UploadSummary.from_job_context(
                error.job_context,
            ),
        ) from error

    except Exception as error:  # pylint: disable=broad-except
        raise common.OperationError(
            f'Error uploading data: {error}',
            summary=UploadSummary(  # pylint: disable=unexpected-keyword-arg
                start_time=start_time,
                end_time=utils_common.current_time(),
                failures=[str(error)],
            ),
        ) from error
