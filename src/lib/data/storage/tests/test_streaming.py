# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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
Unit tests for the storage streaming module.

Targets the public ``stream_object`` contract and its three dispatch modes
(full object, byte-offset range, last-N-lines) across the three output shapes
(bytes stream, lines stream, file-like object). The tests exercise:

- Mode dispatch: which ``get_object`` calls are issued and with what
  offset/length for ``FullStream``, ``OffsetStream``, and ``LastNLinesStream``
- The two-pass last-N-lines seek, including the boundary cases where the
  requested line count meets or exceeds the number of lines in the object
  (empty object, exact line count, missing trailing newline)
- ``StreamSummary`` fidelity: ``size``, ``lines``, ``retries``, ``failures``
- Line decoding via ``StreamLines`` encoding/error strategies
- Client provider lifecycle (the storage client is closed once the stream or
  file-like object is exhausted/closed)
"""

import dataclasses
import unittest
from typing import Iterator, List, cast

from src.lib.data.storage import streaming
from src.lib.data.storage.core import client, provider


@dataclasses.dataclass(frozen=True, slots=True)
class _GetObjectCall:
    """A record of the arguments a single ``get_object`` call was made with."""

    bucket: str
    key: str
    offset: int | None
    length: int | None


class _FakeResumableStream(client.ResumableStream):
    """An in-memory ``ResumableStream`` that serves a fixed byte payload."""

    def __init__(self, data: bytes, chunk_size: int):
        super().__init__()

        self._data = data
        self._chunk_size = chunk_size
        self._position = 0

    def __next__(self) -> bytes:
        if self._position >= len(self._data):
            raise StopIteration

        chunk = self._data[self._position:self._position + self._chunk_size]
        self._position += len(chunk)
        self._bytes_read += len(chunk)
        return chunk

    def read(self, n: int = -1) -> bytes:
        if n == -1:
            chunk = self._data[self._position:]
        else:
            chunk = self._data[self._position:self._position + n]

        self._position += len(chunk)
        self._bytes_read += len(chunk)
        return chunk


class _FakeStorageClient:
    """A ``StorageClient`` stand-in that serves byte ranges of a fixed payload."""

    def __init__(
        self,
        content: bytes,
        *,
        chunk_size: int = 8,
        retries: int = 0,
        errors: List[Exception] | None = None,
    ):
        self.content = content
        self.chunk_size = chunk_size
        self.retries = retries
        self.errors = errors if errors is not None else []
        self.get_object_calls: List[_GetObjectCall] = []
        self.close_count = 0

    def get_object(
        self,
        bucket: str,
        key: str,
        *,
        offset: int | None = None,
        length: int | None = None,
    ) -> client.APIResponse:
        """Records the call and returns a stream over the requested byte range."""
        self.get_object_calls.append(
            _GetObjectCall(bucket=bucket, key=key, offset=offset, length=length),
        )

        start = offset if offset is not None else 0
        end = len(self.content) if length is None else start + length

        body = _FakeResumableStream(self.content[start:end], chunk_size=self.chunk_size)
        body.context.retries = self.retries
        body.context.errors.extend(self.errors)

        return client.APIResponse(
            result=client.GetObjectResponse(
                key=key,
                size=len(self.content),
                body=body,
            ),
            context=body.context,
        )

    def close(self) -> None:
        """Counts how many times the client was closed by the provider."""
        self.close_count += 1

    def as_client(self) -> client.StorageClient:
        """Return self typed as the StorageClient interface."""
        return cast(client.StorageClient, self)


@dataclasses.dataclass(frozen=True)
class _FakeClientFactory(provider.StorageClientFactory):
    """A factory that always hands out the same fake storage client."""

    storage_client: _FakeStorageClient

    def create(self) -> client.StorageClient:
        return self.storage_client.as_client()


def _stream_params(options: streaming.StreamOptions) -> streaming.StreamParams:
    return streaming.StreamParams(
        container='bucket',
        key='logs/task.log',
        options=options,
    )


def _drain(stream: Iterator) -> List:
    return list(stream)


def _summary(
    operation: streaming.BytesStream | streaming.LinesStream | streaming.BytesIO,
) -> streaming.StreamSummary:
    """Returns the operation summary, failing loudly if it was never populated."""
    if operation.summary is None:
        raise AssertionError('operation summary was not populated')
    return operation.summary


# Four lines, six bytes each: byte offsets 0, 6, 12, 18.
_FOUR_LINES = b'line1\nline2\nline3\nline4\n'


class StreamObjectAsBytesTest(unittest.TestCase):
    """``stream_object`` default (bytes) mode."""

    def test_full_stream_yields_every_chunk_of_the_object(self):
        storage_client = _FakeStorageClient(_FOUR_LINES, chunk_size=8)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
        )
        chunks = _drain(stream)

        self.assertEqual(chunks, [b'line1\nli', b'ne2\nline', b'3\nline4\n'])

    def test_full_stream_summary_reports_size_and_no_line_count(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
        )
        _drain(stream)

        self.assertEqual(_summary(stream).size, 24)
        self.assertIsNone(_summary(stream).lines)

    def test_full_stream_summary_reports_retries_and_failures_from_context(self):
        storage_client = _FakeStorageClient(
            _FOUR_LINES,
            retries=3,
            errors=[ValueError('connection reset')],
        )

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
        )
        _drain(stream)

        self.assertEqual(_summary(stream).retries, 3)
        self.assertEqual(_summary(stream).failures, ['connection reset'])

    def test_full_stream_requests_whole_object_without_a_byte_range(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
        )
        _drain(stream)

        self.assertEqual(
            storage_client.get_object_calls,
            [_GetObjectCall(bucket='bucket', key='logs/task.log', offset=None, length=None)],
        )

    def test_exhausting_bytes_stream_closes_the_storage_client(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
        )
        _drain(stream)

        self.assertEqual(storage_client.close_count, 1)

    def test_empty_object_yields_no_chunks_and_zero_size(self):
        storage_client = _FakeStorageClient(b'')

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
        )
        chunks = _drain(stream)

        self.assertEqual(chunks, [])
        self.assertEqual(_summary(stream).size, 0)


class StreamObjectAsLinesTest(unittest.TestCase):
    """``stream_object`` with ``StreamLines`` (decoded lines) mode."""

    def test_lines_stream_yields_one_newline_terminated_string_per_line(self):
        storage_client = _FakeStorageClient(_FOUR_LINES, chunk_size=8)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            streaming.StreamLines(),
        )
        lines = _drain(stream)

        self.assertEqual(lines, ['line1\n', 'line2\n', 'line3\n', 'line4\n'])

    def test_lines_stream_summary_reports_line_count_and_size(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            streaming.StreamLines(),
        )
        _drain(stream)

        self.assertEqual(_summary(stream).lines, 4)
        self.assertEqual(_summary(stream).size, 24)

    def test_lines_stream_appends_newline_to_unterminated_final_line(self):
        storage_client = _FakeStorageClient(b'alpha\nbeta\ngamma')

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            streaming.StreamLines(),
        )
        lines = _drain(stream)

        self.assertEqual(lines, ['alpha\n', 'beta\n', 'gamma\n'])

    def test_lines_stream_replaces_undecodable_bytes_by_default(self):
        storage_client = _FakeStorageClient(b'ok\xffbad\n')

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            streaming.StreamLines(),
        )
        lines = _drain(stream)

        self.assertEqual(lines, ['ok�bad\n'])

    def test_lines_stream_drops_undecodable_bytes_when_errors_is_ignore(self):
        storage_client = _FakeStorageClient(b'ok\xffbad\n')

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            streaming.StreamLines(errors='ignore'),
        )
        lines = _drain(stream)

        self.assertEqual(lines, ['okbad\n'])

    def test_lines_stream_raises_unicode_decode_error_when_errors_is_strict(self):
        storage_client = _FakeStorageClient(b'ok\xffbad\n')

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            streaming.StreamLines(errors='strict'),
        )

        with self.assertRaises(UnicodeDecodeError):
            _drain(stream)

    def test_exhausting_lines_stream_closes_the_storage_client(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            streaming.StreamLines(),
        )
        _drain(stream)

        self.assertEqual(storage_client.close_count, 1)


class StreamObjectOffsetStreamTest(unittest.TestCase):
    """``stream_object`` with an explicit byte range."""

    def test_offset_stream_forwards_offset_and_length_to_the_client(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.OffsetStream(offset=6, length=6)),
        )
        _drain(stream)

        self.assertEqual(
            storage_client.get_object_calls,
            [_GetObjectCall(bucket='bucket', key='logs/task.log', offset=6, length=6)],
        )

    def test_offset_stream_yields_only_the_requested_byte_range(self):
        storage_client = _FakeStorageClient(_FOUR_LINES, chunk_size=64)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.OffsetStream(offset=6, length=6)),
        )
        chunks = _drain(stream)

        self.assertEqual(b''.join(chunks), b'line2\n')

    def test_offset_stream_without_length_streams_to_end_of_object(self):
        storage_client = _FakeStorageClient(_FOUR_LINES, chunk_size=64)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.OffsetStream(offset=18)),
        )
        chunks = _drain(stream)

        self.assertEqual(b''.join(chunks), b'line4\n')
        self.assertIsNone(storage_client.get_object_calls[0].length)


class StreamObjectLastNLinesTest(unittest.TestCase):
    """The two-pass last-N-lines seek."""

    def test_last_n_lines_yields_only_the_trailing_lines(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.LastNLinesStream(last_n_lines=2)),
            streaming.StreamLines(),
        )
        lines = _drain(stream)

        self.assertEqual(lines, ['line3\n', 'line4\n'])

    def test_last_n_lines_issues_a_second_request_at_the_seeked_offset(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.LastNLinesStream(last_n_lines=2)),
            streaming.StreamLines(),
        )
        _drain(stream)

        self.assertEqual(
            storage_client.get_object_calls,
            [
                _GetObjectCall(bucket='bucket', key='logs/task.log', offset=None, length=None),
                _GetObjectCall(bucket='bucket', key='logs/task.log', offset=12, length=None),
            ],
        )

    def test_last_n_lines_of_one_yields_only_the_final_line(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.LastNLinesStream(last_n_lines=1)),
            streaming.StreamLines(),
        )
        lines = _drain(stream)

        self.assertEqual(lines, ['line4\n'])

    def test_last_n_lines_equal_to_the_line_count_returns_the_whole_object(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.LastNLinesStream(last_n_lines=4)),
            streaming.StreamLines(),
        )
        lines = _drain(stream)

        self.assertEqual(lines, ['line1\n', 'line2\n', 'line3\n', 'line4\n'])
        self.assertIsNone(storage_client.get_object_calls[1].offset)

    def test_last_n_lines_greater_than_the_line_count_returns_the_whole_object(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.LastNLinesStream(last_n_lines=99)),
            streaming.StreamLines(),
        )
        lines = _drain(stream)

        self.assertEqual(lines, ['line1\n', 'line2\n', 'line3\n', 'line4\n'])
        self.assertIsNone(storage_client.get_object_calls[1].offset)

    def test_last_n_lines_on_an_empty_object_yields_no_lines(self):
        storage_client = _FakeStorageClient(b'')

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.LastNLinesStream(last_n_lines=5)),
            streaming.StreamLines(),
        )
        lines = _drain(stream)

        self.assertEqual(lines, [])
        self.assertIsNone(storage_client.get_object_calls[1].offset)

    def test_last_n_lines_seeks_past_an_unterminated_final_line(self):
        storage_client = _FakeStorageClient(b'alpha\nbeta\ngamma')

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.LastNLinesStream(last_n_lines=2)),
            streaming.StreamLines(),
        )
        lines = _drain(stream)

        self.assertEqual(lines, ['beta\n', 'gamma\n'])
        self.assertEqual(storage_client.get_object_calls[1].offset, 6)

    def test_last_n_lines_as_bytes_yields_the_trailing_bytes(self):
        storage_client = _FakeStorageClient(_FOUR_LINES, chunk_size=64)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.LastNLinesStream(last_n_lines=2)),
        )
        chunks = _drain(stream)

        self.assertEqual(b''.join(chunks), b'line3\nline4\n')

    def test_last_n_lines_summary_counts_only_the_streamed_lines(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.LastNLinesStream(last_n_lines=2)),
            streaming.StreamLines(),
        )
        _drain(stream)

        self.assertEqual(_summary(stream).lines, 2)
        self.assertEqual(_summary(stream).size, 12)


class StreamObjectAsIoTest(unittest.TestCase):
    """``stream_object`` with ``as_io=True`` (file-like) mode."""

    def test_as_io_read_returns_the_whole_object(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        with streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            as_io=True,
        ) as stream_io:
            content = stream_io.read()

        self.assertEqual(content, _FOUR_LINES)

    def test_as_io_read_with_a_size_returns_a_partial_read(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        with streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            as_io=True,
        ) as stream_io:
            content = stream_io.read(5)

        self.assertEqual(content, b'line1')

    def test_as_io_summary_is_unset_until_the_stream_is_closed(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream_io = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            as_io=True,
        )

        self.assertIsNone(stream_io.summary)
        stream_io.close()

    def test_as_io_summary_reports_the_bytes_read_after_close(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        stream_io = streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            as_io=True,
        )
        stream_io.read()
        stream_io.close()

        self.assertEqual(_summary(stream_io).size, 24)

    def test_as_io_closes_the_storage_client_on_exit(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        with streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            as_io=True,
        ) as stream_io:
            stream_io.read()

        self.assertEqual(storage_client.close_count, 1)

    def test_as_io_keeps_the_storage_client_open_while_reading(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        with streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.FullStream()),
            as_io=True,
        ) as stream_io:
            stream_io.read(1)
            close_count_while_open = storage_client.close_count

        self.assertEqual(close_count_while_open, 0)

    def test_as_io_applies_the_last_n_lines_offset(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        with streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.LastNLinesStream(last_n_lines=2)),
            as_io=True,
        ) as stream_io:
            content = stream_io.read()

        self.assertEqual(content, b'line3\nline4\n')

    def test_as_io_applies_the_offset_stream_range(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)

        with streaming.stream_object(
            _FakeClientFactory(storage_client),
            _stream_params(streaming.OffsetStream(offset=12, length=6)),
            as_io=True,
        ) as stream_io:
            content = stream_io.read()

        self.assertEqual(content, b'line3\n')


class StreamObjectUnknownOptionTest(unittest.TestCase):
    """The exhaustiveness guard in the stream option dispatch."""

    def test_unrecognized_stream_option_raises_assertion_error(self):
        storage_client = _FakeStorageClient(_FOUR_LINES)
        stream_params = _stream_params(streaming.FullStream())
        # Bypass the frozen dataclass to simulate a future option that the
        # dispatch has not been taught to handle.
        object.__setattr__(stream_params, 'options', 'not-a-stream-option')

        stream = streaming.stream_object(_FakeClientFactory(storage_client), stream_params)

        with self.assertRaises(AssertionError):
            _drain(stream)


if __name__ == '__main__':
    unittest.main()
