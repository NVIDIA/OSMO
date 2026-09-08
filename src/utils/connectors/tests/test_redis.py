"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""
import asyncio
import datetime
import unittest
from unittest import mock

import anyio

from src.utils.connectors import redis


def _log_line(text: str) -> redis.LogStreamBody:
    """One STDOUT log entry as redis_log_streamer would yield it."""
    return redis.LogStreamBody(
        source='task-1',
        retry_id=0,
        time=datetime.datetime(2026, 8, 19),
        text=text,
        io_type=redis.IOType.STDOUT,
    )


def _redis_log_entry(
    stream_id: str,
    text: str,
    io_type: redis.IOType = redis.IOType.STDOUT,
) -> tuple[bytes, dict[bytes, bytes]]:
    """One encoded Redis stream entry returned by xread."""
    return stream_id.encode(), {
        b'source': b'task-1',
        b'retry_id': b'0',
        b'time': b'2026-08-19T00:00:00',
        b'text': text.encode(),
        b'io_type': io_type.value.encode(),
    }


class TestRedisLogFormatter(unittest.IsolatedAsyncioTestCase):
    """Covers closure propagation from the log formatter to the Redis reader."""

    async def test_closing_formatter_closes_redis_reader(self):
        reader_closed = asyncio.Event()

        async def tracked_reader(*args):  # pylint: disable=unused-argument
            try:
                yield _log_line('first log line')
                await asyncio.Future()
            finally:
                reader_closed.set()

        with mock.patch.object(redis, 'redis_log_streamer',
                               side_effect=tracked_reader):
            formatter = redis.redis_log_formatter(
                'redis://localhost', 'workflow-logs')
            self.assertIn('first log line', await anext(formatter))
            await formatter.aclose()

        self.assertTrue(
            reader_closed.is_set(),
            'Redis log reader was not closed when its formatter was closed.',
        )


class TestRedisLogStreamer(unittest.IsolatedAsyncioTestCase):
    """Covers Redis log streaming and client cleanup."""

    async def test_yields_every_entry_in_xread_batch(self):
        xread_responses = [
            [(b'logs', [
                _redis_log_entry('1-0', 'first log line'),
                _redis_log_entry('2-0', 'second log line'),
            ])],
            [(b'logs', [
                _redis_log_entry('3-0', '', redis.IOType.END_FLAG),
            ])],
        ]

        class _FakeClient:
            async def xread(self, *args, **kwargs):  # pylint: disable=unused-argument
                return xread_responses.pop(0)

            async def aclose(self):
                pass

        with mock.patch.object(redis.redis.asyncio, 'from_url',
                               return_value=_FakeClient()):
            lines = [
                line async for line in redis.redis_log_streamer(
                    'redis://localhost', 'logs')
            ]

        self.assertEqual(
            ['first log line', 'second log line'],
            [line.text for line in lines],
        )

    async def test_stops_at_end_flag_within_xread_batch(self):
        xread_calls = 0

        class _FakeClient:
            async def xread(self, *args, **kwargs):  # pylint: disable=unused-argument
                nonlocal xread_calls
                xread_calls += 1
                if xread_calls == 1:
                    return [(b'logs', [
                        _redis_log_entry('1-0', 'first log line'),
                        _redis_log_entry('2-0', '', redis.IOType.END_FLAG),
                        _redis_log_entry('3-0', 'after end flag'),
                    ])]
                return [(b'logs', [
                    _redis_log_entry('4-0', '', redis.IOType.END_FLAG),
                ])]

            async def aclose(self):
                pass

        with mock.patch.object(redis.redis.asyncio, 'from_url',
                               return_value=_FakeClient()):
            lines = [
                line async for line in redis.redis_log_streamer(
                    'redis://localhost', 'logs')
            ]

        self.assertEqual(['first log line'], [line.text for line in lines])
        self.assertEqual(1, xread_calls)

    async def test_client_is_closed_even_when_the_reader_is_cancelled(self):
        """A disconnect cancels the task driving the reader, and cancellation
        lands inside it. The close must still complete or the socket leaks."""
        closed = asyncio.Event()

        class _FakeClient:
            async def xread(self, *args, **kwargs):  # pylint: disable=unused-argument
                return []

            async def aclose(self):
                # Any real close awaits; an unshielded one would be cancelled here.
                await asyncio.sleep(0)
                closed.set()

        async def drain():
            async with anyio.create_task_group() as task_group:

                async def read():
                    stream = redis.redis_log_streamer('redis://localhost', 'logs')
                    try:
                        await anext(stream)
                    except StopAsyncIteration:
                        pass
                    finally:
                        await stream.aclose()

                task_group.start_soon(read)
                await asyncio.sleep(0.05)
                task_group.cancel_scope.cancel()

        with mock.patch.object(redis.redis.asyncio, 'from_url',
                               return_value=_FakeClient()):
            await asyncio.wait_for(drain(), timeout=5)

        self.assertTrue(
            closed.is_set(),
            'The Redis client was not closed when the reader was cancelled.',
        )


if __name__ == '__main__':
    unittest.main()
