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
import typing_extensions
import unittest
from typing import List

from testcontainers.core import (  # type: ignore
    container,
    network as testcontainers_network,
)

from src.tests.common.core import backend, utils

logger = logging.getLogger(__name__)

ENABLE_ICC = 'com.docker.network.bridge.enable_icc'  # Inter-container communication
REAPER_PORT = 8080


class NetworkAwareContainer(container.DockerContainer):
    """
    Extends DockerContainer to be aware of its execution mode (i.e. Docker-in-Docker vs. Local
    host). This allows the container to be able to resolve its host IP and port accordingly.
    """

    def get_container_host_ip(self) -> str:
        """
        Handles both docker-in-docker and local host modes.
        """
        if utils.inside_docker_container():
            return self.get_docker_client().bridge_ip(self.get_wrapped_container().id)
        return utils.get_localhost()

    def get_exposed_port(self, port: int) -> int:
        if utils.inside_docker_container():
            return port
        return int(super().get_exposed_port(port))

    def get_backend(self) -> backend.Backend:
        container_backend = backend.Backend(
            name=self._name,
            alias=self._name,
            ports=list(self.ports.keys()),
        )
        if self._network:
            container_backend.network_name = self._network.name
        return container_backend

    def start(self) -> typing_extensions.Self:
        if not self._name:
            raise RuntimeError('A name must be provided for container')
        return super().start()


class NetworkFixture(unittest.TestCase):
    """
    Fixture to create a test network and reaper container.
    """

    network: testcontainers_network.Network
    networked_containers: List[NetworkAwareContainer] = []

    @staticmethod
    def _create_docker_network() -> testcontainers_network.Network:
        return testcontainers_network.Network(
            docker_network_kw={
                'driver': 'bridge',
                'attachable': True,
                'options': {ENABLE_ICC: 'true'}
            }
        ).create()

    @classmethod
    def _clean_up_docker_network(cls):
        logger.info('Tearing down Network (%s).', cls.network.name)

        # Detach all remaining containers from the network
        # pylint: disable=protected-access
        if cls.network._network:
            cls.network._network.reload()
            attached_containers = cls.network._network.attrs['Containers']
            for container_id, _ in attached_containers.items():
                cls.network._network.disconnect(container_id)
        # pylint: enable=protected-access

        cls.network.remove()

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        cls.network = NetworkFixture._create_docker_network()
        logger.info('Setting up Network (%s).', cls.network.name)

        try:
            # Check if test is currently running inside a docker container
            # If so, attach the current container to the network
            if utils.inside_docker_container():
                # pylint: disable=protected-access
                if cls.network._network:
                    attached_containers = cls.network._network.attrs['Containers']
                    if utils.get_container_id() not in attached_containers:
                        cls.network.connect(utils.get_container_id())
                # pylint: enable=protected-access

        except Exception as e:  # pylint: disable=broad-except
            cls._clean_up_docker_network()
            raise e

    @classmethod
    def tearDownClass(cls):
        try:
            cls._clean_up_docker_network()
        finally:
            cls.networked_containers.clear()
            super().tearDownClass()
