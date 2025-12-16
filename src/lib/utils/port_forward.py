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
import collections
import logging
import json
import platform
import random
import socket
import struct
from typing import Deque, Dict, Tuple
import urllib

import requests  # type: ignore
import websockets
import websockets.client
import websockets.exceptions

from . import client, common, osmo_errors

SOCKET_READ_BUFFER_SIZE = 4096

logger = logging.getLogger(__name__)


def _cookie_to_header_string(cookie):
    cookie_parts = [f'{cookie.name}={cookie.value}']

    cookie_parts.append(f'Path={cookie.path}')

    same_site = cookie._rest.get('SameSite', '')  # pylint: disable=protected-access
    if same_site:
        cookie_parts.append(f'SameSite={same_site}')

    if cookie.secure:
        cookie_parts.append('Secure')

    return '; '.join(cookie_parts)


def _get_session_cookie(url: str, timeout: int) -> str:
    """ Gets router session cookies. """
    parsed_url = urllib.parse.urlparse(url)
    if parsed_url.scheme == 'wss':
        parsed_url = parsed_url._replace(scheme='https')
    elif parsed_url.scheme == 'ws':
        parsed_url = parsed_url._replace(scheme='http')
    else:
        raise osmo_errors.OSMOServerError(f'Invalid router address: {url}')
    url = urllib.parse.urlunparse(parsed_url)
    res = requests.get(f'{url}/api/router/version', timeout=timeout)

    # Convert cookies manualy rather than using 'set-cookie' to solve duplicate cookie names
    # for virtual node with ssh port-forwarding
    cookie_str = ', '.join([_cookie_to_header_string(i) for i in res.cookies])
    return cookie_str


async def read_data(reader: asyncio.StreamReader,
                    data_socket: websockets.WebSocketClientProtocol,  # type: ignore
                    ws_write_rate_limiter: common.TokenBucket | None = None,
                    buffer_size: int = SOCKET_READ_BUFFER_SIZE):
    """ Forwards data from reader to websocket. """
    try:
        while True:
            data = await reader.read(buffer_size)
            if not data:
                raise EOFError('Reader closed.')
            if ws_write_rate_limiter:
                await ws_write_rate_limiter.wait_for_tokens(len(data))
            await data_socket.send(data)
    except (EOFError, websockets.exceptions.ConnectionClosed) as e:
        # Finish reading when EOF is reached or connection is closed
        return e


async def write_data(writer: asyncio.StreamWriter,
                     data_socket: websockets.WebSocketClientProtocol):  # type: ignore
    """ Forwards data from websocket to writer. """
    try:
        while True:
            data = await data_socket.recv()
            if not data:
                raise EOFError('Writer closed.')
            writer.write(data)
            await writer.drain()
    # Finish writing when EOF is reached or connection is closed
    except (EOFError, websockets.exceptions.ConnectionClosedOK):
        pass
    except websockets.exceptions.ConnectionClosedError as e:
        return e


async def run_tcp(
    service_client: client.ServiceClient,
    app_host: str,
    app_port: int,
    message: str,
    endpoint: str,
    timeout: int,
    router_address: str,
    key: str,
    ctrl_cookie: str,
    params: Dict | None = None,
    ready_event: asyncio.Event | None = None,
    close_event: asyncio.Event | None = None,
    buffer_size: int = SOCKET_READ_BUFFER_SIZE,
    ws_write_rate_limiter: common.TokenBucket | None = None,
):
    """ Run TCP port forwarding with a designated host and port. """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((app_host, app_port))
        await run_tcp_with_sock(
            service_client,
            sock,
            message,
            endpoint,
            timeout,
            router_address,
            key,
            ctrl_cookie,
            params,
            ready_event,
            close_event,
            buffer_size,
            ws_write_rate_limiter,
        )


