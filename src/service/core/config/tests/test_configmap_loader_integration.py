"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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

# pylint: disable=protected-access

import os
import tempfile
from typing import Any, Dict

import yaml

from src.lib.utils import osmo_errors
from src.service.core.config import (
    config_service,
    configmap_guard,
    configmap_loader,
    objects as config_objects,
)
from src.service.core.tests import fixture
from src.tests.common import runner
from src.utils import configmap_state, connectors


class ConfigMapModeReadIntegrationTest(fixture.ServiceTestFixture):
    """Integration tests: configs served from in-memory snapshot with real DB.

    Verifies that when ConfigMap mode is active, model methods read from
    the in-memory snapshot while backend runtime data still comes from DB.
    """

    def setUp(self):
        super().setUp()
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)

    def tearDown(self):
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)
        super().tearDown()

    def _get_postgres(self) -> connectors.PostgresConnector:
        return connectors.PostgresConnector.get_instance()

    def _activate_configmap_mode(self, managed_configs: Dict[str, Any]):
        """Set up ConfigMap mode with the given config snapshot."""
        configmap_state.set_parsed_configs(managed_configs)
        configmap_state.set_configmap_mode(True)

    # -------------------------------------------------------------------
    # Singleton configs served from snapshot
    # -------------------------------------------------------------------

    def test_workflow_config_from_snapshot(self):
        """get_workflow_configs() returns data from snapshot, not DB."""
        postgres = self._get_postgres()
        self._activate_configmap_mode({
            'workflow': {
                'max_num_tasks': 999,
                'max_exec_timeout': '30d',
                'default_exec_timeout': '7d',
            },
        })

        workflow_config = postgres.get_workflow_configs()
        self.assertEqual(workflow_config.max_num_tasks, 999)

    # -------------------------------------------------------------------
    # Named configs served from snapshot
    # -------------------------------------------------------------------

    def test_pod_template_from_snapshot(self):
        """PodTemplate.fetch_from_db reads from snapshot."""
        postgres = self._get_postgres()
        self._activate_configmap_mode({
            'pod_templates': {
                'test_tmpl': {
                    'spec': {
                        'containers': [
                            {'name': 'ctrl', 'image': 'test:latest'}
                        ],
                    },
                },
            },
        })

        result = connectors.PodTemplate.fetch_from_db(postgres, 'test_tmpl')
        self.assertEqual(result['spec']['containers'][0]['name'], 'ctrl')

    def test_pod_template_not_found_in_snapshot(self):
        """PodTemplate.fetch_from_db raises for missing name."""
        postgres = self._get_postgres()
        self._activate_configmap_mode({
            'pod_templates': {},
        })

        with self.assertRaises(osmo_errors.OSMOUserError):
            connectors.PodTemplate.fetch_from_db(postgres, 'nonexistent')

    def test_pod_template_list_from_snapshot(self):
        """PodTemplate.list_from_db returns all items from snapshot."""
        postgres = self._get_postgres()
        self._activate_configmap_mode({
            'pod_templates': {
                'tmpl_a': {'spec': {}},
                'tmpl_b': {'spec': {}},
            },
        })

        result = connectors.PodTemplate.list_from_db(postgres)
        self.assertEqual(set(result.keys()), {'tmpl_a', 'tmpl_b'})

    def test_resource_validation_from_snapshot(self):
        """ResourceValidation.fetch_from_db reads from snapshot."""
        postgres = self._get_postgres()
        self._activate_configmap_mode({
            'resource_validations': {
                'cpu_check': [
                    {'resource': 'cpu', 'operator': 'LE',
                     'threshold': 'node_cpu'},
                ],
            },
        })

        result = connectors.ResourceValidation.fetch_from_db(
            postgres, 'cpu_check')
        self.assertEqual(len(result), 1)
        # In ConfigMap mode, returns raw dicts from snapshot
        self.assertEqual(result[0]['resource'], 'cpu')

    # -------------------------------------------------------------------
    # 409 rejection for all write endpoints
    # -------------------------------------------------------------------

    def test_409_on_patch_service_config(self):
        """patch_service_configs returns 409 in ConfigMap mode."""
        self._activate_configmap_mode({})
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            config_service.patch_service_configs(
                request=config_objects.PatchConfigRequest(
                    configs_dict={'max_pod_restart_limit': '1h'},
                ),
                username='test@nvidia.com',
            )
        self.assertEqual(ctx.exception.status_code, 409)

    def test_409_on_put_pod_templates(self):
        """put_pod_templates returns 409 in ConfigMap mode."""
        self._activate_configmap_mode({})
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            config_service.put_pod_templates(
                request=config_objects.PutPodTemplatesRequest(
                    configs={'test': {'spec': {}}},
                    description='test',
                ),
                username='test@nvidia.com',
            )
        self.assertEqual(ctx.exception.status_code, 409)

    def test_409_bypass_for_configmap_sync(self):
        """configmap-sync user can write even in ConfigMap mode."""
        self._activate_configmap_mode({})
        # Should not raise for configmap-sync username
        # (will likely fail for other reasons, but not 409)
        try:
            config_service.put_pod_templates(
                request=config_objects.PutPodTemplatesRequest(
                    configs={'test': {'spec': {}}},
                    description='test',
                ),
                username=configmap_guard.CONFIGMAP_SYNC_USERNAME,
            )
        except osmo_errors.OSMOUserError as error:
            # Any error other than 409 is acceptable
            self.assertNotEqual(error.status_code, 409)
        except (osmo_errors.OSMOUserError, osmo_errors.OSMOBackendError,
                osmo_errors.OSMOServerError):
            pass  # Non-409 errors are fine

    # -------------------------------------------------------------------
    # ConfigMapWatcher loads configs into snapshot
    # -------------------------------------------------------------------

    def test_watcher_load_populates_snapshot(self):
        """ConfigMapWatcher._load_and_apply sets the snapshot."""
        postgres = self._get_postgres()
        config = {
            'pod_templates': {
                'watcher_tmpl': {'spec': {'test': True}},
            },
        }
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.yaml', delete=False) as temp_file:
            yaml.dump(config, temp_file)
        try:
            watcher = configmap_loader.ConfigMapWatcher(
                temp_file.name, postgres)
            result = watcher._load_and_apply()
            self.assertTrue(result)

            snapshot = configmap_state.get_snapshot()
            assert snapshot is not None
            self.assertIn('watcher_tmpl',
                          snapshot['pod_templates'])
        finally:
            os.unlink(temp_file.name)


if __name__ == '__main__':
    runner.run_test()
