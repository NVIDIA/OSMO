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
Common functions and definitions for storage modules
"""

import dataclasses
import datetime
import logging
import os
import contextlib
import io
import re
import stat
from typing import Callable, Generic, List, NamedTuple, TypeVar, Generator
from typing_extensions import override

import pydantic

from . import metrics
from .core import executor
from ...utils import common, osmo_errors


logger = logging.getLogger(__name__)

T = TypeVar('T')
R = TypeVar('R', bound='OperationSummary')
I = TypeVar('I', bound=io.IOBase)
S = TypeVar('S', bound='TransferSummary')


@pydantic.dataclasses.dataclass(frozen=True)
class StorageAuth:
    """
    A class for storing Data Storage Authentication Details.
    """

    user: str = pydantic.Field(
        ...,
        description='The user of the storage authentication.',
    )

    key: str = pydantic.Field(
        ...,
        description='The key of the storage authentication.',
    )


@pydantic.dataclasses.dataclass(frozen=True)
class RemotePath:
    """
    Dataclass for a remote path (scoped to a storage profile).

    :param str container: The container of the remote path.
    :param str | None prefix: The prefix of the remote path.
    :param str | None name: The object name of the remote path.
    """

    container: str = pydantic.Field(
        ...,
        min_length=1,
        description='The container of the remote path.',
    )

    prefix: str | None = pydantic.Field(
        default=None,
        description='The prefix of the remote path.',
    )

    name: str | None = pydantic.Field(
        default=None,
        description='The object name of the remote path.',
    )


@pydantic.dataclasses.dataclass(frozen=True, kw_only=True)
class OperationSummary(metrics.MetricsProducer):
    """
    A base class for all storage operation summaries.
    """

    start_time: datetime.datetime = pydantic.Field(
        ...,
        description='The start time of the operation',
    )

    end_time: datetime.datetime | None = pydantic.Field(
        default=None,
        description='The end time of the operation',
    )

    retries: int = pydantic.Field(
        default=0,
        description='The number of retries for the operation',
    )

    failures: List[str] = pydantic.Field(
        default_factory=list,
        description='The list of failures during the operation',
    )

    @property
    def elapsed_time(self) -> datetime.timedelta:
        """
        The elapsed time of the operation.
        """
        end_time = self.end_time or common.current_time()
        return end_time - self.start_time

    def to_metrics(self) -> metrics.OperationMetrics:
        """
        Create an OperationMetrics object from an OperationSummary object.
        """
        end_time = self.end_time or common.current_time()
        duration = end_time - self.start_time

        return metrics.OperationMetrics(
            start_time_ms=int(self.start_time.timestamp() * 1000),
            end_time_ms=int(end_time.timestamp() * 1000),
            duration_ms=int(duration.total_seconds() * 1000),
        )


class OperationStream(Generic[T, R], Generator[T, None, R]):
    """
    A stream of operations that returns an operation summary.
    """

    def __init__(
        self,
        gen: Generator[T, None, R],
    ):
        self._gen = gen
        self.summary: R | None = None

    def __iter__(self) -> 'OperationStream[T, R]':
        return self

    def __next__(self) -> T:
        try:
            return next(self._gen)
        except StopIteration as e:
            self.summary = e.value
            raise

    def send(self, value: None) -> T:
        try:
            return self._gen.send(value)
        except StopIteration as e:
            self.summary = e.value
            raise

    def throw(self, typ, val=None, tb=None) -> T:
        try:
            return self._gen.throw(typ, val, tb)
        except StopIteration as e:
            self.summary = e.value
            raise

    def close(self) -> None:
        return self._gen.close()


class OperationIO(Generic[I, R], io.IOBase):
    """
    A file-like object that contains an operation summary.
    """

    def __init__(
        self,
        open_with_stack: Callable[[contextlib.ExitStack], I],
        finalize: Callable[[I], R],
    ):
        super().__init__()

        self._stack = contextlib.ExitStack()
        self._delegate = open_with_stack(self._stack)
        self._finalize = finalize
        self.summary: R | None = None

    def __enter__(self) -> 'OperationIO[I, R]':
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    @override
    def read(self, n: int = -1) -> bytes:
        if n < -1:
            raise ValueError('n must be -1, 0, or positive')

        return self._delegate.read(n)

    @override
    def readable(self) -> bool:
        return True

    @override
    def close(self) -> None:
        if super().closed:  # pylint: disable=using-constant-test
            return

        try:
            self._stack.close()
            self.summary = self._finalize(self._delegate)
        finally:
            super().close()


class OperationError(osmo_errors.OSMODataStorageError, metrics.MetricsProducingError):
    """
    An error that occurred during an operation.
    """

    def __init__(
        self,
        *args,
        summary: OperationSummary,
        **kwargs,
    ):
        self.summary = summary
        super().__init__(*args, **kwargs)

    def to_metrics(self) -> metrics.OperationMetrics:
        """
        Create an OperationMetrics object from the underlying summary.
        """
        return self.summary.to_metrics()


@dataclasses.dataclass(kw_only=True, slots=True)
class TransferWorkerOutput(executor.ThreadWorkerOutput):
    """
    Data class for the output for a data transfer worker execution.
    """

    retries: int = dataclasses.field(default=0)
    size: int = dataclasses.field(default=0)
    size_transferred: int = dataclasses.field(default=0)
    count: int = dataclasses.field(default=0)
    count_transferred: int = dataclasses.field(default=0)

    @override
    def __add__(self, other: 'TransferWorkerOutput | None') -> 'TransferWorkerOutput':
        if other is None:
            return self

        return TransferWorkerOutput(
            retries=self.retries + other.retries,
            size=self.size + other.size,
            size_transferred=self.size_transferred + other.size_transferred,
            count=self.count + other.count,
            count_transferred=self.count_transferred + other.count_transferred,
        )

    def __iadd__(self, other: 'TransferWorkerOutput | None') -> 'TransferWorkerOutput':
        if other is None:
            return self

        self.retries += other.retries
        self.size += other.size
        self.size_transferred += other.size_transferred
        self.count += other.count
        self.count_transferred += other.count_transferred
        return self


@pydantic.dataclasses.dataclass(frozen=True, kw_only=True)
class TransferSummary(OperationSummary):
    """
    A base class for all transfer operation summaries.
    """

    size: int = pydantic.Field(
        default=0,
        description='The size of the data.',
    )

    size_transferred: int = pydantic.Field(
        default=0,
        description='The size of the data that was transferred.',
    )

    count: int = pydantic.Field(
        default=0,
        description='The number of files that were uploaded.',
    )

    count_transferred: int = pydantic.Field(
        default=0,
        description='The number of files that were transferred.',
    )

    @classmethod
    def from_job_context(
        cls: type[S],
        job_context: executor.JobContext[executor._T, TransferWorkerOutput],
    ) -> S:
        """
        Create an UploadResult from a job context.
        """
        if job_context.output is None:
            return cls(  # pylint: disable=unexpected-keyword-arg
                start_time=job_context.start_time,
                end_time=job_context.end_time,
                failures=[str(error) for error in job_context.errors],
            )

        return cls(  # pylint: disable=unexpected-keyword-arg
            start_time=job_context.start_time,
            end_time=job_context.end_time,
            retries=job_context.output.retries,
            failures=[str(error) for error in job_context.errors],
            size=job_context.output.size,
            size_transferred=job_context.output.size_transferred,
            count=job_context.output.count,
            count_transferred=job_context.output.count_transferred,
        )

    @override
    def to_metrics(self) -> metrics.TransferMetrics:
        """
        Create a TransferMetrics object from a TransferSummary object.
        """
        base_metrics = super().to_metrics()
        return metrics.TransferMetrics(
            **dataclasses.asdict(base_metrics),
            average_mbps=metrics.calculate_mbps(
                self.size_transferred,
                self.elapsed_time.total_seconds(),
            ),
            total_bytes_transferred=self.size_transferred,
            total_number_of_files=self.count_transferred,
        )


def get_upload_relative_path(
    file_abs_path: str,
    file_base_path: str,
    *,
    has_asterisk: bool = False,
) -> str:
    """
    Gets the object key path relative to the file base path when uploading/copying.

    If a user wants to upload from /a/b/c, object keys will be relative to /a/b/c when uploaded
    to the object storage.

    See ./tests/test_common.py for test cases and example usages.

    Args:
        file_abs_path: The absolute path of the file to get the relative path for.
        file_base_path: The base path of the file to get the relative path for.
        has_asterisk: Whether the file base path has an asterisk.

    Returns:
        The relative path of the file to the file base path.
    """
    if has_asterisk:
        return os.path.relpath(file_abs_path, file_base_path)
    normalized_file_base_path = os.path.normpath(file_base_path.rstrip('/'))
    file_base_dir = os.path.dirname(normalized_file_base_path)
    return os.path.relpath(file_abs_path, file_base_dir)


def get_download_relative_path(
    object_key: str,
    storage_base_path: str | None = None,
) -> str:
    """
    Gets the object key path relative to the storage base path when downloading.

    If a user wants to download from `a/b/c/`, object keys will be relative to `a/b/c`
    when downloaded from the object storage.

    See ./tests/test_common.py for test cases and example usages.

    Args:
        object_key: The object key to get the relative path for.
        storage_base_path: The storage base path to get the relative path for.

    Returns:
        The relative path of the object key to the storage base path.
    """
    if not storage_base_path:
        return object_key

    if storage_base_path == object_key:
        return os.path.basename(object_key)

    normalized_storage_base_path = os.path.normpath(storage_base_path.rstrip('/'))
    return os.path.relpath(object_key, normalized_storage_base_path)


def remap_destination_name(
    rel_path: str,
    source_is_dir: bool,
    new_name: str,
) -> str:
    """
    Remap a relative path by replacing:
    - first segment if the source is a directory
    - last segment (basename) if the source is a single file
    """
    parts = rel_path.split(os.path.sep)
    if source_is_dir:
        parts[0] = new_name
    else:
        parts[-1] = new_name
    return os.path.join(*parts)


class ListLocalFilesError(osmo_errors.OSMODataStorageError):
    """
    An error that occurred while listing file system objects.
    """
    pass


class LocalFileResult(NamedTuple):
    """
    A result of listing file system objects.
    """
    size: int      # Size of the file in bytes
    abs_path: str  # Absolute path of the file
    rel_path: str  # Path of the file relative to the local path input


def list_local_files(
    local_path: str,
    has_asterisk: bool = False,
    regex_pattern: re.Pattern | None = None,
) -> Generator[LocalFileResult, None, List[BaseException]]:
    """
    Lists files in a local path.

    Args:
        local_path: The local path to list files from.
        has_asterisk: Whether the local path has an asterisk.
        regex_pattern: A regex pattern to filter files by. (Optional)

    Returns:
        A generator of LocalFileResult objects.
        List[BaseException]: A list of errors that occurred while listing the files.
    """
    generator_errors: List[BaseException] = []
    returned_entries = False

    try:
        # Get the stats of the local path (follows symlinks)
        stat_result: os.stat_result = os.stat(local_path)

        if has_asterisk and not stat.S_ISDIR(stat_result.st_mode):
            # User provided a path with an asterisk, but it is not a directory
            generator_errors.append(
                ListLocalFilesError(
                    f'{local_path}: is not a directory, skipping...',
                ),
            )

        elif stat.S_ISREG(stat_result.st_mode):  # Regular file
            returned_entries = True
            yield LocalFileResult(
                size=stat_result.st_size,
                abs_path=local_path,
                rel_path=os.path.basename(local_path),
            )

        elif stat.S_ISDIR(stat_result.st_mode):  # Directory
            # TODO: support os.walk followlinks with cycle detection
            for (root, _, files) in os.walk(local_path, topdown=True):
                # Traverse lexicographically
                files.sort()

                for file in files:
                    file_abs_path = os.path.join(root, file)

                    file_rel_path = get_upload_relative_path(
                        file_abs_path,
                        local_path,
                        has_asterisk=has_asterisk,
                    )

                    if regex_pattern and not regex_pattern.match(file_rel_path):
                        continue

                    returned_entries = True
                    yield LocalFileResult(
                        size=os.stat(file_abs_path).st_size,
                        abs_path=file_abs_path,
                        rel_path=file_rel_path,
                    )

        else:
            # Other type (socket, device, etc.)
            generator_errors.append(
                ListLocalFilesError(
                    f'{local_path}: is not a regular file or directory, skipping...',
                ),
            )

    except OSError as err:
        generator_errors.append(
            ListLocalFilesError(
                f'{local_path}: cannot be accessed by OSMO, skipping: {err}',
            ),
        )

    finally:
        if regex_pattern and not returned_entries:
            logger.warning(
                '%s: No entries matched regex %s',
                local_path,
                regex_pattern.pattern,
            )

    return generator_errors
