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
Base data storage client protocol and utilities.
"""

import abc
import dataclasses
import datetime
import io
import logging
import mimetypes
from typing import (
    Any,
    Callable,
    Generic,
    Iterator,
    List,
    Protocol,
    TypeVar,
    TypedDict,
)
from typing_extensions import override
import weakref

from ....utils import common, osmo_errors

logger = logging.getLogger(__name__)

# API Response Type Variable
_T = TypeVar('_T')


########################
#     Core Schemas     #
########################

class APIContextExtraData(TypedDict, total=False):
    """
    A class for storing extra data of an API execution context.
    """

    suppress_no_key_error: bool


@dataclasses.dataclass(slots=True)
class APIContext:
    """
    A class for storing a data storage client API execution context.
    """

    start_time: datetime.datetime = dataclasses.field(default_factory=common.current_time)
    end_time: datetime.datetime | None = dataclasses.field(default=None)
    last_attempt_time: datetime.datetime = dataclasses.field(default_factory=common.current_time)
    retries: int = dataclasses.field(default=-1)
    errors: List[Exception] = dataclasses.field(default_factory=list)
    extra_data: APIContextExtraData = dataclasses.field(
        default_factory=lambda: APIContextExtraData(),
    )

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.end_time = common.current_time()
        return False

    @property
    def time_since_start(self) -> datetime.timedelta:
        """ Returns the time since the start of the current API execution context. """
        return common.current_time() - self.start_time

    @property
    def time_since_last_attempt(self) -> datetime.timedelta:
        """ Returns the time since the last attempt of the current API execution context. """
        return common.current_time() - self.last_attempt_time

    @property
    def elapsed_time(self) -> datetime.timedelta:
        """ Returns the elapsed time of the current API execution context. """
        end = self.end_time or common.current_time()
        return end - self.start_time

    @property
    def is_finished(self) -> bool:
        """ Returns whether the current API execution context is finished. """
        return self.end_time is not None

    @property
    def attempts(self) -> int:
        """ Returns the number of attempts of the current API execution context. """
        return self.retries + 1

    def increment_attempt(self) -> None:
        """ Increments the attempt count of the current API execution context. """
        self.retries += 1
        self.last_attempt_time = common.current_time()

    def add_error(self, error: Exception) -> None:
        """ Adds an error to the current API execution context. """
        self.errors.append(error)


@dataclasses.dataclass(slots=True)
class APIResponse(Generic[_T]):
    """
    A class for storing the response of an API call.
    """

    result: _T
    context: APIContext


class OSMODataStorageClientError(osmo_errors.OSMODataStorageError):
    """
    An exception raised when a storage client operation fails.
    """

    context: APIContext | None = None

    def __init__(
        self,
        message: str,
        context: APIContext | None = None,
    ):
        super().__init__(message)
        self.context = context


class ErrorHandler(Protocol):
    """
    A protocol for handling errors from a function.
    """

    def eligible(self, error: Exception) -> bool:
        """
        Returns whether the error is eligible to be handled.
        """
        raise NotImplementedError

    def handle_error(
        self,
        error: Exception,
        context: APIContext,
    ) -> bool:
        """
        Handles an error that occurred during the execution of an API call.

        Args:
            error: The error that occurred.
            context: The API execution context.

        Returns:
            bool: Whether to retry the operation.
        """
        raise NotImplementedError


############################
#     Response Schemas     #
############################


class ResumableStream(Iterator[bytes], io.IOBase):
    """
    A resumable byte stream with automatic retry and cleanup handling.

    This abstract base class provides a resilient streaming interface for reading
    data from remote storage. It automatically handles:

    - **Retry logic**: Transparently retries failed requests due to transient errors
    - **Resumption**: Resumes from the last read position after connection issues
    - **Resource cleanup**: Guarantees cleanup even if the stream is not fully consumed

    The stream can be used as both an iterator (yields byte chunks) and a file-like
    object (supports ``read()``).

    Example:
        .. code-block:: python

            # As an iterator
            with client.get_object_stream("data/file.txt") as stream:
                for chunk in stream:
                    process(chunk)
                print(f"Total bytes: {stream.size}")

            # As a file-like object
            with client.get_object_stream("data/file.txt") as stream:
                content = stream.read()

            # Line-by-line iteration
            with client.get_object_stream("data/file.txt") as stream:
                for line in stream.iter_lines():
                    print(line.decode())
                print(f"Total lines: {stream.lines}")

    :ivar int size: Total bytes read from the stream.
    :ivar int | None lines: Number of lines read (only set when using ``iter_lines()``).

    Note:
        This is an abstract base class. Use concrete implementations like
        :py:class:`~osmo.data.storage.streaming.BytesStream` for actual streaming.
    """

    _context: APIContext
    _bytes_read: int
    _lines_read: int | None

    # Guarantees clean up if the stream leaves the scope and was not fully consumed.
    _finalizer: weakref.finalize

    def __init__(self):
        super().__init__()

        self._context = APIContext()
        self._bytes_read = 0
        self._lines_read = None
        self._finalizer = weakref.finalize(self, type(self).close, self)

    def __enter__(self) -> 'ResumableStream':
        self._context.__enter__()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self._context.__exit__(exc_type, exc_val, exc_tb)
        self.close()

    def __iter__(self) -> 'ResumableStream':
        return self

    @property
    def context(self) -> APIContext:
        """
        Returns the context of the resumable stream.
        """
        return self._context

    @property
    def size(self) -> int:
        """
        Returns the size of the resumable stream.
        """
        return self._bytes_read

    @property
    def lines(self) -> int | None:
        """
        Returns the number of lines read from the resumable stream.
        """
        return self._lines_read

    @abc.abstractmethod
    def __next__(self) -> bytes:
        raise NotImplementedError

    @abc.abstractmethod
    def read(self, n: int = -1) -> bytes:
        raise NotImplementedError

    @override
    def readable(self) -> bool:
        return True

    def execute_api(
        self,
        api_call: Callable[[], _T],
        error_handler: ErrorHandler,
    ) -> APIResponse[_T]:
        return execute_api(api_call, error_handler, self._context)

    @override
    def close(self) -> None:
        """
        Closes the resumable stream.
        """
        if super().closed:  # pylint: disable=using-constant-test
            return
        try:
            self._finalizer.detach()
        finally:
            super().close()

    def iter_lines(self, keepends: bool = False) -> Iterator[bytes]:
        """
        Iterate over the stream line by line.

        Yields each line as a byte string. The ``lines`` property is updated
        as lines are yielded.

        :param bool keepends: If ``True``, line ending characters are preserved.
                             Defaults to ``False``.
        :yields: Each line as bytes.
        """
        if self._lines_read is None:
            self._lines_read = 0

        pending = b''
        for chunk in self:
            lines = (pending + chunk).splitlines(True)
            for line in lines[:-1]:
                self._lines_read += 1
                yield line.splitlines(keepends)[0]
            pending = lines[-1]
        if pending:
            self._lines_read += 1
            yield pending.splitlines(keepends)[0]


@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class GetObjectInfoResponse:
    """
    A class that represents information about an object.
    """

    key: str
    size: int = dataclasses.field(default=0)
    checksum: str | None = dataclasses.field(default=None)
    last_modified: datetime.datetime | None = dataclasses.field(default=None)
    is_directory: bool = dataclasses.field(default=False)


@dataclasses.dataclass(frozen=True)
class ObjectExistsResponse:
    """
    Response of the object exists API call.
    """

    exists: bool
    info: GetObjectInfoResponse | None = dataclasses.field(default=None)


@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class GetObjectResponse(GetObjectInfoResponse):
    """
    Response of the get object API call.
    """

    body: ResumableStream


@dataclasses.dataclass(frozen=True)
class RangeQueryParams:
    """
    A class that represents parameters for a range query.
    """

    start_after: str | None = dataclasses.field(default=None)
    end_at: str | None = dataclasses.field(default=None)


class ListObjectsIterator(Iterator[GetObjectInfoResponse]):
    """
    A wrapper around an iterator of GetObjectInfoResponse objects.

    Provides API context that tracks the life-cycle of the underlying iterator.
    """

    _context: APIContext
    _objects: Iterator[GetObjectInfoResponse]

    _closed: bool
    _finalizer: weakref.finalize

    def __init__(
        self,
        objects: Iterator[GetObjectInfoResponse],
    ):
        self._context = APIContext()
        self._objects = objects

        self._closed = False
        self._finalizer = weakref.finalize(self, type(self).close, self)

    def __enter__(self) -> 'ListObjectsIterator':
        self._context.__enter__()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self._context.__exit__(exc_type, exc_val, exc_tb)
        self.close()

    @property
    def context(self) -> APIContext:
        """
        Returns the context of the list objects iterator.
        """
        return self._context

    def close(self) -> None:
        """
        Closes the list objects iterator.
        """
        if self._closed:
            return
        self._closed = True
        self._finalizer.detach()

    def __iter__(self) -> 'ListObjectsIterator':
        return self

    def __next__(self) -> GetObjectInfoResponse:
        """
        Returns the next object from the list objects iterator.
        """
        return next(self._objects)


@dataclasses.dataclass(frozen=True, slots=True)
class ListObjectsIteratorResponse:
    """
    Response of the list objects API call.
    """

    objects: ListObjectsIterator


@dataclasses.dataclass(frozen=True, slots=True)
class UploadResponse:
    """
    Response of the upload object API call.
    """

    size: int


@dataclasses.dataclass(frozen=True, slots=True)
class DownloadResponse:
    """
    Response of the download object API call.
    """

    size: int


@dataclasses.dataclass(frozen=True, slots=True)
class CopyResponse:
    """
    Response of the copy object API call.
    """

    size: int


@dataclasses.dataclass(frozen=True, slots=True)
class DeleteError:
    """
    A class that represents an error that occurred during the deletion of an object.
    """

    key: str
    message: str | None = dataclasses.field(default=None)

    def __str__(self) -> str:
        if self.message:
            return f'DeleteError(key={self.key}, message={self.message})'
        return f'DeleteError(key={self.key})'

    def __repr__(self) -> str:
        return self.__str__()


@dataclasses.dataclass(frozen=True, slots=True)
class DeleteResponse:
    """
    Response of the delete object API call.
    """

    success_count: int
    failures: List[DeleteError]


############################
#     Client Interface     #
############################


class StorageClient(abc.ABC):
    """
    Base class for storage clients.
    """

    @abc.abstractmethod
    def object_exists(
        self,
        bucket: str,
        key: str,
        *,
        checksum: str | None = None,
    ) -> APIResponse[ObjectExistsResponse]:
        ...

    @abc.abstractmethod
    def get_object_info(
        self,
        bucket: str,
        key: str,
    ) -> APIResponse[GetObjectInfoResponse]:
        ...

    @abc.abstractmethod
    def get_object(
        self,
        bucket: str,
        key: str,
        *,
        offset: int | None = None,
        length: int | None = None,
    ) -> APIResponse[GetObjectResponse]:
        ...

    @abc.abstractmethod
    def list_objects(
        self,
        bucket: str,
        prefix: str | None = None,
        *,
        regex: str | None = None,
        range_query: RangeQueryParams | None = None,
        recursive: bool = True,
    ) -> APIResponse[ListObjectsIteratorResponse]:
        ...

    @abc.abstractmethod
    def upload(
        self,
        filename: str,
        bucket: str,
        key: str,
        *,
        progress_hook: Callable[..., Any] | None = None,
    ) -> APIResponse[UploadResponse]:
        ...

    @abc.abstractmethod
    def download(
        self,
        bucket: str,
        key: str,
        filename: str,
        *,
        progress_hook: Callable[..., Any] | None = None,
    ) -> APIResponse[DownloadResponse]:
        ...

    @abc.abstractmethod
    def copy(
        self,
        source_bucket: str,
        source_key: str,
        destination_bucket: str,
        destination_key: str,
        *,
        progress_hook: Callable[[int], Any] | None = None,
    ) -> APIResponse[CopyResponse]:
        ...

    @abc.abstractmethod
    def delete(
        self,
        bucket: str,
        prefix: str | None = None,
        *,
        regex: str | None = None,
    ) -> APIResponse[DeleteResponse]:
        ...

    def close(self) -> None:
        """
        Closes the storage client.
        """
        pass


def _execute_api(
    api_call: Callable[[], _T],
    error_handler: ErrorHandler,
    context: APIContext,
) -> APIResponse[_T]:
    last_error: Exception | None = None

    while True:
        try:
            context.increment_attempt()
            return APIResponse(
                result=api_call(),
                context=context,
            )
        except Exception as err:  # pylint: disable=broad-except
            last_error = err
            context.add_error(err)

            if not error_handler.eligible(err):
                raise err

            should_retry = error_handler.handle_error(err, context)
            if not should_retry:
                break

    error_type = type(last_error).__name__
    error_message = last_error.args[0] if last_error.args else str(last_error)

    raise OSMODataStorageClientError(
        message=(
            f'API call failed after {context.attempts} attempts with error: '
            f'{error_type}: {error_message}'
        ),
        context=context,
    ) from last_error


def execute_api(
    api_call: Callable[[], _T],
    error_handler: ErrorHandler,
    context: APIContext | None = None,
) -> APIResponse[_T]:
    """
    Generic retry function for executing an API call.

    Args:
        api_call: The API call to execute.
        error_handler: The error handler.

    Returns:
        _T: The response of the API call with the execution context.

    Raises:
        OSMODataStorageClientError: If the API call fails after all attempts.
    """
    if context is None:
        with APIContext() as new_context:
            return _execute_api(api_call, error_handler, new_context)

    return _execute_api(api_call, error_handler, context)


def get_content_type(filename: str) -> str:
    """
    Get the content type of a file.
    """
    mime_type, _ = mimetypes.guess_type(filename)
    if mime_type:
        return mime_type
    return 'text/plain'