async def run_tcp_with_sock(
    service_client: client.ServiceClient,
    sock: socket.socket,
    message: str,
    endpoint: str,
    timeout: int,
    router_address: str,
    key: str,
    ctrl_cookie: str,
    params: Dict | None = None,
    ready_event: asyncio.Event | None = None,
    close_event: asyncio.Event | None = None,
    buffer_size: int = SOCKET_READ_BUFFER_SIZE,
    ws_write_rate_limiter: common.TokenBucket | None = None,
):
    """ Run TCP port forwarding with a socket. """
    ctrl_ws = None
    try:
        app_port = sock.getsockname()[1]
        ctrl_ws = await service_client.create_websocket(
            router_address,
            f'{endpoint}/{key}',
            headers={'Cookie': ctrl_cookie},
            params=params,
            timeout=timeout,
        )
        close = close_event or asyncio.Event()

        async def handle_connection(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
            logger.debug('Handle new client connection for port %d', app_port)
            try:
                conn_key = f'PORTFORWARD-{common.generate_unique_id()}'
                cookie = _get_session_cookie(router_address, timeout)
                payload = {'key': conn_key, 'cookie': cookie}
                await ctrl_ws.send(json.dumps(payload).encode())
            except (requests.exceptions.ConnectionError,
                    websockets.exceptions.ConnectionClosedError) as err:
                logger.error('Error: control connection closed. Port %d, err: %s', app_port, err)
                close.set()
                return
            try:
                ws = await service_client.create_websocket(
                    router_address,
                    f'{endpoint}/{conn_key}',
                    headers={'Cookie': cookie},
                    params=params,
                    timeout=timeout,
                )
                loop = asyncio.get_event_loop()
                coroutines = [
                    loop.create_task(write_data(writer, ws)),
                    loop.create_task(read_data(reader, ws, ws_write_rate_limiter, buffer_size)),
                ]

                await asyncio.wait(coroutines, return_when=asyncio.FIRST_COMPLETED)
                await ws.close()
                writer.close()
                await writer.wait_closed()
            except (ConnectionRefusedError, websockets.exceptions.ConnectionClosedError) as err:
                logger.error(err)

        logger.info(message)
        server = await asyncio.start_server(handle_connection, sock=sock)

        if ready_event:
            ready_event.set()

        async with server:
            await common.first_completed([
                server.serve_forever(),
                close.wait(),
                ctrl_ws.wait_closed(),
            ])
    except (ConnectionRefusedError, websockets.exceptions.ConnectionClosedError) as err:
        logger.error(err)
    finally:
        if ctrl_ws:
            try:
                await ctrl_ws.close()
            except Exception:  # pylint: disable=broad-except
                pass


def _encode_addr(data: bytes, addr: Tuple[str, int]) -> bytes:
    """Encodes the address and data into a message"""
    ip, port = addr
    return (socket.inet_aton(ip) + struct.pack('>H', port)) + data


def _decode_addr(data: bytes) -> Tuple[bytes, str, int]:
    """Decodes a message head into the IP address and port"""
    ip = socket.inet_ntoa(data[:4])
    port = struct.unpack('>H', data[4:6])[0]
    return data[6:], ip, port


async def run_udp(service_client: client.ServiceClient, app_host: str, app_port: int, message: str,
                  endpoint: str, timeout: int, router_address: str, key: str, cookie: str):
    """ Run UDP port forwarding. """
    ctrl_ws = None
    transport = None
    try:
        ctrl_ws = await service_client.create_websocket(
            router_address, f'{endpoint}/{key}', headers={'Cookie': cookie}, timeout=timeout)
        deque: Deque = collections.deque()

        async def send_datagram_to_router():
            try:
                while True:
                    if deque:
                        data = deque.popleft()
                        await ctrl_ws.send(data)
                    else:
                        await asyncio.sleep(0.1)
            except websockets.exceptions.ConnectionClosedError:
                pass

        async def receive_datagram_from_router(transport):
            try:
                while True:
                    data = await ctrl_ws.recv()
                    if not data:
                        break
                    data, ip, port = _decode_addr(data)
                    transport.sendto(data, (ip, port))
            except websockets.exceptions.ConnectionClosedError:
                pass

        class Protocol:
            def connection_made(self, transport):
                pass

            def datagram_received(self, data, addr):
                deque.append(_encode_addr(data, addr))

            def connection_lost(self, exc):
                pass

        logger.info(message)
        loop = asyncio.get_event_loop()

        # On macOS, force IPv4 binding when localhost is used to avoid IPv6 (::1) binding
        bind_host = app_host
        if platform.system() == 'Darwin' and app_host in ('localhost', '::1'):
            bind_host = '127.0.0.1'

        transport, _ = await loop.create_datagram_endpoint(
            lambda: Protocol(), local_addr=(bind_host, app_port))  # type: ignore

        _, pending = await asyncio.wait([send_datagram_to_router(),
                                        receive_datagram_from_router(transport)],
                                        return_when=asyncio.FIRST_COMPLETED)
        for i in pending:
            i.cancel()
    except (ConnectionRefusedError, websockets.exceptions.ConnectionClosedError) as err:
        logger.error(err)
    finally:
        if ctrl_ws:
            await ctrl_ws.close()
        if transport:
            transport.close()


def get_exponential_backoff_delay(retry: int) -> float:
    random_delay = random.random() * 5
    exp_delay = 2 ** min(retry, 5)
    return random_delay + exp_delay
