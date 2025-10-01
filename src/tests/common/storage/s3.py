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
import os

from testcontainers import localstack  # type: ignore
from testcontainers.core import labels  # type: ignore
from types_boto3_s3.client import S3Client  # type: ignore

from src.tests.common.core import network, utils

logger = logging.getLogger(__name__)

S3_IMAGE = f'{utils.DOCKER_HUB_REGISTRY}/localstack/localstack:s3-latest'
S3_NAME = f's3-{labels.SESSION_ID}'
S3_PORT = 4566
S3_REGION = 'us-east-1'
S3_ACCESS_KEY_ID = 'testcontainers-localstack'
S3_ACCESS_KEY = 'testcontainers-localstack'

S3_TEST_BUCKET_NAME = 'test-bucket'


class NetworkAwareLocalStackContainer(network.NetworkAwareContainer,
                                      localstack.LocalStackContainer):
    """
    A network aware testcontainer that runs the localstack image.
    """

    def start(self):
        return super(localstack.LocalStackContainer, self).start()


@dataclasses.dataclass
class S3StorageFixtureParams:
    image: str = S3_IMAGE
    edge_port: int = S3_PORT
    region_name: str | None = S3_REGION


class S3StorageFixture(network.NetworkFixture):
    """
    A fixture that manages a S3 storage testcontainer.
    """
    s3_params: S3StorageFixtureParams = S3StorageFixtureParams()
    s3_container: NetworkAwareLocalStackContainer
    s3_client: S3Client

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.s3_container = NetworkAwareLocalStackContainer(
            **dataclasses.asdict(cls.s3_params))
        cls.s3_container.with_name(S3_NAME)
        cls.s3_container.with_network(cls.network)
        cls.s3_container.with_network_aliases(S3_NAME)
        cls.s3_container.with_services('s3')

        logger.info('Waiting for S3 testcontainer to be ready ...')
        cls.s3_container.start()
        logger.info('S3 testcontainer is ready.')

        cls.s3_client = localstack.LocalStackContainer.get_client(
            cls.s3_container, name='s3')

        # register the S3 container for SSL Proxy
        cls.networked_containers.append(cls.s3_container)
        utils.patch_boto3_session_for_ssl_verification()

        # Set AWS endpoint URL for S3 to point to s3 testcontainer
        os.environ['AWS_ENDPOINT_URL_S3'] = cls.s3_container.get_url()

    @classmethod
    def tearDownClass(cls):
        logger.info('Tearing down S3 testcontainer.')
        try:
            cls.s3_container.get_wrapped_container().reload()
            if cls.s3_container.get_wrapped_container().status == 'running':
                cls.s3_container.stop()
            utils.restore_boto3_session()
            os.environ.pop('AWS_ENDPOINT_URL_S3')
        finally:
            super().tearDownClass()
