"""Regression tests for ConfigMap-only pool configuration authority."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0

import datetime
import unittest
from unittest import mock

from src.utils import configmap_state, connectors


class PoolConfigAuthorityTest(unittest.TestCase):

    def setUp(self) -> None:
        self.snapshot = {
            'workflow': {},
            'pools': {
                'config-pool': {
                    'backend': 'config-backend',
                    'platforms': {},
                },
            },
        }

    def test_single_pool_and_names_do_not_acquire_postgres(self) -> None:
        with mock.patch.object(
                configmap_state, 'require_snapshot', return_value=self.snapshot), \
             mock.patch.object(
                connectors.PostgresConnector,
                'get_instance',
                side_effect=AssertionError('pool config must not acquire PostgreSQL')):
            pool = connectors.Pool.fetch_from_configmap('config-pool')
            names = connectors.Pool.get_all_configured_pool_names()

        self.assertEqual(pool.backend, 'config-backend')
        self.assertEqual(names, ['config-pool'])

    def test_runtime_status_cannot_inject_db_only_pool(self) -> None:
        postgres = mock.Mock(spec=connectors.PostgresConnector)
        postgres.execute_fetch_command.return_value = [{
            'name': 'db-only-pool',
            'last_heartbeat': None,
        }]

        with mock.patch.object(
                configmap_state, 'require_snapshot', return_value=self.snapshot):
            pools = connectors.fetch_minimal_pool_config(postgres).pools

        self.assertEqual(list(pools), ['config-pool'])
        command, parameters, _ = postgres.execute_fetch_command.call_args[0]
        self.assertIn('FROM backends', command)
        self.assertNotIn('FROM pools', command)
        self.assertEqual(parameters, (('config-backend',),))

    def test_single_pool_runtime_view_preserves_backend_heartbeat(self) -> None:
        heartbeat = datetime.datetime(2026, 9, 2)
        postgres = mock.Mock(spec=connectors.PostgresConnector)
        postgres.execute_fetch_command.return_value = [
            {
                'name': 'db-only-backend',
                'last_heartbeat': None,
            },
            {
                'name': 'config-backend',
                'last_heartbeat': heartbeat,
            },
        ]

        with mock.patch.object(
                configmap_state, 'require_snapshot', return_value=self.snapshot):
            pool = connectors.Pool.fetch_runtime_from_configmap(
                postgres, 'config-pool')

        self.assertEqual(pool.name, 'config-pool')
        self.assertEqual(pool.backend, 'config-backend')
        self.assertEqual(pool.last_heartbeat, heartbeat)
        command, parameters, _ = postgres.execute_fetch_command.call_args[0]
        self.assertIn('FROM backends', command)
        self.assertNotIn('FROM pools', command)
        self.assertEqual(parameters, ('config-backend',))

    def test_never_connected_configmap_backend_is_offline(self) -> None:
        postgres = mock.Mock(spec=connectors.PostgresConnector)
        postgres.execute_fetch_command.return_value = []
        snapshot: dict[str, object] = {
            'backends': {'config-backend': {}},
            'pools': {},
        }

        with mock.patch.object(
                configmap_state, 'require_snapshot', return_value=snapshot):
            backend = connectors.Backend.fetch_from_db(
                postgres, 'config-backend')

        self.assertFalse(backend.online)
        self.assertIsNone(backend.last_heartbeat)


if __name__ == '__main__':
    unittest.main()
