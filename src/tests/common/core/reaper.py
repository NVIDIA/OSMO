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

import contextlib
import logging
import socket
import time
import typing

from testcontainers.core import (  # type: ignore
    config,
    container,
    exceptions,
    labels,
    wait_strategies,
)

from src.tests.common.core import network

logger = logging.getLogger(__name__)

REAPER_NAME = f'testcontainers-ryuk-{labels.SESSION_ID}'
REAPER_PORT = 8080


def patch_reaper_create_instance(reaper_container: network.NetworkAwareContainer):
    """
    As of testcontainers v4.13.2, Reaper container requires a special patch
    in order to operate across both Docker-in-Docker and Local modes.

    Reference of the original implementation:
    https://github.com/testcontainers/testcontainers-python/blob/5c1504c217d8cd3debd99dee54db826e49bfa579/core/testcontainers/core/container.py#L308
    """

    # pylint: disable=protected-access
    # pylint: disable=unused-argument
    def new_create_instance(cls) -> container.Reaper:
        logger.debug('Creating new Reaper for session: %s', labels.SESSION_ID)

        container.Reaper._container = reaper_container.start()
        container.Reaper._container.waiting_for(
            wait_strategies.LogMessageWaitStrategy(r'.* Started!').with_startup_timeout(20))

        container_host = container.Reaper._container.get_container_host_ip()
        container_port = container.Reaper._container.get_exposed_port(8080)

        if not container_host or not container_port:
            rcc = container.Reaper._container
            assert rcc
            raise exceptions.ContainerConnectException(
                f'Could not obtain network details for {rcc.get_wrapped_container().id}. '
                f'Host: {container_host} Port: {container_port}'
            )

        last_connection_exception: typing.Optional[Exception] = None
        for _ in range(50):
            try:
                container.Reaper._socket = socket.socket(
                    socket.AF_INET, socket.SOCK_STREAM)
                container.Reaper._socket.settimeout(1)
                container.Reaper._socket.connect(
                    (container_host, container_port))
                last_connection_exception = None
                break
            except (ConnectionRefusedError, OSError) as e:
                if container.Reaper._socket is not None:
                    with contextlib.suppress(Exception):
                        container.Reaper._socket.close()
                    container.Reaper._socket = None
                last_connection_exception = e

                time.sleep(0.5)

        if last_connection_exception:
            raise last_connection_exception

        if container.Reaper._socket is None:
            raise RuntimeError('Could not connect to Reaper socket')

        container.Reaper._socket.send(
            f'label={labels.LABEL_SESSION_ID}={labels.SESSION_ID}\r\n'.encode())
        container.Reaper._instance = container.Reaper()

        return container.Reaper._instance

    setattr(
        container.Reaper,
        '_create_instance',
        classmethod(new_create_instance),
    )
    # pylint: enable=protected-access


class ReaperFixture(network.NetworkFixture):
    """
    Fixture to create a reaper container that is responsible for cleaning up Docker resources
    even if the test terminates unexpectedly.
    """

    reaper: network.NetworkAwareContainer

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        cls.reaper = network.NetworkAwareContainer(
            config.testcontainers_config.ryuk_image
        )

        cls.reaper.with_name(REAPER_NAME) \
            .with_network(cls.network) \
            .with_network_aliases('ryuk') \
            .with_exposed_ports(REAPER_PORT) \
            .with_volume_mapping(config.testcontainers_config.ryuk_docker_socket,
                                 '/var/run/docker.sock', 'rw') \
            .with_kwargs(privileged=config.testcontainers_config.ryuk_privileged,
                         auto_remove=True) \
            .with_env('RYUK_RECONNECTION_TIMEOUT',
                      config.testcontainers_config.ryuk_reconnection_timeout)

        patch_reaper_create_instance(cls.reaper)

    @classmethod
    def tearDownClass(cls):
        try:
            # pylint: disable=protected-access
            if cls.reaper._container:
                try:
                    cls.reaper._container.reload()
                    if cls.reaper._container.status == 'running':
                        cls.reaper._container.stop()
                except Exception:  # pylint: disable=broad-except
                    # Container may have already been removed (e.g., due to auto_remove=True)
                    logger.debug('Reaper container already removed or not found')
            # pylint: enable=protected-access
        finally:
            super().tearDownClass()
