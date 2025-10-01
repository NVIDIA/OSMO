"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

import logging
from typing import Any, Callable

from src.utils import backend_messages


# Type definition for a function that adds a string to the queue
EnqueueCallback = Callable[[backend_messages.MessageBody], None]
DequeueCallback = Callable[[], backend_messages.MessageBody]


async def send_log_through_websocket(log_type: backend_messages.LoggingType, text: str,
                                     websocket: Any, workflow_uuid: str = ''):
    if workflow_uuid:
        logging.log(log_type.value, text, extra={'workflow_uuid': workflow_uuid})
    else:
        logging.log(log_type.value, text)
    await websocket.send(backend_messages.MessageBody(
                         type=backend_messages.MessageType.LOGGING,
                         body=backend_messages.LoggingBody(type=log_type,
                             text=text)).json())


def send_log_through_queue(log_type: backend_messages.LoggingType, text: str,
                           send_queue: EnqueueCallback,
                           workflow_uuid: str | None = None):
    logging.log(log_type.value, text, extra={'workflow_uuid': workflow_uuid})
    send_queue(backend_messages.MessageBody(
        type=backend_messages.MessageType.LOGGING,
        body=backend_messages.LoggingBody(type=log_type,
            text=text, workflow_uuid=workflow_uuid)))
