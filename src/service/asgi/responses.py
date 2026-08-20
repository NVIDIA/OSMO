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

import contextlib
from typing import Any, AsyncGenerator, AsyncIterator, cast

import anyio
import anyio.abc
import fastapi.responses
from starlette.requests import ClientDisconnect
from starlette.responses import ContentStream
from starlette.types import Message, Receive, Scope, Send


@contextlib.asynccontextmanager
async def _collapsing_task_group() -> AsyncIterator[anyio.abc.TaskGroup]:
    """Task group that re-raises a lone child exception instead of a group."""
    try:
        async with anyio.create_task_group() as task_group:
            yield task_group
    except BaseExceptionGroup as group:
        exceptions = tuple(group.exceptions)
        if len(exceptions) != 1:
            raise
        only_exception = exceptions[0]
        context = None if only_exception.__suppress_context__ else only_exception.__context__
        raise only_exception from only_exception.__cause__ or context


class ClosingStreamingResponse(fastapi.responses.StreamingResponse):
    """Streaming response that releases its body's resources when the client leaves.

    Adds two guarantees the base class does not make:

    * The response ends when the client disconnects, even while the body is idle.
      The base class infers a disconnect from a failed body send, which cannot
      happen on a stream that has gone quiet, so such a request would otherwise
      stay alive for as long as the process does.
    * The body iterator is closed once the response ends, so whatever it holds --
      a Redis connection, a backend socket, an object-store read -- is released
      then and there rather than whenever the generator is finalized.

    Use this for any body backed by a live connection. A body that is already
    fully in memory does not need it.
    """

    def __init__(self, content: ContentStream, *args: Any, **kwargs: Any) -> None:
        super().__init__(content, *args, **kwargs)
        # Starlette keeps only its own wrapper around a synchronous body, and
        # closing that wrapper releases the body itself no sooner than the next
        # cyclic collection. Keep the original so it can be closed directly.
        self._source = content

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http':
            await super().__call__(scope, receive, send)
            return

        try:
            await self._stream_until_disconnect(receive, send)
        finally:
            await self._close_body()

        if self.background is not None:
            await self.background()

    async def _close_body(self) -> None:
        """Release the body and whatever it holds open."""
        # Starlette wraps every body in an async generator -- including a
        # synchronous one, via iterate_in_threadpool -- but types the result as a
        # bare AsyncIterable.
        await cast(AsyncGenerator[bytes, None], self.body_iterator).aclose()
        if self._source is not self.body_iterator:
            close_source = getattr(self._source, 'close', None)
            if close_source is not None:
                close_source()

    async def _stream_until_disconnect(self, receive: Receive, send: Send) -> None:
        """Send the body, stopping as soon as the client disconnects."""

        async def send_or_disconnect(message: Message) -> None:
            # Report a dead socket as a disconnect, matching the base class. The
            # wrapper covers only `send`, so a failure raised by the body itself
            # (a Redis read error, say) is still reported as what it was.
            try:
                await send(message)
            except OSError as error:
                raise ClientDisconnect() from error

        async with _collapsing_task_group() as task_group:

            async def stream() -> None:
                try:
                    await self.stream_response(send_or_disconnect)
                finally:
                    task_group.cancel_scope.cancel()

            task_group.start_soon(stream)
            await self.listen_for_disconnect(receive)
            task_group.cancel_scope.cancel()
