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
from typing import AsyncGenerator, cast

import fastapi.responses
from starlette.types import Receive, Scope, Send


class ClosingStreamingResponse(fastapi.responses.StreamingResponse):
    """Streaming response that ends and releases its body when the client leaves.

    Starlette only installs a disconnect listener for ASGI servers older than
    spec 2.4; on 2.4 and later it infers a disconnect from a failed body send.
    Uvicorn advertises 2.4, so a body that never sends -- a log tail on a quiet
    workflow -- is never told the client is gone, and the request runs forever.

    This restores the listener unconditionally and closes the body afterwards,
    so whatever the body holds open is released with the response. Use it for a
    body that can stay idle; a body that always has a next chunk does not need
    it, because its next send will fail and end the request anyway.
    """

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http':
            await super().__call__(scope, receive, send)
            return

        streaming = asyncio.ensure_future(self.stream_response(send))
        watching = asyncio.ensure_future(self.listen_for_disconnect(receive))
        try:
            await asyncio.wait((streaming, watching), return_when=asyncio.FIRST_COMPLETED)
        finally:
            streaming.cancel()
            watching.cancel()
            # Both have to finish unwinding before the body can be closed, or
            # aclose() lands on a generator that is still running.
            await asyncio.wait((streaming, watching))
            await cast(AsyncGenerator[bytes, None], self.body_iterator).aclose()

        if not streaming.cancelled():
            # Surface a body failure; a cancelled stream means the client left.
            streaming.result()

        if self.background is not None:
            await self.background()
