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
    configmap_loader,
    objects as config_objects,
)
from src.service.core.tests import fixture
from src.tests.common import runner
from src.utils import auth, configmap_state, connectors


def _service_auth_config() -> Dict[str, Any]:
    service_auth = auth.AuthenticationConfig.generate_default()
    data = service_auth.model_dump(mode='json')
    for key_name, key_pair in service_auth.keys.items():
        data['keys'][key_name]['private_key'] = (
            key_pair.private_key.get_secret_value())
    return data


def _with_service_auth(config: Dict[str, Any]) -> Dict[str, Any]:
    complete_config: Dict[str, Any] = {
        'service': {},
        'workflow': {},
        'pools': {},
        'pod_templates': {},
        'resource_validations': {},
        'backends': {},
        'backend_tests': {},
        'group_templates': {},
        'roles': {
            'osmo-default': {
                'description': 'Default test role',
                'policies': [{
                    'effect': 'Allow',
                    'actions': ['system:Health'],
                    'resources': ['*'],
                }],
                'external_roles': [],
            },
        },
    }
    complete_config.update(config)
    config = complete_config
    service = dict(config.get('service', {}))
    service['service_auth'] = _service_auth_config()
    config['service'] = service
    return config


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
                'labels_config': {
                    'policy': [{
                        'key': 'project',
                        'allow_list': ['audio'],
                        'enforcement': 'warn',
                    }],
                },
            },
        })

        workflow_config = postgres.get_workflow_configs()
        self.assertEqual(workflow_config.max_num_tasks, 999)
        label_policy = workflow_config.labels_config.policy[0]
        self.assertEqual(label_policy.key, 'project')
        self.assertEqual(label_policy.allow_list, ['audio'])
        self.assertEqual(
            label_policy.enforcement,
            connectors.LabelEnforcement.WARN,
        )

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

        result: Any = connectors.ResourceValidation.fetch_from_db(
            postgres, 'cpu_check')
        self.assertEqual(len(result), 1)
        # In ConfigMap mode, snapshot returns raw dicts
        self.assertEqual(result[0]['resource'], 'cpu')

    def test_group_template_from_snapshot(self):
        """GroupTemplate.fetch_from_db reads from snapshot."""
        postgres = self._get_postgres()
        self._activate_configmap_mode({
            'group_templates': {
                'test_group': {'topology': 'rack'},
            },
        })

        result = connectors.GroupTemplate.fetch_from_db(postgres, 'test_group')
        self.assertEqual(result['topology'], 'rack')

    def test_group_template_list_from_snapshot(self):
        """GroupTemplate.list_from_db returns all items from snapshot."""
        postgres = self._get_postgres()
        self._activate_configmap_mode({
            'group_templates': {
                'grp_a': {'topology': 'rack'},
                'grp_b': {'topology': 'zone'},
            },
        })

        result = connectors.GroupTemplate.list_from_db(postgres)
        self.assertEqual(set(result.keys()), {'grp_a', 'grp_b'})

    def test_roles_are_read_from_configmap_without_db_projection(self):
        postgres = self._get_postgres()
        self._activate_configmap_mode({
            'roles': {
                'must-not-be-read': {
                    'description': 'ConfigMap-owned role',
                    'policies': [],
                },
            },
        })

        roles = connectors.Role.list_from_db(postgres)
        self.assertEqual([item.name for item in roles], ['must-not-be-read'])
        db_rows = postgres.execute_fetch_command(
            'SELECT name FROM roles WHERE name = %s;',
            ('must-not-be-read',), True)
        self.assertEqual(db_rows, [])

    def test_backend_list_from_snapshot(self):
        """Backend.list_from_db returns backends from snapshot."""
        postgres = self._get_postgres()
        self._activate_configmap_mode({
            'backends': {
                'test-be': {
                    'description': 'Test backend',
                    'scheduler_settings': {
                        'scheduler_type': 'kai',
                        'scheduler_name': 'kai-scheduler',
                        'scheduler_timeout': 30,
                    },
                },
            },
        })

        result = connectors.Backend.list_from_db(postgres)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, 'test-be')
        self.assertEqual(
            result[0].scheduler_settings.scheduler_type.value, 'kai')

    def test_backend_names_from_snapshot(self):
        """Backend.list_names_from_db returns names from snapshot."""
        postgres = self._get_postgres()
        self._activate_configmap_mode({
            'backends': {
                'be-a': {'description': 'A'},
                'be-b': {'description': 'B'},
            },
        })

        result = connectors.Backend.list_names_from_db(postgres)
        self.assertEqual(sorted(result), ['be-a', 'be-b'])

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

    def test_no_internal_user_bypasses_configmap_ownership(self):
        self._activate_configmap_mode({})
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            config_service.put_pod_templates(
                request=config_objects.PutPodTemplatesRequest(
                    configs={'test': {'spec': {}}},
                    description='test',
                ),
                username='configmap-sync',
            )
        self.assertEqual(context.exception.status_code, 409)

    # -------------------------------------------------------------------
    # ConfigMapWatcher loads configs into snapshot
    # -------------------------------------------------------------------

    def test_watcher_load_populates_snapshot(self):
        """ConfigMapWatcher._load_and_apply sets the snapshot."""
        config = {
            'pod_templates': {
                'watcher_tmpl': {'spec': {'test': True}},
            },
        }
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.yaml', delete=False) as temp_file:
            yaml.dump(_with_service_auth(config), temp_file)
        try:
            watcher = configmap_loader.ConfigMapWatcher(
                temp_file.name, self._get_postgres())
            result = watcher._load_and_apply()
            self.assertTrue(result)

            snapshot = configmap_state.get_snapshot()
            assert snapshot is not None
            self.assertIn('watcher_tmpl',
                          snapshot['pod_templates'])
        finally:
            os.unlink(temp_file.name)

    def test_watcher_resolves_pool_parsed_fields(self):
        """ConfigMapWatcher resolves parsed_pod_template from references."""
        config = {
            'pod_templates': {
                'user_tmpl': {
                    'spec': {
                        'containers': [
                            {'name': 'user', 'image': 'test:latest'}
                        ],
                    },
                },
                'gpu_override': {
                    'spec': {
                        'nodeSelector': {'gpu': 'a100'},
                    },
                },
            },
            'resource_validations': {
                'cpu_check': [
                    {'operator': 'LE',
                     'left_operand': '{{USER_CPU}}',
                     'right_operand': '{{K8_CPU}}',
                     'assert_message': 'Requested CPU exceeds capacity'},
                ],
            },
            'backends': {
                'default': {'k8s_namespace': 'default'},
            },
            'pools': {
                'test-pool': {
                    'backend': 'default',
                    'common_pod_template': ['user_tmpl'],
                    'common_resource_validations': ['cpu_check'],
                    'common_group_templates': [],
                    'platforms': {
                        'gpu-a100': {
                            'override_pod_template': ['gpu_override'],
                            'resource_validations': [],
                        },
                    },
                },
            },
        }
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.yaml', delete=False) as temp_file:
            yaml.dump(_with_service_auth(config), temp_file)
        try:
            watcher = configmap_loader.ConfigMapWatcher(
                temp_file.name, self._get_postgres())
            result = watcher._load_and_apply()
            self.assertTrue(result)

            snapshot = configmap_state.get_snapshot()
            assert snapshot is not None
            platform = snapshot['pools']['test-pool']['platforms']['gpu-a100']

            # Should have resolved pod template with both common + override
            self.assertIn('spec', platform['parsed_pod_template'])
            self.assertEqual(
                platform['parsed_pod_template']['spec']['nodeSelector'],
                {'gpu': 'a100'})
            containers = platform['parsed_pod_template']['spec']['containers']
            self.assertEqual(containers[0]['name'], 'user')

            # Should have resolved resource validations
            self.assertEqual(
                len(platform['parsed_resource_validations']), 1)
            self.assertEqual(
                platform['parsed_resource_validations'][0]['operator'], 'LE')

            # Should have derived labels from nodeSelector
            self.assertEqual(
                platform.get('labels'), {'gpu': 'a100'})
        finally:
            os.unlink(temp_file.name)


if __name__ == '__main__':
    runner.run_test()
