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

import dataclasses
import logging

import redis
from testcontainers import redis as testcontainer_redis  # type: ignore
from testcontainers.core import labels  # type: ignore

from src.tests.common.core import network, utils

logger = logging.getLogger(__name__)

REDIS_IMAGE = f'{utils.DOCKER_HUB_REGISTRY}/library/redis:7-alpine'
REDIS_NAME = f'redis-{labels.SESSION_ID}'
REDIS_PORT = 6379
REDIS_PASSWORD = 'testcontainers-redis'
REDIS_DB_NUMBER = 0


class NetworkAwareRedisContainer(network.NetworkAwareContainer,
                                 testcontainer_redis.RedisContainer):
    """
    A network aware testcontainer that runs the Redis image.
    """

    def start(self):
        return super(testcontainer_redis.RedisContainer, self).start()


@dataclasses.dataclass
class RedisStorageFixtureParams:
    image: str = REDIS_IMAGE
    port: int = REDIS_PORT
    password: str | None = REDIS_PASSWORD
    db_number: int = REDIS_DB_NUMBER


class RedisStorageFixture(network.NetworkFixture):
    """
    A fixture that manages a Redis storage testcontainer.
    """
    redis_params: RedisStorageFixtureParams = RedisStorageFixtureParams()
    redis_container: NetworkAwareRedisContainer
    redis_client: redis.Redis

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.redis_container = NetworkAwareRedisContainer(
            image=cls.redis_params.image,
            port=cls.redis_params.port,
            password=cls.redis_params.password
        )
        cls.redis_container.with_name(REDIS_NAME)
        cls.redis_container.with_exposed_ports(cls.redis_params.port)
        cls.redis_container.with_network(cls.network)
        cls.redis_container.with_network_aliases(REDIS_NAME)

        logger.info('Waiting for Redis testcontainer to be ready ...')
        cls.redis_container.start()
        logger.info('Redis testcontainer is ready.')

        # Create Redis client connection
        cls.redis_client = testcontainer_redis.RedisContainer.get_client(
            cls.redis_container)

        # register the Redis container for network management
        cls.networked_containers.append(cls.redis_container)

    @classmethod
    def tearDownClass(cls):
        logger.info('Tearing down Redis testcontainer.')
        try:
            if hasattr(cls, 'redis_client'):
                cls.redis_client.close()

            cls.redis_container.get_wrapped_container().reload()
            if cls.redis_container.get_wrapped_container().status == 'running':
                cls.redis_container.stop()
        finally:
            super().tearDownClass()
