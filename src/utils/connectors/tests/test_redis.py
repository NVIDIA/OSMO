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

import asyncio
import datetime
import unittest
from unittest import mock

import anyio

from src.utils.connectors import redis


class RedisLogFormatterTest(unittest.IsolatedAsyncioTestCase):

    async def test_cancellation_does_not_interrupt_redis_client_cleanup(self):
        read_started = asyncio.Event()
        client_closed = asyncio.Event()

        class TrackedRedisClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                await self.aclose()

            async def xread(self, *_args, **_kwargs):
                read_started.set()
                await asyncio.Future()

            async def aclose(self):
                await asyncio.sleep(0)
                client_closed.set()

        redis_client = TrackedRedisClient()

        async def consume():
            async for _ in redis.redis_log_streamer(
                'redis://localhost', 'workflow-logs'
            ):
                pass

        with mock.patch.object(redis.redis.asyncio, 'from_url',
                               return_value=redis_client):
            async with anyio.create_task_group() as task_group:
                task_group.start_soon(consume)
                await read_started.wait()
                task_group.cancel_scope.cancel()

        self.assertTrue(
            client_closed.is_set(),
            'Redis client cleanup was cancelled before it completed.',
        )

    async def test_closing_formatter_closes_redis_reader(self):
        reader_closed = asyncio.Event()

        async def tracked_reader(*_args):
            try:
                yield redis.LogStreamBody(
                    source='task-1',
                    retry_id=0,
                    time=datetime.datetime(2026, 8, 19),
                    text='first log line',
                    io_type=redis.IOType.STDOUT,
                )
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


if __name__ == '__main__':
    unittest.main()
