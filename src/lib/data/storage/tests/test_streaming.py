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

All tests drive the single public entry point ``stream_object``, which backs
workflow log retrieval (CLI ``workflow logs``, the log-viewer UI and the core
service data endpoints). The tests exercise:

- the three ``StreamOptions`` dispatch paths (full, byte range, last N lines)
- the last-N-lines seek: which byte offset the second ranged GET asks for,
  including lines that straddle a chunk boundary
- the ``byte_start is None`` fallbacks (empty file, ``last_n_lines`` at or
  above the total line count) that degrade to a full refetch
- the bytes, lines and file-like (``as_io``) output shapes
- the ``StreamSummary`` fields (size, lines, retries, failures)
"""

import collections
import dataclasses
import unittest
from typing import List, cast
from unittest import mock

from src.lib.data.storage import streaming
from src.lib.data.storage.core import client, provider


_CONTAINER = 'osmo-logs'
_KEY = 'workflow/task/stdout.log'

# Five 6-byte lines. Line byte offsets are 0, 6, 12, 18, 24.
_FIVE_LINES = b'line1\nline2\nline3\nline4\nline5\n'


class _FakeResumableStream(client.ResumableStream):
    """A ``ResumableStream`` that replays a fixed list of byte chunks."""

    def __init__(self, chunks: List[bytes]):
        super().__init__()
        self._remaining: collections.deque[bytes] = collections.deque(chunks)

    def __next__(self) -> bytes:
        if not self._remaining:
            raise StopIteration
        chunk = self._remaining.popleft()
        self._bytes_read += len(chunk)
        return chunk

    def read(self, n: int = -1) -> bytes:
        del n  # The fake always drains the remaining chunks.
        data = b''.join(self._remaining)
        self._remaining.clear()
        self._bytes_read += len(data)
        return data


@dataclasses.dataclass(frozen=True)
class _FakeClientFactory(provider.StorageClientFactory):
    """A factory that hands out a pre-built storage client."""

    storage_client: client.StorageClient

    def create(self) -> client.StorageClient:
        return self.storage_client


def _make_get_object_response(chunks: List[bytes]) -> client.APIResponse:
    """Build a ``get_object`` API response whose body replays ``chunks``."""
    body = _FakeResumableStream(chunks)
    return client.APIResponse(
        result=client.GetObjectResponse(
            key=_KEY,
            size=sum(len(chunk) for chunk in chunks),
            body=body,
        ),
        context=client.APIContext(),
    )


class TestStreamObjectAsBytes(unittest.TestCase):
    """Tests for ``stream_object`` returning a byte stream."""

    def setUp(self):
        self.storage_client = mock.MagicMock(spec=client.StorageClient)
        self.client_factory = _FakeClientFactory(storage_client=self.storage_client)

    def test_full_stream_yields_every_chunk_in_order(self):
        """A FullStream request yields the object's chunks untouched."""
        self.storage_client.get_object.return_value = _make_get_object_response(
            [b'first-', b'second-', b'third'],
        )
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
        )

        chunks = list(stream)

        self.assertEqual(chunks, [b'first-', b'second-', b'third'])

    def test_full_stream_requests_object_without_byte_range(self):
        """A FullStream request issues a single unranged GET."""
        self.storage_client.get_object.return_value = _make_get_object_response([b'body'])
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
        )

        list(stream)

        self.storage_client.get_object.assert_called_once_with(
            bucket=_CONTAINER,
            key=_KEY,
        )

    def test_full_stream_summary_reports_size_and_no_line_count(self):
        """A byte stream records the transferred size but leaves lines unset."""
        self.storage_client.get_object.return_value = _make_get_object_response(
            [b'abcd', b'efghij'],
        )
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
        )

        list(stream)

        summary = cast(streaming.StreamSummary, stream.summary)
        self.assertEqual(summary.size, 10)
        self.assertIsNone(summary.lines)

    def test_full_stream_summary_reports_retries_and_failures(self):
        """Retries and errors recorded on the stream context surface in the summary."""
        response = _make_get_object_response([b'payload'])
        response.result.body.context.increment_attempt()
        response.result.body.context.increment_attempt()
        response.result.body.context.add_error(ValueError('connection reset'))
        self.storage_client.get_object.return_value = response
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
        )

        list(stream)

        summary = cast(streaming.StreamSummary, stream.summary)
        self.assertEqual(summary.retries, 1)
        self.assertEqual(summary.failures, ['connection reset'])

    def test_offset_stream_requests_the_given_byte_range(self):
        """An OffsetStream request forwards offset and length to the client."""
        self.storage_client.get_object.return_value = _make_get_object_response([b'line3\n'])
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.OffsetStream(offset=12, length=6),
            ),
        )

        list(stream)

        self.storage_client.get_object.assert_called_once_with(
            bucket=_CONTAINER,
            key=_KEY,
            offset=12,
            length=6,
        )

    def test_offset_stream_without_length_requests_open_ended_range(self):
        """An OffsetStream with no length asks for everything after the offset."""
        self.storage_client.get_object.return_value = _make_get_object_response([b'tail'])
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.OffsetStream(offset=24),
            ),
        )

        chunks = list(stream)

        self.assertEqual(chunks, [b'tail'])
        self.storage_client.get_object.assert_called_once_with(
            bucket=_CONTAINER,
            key=_KEY,
            offset=24,
            length=None,
        )


