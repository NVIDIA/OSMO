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

import boto3
import requests
from testcontainers.core import (  # type: ignore
    labels,
    network as core_network,
    waiting_utils,
)
from types_boto3_s3.client import S3Client  # type: ignore

from src.tests.common.core import network, utils

logger = logging.getLogger(__name__)

SWIFT_NAME = f'swift-{labels.SESSION_ID}'
SWIFT_IMAGE = f'{utils.DOCKER_HUB_REGISTRY}/openstackswift/saio'
SWIFT_APP_PORT = 8080

# Following credentials grant full access to Swift and will be able to operate on any buckets
# regardless of tenant/project scope.
SWIFT_ACCESS_KEY_ID = 'test:tester'
SWIFT_ACCESS_KEY = 'testing'
SWIFT_REGION_NAME = 'us-east-1'

SWIFT_TEST_BUCKET_NAME = 'test-bucket'


class SwiftTestContainer(network.NetworkAwareContainer):
    """
    A network aware testcontainer that runs the openstackswift/saio image.
    """

    def __init__(self, test_network: core_network.Network):
        super().__init__(SWIFT_IMAGE)
        self.with_name(SWIFT_NAME)
        self.with_exposed_ports(SWIFT_APP_PORT)
        self.with_network(test_network)
        self.with_network_aliases(SWIFT_NAME)
        self.with_kwargs(
            mem_limit='512m',
            memswap_limit='512m'
        )

    @waiting_utils.wait_container_is_ready(
        requests.ConnectionError,
        requests.Timeout,
        requests.ReadTimeout,
    )
    def _wait_until_ready(self):
        """
        Block until the swift testcontainer is fully ready for API calls
        """
        host, port = None, None
        try:
            host = self.get_container_host_ip()
            port = self.get_exposed_port(SWIFT_APP_PORT)
        except Exception as e:  # pylint: disable=broad-except
            raise ConnectionError(
                'Container host and port not ready yet') from e

        # Attempt to make a request to confirm readiness
        url = f'http://{host}:{port}/info'
        response = requests.get(url, timeout=5, verify=False)
        if response.status_code != 200:
            raise ConnectionError(
                f'Unexpected status code: {response.status_code}')

    def start(self):
        super().start()
        self._wait_until_ready()


class SwiftStorageFixture(network.NetworkFixture):
    """
    A fixture that manages a Swift storage testcontainer.
    """
    swift_container: SwiftTestContainer
    swift_client: S3Client

    @staticmethod
    def get_http_boto3_client(swift_container: SwiftTestContainer) -> S3Client:
        """
        Provide a S3 client that directly operates against the swift testcontainer
        """
        host = swift_container.get_container_host_ip()
        port = swift_container.get_exposed_port(SWIFT_APP_PORT)

        return boto3.Session().client(
            's3',
            endpoint_url=f'http://{host}:{port}',
            aws_access_key_id=SWIFT_ACCESS_KEY_ID,
            aws_secret_access_key=SWIFT_ACCESS_KEY,
            region_name=SWIFT_REGION_NAME,
        )

    @classmethod
    @utils.retry(retries=3, delay=1)
    def _retriable_swift_startup(cls):
        """
        Swift testcontainer may sometimes hang during startup. We retry startup up to 3 times
        before giving up.
        """
        swift_container = SwiftTestContainer(cls.network)

        logger.info('Waiting for openstackswift/saio container to be ready ...')
        try:
            swift_container.start()
        except Exception as e:  # pylint: disable=broad-except
            logger.error(e)
            swift_container.stop()
            raise e

        logger.info('openstackswift/saio container is ready.')
        return swift_container

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.swift_container = cls._retriable_swift_startup()
        cls.swift_client = SwiftStorageFixture.get_http_boto3_client(
            cls.swift_container)

        # register the swift container for SSL Proxy
        cls.networked_containers.append(cls.swift_container)
        utils.patch_boto3_session_for_ssl_verification()

    @classmethod
    def tearDownClass(cls):
        logger.info('Tearing down Swift storage testcontainer.')
        try:
            cls.swift_container.get_wrapped_container().reload()
            if cls.swift_container.get_wrapped_container().status == 'running':
                cls.swift_container.stop()
            utils.restore_boto3_session()
        finally:
            super().tearDownClass()
