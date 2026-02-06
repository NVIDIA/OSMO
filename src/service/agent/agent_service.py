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
import asyncio
from urllib.parse import urlparse

import fastapi
import fastapi.responses
import fastapi.staticfiles
import pydantic
import uvicorn  # type: ignore

import src.lib.utils.logging
from src.utils.metrics import metrics
from src.service.agent import helpers
from src.service.core.auth import auth_service
from src.service.core.workflow import objects
from src.utils import connectors, static_config
from src.utils.progress_check import progress


class BackendServiceConfig(connectors.RedisConfig, connectors.PostgresConfig,
                           src.lib.utils.logging.LoggingConfig, static_config.StaticConfig):
    """Config settings for the backend service"""
    progress_period: int = pydantic.Field(
        command_line='progress_period',
        env='OSMO_PROGRESS_PERIOD',
        default=30,
        description='The amount of time to wait between updating progress')


app = fastapi.FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

app.include_router(auth_service.router)

app.add_middleware(connectors.AccessControlMiddleware)


@app.get('/health')
async def health():
    """ To be used for the readiness probe, but not liveness probe. That way, if this method is
    slow, no new traffic gets routed, instead of killing the service. """
    return {'status': 'OK'}


@app.websocket('/api/agent/listener/node/backend/{name}')
async def backend_listener_node_communication(websocket: fastapi.WebSocket,
                                         name: str):
    """ Endpoint wrapper for node queue communication with backend listener. """
    await helpers.backend_listener_impl(websocket, name)


@app.websocket('/api/agent/listener/pod/backend/{name}')
async def backend_listener_pod_communication(websocket: fastapi.WebSocket,
                                         name: str):
    """ Endpoint wrapper for pod queue communication with backend listener. """
    await helpers.backend_listener_impl(websocket, name)


@app.websocket('/api/agent/listener/event/backend/{name}')
async def backend_listener_event_communication(websocket: fastapi.WebSocket,
                                         name: str):
    """ Endpoint wrapper for backend queue communication with backend listener. """
    await helpers.backend_listener_impl(websocket, name)


@app.websocket('/api/agent/listener/heartbeat/backend/{name}')
async def backend_listener_heartbeat_communication(websocket: fastapi.WebSocket,
                                         name: str):
    """ Endpoint wrapper for heartbeat queue communication with backend listener. """
    await helpers.backend_listener_impl(websocket, name)


@app.websocket('/api/agent/listener/message/backend/{name}')
async def backend_listener_message_communication(websocket: fastapi.WebSocket,
                                         name: str):
    """ Endpoint wrapper for message queue communication with backend listener. """
    await helpers.backend_listener_impl(websocket, name)


@app.websocket('/api/agent/worker/backend/{name}')
async def backend_worker_communication(websocket: fastapi.WebSocket,
                                       name: str):
    """ Endpoint wrapper for communication with backend worker. """
    await helpers.backend_worker_impl(websocket, name)


@app.websocket('/api/agent/listener/control/backend/{name}')
async def backend_listener_control_communication(websocket: fastapi.WebSocket,
                                             name: str):
    """ Endpoint wrapper for backend queue communication with backend listener. """
    await helpers.backend_listener_control_impl(websocket, name)


def main():
    config = objects.WorkflowServiceConfig.load()
    agent_service_config = BackendServiceConfig.load()
    src.lib.utils.logging.init_logger('agent', config)
    postgres = connectors.PostgresConnector(config)
    connectors.RedisConnector(config)
    metrics.MetricCreator(config=config).get_meter_instance()
    objects.WorkflowServiceContext.set(
        objects.WorkflowServiceContext(config=config, database=postgres))
    parsed_url = urlparse(config.host)
    host = parsed_url.hostname if parsed_url.hostname else ''
    if parsed_url.port:
        port = parsed_url.port
    else:
        port = 8000

    async def liveness_update():
        progress_writer = progress.ProgressWriter(config.progress_file)
        while True:
            progress_writer.report_progress()
            await asyncio.sleep(agent_service_config.progress_period)

    uvicorn_config = uvicorn.Config(app, host=host, port=port)
    uvicorn_server = uvicorn.Server(config=uvicorn_config)
    loop = asyncio.get_event_loop()
    liveness_task = loop.create_task(liveness_update())
    loop.run_until_complete(uvicorn_server.serve())
    liveness_task.cancel()
    try:
        loop.run_until_complete(liveness_task)
    except asyncio.exceptions.CancelledError:
        pass


if __name__ == '__main__':
    main()