class TestStreamObjectAsLines(unittest.TestCase):
    """Tests for ``stream_object`` returning a line stream."""

    def setUp(self):
        self.storage_client = mock.MagicMock(spec=client.StorageClient)
        self.client_factory = _FakeClientFactory(storage_client=self.storage_client)

    def test_lines_are_decoded_and_terminated_with_newline(self):
        """Each yielded line is decoded text with a single trailing newline."""
        self.storage_client.get_object.return_value = _make_get_object_response(
            [b'alpha\nbra', b'vo\ncharlie\n'],
        )
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
            streaming.StreamLines(),
        )

        lines = list(stream)

        self.assertEqual(lines, ['alpha\n', 'bravo\n', 'charlie\n'])

    def test_final_line_without_newline_is_still_terminated(self):
        """A file with no trailing newline still yields a newline-terminated line."""
        self.storage_client.get_object.return_value = _make_get_object_response(
            [b'alpha\nomega'],
        )
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
            streaming.StreamLines(),
        )

        lines = list(stream)

        self.assertEqual(lines, ['alpha\n', 'omega\n'])

    def test_undecodable_bytes_are_replaced_by_default(self):
        """The default 'replace' error strategy substitutes invalid bytes."""
        self.storage_client.get_object.return_value = _make_get_object_response(
            [b'ok\n', b'b\xffd\n'],
        )
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
            streaming.StreamLines(),
        )

        lines = list(stream)

        self.assertEqual(lines, ['ok\n', 'b�d\n'])

    def test_undecodable_bytes_are_dropped_when_errors_is_ignore(self):
        """The 'ignore' error strategy drops invalid bytes from the line."""
        self.storage_client.get_object.return_value = _make_get_object_response(
            [b'b\xffd\n'],
        )
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
            streaming.StreamLines(errors='ignore'),
        )

        lines = list(stream)

        self.assertEqual(lines, ['bd\n'])

    def test_undecodable_bytes_raise_when_errors_is_strict(self):
        """The 'strict' error strategy propagates the decode failure."""
        self.storage_client.get_object.return_value = _make_get_object_response(
            [b'b\xffd\n'],
        )
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
            streaming.StreamLines(errors='strict'),
        )

        with self.assertRaises(UnicodeDecodeError):
            list(stream)

    def test_lines_summary_reports_line_count_and_size(self):
        """A line stream records both the decoded line count and the byte size."""
        self.storage_client.get_object.return_value = _make_get_object_response(
            [_FIVE_LINES],
        )
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
            streaming.StreamLines(),
        )

        list(stream)

        summary = cast(streaming.StreamSummary, stream.summary)
        self.assertEqual(summary.lines, 5)
        self.assertEqual(summary.size, len(_FIVE_LINES))


