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
from typing import cast
import unittest

import fastapi

from src.service.router import helper


def _chunk(payload: bytes) -> bytes:
    """Encode one chunked-transfer-encoding chunk."""
    return f'{len(payload):x}\r\n'.encode() + payload + b'\r\n'


class _SilentWebSocket:
    """Backend websocket that accepts the connection and then says nothing."""

    async def receive_bytes(self) -> bytes:
        await asyncio.Future()
        raise AssertionError('unreachable')


def _silent_websocket() -> fastapi.WebSocket:
    """A backend websocket stand-in, typed for the helpers under test."""
    return cast(fastapi.WebSocket, _SilentWebSocket())


class TestStreamTeardown(unittest.IsolatedAsyncioTestCase):
    """Covers release of the backend connection when a response is torn down."""

    async def test_chunked_stream_releases_backend_when_closed_early(self):
        close = asyncio.Event()
        stream = helper.stream_chunked(_silent_websocket(), close, _chunk(b'first'))

        self.assertEqual(await anext(stream), b'first')
        self.assertFalse(close.is_set(), 'The backend was released while still streaming.')

        await stream.aclose()

        self.assertTrue(
            close.is_set(),
            'A chunked response closed early left its backend connection open.',
        )

    async def test_chunked_stream_releases_backend_on_the_end_marker(self):
        close = asyncio.Event()
        stream = helper.stream_chunked(
            _silent_websocket(), close, _chunk(b'first') + _chunk(b''))

        self.assertEqual([chunk async for chunk in stream], [b'first'])

        self.assertTrue(close.is_set(), 'A fully read chunked response held its backend.')

    async def test_sized_stream_releases_backend_when_closed_early(self):
        close = asyncio.Event()
        stream = helper.stream_content(_silent_websocket(), close, b'first', 100)

        self.assertEqual(await anext(stream), b'first')
        self.assertFalse(close.is_set(), 'The backend was released while still streaming.')

        await stream.aclose()

        self.assertTrue(
            close.is_set(),
            'A sized response closed early left its backend connection open.',
        )


if __name__ == '__main__':
    unittest.main()
