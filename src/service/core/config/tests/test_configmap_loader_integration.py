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

import os
import tempfile
from typing import Any, Dict

import yaml

from src.service.core.config import config_service, configmap_loader
from src.service.core.config import helpers as config_helpers, objects as config_objects
from src.service.core.config.configmap_loader import CONFIGMAP_SYNC_USERNAME
from src.service.core.tests import fixture
from src.tests.common import runner
from src.utils import connectors


class ConfigMapLoaderIntegrationTestCase(fixture.ServiceTestFixture):
    """Integration tests for configmap_loader with real database."""

    def _get_postgres(self) -> connectors.PostgresConnector:
        return connectors.PostgresConnector.get_instance()

    def _write_config_file(self, config: Dict[str, Any]) -> str:
        """Write a config dict to a temp YAML file and return its path."""
        temp_file = tempfile.NamedTemporaryFile(
            mode='w', suffix='.yaml', delete=False)
        yaml.dump(config, temp_file)
        temp_file.close()
        return temp_file.name

    def _cleanup_file(self, path: str) -> None:
        if os.path.exists(path):
            os.unlink(path)

    # -------------------------------------------------------------------
    # Singleton configs: SERVICE
    # -------------------------------------------------------------------

    def test_apply_service_config_seed_new(self):
        """Service config applied in configmap mode (overwrites fixture defaults).

        Note: seed mode cannot be tested via ServiceTestFixture because
        configure_app() pre-seeds service configs, causing
        _singleton_config_exists to return True. We use configmap mode
        to verify the loader writes service config correctly.
        """
        postgres = self._get_postgres()
        config_data = {
            'managed_configs': {
                'service': {
                    'managed_by': 'configmap',
                    'config': {
                        'cli_config': {
                            'latest_version': 'seed-version',
                            'min_supported_version': '1.0.0',
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            service_config = postgres.get_configs(connectors.ConfigType.SERVICE)
            config_dict = service_config.dict(by_alias=True)
            self.assertEqual(
                config_dict['cli_config']['latest_version'], 'seed-version')
        finally:
            self._cleanup_file(config_path)

    def test_apply_service_config_seed_existing(self):
        """Service config skipped when DB already has explicit config (seed mode)."""
        postgres = self._get_postgres()

        # First, apply a config via the normal API
        config_service.patch_service_configs(
            request=config_objects.PatchConfigRequest(
                configs_dict={
                    'cli_config': {
                        'latest_version': 'existing-version',
                        'min_supported_version': '1.0.0',
                    },
                },
                description='Pre-existing config',
            ),
            username='test@nvidia.com',
        )

        # Now try seed mode - should be skipped
        config_data = {
            'managed_configs': {
                'service': {
                    'managed_by': 'seed',
                    'config': {
                        'cli_config': {
                            'latest_version': 'seed-should-not-apply',
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            service_config = postgres.get_configs(connectors.ConfigType.SERVICE)
            config_dict = service_config.dict(by_alias=True)
            # Original value should be preserved
            self.assertEqual(
                config_dict['cli_config']['latest_version'], 'existing-version')
        finally:
            self._cleanup_file(config_path)

    def test_apply_service_config_configmap_overwrite(self):
        """Service config always applied in configmap mode, overwriting existing."""
        postgres = self._get_postgres()

        # First, apply a config via the normal API
        config_service.patch_service_configs(
            request=config_objects.PatchConfigRequest(
                configs_dict={
                    'cli_config': {
                        'latest_version': 'original-version',
                        'min_supported_version': '1.0.0',
                    },
                },
                description='Original config',
            ),
            username='test@nvidia.com',
        )

        # Now apply via configmap mode - should overwrite
        config_data = {
            'managed_configs': {
                'service': {
                    'managed_by': 'configmap',
                    'config': {
                        'cli_config': {
                            'latest_version': 'configmap-version',
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            service_config = postgres.get_configs(connectors.ConfigType.SERVICE)
            config_dict = service_config.dict(by_alias=True)
            self.assertEqual(
                config_dict['cli_config']['latest_version'], 'configmap-version')
        finally:
            self._cleanup_file(config_path)

    # -------------------------------------------------------------------
    # Singleton configs: WORKFLOW
    # -------------------------------------------------------------------

    def test_apply_workflow_config_configmap(self):
        """Workflow config applied in configmap mode."""
        postgres = self._get_postgres()
        config_data = {
            'managed_configs': {
                'workflow': {
                    'managed_by': 'configmap',
                    'config': {
                        'max_num_tasks': 200,
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            workflow_config = postgres.get_configs(connectors.ConfigType.WORKFLOW)
            config_dict = workflow_config.dict(by_alias=True)
            self.assertEqual(config_dict['max_num_tasks'], 200)
        finally:
            self._cleanup_file(config_path)

    # -------------------------------------------------------------------
    # Singleton configs: DATASET with secrets
    # -------------------------------------------------------------------

    def test_apply_dataset_config_with_secrets(self):
        """Secret file resolution and credentials stored in dataset config.

        Note: Uses configmap mode because configure_app() pre-seeds dataset
        config, making seed mode skip via _singleton_config_exists.
        """
        postgres = self._get_postgres()

        # Create a secret file
        secret_data = {
            'access_key_id': 'AKIAIOSFODNN7EXAMPLE',
            'access_key': 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        }
        secret_file = tempfile.NamedTemporaryFile(
            mode='w', suffix='.yaml', delete=False)
        yaml.dump(secret_data, secret_file)
        secret_file.close()

        config_data = {
            'managed_configs': {
                'dataset': {
                    'managed_by': 'configmap',
                    'config': {
                        'default_bucket': 'test-integration-bucket',
                        'buckets': {
                            'test-integration-bucket': {
                                'dataset_path': 's3://test-integration-bucket',
                                'region': 'us-west-2',
                                'mode': 'read-write',
                                'default_credential': {
                                    'secret_file': secret_file.name,
                                },
                            },
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            dataset_config = postgres.get_configs(connectors.ConfigType.DATASET)
            config_dict = dataset_config.dict(by_alias=True)
            self.assertEqual(config_dict['default_bucket'], 'test-integration-bucket')
            bucket = config_dict['buckets']['test-integration-bucket']
            self.assertEqual(bucket['region'], 'us-west-2')
            # Credentials should be stored (encrypted in DB, decrypted on read)
            self.assertIn('default_credential', bucket)
            credential = bucket['default_credential']
            self.assertEqual(credential['access_key_id'], 'AKIAIOSFODNN7EXAMPLE')
        finally:
            self._cleanup_file(config_path)
            self._cleanup_file(secret_file.name)

    # -------------------------------------------------------------------
    # Named configs: POD_TEMPLATES
    # -------------------------------------------------------------------

    def test_apply_pod_templates_seed_new(self):
        """Pod templates created when they don't exist (seed mode)."""
        postgres = self._get_postgres()
        pod_template_data = {
            'spec': {
                'containers': [{
                    'name': 'test-container',
                    'resources': {
                        'limits': {'cpu': '2'},
                        'requests': {'cpu': '1'},
                    },
                }],
            },
        }
        config_data = {
            'managed_configs': {
                'pod_templates': {
                    'managed_by': 'seed',
                    'items': {
                        'test_seed_template': pod_template_data,
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            # fetch_from_db returns the pod_template dict directly, not a PodTemplate instance
            template = connectors.PodTemplate.fetch_from_db(postgres, 'test_seed_template')
            self.assertEqual(
                template['spec']['containers'][0]['name'], 'test-container')
        finally:
            self._cleanup_file(config_path)

    def test_apply_pod_templates_configmap(self):
        """Pod templates applied in configmap mode (overwrites existing)."""
        postgres = self._get_postgres()

        # Create an existing template
        original_data = {
            'spec': {
                'containers': [{
                    'name': 'original-container',
                    'resources': {'limits': {'cpu': '1'}},
                }],
            },
        }
        config_service.put_pod_templates(
            request=config_objects.PutPodTemplatesRequest(
                configs={'test_configmap_template': original_data},
                description='Original template',
            ),
            username='test@nvidia.com',
        )

        # Now overwrite via configmap
        updated_data = {
            'spec': {
                'containers': [{
                    'name': 'updated-container',
                    'resources': {'limits': {'cpu': '4'}},
                }],
            },
        }
        config_data = {
            'managed_configs': {
                'pod_templates': {
                    'managed_by': 'configmap',
                    'items': {
                        'test_configmap_template': updated_data,
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            # fetch_from_db returns the pod_template dict directly, not a PodTemplate instance
            template = connectors.PodTemplate.fetch_from_db(
                postgres, 'test_configmap_template')
            self.assertEqual(
                template['spec']['containers'][0]['name'],
                'updated-container')
        finally:
            self._cleanup_file(config_path)

    # -------------------------------------------------------------------
    # Named configs: BACKENDS
    # -------------------------------------------------------------------

    def test_apply_backends_create_new(self):
        """New backend inserted when it doesn't exist."""
        postgres = self._get_postgres()
        config_data = {
            'managed_configs': {
                'backends': {
                    'managed_by': 'seed',
                    'items': {
                        'test-new-backend': {
                            'description': 'A new test backend',
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            backend = connectors.Backend.fetch_from_db(postgres, 'test-new-backend')
            self.assertEqual(backend.description, 'A new test backend')
        finally:
            self._cleanup_file(config_path)

    def test_apply_backends_update_existing(self):
        """Existing backend updated in configmap mode."""
        postgres = self._get_postgres()

        # Create a backend first
        self.create_test_backend(database=postgres, backend_name='test-update-backend')

        # Update via configmap
        config_data = {
            'managed_configs': {
                'backends': {
                    'managed_by': 'configmap',
                    'items': {
                        'test-update-backend': {
                            'description': 'Updated description',
                            'dashboard_url': 'https://grafana.example.com',
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            backend = connectors.Backend.fetch_from_db(postgres, 'test-update-backend')
            self.assertEqual(backend.description, 'Updated description')
            self.assertEqual(backend.dashboard_url, 'https://grafana.example.com')
        finally:
            self._cleanup_file(config_path)

    def test_apply_backends_seed_skip(self):
        """Existing backend skipped in seed mode."""
        postgres = self._get_postgres()

        # Create a backend first
        self.create_test_backend(database=postgres, backend_name='test-seed-skip-backend')

        original_backend = connectors.Backend.fetch_from_db(
            postgres, 'test-seed-skip-backend')
        original_description = original_backend.description

        # Try seed mode - should be skipped
        config_data = {
            'managed_configs': {
                'backends': {
                    'managed_by': 'seed',
                    'items': {
                        'test-seed-skip-backend': {
                            'description': 'Should not apply',
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            backend = connectors.Backend.fetch_from_db(postgres, 'test-seed-skip-backend')
            self.assertEqual(backend.description, original_description)
        finally:
            self._cleanup_file(config_path)

    def test_apply_backends_per_item_error_isolation(self):
        """One backend failing doesn't block others."""
        postgres = self._get_postgres()
        config_data = {
            'managed_configs': {
                'backends': {
                    'managed_by': 'configmap',
                    'items': {
                        'good-backend-1': {
                            'description': 'This should succeed',
                        },
                        'bad-backend': {
                            'description': 'This will cause an error',
                            # scheduler_settings with invalid type to cause error
                            'scheduler_settings': {
                                'scheduler_type': 'completely_invalid_type',
                            },
                        },
                        'good-backend-2': {
                            'description': 'This should also succeed',
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            # Good backends should still be created
            backend1 = connectors.Backend.fetch_from_db(postgres, 'good-backend-1')
            self.assertEqual(backend1.description, 'This should succeed')
            backend2 = connectors.Backend.fetch_from_db(postgres, 'good-backend-2')
            self.assertEqual(backend2.description, 'This should also succeed')
        finally:
            self._cleanup_file(config_path)

    # -------------------------------------------------------------------
    # Named configs: POOLS with dependencies
    # -------------------------------------------------------------------

    def test_apply_pools_with_dependencies(self):
        """Pools applied after backends/templates exist (dependency ordering)."""
        postgres = self._get_postgres()

        # Create backend (pool depends on backend)
        self.create_test_backend(database=postgres, backend_name='pool-dep-backend')

        config_data = {
            'managed_configs': {
                'pools': {
                    'managed_by': 'configmap',
                    'items': {
                        'test-dep-pool': {
                            'description': 'Pool with backend dependency',
                            'default_platform': 'test_platform',
                            'platforms': {
                                'test_platform': {},
                            },
                            'backend': 'pool-dep-backend',
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            pool = connectors.Pool.fetch_from_db(postgres, 'test-dep-pool')
            self.assertEqual(pool.backend, 'pool-dep-backend')
            self.assertEqual(pool.description, 'Pool with backend dependency')
        finally:
            self._cleanup_file(config_path)

    # -------------------------------------------------------------------
    # Named configs: ROLES
    # -------------------------------------------------------------------

    def test_apply_roles_configmap(self):
        """Roles created in configmap mode."""
        postgres = self._get_postgres()
        config_data = {
            'managed_configs': {
                'roles': {
                    'managed_by': 'configmap',
                    'items': {
                        'test-admin-role': {
                            'description': 'Test admin role',
                            'policies': [
                                {
                                    'actions': ['*:*'],
                                    'resources': ['*'],
                                },
                            ],
                            'immutable': True,
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            role = connectors.Role.fetch_from_db(postgres, 'test-admin-role')
            self.assertEqual(role.description, 'Test admin role')
            self.assertEqual(len(role.policies), 1)
        finally:
            self._cleanup_file(config_path)

    # -------------------------------------------------------------------
    # Named configs: RESOURCE_VALIDATIONS
    # -------------------------------------------------------------------

    def test_apply_resource_validations_seed(self):
        """Resource validations created in seed mode."""
        postgres = self._get_postgres()
        config_data = {
            'managed_configs': {
                'resource_validations': {
                    'managed_by': 'seed',
                    'items': {
                        'test_cpu_check': [
                            {
                                'operator': 'LE',
                                'left_operand': '{{USER_CPU}}',
                                'right_operand': '{{K8_CPU}}',
                                'assert_message': 'CPU too high',
                            },
                        ],
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)
            # fetch_from_db returns the resource_validations list directly
            validations = connectors.ResourceValidation.fetch_from_db(
                postgres, 'test_cpu_check')
            self.assertEqual(len(validations), 1)
            self.assertEqual(validations[0]['operator'], 'LE')  # type: ignore[index]
        finally:
            self._cleanup_file(config_path)

    # -------------------------------------------------------------------
    # End-to-end and error isolation
    # -------------------------------------------------------------------

    def test_full_config_load_end_to_end(self):
        """Complete YAML loaded, all configs present in DB."""
        postgres = self._get_postgres()

        # Create a secret file for dataset
        secret_data = {
            'access_key_id': 'E2E_KEY_ID',
            'access_key': 'E2E_SECRET_KEY',
        }
        secret_file = tempfile.NamedTemporaryFile(
            mode='w', suffix='.yaml', delete=False)
        yaml.dump(secret_data, secret_file)
        secret_file.close()

        config_data = {
            'managed_configs': {
                'resource_validations': {
                    'managed_by': 'configmap',
                    'items': {
                        'e2e_cpu': [
                            {
                                'operator': 'GT',
                                'left_operand': '{{USER_CPU}}',
                                'right_operand': '0',
                                'assert_message': 'CPU must be > 0',
                            },
                        ],
                    },
                },
                'pod_templates': {
                    'managed_by': 'configmap',
                    'items': {
                        'e2e_template': {
                            'spec': {
                                'containers': [{
                                    'name': 'e2e-container',
                                    'resources': {'limits': {'cpu': '1'}},
                                }],
                            },
                        },
                    },
                },
                'backends': {
                    'managed_by': 'configmap',
                    'items': {
                        'e2e-backend': {
                            'description': 'E2E test backend',
                        },
                    },
                },
                'pools': {
                    'managed_by': 'configmap',
                    'items': {
                        'e2e-pool': {
                            'description': 'E2E test pool',
                            'default_platform': 'e2e_platform',
                            'platforms': {'e2e_platform': {}},
                            'backend': 'e2e-backend',
                        },
                    },
                },
                'roles': {
                    'managed_by': 'configmap',
                    'items': {
                        'e2e-role': {
                            'description': 'E2E role',
                            'policies': [
                                {
                                    'actions': ['*:*'],
                                    'resources': ['*'],
                                },
                            ],
                        },
                    },
                },
                'service': {
                    'managed_by': 'configmap',
                    'config': {
                        'cli_config': {
                            'latest_version': 'e2e-version',
                        },
                    },
                },
                'workflow': {
                    'managed_by': 'configmap',
                    'config': {
                        'max_num_tasks': 500,
                    },
                },
                'dataset': {
                    'managed_by': 'configmap',
                    'config': {
                        'default_bucket': 'e2e-bucket',
                        'buckets': {
                            'e2e-bucket': {
                                'dataset_path': 's3://e2e-bucket',
                                'region': 'us-east-1',
                                'mode': 'read-write',
                                'default_credential': {
                                    'secret_file': secret_file.name,
                                },
                            },
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)

            # Verify all config types were applied
            connectors.ResourceValidation.fetch_from_db(postgres, 'e2e_cpu')
            connectors.PodTemplate.fetch_from_db(postgres, 'e2e_template')
            connectors.Backend.fetch_from_db(postgres, 'e2e-backend')
            pool = connectors.Pool.fetch_from_db(postgres, 'e2e-pool')
            self.assertEqual(pool.backend, 'e2e-backend')
            connectors.Role.fetch_from_db(postgres, 'e2e-role')

            service_config = postgres.get_configs(connectors.ConfigType.SERVICE)
            self.assertEqual(
                service_config.dict(by_alias=True)['cli_config']['latest_version'],
                'e2e-version')

            workflow_config = postgres.get_configs(connectors.ConfigType.WORKFLOW)
            self.assertEqual(
                workflow_config.dict(by_alias=True)['max_num_tasks'], 500)

            dataset_config = postgres.get_configs(connectors.ConfigType.DATASET)
            dataset_dict = dataset_config.dict(by_alias=True)
            self.assertEqual(dataset_dict['default_bucket'], 'e2e-bucket')
        finally:
            self._cleanup_file(config_path)
            self._cleanup_file(secret_file.name)

    def test_partial_failure_continues(self):
        """One config type failing doesn't prevent others from being applied."""
        postgres = self._get_postgres()
        config_data = {
            'managed_configs': {
                'service': {
                    'managed_by': 'configmap',
                    'config': {
                        'cli_config': {
                            'latest_version': 'partial-version',
                        },
                    },
                },
                # pools referencing nonexistent backend will fail
                'pools': {
                    'managed_by': 'configmap',
                    'items': {
                        'failing-pool': {
                            'description': 'Pool with missing backend',
                            'default_platform': 'plat',
                            'platforms': {'plat': {}},
                            'backend': 'nonexistent-backend-xyz',
                        },
                    },
                },
                'workflow': {
                    'managed_by': 'configmap',
                    'config': {
                        'max_num_tasks': 999,
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)

            # Service config should still be applied
            service_config = postgres.get_configs(connectors.ConfigType.SERVICE)
            self.assertEqual(
                service_config.dict(by_alias=True)['cli_config']['latest_version'],
                'partial-version')

            # Workflow config should still be applied
            workflow_config = postgres.get_configs(connectors.ConfigType.WORKFLOW)
            self.assertEqual(
                workflow_config.dict(by_alias=True)['max_num_tasks'], 999)
        finally:
            self._cleanup_file(config_path)

    # -------------------------------------------------------------------
    # Config history verification
    # -------------------------------------------------------------------

    def test_config_history_entries(self):
        """Verify configmap-sync username and tags in history entries."""
        postgres = self._get_postgres()
        config_data = {
            'managed_configs': {
                'service': {
                    'managed_by': 'configmap',
                    'config': {
                        'cli_config': {
                            'latest_version': 'history-test',
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            configmap_loader.load_dynamic_configs(config_path, postgres)

            # Check config history via API
            response = self.client.get(
                '/api/configs/history',
                params={'config_types': ['SERVICE']})
            self.assertEqual(response.status_code, 200)
            history = response.json()

            # Find the configmap-sync entry
            configmap_entries = [
                entry for entry in history['configs']
                if entry['username'] == CONFIGMAP_SYNC_USERNAME
            ]
            self.assertGreater(len(configmap_entries), 0)
            entry = configmap_entries[-1]
            self.assertEqual(entry['username'], CONFIGMAP_SYNC_USERNAME)
            self.assertIn('configmap', entry['tags'])
        finally:
            self._cleanup_file(config_path)

    def test_insert_backend_no_history_on_conflict(self):
        """No history entry when INSERT backend does nothing (conflict)."""
        postgres = self._get_postgres()

        # Create backend first
        self.create_test_backend(database=postgres, backend_name='conflict-backend')

        # Get history count before
        response = self.client.get(
            '/api/configs/history',
            params={'config_types': ['BACKEND']})
        self.assertEqual(response.status_code, 200)
        history_before = response.json()
        count_before = len(history_before['configs'])

        # Call _insert_backend directly — should hit ON CONFLICT DO NOTHING
        configmap_loader._insert_backend(
            'conflict-backend',
            {'description': 'Should conflict'},
            postgres,
        )

        # Check history count after — should be the same
        response = self.client.get(
            '/api/configs/history',
            params={'config_types': ['BACKEND']})
        self.assertEqual(response.status_code, 200)
        history_after = response.json()
        count_after = len(history_after['configs'])

        self.assertEqual(count_before, count_after)


    # -------------------------------------------------------------------
    # Drift reconciliation
    # -------------------------------------------------------------------

    def test_drift_reconciliation_reverts_cli_change(self):
        """CLI change to a configmap-mode config is reverted by drift reconciliation."""
        postgres = self._get_postgres()

        config_data = {
            'managed_configs': {
                'workflow': {
                    'managed_by': 'configmap',
                    'config': {
                        'max_num_tasks': 42,
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            # Initial apply via ConfigMap
            watcher = configmap_loader.ConfigMapWatcher(config_path, postgres)
            watcher.load_and_apply()

            workflow_config = postgres.get_configs(connectors.ConfigType.WORKFLOW)
            self.assertEqual(workflow_config.dict(by_alias=True)['max_num_tasks'], 42)

            # Simulate CLI override
            config_helpers.patch_configs(
                request=config_objects.PatchConfigRequest(
                    configs_dict={'max_num_tasks': 999},
                    description='CLI override',
                ),
                config_type=connectors.ConfigType.WORKFLOW,
                username='test-user',
            )
            workflow_config = postgres.get_configs(connectors.ConfigType.WORKFLOW)
            self.assertEqual(workflow_config.dict(by_alias=True)['max_num_tasks'], 999)

            # Drift reconciliation should revert to ConfigMap value
            watcher._reconcile_drift()

            workflow_config = postgres.get_configs(connectors.ConfigType.WORKFLOW)
            self.assertEqual(workflow_config.dict(by_alias=True)['max_num_tasks'], 42)
        finally:
            self._cleanup_file(config_path)

    def test_drift_reconciliation_skips_seed_mode(self):
        """Seed-mode configs are NOT reverted by drift reconciliation."""
        postgres = self._get_postgres()

        config_data = {
            'managed_configs': {
                'service': {
                    'managed_by': 'seed',
                    'config': {
                        'cli_config': {
                            'latest_version': 'from-configmap',
                        },
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            watcher = configmap_loader.ConfigMapWatcher(config_path, postgres)
            watcher.load_and_apply()

            # Simulate CLI override
            config_helpers.patch_configs(
                request=config_objects.PatchConfigRequest(
                    configs_dict={'cli_config': {'latest_version': 'from-cli'}},
                    description='CLI override',
                ),
                config_type=connectors.ConfigType.SERVICE,
                username='test-user',
            )

            # Drift reconciliation should NOT touch seed-mode configs
            watcher._reconcile_drift()

            service_config = postgres.get_configs(connectors.ConfigType.SERVICE)
            self.assertEqual(
                service_config.dict(by_alias=True)['cli_config']['latest_version'],
                'from-cli')
        finally:
            self._cleanup_file(config_path)

    def test_drift_reconciliation_no_history_when_no_drift(self):
        """No config_history entry created when values haven't drifted."""
        postgres = self._get_postgres()

        config_data = {
            'managed_configs': {
                'workflow': {
                    'managed_by': 'configmap',
                    'config': {
                        'max_num_tasks': 77,
                    },
                },
            },
        }
        config_path = self._write_config_file(config_data)
        try:
            watcher = configmap_loader.ConfigMapWatcher(config_path, postgres)
            watcher.load_and_apply()

            # Count history entries before reconciliation
            history_before = postgres.execute_fetch_command(
                'SELECT COUNT(*) as count FROM config_history WHERE config_type = %s',
                ('workflow',), return_raw=True)
            count_before = history_before[0]['count']

            # Reconcile with no drift — should not create history entries
            watcher._reconcile_drift()

            history_after = postgres.execute_fetch_command(
                'SELECT COUNT(*) as count FROM config_history WHERE config_type = %s',
                ('workflow',), return_raw=True)
            count_after = history_after[0]['count']

            self.assertEqual(count_before, count_after)
        finally:
            self._cleanup_file(config_path)


if __name__ == '__main__':
    runner.run_test()
