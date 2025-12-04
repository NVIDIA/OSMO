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
import unittest

from src.lib.utils import common


class TestCommon(unittest.TestCase):
    """
    Unit tests for the common module.
    """

    def test_convert_resource_value(self):
        self.assertEqual(common.convert_resource_value_str('10Gi', target='TiB'), 10.0 / 1024)
        self.assertEqual(common.convert_resource_value_str('1.5Ti', target='GiB'), 1.5 * 1024)
        self.assertEqual(common.convert_resource_value_str(
            '1.5Ti', target='MiB'), 1.5 * 1024 * 1024)
        self.assertEqual(common.convert_resource_value_str('1000', target='KiB'), 1000.0 / 1024)

    def test_docker_parse(self):
        """Data-driven tests for docker_parse function."""
        # (image, expected_host, expected_port, expected_name, expected_tag, expected_digest)
        test_cases = [
            # Official Docker Hub images
            ('ubuntu', common.DEFAULT_REGISTRY, 443, 'library/ubuntu', 'latest', None),
            ('ubuntu:22.04', common.DEFAULT_REGISTRY, 443, 'library/ubuntu', '22.04', None),
            ('alpine', common.DEFAULT_REGISTRY, 443, 'library/alpine', 'latest', None),

            # Docker Hub org/image (should NOT treat org as host)
            ('alpine/curl', common.DEFAULT_REGISTRY, 443, 'alpine/curl', 'latest', None),
            ('alpine/curl:latest', common.DEFAULT_REGISTRY, 443, 'alpine/curl', 'latest', None),
            ('alpine/git', common.DEFAULT_REGISTRY, 443, 'alpine/git', 'latest', None),
            ('nginx/nginx', common.DEFAULT_REGISTRY, 443, 'nginx/nginx', 'latest', None),
            ('company/team/project', common.DEFAULT_REGISTRY,
             443, 'company/team/project', 'latest', None),

            # localhost registry (special case)
            ('localhost/image', 'localhost', 443, 'image', 'latest', None),
            ('localhost/image:latest', 'localhost', 443, 'image', 'latest', None),
            ('localhost:5000/image', 'localhost', 5000, 'image', 'latest', None),
            ('localhost:5000/org/image:v1', 'localhost', 5000, 'org/image', 'v1', None),

            # Custom registries with dots
            ('gcr.io/project/image', 'gcr.io', 443, 'project/image', 'latest', None),
            ('gcr.io/image/sub:latest', 'gcr.io', 443, 'image/sub', 'latest', None),
            ('nvcr.io/nvidia/pytorch:23.10-py3', 'nvcr.io', 443,
             'nvidia/pytorch', '23.10-py3', None),
            ('registry.example.com/org/image', 'registry.example.com', 443,
             'org/image', 'latest', None),
            ('registry.example.com:5000/org/image:v1',
             'registry.example.com', 5000, 'org/image', 'v1', None),

            # IP-based registries
            ('192.168.1.100:5000/myimage', '192.168.1.100', 5000, 'myimage', 'latest', None),
            ('10.0.0.1:5000/org/image:v2', '10.0.0.1', 5000, 'org/image', 'v2', None),

            # Bare hostname with port (Docker-in-Docker, testcontainers, etc.)
            # Port presence disambiguates registry from org
            ('docker:5000/image', 'docker', 5000, 'image', 'latest', None),
            ('docker:32781/test_image', 'docker', 32781, 'test_image', 'latest', None),
            ('registry:5000/org/image:v1', 'registry', 5000, 'org/image', 'v1', None),
            ('myhost:8080/project/app:latest', 'myhost', 8080, 'project/app', 'latest', None),

            # Images with digest
            ('ubuntu@sha256:abc123def456', common.DEFAULT_REGISTRY,
             443, 'library/ubuntu', None, 'sha256:abc123def456'),
            ('ubuntu:22.04@sha256:abc123def456', common.DEFAULT_REGISTRY,
             443, 'library/ubuntu', '22.04', 'sha256:abc123def456'),

            # Edge cases
            ('ubuntu:v', common.DEFAULT_REGISTRY, 443, 'library/ubuntu', 'v', None),
        ]

        for image, exp_host, exp_port, exp_name, exp_tag, exp_digest in test_cases:
            with self.subTest(image=image):
                result = common.docker_parse(image)
                self.assertEqual(result.host, exp_host, f'host mismatch for {image}')
                self.assertEqual(result.port, exp_port, f'port mismatch for {image}')
                self.assertEqual(result.name, exp_name, f'name mismatch for {image}')
                self.assertEqual(result.tag, exp_tag, f'tag mismatch for {image}')
                self.assertEqual(result.digest, exp_digest, f'digest mismatch for {image}')


if __name__ == '__main__':
    unittest.main()
