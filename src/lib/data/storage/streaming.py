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
Top level functions for streaming data from a storage client.
"""


import collections
import contextlib
import logging
from typing import Generator, Literal, overload
from typing_extensions import assert_never

from pydantic import dataclasses
import pydantic

from . import common
from .core import client, provider


logger = logging.getLogger(__name__)


##########################
#     Stream schemas     #
##########################


@dataclasses.dataclass(frozen=True)
class OffsetStream:
    """
    Stream a file with a specific offset and length.
    """

    offset: int = pydantic.Field(
        ...,
        description='The offset to start fetching bytes from. '
                    'If None, fetch starts at the beginning of the file.',
    )

    length: int | None = pydantic.Field(
        default=None,
        description='The amount of bytes to fetch. If None, the entire file is fetched.',
    )


@dataclasses.dataclass(frozen=True)
class LastNLinesStream:
    """
    Stream the last N lines of a file.
    """

    last_n_lines: int = pydantic.Field(
        ...,
        description='The number of lines to fetch from the end of the file.',
        ge=1,
    )


@dataclasses.dataclass(frozen=True)
class FullStream:
    """
    Stream the entire file.
    """
    pass


StreamOptions = OffsetStream | LastNLinesStream | FullStream


@dataclasses.dataclass(frozen=True)
class StreamLines:
    """
    Stream an object as lines.
    """

    encoding: str = pydantic.Field(
        default='utf-8',
        description='The encoding to use when fetching the file as lines.',
    )

    errors: Literal['strict', 'replace', 'ignore'] = pydantic.Field(
        default='replace',
        description='The error handling strategy to use when decoding the file as lines.',
    )


@dataclasses.dataclass(frozen=True)
class StreamParams:
    """
    Parameters for a stream operation.
    """

    container: str = pydantic.Field(
        ...,
        description='The container of the object to fetch.',
    )

    key: str = pydantic.Field(
        ...,
        description='The key of the object to fetch.',
    )

    options: StreamOptions = pydantic.Field(
        ...,
        description='The options for the stream.',
    )


@dataclasses.dataclass(frozen=True, kw_only=True)
class StreamSummary(common.OperationSummary):
    """
    Summary of a stream operation.

    :ivar int size: The size of the fetched data.
    :ivar int lines: The number of lines in the streamed data. Only set if stream_lines is provided.
    :ivar datetime.datetime start_time: The start time of the stream operation.
    :ivar datetime.datetime end_time: The end time of the stream operation.
    :ivar int retries: The number of retries that were made during the stream operation.
    :ivar List[str] failures: A list of messages describing failed stream operations.
    """

    size: int = pydantic.Field(
        default=0,
        description='The size of the fetched data.',
    )

    lines: int | None = pydantic.Field(
        default=None,
        description='The number of lines in the streamed data. '
                    'Only set if stream_lines is provided.',
    )


# Stream object as a stream of bytes
BytesStream = common.OperationStream[bytes, StreamSummary]

# Stream object as a stream of lines
LinesStream = common.OperationStream[str, StreamSummary]

# Stream object as a file-like object
BytesIO = common.OperationIO[client.ResumableStream, StreamSummary]

#################################
#     Stream implementations     #
#################################


def _create_summary(
    streaming_body: client.ResumableStream,
) -> StreamSummary:
    return StreamSummary(  # pylint: disable=unexpected-keyword-arg
        start_time=streaming_body.context.start_time,
        end_time=streaming_body.context.end_time,
        retries=streaming_body.context.retries,
        failures=[str(error) for error in streaming_body.context.errors],
        size=streaming_body.size,
        lines=streaming_body.lines,
    )


def _as_lines(
    get_object_response: client.GetObjectResponse,
    stream_lines: StreamLines,
) -> Generator[str, None, StreamSummary]:
    """
    Convert a stream of bytes to a stream of lines.
    """
    with get_object_response.body as streaming_body:
        for line in streaming_body.iter_lines():
            yield f'{line.decode(encoding=stream_lines.encoding, errors=stream_lines.errors)}\n'
        return _create_summary(streaming_body)


def _as_bytes(
    get_object_response: client.GetObjectResponse,
) -> Generator[bytes, None, StreamSummary]:
    """
    Convert a stream of bytes to a stream of bytes.
    """
    with get_object_response.body as streaming_body:
        yield from streaming_body
        return _create_summary(streaming_body)


def _seek_last_n_lines_byte_start(
    get_object_response: client.GetObjectResponse,
    last_n_lines: int,
) -> int | None:
    """
    Seeks the byte position of the last N lines of a file.
    """
    with get_object_response.body as streaming_body:
        # Record offsets of last_n line breaks
        byte_offsets: collections.deque[int] = collections.deque(maxlen=last_n_lines)
        total_bytes = 0
        total_lines = 0

        for line in streaming_body.iter_lines(
            keepends=True,  # Keep the trailing newline
        ):
            total_lines += 1
            byte_offsets.append(total_bytes)
            total_bytes += len(line)

        if last_n_lines >= total_lines:
            # File is empty or we're asking for more lines than the file has
            return None

        # First byte_offset in the deque is the start of the last-N-th line
        return byte_offsets[0]


def _stream_last_n_lines(
    storage_client: client.StorageClient,
    container: str,
    key: str,
    last_n_lines: int,
) -> client.GetObjectResponse:
    """
    Streams the last N lines of a file.

    NOTES: Streaming from an object storage yields a streaming body of bytes.
           However, we cannot randomly seek within a streaming body. As a result, we need to make
           some trade-offs to fetch the last N lines:

           There are various ways to do this, for example:

           1. Stream the entire file, then buffer the last N lines in memory.

              Pros:
                - most network efficient (only 1 API call)
              Cons:
                - holds N lines in memory
                - risks OOM during high loads and/or large last_n_lines value

           2. Request chunks from the end of the file until we identified at least N lines.

              Pros:
                - most memory efficient
                - does not require downloading the entire file
              Cons:
                - requires multiple API calls to seek the byte start marker
                - unnecessary latency if last_n_lines is close to the beginning of the file

           3. Request the entire file, then seek to the byte start of the last N lines. Then
              make a second request to directly stream the last N lines.

              Pros:
                - more memory efficient than #1 (but less than #2)
              Cons:
                - requires downloading the entire file once
                - very latent if the file is large

           This implementation uses the third approach for simplicity.
    """
    # Get the entire file to find the byte start of the last N lines
    seek_byte_start_response = storage_client.get_object(
        bucket=container,
        key=key,
    ).result

    byte_start: int | None = _seek_last_n_lines_byte_start(
        seek_byte_start_response,
        last_n_lines,
    )

    # Make a second request to stream from the desired byte start (if found)
    if byte_start is None:
        # No byte_start found, fetch the entire file.
        return storage_client.get_object(
            bucket=container,
            key=key,
        ).result

    else:
        # Fetch the last N lines of the file using byte offset
        return storage_client.get_object(
            bucket=container,
            key=key,
            offset=byte_start,
            length=None,
        ).result


def _stream_response(
    storage_client: client.StorageClient,
    stream_params: StreamParams,
) -> client.GetObjectResponse:
    match stream_params.options:

        case FullStream():
            return storage_client.get_object(
                bucket=stream_params.container,
                key=stream_params.key,
            ).result

        case OffsetStream():
            return storage_client.get_object(
                bucket=stream_params.container,
                key=stream_params.key,
                offset=stream_params.options.offset,
                length=stream_params.options.length,
            ).result

        case LastNLinesStream():
            return _stream_last_n_lines(
                storage_client,
                stream_params.container,
                stream_params.key,
                stream_params.options.last_n_lines,
            )

        case _ as unreachable:
            # This should never happen, but we need to satisfy the type checker
            # mypy will force us to perform exhausting matching above to protect
            # against future cases.
            assert_never(unreachable)

##############################
#     Stream public APIs     #
##############################


@overload
def stream_object(
    client_factory: provider.StorageClientFactory,
    stream_params: StreamParams,
) -> BytesStream:
    ...


@overload
def stream_object(
    client_factory: provider.StorageClientFactory,
    stream_params: StreamParams,
    stream_lines: StreamLines,
) -> LinesStream:
    ...


@overload
def stream_object(
    client_factory: provider.StorageClientFactory,
    stream_params: StreamParams,
    *,
    as_io: Literal[True],
) -> BytesIO:
    ...


def stream_object(
    client_factory: provider.StorageClientFactory,
    stream_params: StreamParams,
    stream_lines: StreamLines | None = None,
    *,
    as_io: bool = False,
) -> BytesStream | LinesStream | BytesIO:
    """
    Stream a file from a storage client. The response is a streamable body of the streamed file.
    """
    if stream_lines is not None:
        # Stream the file as lines
        def _gen_lines_stream() -> Generator[str, None, StreamSummary]:
            with client_factory.to_provider() as client_provider:
                with client_provider.get() as storage_client:
                    summary = yield from _as_lines(
                        _stream_response(storage_client, stream_params),
                        stream_lines,
                    )
                    return summary

        return common.OperationStream[str, StreamSummary](_gen_lines_stream())

    if as_io:
        # Stream the file as a file-like object
        def _gen_bytes_io(stack: contextlib.ExitStack) -> client.ResumableStream:
            provider_context = client_factory.to_provider()
            client_provider = stack.enter_context(provider_context)
            storage_client = stack.enter_context(client_provider.get())
            resp = _stream_response(storage_client, stream_params)
            return stack.enter_context(resp.body)

        return common.OperationIO[client.ResumableStream, StreamSummary](
            open_with_stack=_gen_bytes_io,
            finalize=_create_summary,
        )

    # Otherwise, stream the file as bytes
    def _gen_bytes_stream() -> Generator[bytes, None, StreamSummary]:
        with client_factory.to_provider() as client_provider:
            with client_provider.get() as storage_client:
                summary = yield from _as_bytes(
                    _stream_response(storage_client, stream_params),
                )
                return summary

    return common.OperationStream[bytes, StreamSummary](_gen_bytes_stream())