class TestStreamObjectLastNLines(unittest.TestCase):
    """Tests for the last-N-lines seek and its ranged second request."""

    def setUp(self):
        self.storage_client = mock.MagicMock(spec=client.StorageClient)
        self.client_factory = _FakeClientFactory(storage_client=self.storage_client)

    def _stream_last_n_lines(self, seek_chunks, tail_chunks, last_n_lines):
        """Drive stream_object for a LastNLinesStream and return the yielded lines."""
        self.storage_client.get_object.side_effect = [
            _make_get_object_response(seek_chunks),
            _make_get_object_response(tail_chunks),
        ]
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.LastNLinesStream(last_n_lines=last_n_lines),
            ),
            streaming.StreamLines(),
        )
        return list(stream)

    def test_ranged_request_starts_at_the_nth_last_line_offset(self):
        """The second GET starts at the byte offset of the last-N-th line."""
        self._stream_last_n_lines([_FIVE_LINES], [b'line4\nline5\n'], 2)

        self.assertEqual(
            self.storage_client.get_object.call_args_list[1],
            mock.call(bucket=_CONTAINER, key=_KEY, offset=18, length=None),
        )

    def test_seek_request_fetches_the_whole_object_first(self):
        """The first GET is unranged so the seek can count every line."""
        self._stream_last_n_lines([_FIVE_LINES], [b'line5\n'], 1)

        self.assertEqual(
            self.storage_client.get_object.call_args_list[0],
            mock.call(bucket=_CONTAINER, key=_KEY),
        )

    def test_ranged_request_yields_only_the_tail_lines(self):
        """Only the lines returned by the ranged request are streamed."""
        lines = self._stream_last_n_lines([_FIVE_LINES], [b'line4\nline5\n'], 2)

        self.assertEqual(lines, ['line4\n', 'line5\n'])

    def test_offset_is_correct_when_a_line_straddles_a_chunk_boundary(self):
        """Line offsets account for lines reassembled across chunk boundaries."""
        self._stream_last_n_lines([b'alpha\nbra', b'vo\ncharlie\n'], [b'charlie\n'], 1)

        self.assertEqual(
            self.storage_client.get_object.call_args_list[1],
            mock.call(bucket=_CONTAINER, key=_KEY, offset=12, length=None),
        )

    def test_final_line_without_newline_gets_its_own_offset(self):
        """A trailing line with no newline is still counted and offset correctly."""
        self._stream_last_n_lines([b'alpha\nbravo\nomega'], [b'omega'], 1)

        self.assertEqual(
            self.storage_client.get_object.call_args_list[1],
            mock.call(bucket=_CONTAINER, key=_KEY, offset=12, length=None),
        )

    def test_request_equal_to_total_lines_refetches_whole_object(self):
        """Asking for exactly as many lines as the file has skips the byte range."""
        self._stream_last_n_lines([_FIVE_LINES], [_FIVE_LINES], 5)

        self.assertEqual(
            self.storage_client.get_object.call_args_list[1],
            mock.call(bucket=_CONTAINER, key=_KEY),
        )

    def test_request_beyond_total_lines_yields_every_line(self):
        """Asking for more lines than the file has streams the whole file."""
        lines = self._stream_last_n_lines([_FIVE_LINES], [_FIVE_LINES], 50)

        self.assertEqual(
            lines,
            ['line1\n', 'line2\n', 'line3\n', 'line4\n', 'line5\n'],
        )

    def test_empty_object_refetches_whole_object(self):
        """An empty file has no line offsets, so the second GET is unranged."""
        self._stream_last_n_lines([], [], 1)

        self.assertEqual(
            self.storage_client.get_object.call_args_list[1],
            mock.call(bucket=_CONTAINER, key=_KEY),
        )

    def test_empty_object_yields_no_lines(self):
        """An empty file streams no lines at all."""
        lines = self._stream_last_n_lines([], [], 1)

        self.assertEqual(lines, [])

    def test_last_n_lines_as_bytes_yields_the_tail_chunks(self):
        """A last-N-lines request without StreamLines yields raw tail bytes."""
        self.storage_client.get_object.side_effect = [
            _make_get_object_response([_FIVE_LINES]),
            _make_get_object_response([b'line5\n']),
        ]
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.LastNLinesStream(last_n_lines=1),
            ),
        )

        chunks = list(stream)

        self.assertEqual(chunks, [b'line5\n'])


class TestStreamObjectAsIO(unittest.TestCase):
    """Tests for ``stream_object`` returning a file-like object."""

    def setUp(self):
        self.storage_client = mock.MagicMock(spec=client.StorageClient)
        self.client_factory = _FakeClientFactory(storage_client=self.storage_client)

    def test_as_io_read_returns_the_whole_object(self):
        """Reading the file-like stream returns the object's bytes."""
        self.storage_client.get_object.return_value = _make_get_object_response(
            [b'alpha\n', b'bravo\n'],
        )
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
            as_io=True,
        )

        with stream as io_stream:
            content = io_stream.read()

        self.assertEqual(content, b'alpha\nbravo\n')

    def test_as_io_summary_is_populated_after_close(self):
        """Closing the file-like stream finalizes the summary."""
        self.storage_client.get_object.return_value = _make_get_object_response(
            [b'alpha\nbravo\n'],
        )
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
            as_io=True,
        )

        with stream as io_stream:
            io_stream.read()

        summary = cast(streaming.StreamSummary, stream.summary)
        self.assertEqual(summary.size, 12)
        self.assertIsNone(summary.lines)

    def test_as_io_summary_is_unset_before_close(self):
        """The summary is only available once the stream has been closed."""
        self.storage_client.get_object.return_value = _make_get_object_response([b'alpha\n'])
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.FullStream(),
            ),
            as_io=True,
        )

        stream.read()

        self.assertIsNone(stream.summary)
        stream.close()

    def test_as_io_honors_the_requested_byte_range(self):
        """An OffsetStream request is forwarded when streaming as a file object."""
        self.storage_client.get_object.return_value = _make_get_object_response([b'line3\n'])
        stream = streaming.stream_object(
            self.client_factory,
            streaming.StreamParams(
                container=_CONTAINER,
                key=_KEY,
                options=streaming.OffsetStream(offset=12, length=6),
            ),
            as_io=True,
        )

        with stream:
            pass

        self.storage_client.get_object.assert_called_once_with(
            bucket=_CONTAINER,
            key=_KEY,
            offset=12,
            length=6,
        )


if __name__ == '__main__':
    unittest.main()
