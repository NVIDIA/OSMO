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
import datetime
import logging
from typing import Dict, List, Optional, Any
from urllib.parse import urlparse

import fastapi
import fastapi.responses
from starlette.types import ASGIApp, Receive, Scope, Send
import pydantic
import uvicorn  # type: ignore

from src.lib.utils import common, version
import src.lib.utils.logging
from src.service.router import helper
from src.utils import connectors, static_config


class RouterServiceConfig(src.lib.utils.logging.LoggingConfig, static_config.StaticConfig,
                          connectors.PostgresConfig):
    """Config settings for the logger service"""
    host: str = pydantic.Field(
        command_line='host',
        default='http://0.0.0.0:8000',
        description='The url to bind to when serving the router service.')
    hostname: str = pydantic.Field(
        command_line='hostname',
        default='localhost',
        description='The DNS hostname of the router service.')
    timeout: int = pydantic.Field(
        command_line='timeout',
        default=60,
        description='Timeout for router connections.')
    webserver_enabled: bool = pydantic.Field(
        command_line='webserver_enabled',
        default=False,
        description='Whether webserver is enabled during deployment.')
    webserver_initial_timeout: int = pydantic.Field(
        command_line='webserver_initial_timeout',
        default=60 * 60,  # 1 hour in seconds
        description='Initial timeout for webserver connections.')
    webserver_nonactive_timeout: int = pydantic.Field(
        command_line='webserver_nonactive_timeout',
        default=30 * 60,  # 30 minutes in seconds
        description='Timeout for non-activewebserver connections.')
    sticky_cookies: List[str] = pydantic.Field(
        command_line='sticky_cookies',
        default=['AWSALB', 'AWSALBCORS'],
        description='List of sticky cookies to send to the webserver.')


class RouterConnection(pydantic.BaseModel):
    """Model representing a router connection with websocket and synchronization events."""
    wait_connect: Optional[asyncio.Event] = None
    wait_close: Optional[asyncio.Event] = None
    websocket: Optional[fastapi.WebSocket] = None

    class Config:
        arbitrary_types_allowed = True


class WebserverConnection(pydantic.BaseModel):
    """Model representing a webserver connection with websocket and synchronization events."""
    wait_close: asyncio.Event
    last_active_time: datetime.datetime
    websocket: fastapi.WebSocket

    class Config:
        arbitrary_types_allowed = True


class ConnectionPayload(pydantic.BaseModel):
    key: str
    cookie: str
    type: str = 'tcp'
    payload: Dict[str, Any] | None = None  # Optional, only used for 'ws' type


app = fastapi.FastAPI(docs_url='/api/router/docs', redoc_url=None, openapi_url=None)
connections: Dict[str, RouterConnection] = {}
webservers: Dict[str, WebserverConnection] = {}


class RouterWebSocketMiddleware:
    """Middleware for handling WebSocket connections in the router service."""
    # pylint: disable=redefined-outer-name
    def __init__(self, app: ASGIApp):
        self.app = app
        self.resolve_session_key = helper.resolve_session_key_decorator(
            RouterServiceConfig.load().hostname)

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope['type'] == 'websocket':
            websocket = fastapi.WebSocket(scope, receive=receive, send=send)
            session_key = self.resolve_session_key(websocket.headers)
            if not session_key:
                return await self.app(scope, receive, send)
            return await webserver_ws_request(websocket, session_key)
        elif scope['type'] == 'http':
            request = fastapi.Request(scope, receive=receive, send=send)
            session_key = self.resolve_session_key(request.headers)
            if not session_key:
                return await self.app(scope, receive, send)
            response = await webserver_http_request(request, session_key)
            return await response(scope, receive, send)
        return await self.app(scope, receive, send)


app.add_middleware(RouterWebSocketMiddleware)


@app.get('/api/router/version')
def get_version():
    return version.VERSION


@app.get('/api/router/webserver/{key}')
def is_session_alive(key: str) -> bool:
    return key.lower() in webservers


# Endpoint for UI to determine whether to show the port forwarding button
@app.get('/api/router/webserver_enabled')
def is_webserver_enabled() -> bool:
    return RouterServiceConfig.load().webserver_enabled


@app.websocket('/api/router/exec/{name}/backend/{key}')
@app.websocket('/api/router/portforward/{name}/backend/{key}')
@app.websocket('/api/router/rsync/{name}/backend/{key}')
async def run_connect_backend(ws: fastapi.WebSocket, name: str, key: str):
    """Websocket for backend to connect."""
    await ws.accept()
    try:
        close = asyncio.Event()
        if key in connections:
            connections[key].websocket = ws
            connections[key].wait_close = close
            connections[key].wait_connect.set()  # type: ignore
        else:
            connect = asyncio.Event()
            connections[key] = RouterConnection(
                websocket=ws, wait_connect=connect, wait_close=close)
            await asyncio.wait_for(connect.wait(), RouterServiceConfig.load().timeout)
        await close.wait()
    except fastapi.WebSocketDisconnect as err:
        logging.info(
            'Backend close websocket connection for workflow %s with key %s: %s',
            name, key, err)
    except asyncio.TimeoutError:
        logging.info('Backend connection for workflow %s with key %s is timeout', name, key)
        await ws.close(4000, 'Router connection timeout')

    del connections[key]
    # Make close faster
    try:
        await ws.close()
    except:  # pylint: disable=bare-except
        pass
    logging.info('Backend API finished: %s, %s', name, key)


