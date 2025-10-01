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
import pydantic
import uvicorn  # type: ignore

import src.lib.utils.logging
from src.service.logger import ctrl_websocket
from src.service.core.auth import auth_service
from src.utils import connectors, static_config
from src.utils.progress_check import progress


class LoggerServiceConfig(connectors.RedisConfig, connectors.PostgresConfig,
                          src.lib.utils.logging.LoggingConfig, static_config.StaticConfig):
    """Config settings for the logger service"""
    host: str = pydantic.Field(
        command_line='host',
        default='http://0.0.0.0:8000',
        description='The url to bind to when serving the workflow service.')
    progress_file: str = pydantic.Field(
        command_line='progress_file',
        env='OSMO_PROGRESS_FILE',
        default='/var/run/osmo/last_progress',
        description='The file to write node watch progress timestamps to (For liveness/startup)')
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


@app.websocket('/api/logger/workflow/{name}/osmo_ctrl/{task_name}/retry_id/{retry_id}')
async def put_workflow_logs(websocket: fastapi.WebSocket, name: str, task_name: str, retry_id: int):
    """ Websocket for osmo-ctrl for sending workflow logs and metrics. """
    await ctrl_websocket.run_websocket(websocket, name, task_name, retry_id)


def main():
    config = LoggerServiceConfig.load()
    src.lib.utils.logging.init_logger('logger', config)
    _ = connectors.PostgresConnector(config)
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
            await asyncio.sleep(config.progress_period)

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
