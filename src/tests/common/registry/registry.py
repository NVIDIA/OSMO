# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

"""
Network aware Docker registry container for functional tests.
"""


import hashlib
import io
import json
import logging
import tarfile

import requests
from testcontainers import registry  # type: ignore
from testcontainers.core import labels  # type: ignore

from src.tests.common.core import network, utils

logger = logging.getLogger(__name__)

REGISTRY_NAME = f'registry-{labels.SESSION_ID}'
REGISTRY_IMAGE = f'{utils.DOCKER_HUB_REGISTRY}/registry'
REGISTRY_IMAGE_TAG = '3'
REGISTRY_PORT = 5000
REGISTRY_TIMEOUT = 5


class DockerRegistryContainer(network.NetworkAwareContainer,
                              registry.DockerRegistryContainer):
    """
    Network aware Docker registry container.
    """

    def start(self):
        return super(network.NetworkAwareContainer, self).start()

    def create_image(self, image_name: str, tag: str = 'latest'):
        """
        Create an empty image in the registry for testing purposes.

        Args:
            image_name: The name of the image to create
            tag: The tag of the image to create (default: "latest")
        """
        registry_url = f'http://{self.get_registry()}'

        # Create a minimal layer (empty tar)
        layer_data = io.BytesIO()
        with tarfile.open(fileobj=layer_data, mode='w') as _:
            pass
        layer_bytes = layer_data.getvalue()
        layer_digest = f'sha256:{hashlib.sha256(layer_bytes).hexdigest()}'

        # Create config
        config = {
            'architecture': 'amd64',
            'os': 'linux',
            'config': {
                'Labels': {'purpose': 'testing'}
            },
            'rootfs': {
                'type': 'layers',
                'diff_ids': [layer_digest]
            },
            # Add history entries for schema1 compatibility
            'history': [
                {
                    'created': '2025-03-09T00:00:00Z',
                    'created_by': '/bin/sh -c #(nop) LABEL purpose=testing',
                    'empty_layer': True
                },
            ],
        }
        config_bytes = json.dumps(config).encode()
        config_digest = f'sha256:{hashlib.sha256(config_bytes).hexdigest()}'

        # Push layer
        response = requests.post(f'{registry_url}/v2/{image_name}/blobs/uploads/',
                                 timeout=REGISTRY_TIMEOUT)
        upload_url = response.headers['Location']

        delimiter = '&' if '?' in upload_url else '?'
        response = requests.put(
            f'{upload_url}{delimiter}digest={layer_digest}',
            data=layer_bytes,
            headers={'Content-Type': 'application/octet-stream'},
            timeout=REGISTRY_TIMEOUT,
        )
        response.raise_for_status()

        # Push config
        response = requests.post(f'{registry_url}/v2/{image_name}/blobs/uploads/',
                                 timeout=REGISTRY_TIMEOUT)
        upload_url = response.headers['Location']

        delimiter = '&' if '?' in upload_url else '?'
        response = requests.put(
            f'{upload_url}{delimiter}digest={config_digest}',
            data=config_bytes,
            headers={'Content-Type': 'application/octet-stream'},
            timeout=REGISTRY_TIMEOUT,
        )
        response.raise_for_status()

        # Push manifest
        manifest = {
            'schemaVersion': 2,
            'mediaType': 'application/vnd.docker.distribution.manifest.v2+json',
            'config': {
                'mediaType': 'application/vnd.docker.container.image.v1+json',
                'size': len(config_bytes),
                'digest': config_digest,
            },
            'layers': [{
                'mediaType': 'application/vnd.docker.image.rootfs.diff.tar.gzip',
                'size': len(layer_bytes),
                'digest': layer_digest,
            }],
        }

        response = requests.put(
            f'{registry_url}/v2/{image_name}/manifests/{tag}',
            data=json.dumps(manifest),
            headers={
                'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json',
            },
            timeout=REGISTRY_TIMEOUT,
        )
        response.raise_for_status()


class DockerRegistryFixture(network.NetworkFixture):
    """
    Network aware Docker registry container.
    """

    registry_container: DockerRegistryContainer

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        cls.registry_container = DockerRegistryContainer(
            image=f'{REGISTRY_IMAGE}:{REGISTRY_IMAGE_TAG}',
            port=REGISTRY_PORT,
        )
        cls.registry_container.with_name(REGISTRY_NAME)
        cls.registry_container.with_network(cls.network)
        cls.registry_container.with_network_aliases(REGISTRY_NAME)
        cls.registry_container.with_exposed_ports(REGISTRY_PORT)
        cls.registry_container.with_kwargs(
            mem_limit='256m',
            memswap_limit='256m'
        )

        cls.registry_container.start()
        cls.networked_containers.append(cls.registry_container)

    @classmethod
    def tearDownClass(cls):
        try:
            cls.registry_container.stop()
        finally:
            super().tearDownClass()