@app.websocket('/api/router/exec/{name}/client/{key}')
@app.websocket('/api/router/portforward/{name}/client/{key}')
@app.websocket('/api/router/rsync/{name}/client/{key}')
async def run_connect_client(
    client_ws: fastapi.WebSocket,
    name: str,
    key: str,
    timeout: int = RouterServiceConfig.load().timeout,
):
    """Websocket for client to connect."""
    await client_ws.accept()
    close = None

    try:
        if key in connections:
            connections[key].wait_connect.set()  # type: ignore
        else:
            connect = asyncio.Event()
            connections[key] = RouterConnection(wait_connect=connect)
            await asyncio.wait_for(connect.wait(), timeout)
        backend_ws = connections[key].websocket
        close = connections[key].wait_close

        loop = asyncio.get_event_loop()
        if backend_ws is not None:
            coroutines = [
                    loop.create_task(copy_data(client_ws, backend_ws)),
                    loop.create_task(copy_data(backend_ws, client_ws))
                ]
            await common.gather_cancel(*coroutines)
    except fastapi.WebSocketDisconnect as err:
        logging.info('Websocket disconnection for workflow %s with key %s: %s', name, key, err)
    except asyncio.TimeoutError:
        logging.info('Client connection for workflow %s with key %s is timeout', name, key)
        del connections[key]

    if close:
        close.set()
    # Make close faster
    try:
        await client_ws.close()
    except:  # pylint: disable=bare-except
        pass
    logging.info('Client API finished: %s, %s', name, key)


async def copy_data(src_ws: fastapi.WebSocket, dst_ws: fastapi.WebSocket):
    """Forwards data from src_ws to dst_ws."""
    while True:
        data = await src_ws.receive_bytes()
        if not data:
            break
        await dst_ws.send_bytes(data)


async def webserver_http_request(request: fastapi.Request, ctrl_key: str):
    """Serve a request from the webserver to the backend."""
    if ctrl_key not in webservers:
        return fastapi.Response(
            content='No active backend connection found, your session may have expired.',
            status_code=404)
    ctrl_ws = webservers[ctrl_key].websocket
    webservers[ctrl_key].last_active_time = datetime.datetime.now()

    request_bytes = await helper.http2raw(request) + await request.body()

    # Create a new backend connection
    conn_key = f'PORTFORWARD-{common.generate_unique_id()}'
    connect = asyncio.Event()
    connections[conn_key] = RouterConnection(wait_connect=connect)
    sticky_cookies = RouterServiceConfig.load().sticky_cookies
    cookie_str = ', '.join(f'{k}={v}' for k, v in request.cookies.items() if k in sticky_cookies)
    await ctrl_ws.send_json(
        ConnectionPayload(key=conn_key, cookie=cookie_str).dict(exclude_none=True))
    try:
        await asyncio.wait_for(connect.wait(), RouterServiceConfig.load().timeout)
        ws = connections[conn_key].websocket
        close = connections[conn_key].wait_close
    except asyncio.TimeoutError:
        return fastapi.Response(
            content='Request timed out waiting for backend connection.', status_code=504)

    if not ws or not close:  # To fix pytype error
        return fastapi.Response(
            content='No active backend connection found, your session may have expired.',
            status_code=404)

    await ws.send_bytes(request_bytes)

    response_bytes = await ws.receive_bytes()
    status_code, headers, body = helper.split_headers_body(response_bytes)

    if headers.get('transfer-encoding', '').lower() == 'chunked':
        # Remove chunked encoding header since fastapi will handle it
        headers.pop('transfer-encoding')
        return fastapi.responses.StreamingResponse(
            helper.stream_chunked(ws, close, body),
            status_code=status_code,
            headers=headers,
            media_type=headers.get('content-type')
        )
    else:
        total_length = int(headers.get('content-length', 0))
        return fastapi.responses.StreamingResponse(
            helper.stream_content(ws, close, body, total_length),
            status_code=status_code,
            headers=headers,
            media_type=headers.get('content-type')
        )


async def copy_websocket(src_ws: fastapi.WebSocket, dst_ws: fastapi.WebSocket):
    """Copies messages from source websocket to destination websocket."""
    try:
        while True:
            message = await src_ws.receive()
            if message['type'] == 'websocket.receive':
                if 'text' in message:
                    await dst_ws.send_text(message['text'])
                elif 'bytes' in message:
                    await dst_ws.send_bytes(message['bytes'])
            elif message['type'] == 'websocket.disconnect':
                break
    except fastapi.WebSocketDisconnect:
        logging.info('WebSocket disconnected during copy')


