"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
from unittest import mock

from src.utils import connectors


def _resource_row(backend: str) -> dict:
    return {
        'name': 'ovx001',
        'backend': backend,
        'available': True,
        'taints': [],
        'label_fields': '',
        'allocatable_fields': '"cpu"=>"8"',
        'usage_fields': '"cpu"=>"1"',
        'non_workflow_usage_fields': '"cpu"=>"0"',
        'pool_platform_labels': ['shared-pool/dgx'],
        'resource_type': 'RESERVED',
    }


def _pool_config(backend: str) -> connectors.VerbosePoolConfig:
    platform = connectors.Platform(
        host_network_allowed=backend == 'backend-b',
        default_mounts=[f'/{backend}'],
    )
    pool = connectors.Pool(
        name='shared-pool',
        backend=backend,
        platforms={'dgx': platform},
    )
    return connectors.VerbosePoolConfig(pools={'shared-pool': pool})


class TestBackendResource(unittest.TestCase):
    def test_list_from_db_hydrates_pool_config_per_backend(self):
        postgres = mock.Mock(spec=connectors.PostgresConnector)
        postgres.execute_fetch_command.return_value = [
            _resource_row('backend-a'),
            _resource_row('backend-b'),
        ]

        with mock.patch.object(
                connectors.PostgresConnector, 'get_instance', return_value=postgres), \
             mock.patch(
                'src.utils.connectors.postgres.fetch_verbose_pool_config',
                side_effect=lambda _postgres, backend: _pool_config(backend)) as fetch_config:
            resources = connectors.BackendResource.list_from_db()

        self.assertEqual(len(resources), 2)
        backend_a, backend_b = resources
        assert backend_a.config_fields is not None
        assert backend_b.config_fields is not None
        config_a = backend_a.config_fields['shared-pool']['dgx']
        config_b = backend_b.config_fields['shared-pool']['dgx']
        self.assertEqual(config_a.default_mounts, ['/backend-a'])
        self.assertFalse(config_a.host_network)
        self.assertEqual(config_b.default_mounts, ['/backend-b'])
        self.assertTrue(config_b.host_network)
        self.assertEqual(fetch_config.call_args_list, [
            mock.call(postgres, 'backend-a'),
            mock.call(postgres, 'backend-b'),
        ])


if __name__ == '__main__':
    unittest.main()
