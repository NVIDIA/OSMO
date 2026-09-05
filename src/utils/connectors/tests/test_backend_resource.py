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


def _resource_row(backend: str, pool: str) -> dict:
    return {
        'name': 'ovx001',
        'backend': backend,
        'available': True,
        'taints': [],
        'label_fields': '',
        'allocatable_fields': '"cpu"=>"8"',
        'usage_fields': '"cpu"=>"1"',
        'non_workflow_usage_fields': '"cpu"=>"0"',
        'pool_platform_labels': [f'{pool}/dgx'],
        'resource_type': 'RESERVED',
    }


def _pool_config(backend: str, pool_name: str) -> connectors.VerbosePoolConfig:
    platform = connectors.Platform(
        host_network_allowed=backend == 'backend-b',
        default_mounts=[f'/{backend}'],
    )
    pool = connectors.Pool(
        name=pool_name,
        backend=backend,
        platforms={'dgx': platform},
    )
    return connectors.VerbosePoolConfig(pools={pool_name: pool})


class TestBackendResource(unittest.TestCase):
    def test_list_from_db_hydrates_pool_config_per_backend(self):
        postgres = mock.Mock(spec=connectors.PostgresConnector)
        postgres.execute_fetch_command.return_value = [
            _resource_row('backend-a', 'pool-a'),
            _resource_row('backend-b', 'pool-b'),
        ]
        snapshot = {
            'backends': {'backend-a': {}, 'backend-b': {}},
            'pools': {
                'pool-a': {
                    'backend': 'backend-a',
                    'platforms': {'dgx': {}},
                },
                'pool-b': {
                    'backend': 'backend-b',
                    'platforms': {'dgx': {}},
                },
            },
        }

        with mock.patch.object(
                connectors.PostgresConnector, 'get_instance', return_value=postgres), \
             mock.patch(
                'src.utils.connectors.postgres.configmap_state.require_snapshot',
                return_value=snapshot), \
             mock.patch(
                'src.utils.connectors.postgres.fetch_verbose_pool_config',
                side_effect=lambda _postgres, backend: _pool_config(
                    backend, 'pool-a' if backend == 'backend-a' else 'pool-b'),
             ) as fetch_config:
            resources = connectors.BackendResource.list_from_db()

        self.assertEqual(len(resources), 2)
        backend_a, backend_b = resources
        assert backend_a.config_fields is not None
        assert backend_b.config_fields is not None
        config_a = backend_a.config_fields['pool-a']['dgx']
        config_b = backend_b.config_fields['pool-b']['dgx']
        self.assertEqual(config_a.default_mounts, ['/backend-a'])
        self.assertFalse(config_a.host_network)
        self.assertEqual(config_b.default_mounts, ['/backend-b'])
        self.assertTrue(config_b.host_network)
        self.assertEqual(fetch_config.call_args_list, [
            mock.call(postgres, 'backend-a'),
            mock.call(postgres, 'backend-b'),
        ])

    def test_list_from_db_joins_only_configmap_pool_platforms(self):
        postgres = mock.Mock(spec=connectors.PostgresConnector)
        postgres.execute_fetch_command.return_value = []
        snapshot = {
            'backends': {'backend-a': {}},
            'pools': {
                'allowed-pool': {
                    'backend': 'backend-a',
                    'platforms': {'gpu': {}},
                },
            },
        }

        with mock.patch.object(
                connectors.PostgresConnector, 'get_instance', return_value=postgres), \
             mock.patch(
                'src.utils.connectors.postgres.configmap_state.require_snapshot',
                return_value=snapshot):
            connectors.BackendResource.list_from_db(resource_name='ovx001')

        query, parameters, _ = postgres.execute_fetch_command.call_args.args
        self.assertIn('JOIN configured_pool_platforms', query)
        self.assertIn('r.backend IN %s', query)
        self.assertIn('r.name = %s', query)
        self.assertEqual(parameters, (
            'allowed-pool', 'gpu', 'backend-a', ('backend-a',), 'ovx001'))

    def test_list_from_db_rejects_db_only_requested_pool(self):
        postgres = mock.Mock(spec=connectors.PostgresConnector)
        snapshot = {
            'backends': {'backend-a': {}},
            'pools': {
                'allowed-pool': {
                    'backend': 'backend-a',
                    'platforms': {'gpu': {}},
                },
            },
        }

        with mock.patch.object(
                connectors.PostgresConnector, 'get_instance', return_value=postgres), \
             mock.patch(
                'src.utils.connectors.postgres.configmap_state.require_snapshot',
                return_value=snapshot):
            resources = connectors.BackendResource.list_from_db(
                pools=['db-only-pool'])

        self.assertEqual(resources, [])
        postgres.execute_fetch_command.assert_not_called()

    def test_list_from_db_preserves_explicit_empty_pool_filter(self):
        postgres = mock.Mock(spec=connectors.PostgresConnector)
        snapshot = {
            'backends': {'backend-a': {}},
            'pools': {
                'allowed-pool': {
                    'backend': 'backend-a',
                    'platforms': {'gpu': {}},
                },
            },
        }

        with mock.patch.object(
                connectors.PostgresConnector, 'get_instance', return_value=postgres), \
             mock.patch(
                'src.utils.connectors.postgres.configmap_state.require_snapshot',
                return_value=snapshot):
            resources = connectors.BackendResource.list_from_db(pools=[])

        self.assertEqual(resources, [])
        postgres.execute_fetch_command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