async def webserver_ws_request(ws: fastapi.WebSocket, ctrl_key: str):
    """Serve a request from the webserver to the backend."""
    await ws.accept()
    if ctrl_key not in webservers:
        await ws.close(
            code=4000,
            reason='No active backend connection found, your session may have expired.')
        return
    ctrl_ws = webservers[ctrl_key].websocket
    webservers[ctrl_key].last_active_time = datetime.datetime.now()

    # Create a new backend connection
    conn_key = f'PORTFORWARD-{common.generate_unique_id()}'
    connect = asyncio.Event()
    connections[conn_key] = RouterConnection(wait_connect=connect)

    headers = dict(ws.headers)
    headers_to_remove = [
        'Connection',
        'Upgrade',
        'Sec-WebSocket-Key',
        'Sec-WebSocket-Version',
        'Sec-WebSocket-Extensions',
    ]
    for header in headers_to_remove:
        headers.pop(header, None)
        headers.pop(header.lower(), None)
    payload = {
        'path': f'{ws.url.path}?{ws.url.query}' if ws.url.query else ws.url.path,
        'headers': headers,
    }
    sticky_cookies = RouterServiceConfig.load().sticky_cookies
    cookie_header = ws.headers.get('cookie', '')
    cookies = []
    if cookie_header:
        for cookie in cookie_header.split(';'):
            name = cookie.strip().split('=')[0]
            if name in sticky_cookies:
                cookies.append(cookie.strip())
    cookie_str = ', '.join(cookies)
    await ctrl_ws.send_json(
        ConnectionPayload(key=conn_key, cookie=cookie_str, type='ws', payload=payload).dict())

    close = None
    try:
        await asyncio.wait_for(connect.wait(), RouterServiceConfig.load().timeout)
        backend_ws = connections[conn_key].websocket
        close = connections[conn_key].wait_close

        loop = asyncio.get_event_loop()
        if backend_ws is not None:
            coroutines = [
                loop.create_task(copy_websocket(backend_ws, ws)),
                loop.create_task(copy_websocket(ws, backend_ws)),
                loop.create_task(update_last_active_time(ctrl_key))
            ]
            await common.gather_cancel(*coroutines)

    except asyncio.TimeoutError:
        await ws.close(code=4000, reason='Connection timed out waiting for backend')
        return
    except fastapi.WebSocketDisconnect:
        if close:
            close.set()
    finally:
        if conn_key in connections:
            del connections[conn_key]


@app.websocket('/api/router/webserver/{name}/backend/{key}')
async def webserver_connect_backend(ws: fastapi.WebSocket, name: str, key: str):
    """Websocket for backend to connect for webserver."""
    key = key.lower()  # All hostnames will be converted to lowercase
    close = asyncio.Event()
    await ws.accept()
    try:
        webservers[key] = WebserverConnection(
            websocket=ws,
            last_active_time=datetime.datetime.now(),
            wait_close=close
        )
        await asyncio.sleep(RouterServiceConfig.load().webserver_initial_timeout)
        await close.wait()
    except fastapi.WebSocketDisconnect as err:
        logging.info(
            'Backend close webserver connection for workflow %s with key %s: %s', name, key, err)
    await ws.close()
    del webservers[key]


async def check_webserver_timeout():
    """Check if the webserver has been inactive for too long and close the connection."""
    logging.info('Launch check_webserver_timeout')
    timeout = datetime.timedelta(seconds=RouterServiceConfig.load().webserver_nonactive_timeout)
    while True:
        duration = timeout
        for key, server in webservers.items():
            expire_time = server.last_active_time + timeout
            current_time = datetime.datetime.now()
            if expire_time > current_time:
                duration = min(duration, expire_time - current_time)
            else:
                server.wait_close.set()
                logging.info('Webserver %s has been inactive for %s seconds and will be closed',
                             key, timeout)
        await asyncio.sleep(duration.total_seconds())


async def update_last_active_time(key: str, duration: int = 60):
    """Update the last active time of the webserver."""
    while True:
        webservers[key].last_active_time = datetime.datetime.now()
        await asyncio.sleep(duration)


def main():
    config = RouterServiceConfig.load()
    src.lib.utils.logging.init_logger('router', config)
    parsed_url = urlparse(config.host)
    host = parsed_url.hostname if parsed_url.hostname else ''
    if parsed_url.port:
        port = parsed_url.port
    else:
        port = 8000

    connectors.PostgresConnector(config)

    app.add_middleware(connectors.AccessControlMiddleware, method=config.method,
                       domain_access_check=helper.resolve_session_key_decorator(config.hostname))

    uvicorn_config = uvicorn.Config(app, host=host, port=port)
    uvicorn_server = uvicorn.Server(config=uvicorn_config)
    loop = asyncio.get_event_loop()
    check_timeout_task = loop.create_task(check_webserver_timeout())
    try:
        loop.run_until_complete(uvicorn_server.serve())
    except KeyboardInterrupt:
        pass
    check_timeout_task.cancel()


if __name__ == '__main__':
    main()
