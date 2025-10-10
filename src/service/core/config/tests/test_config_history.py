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

import datetime
from typing import Dict, List, Optional

import pydantic

from src.lib.utils import credentials, osmo_errors
from src.service.core.config import config_service, objects
from src.service.core.tests import fixture
from src.utils import connectors
from src.tests.common import runner


class ConfigHistoryTestCase(fixture.ServiceTestFixture):
    """Integration tests for config history functionality."""

    def _get_config_history(self, **kwargs) -> Dict:
        """Helper method to get config history with optional filters."""
        response = self.client.get('/api/configs/history', params=kwargs)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def _verify_history_entry(
        self,
        entry: Dict,
        expected_type: str,
        expected_name: str,
        expected_username: str = 'test@nvidia.com',
        expected_description: Optional[str] = None,
        expected_tags: Optional[List[str]] = None,
    ):
        """Helper method to verify a history entry has expected values."""
        self.assertEqual(entry['config_type'], expected_type)
        self.assertEqual(entry['name'], expected_name)
        self.assertEqual(entry['username'], expected_username)
        self.assertIn('revision', entry)
        self.assertIn('created_at', entry)
        self.assertIn('tags', entry)
        self.assertIn('description', entry)
        self.assertIn('data', entry)
        if expected_description is not None:
            self.assertEqual(entry['description'], expected_description)
        if expected_tags is not None:
            self.assertEqual(sorted(entry['tags']), sorted(expected_tags))

    def _verify_initial_config_entry(self, config_type: str):
        """Helper method to verify initial config history entry exists."""
        history = self._get_config_history(config_types=[config_type])
        self.assertGreater(
            len(history['configs']), 0, f'No initial history entry found for {config_type} config'
        )
        self._verify_history_entry(
            history['configs'][0],
            expected_type=config_type,
            expected_name='',
            expected_username='system',
            expected_tags=['initial-config'],
        )

    def test_service_config_history(self):
        """Test history entries for service config operations."""
        self._verify_initial_config_entry('SERVICE')

        # Test first service config update
        first_service_config = {
            'cli_config': {
                'cli_name': 'test-cli',
                'min_supported_version': '1.0.0',
                'credential': {
                    'endpoint': 's3://test-bucket',
                    'access_key_id': 'test-key',
                    'access_key': 'test-secret',
                    'region': 'us-east-1',
                },
            }
        }
        first_tags = ['service-update', 'cli-config']
        config_service.patch_service_configs(
            request=objects.PatchConfigRequest(
                configs_dict=first_service_config,
                description='First service config update',
                tags=first_tags
            ),
            username='test@nvidia.com',
        )

        # Test second service config update
        second_service_config = {
            'cli_config': {
                'cli_name': 'updated-cli',
                'min_supported_version': '2.0.0',
                'credential': {
                    'endpoint': 's3://new-bucket',
                    'access_key_id': 'new-key',
                    'access_key': 'new-secret',
                    'region': 'us-west-1',
                },
            }
        }
        second_tags = ['service-update', 'cli-update']
        config_service.patch_service_configs(
            request=objects.PatchConfigRequest(
                configs_dict=second_service_config,
                description='Second service config update',
                tags=second_tags
            ),
            username='test@nvidia.com',
        )

        # Verify both updates
        history = self._get_config_history()
        self._verify_history_entry(
            history['configs'][-2],
            expected_type='SERVICE',
            expected_name='',
            expected_description='First service config update',
            expected_tags=first_tags,
        )
        config = history['configs'][-2]['data']
        self.assertEqual(config['cli_config']['cli_name'], 'test-cli')
        self.assertEqual(config['cli_config']
                         ['min_supported_version'], '1.0.0')
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='SERVICE',
            expected_name='',
            expected_description='Second service config update',
            expected_tags=second_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['cli_config']['cli_name'], 'updated-cli')
        self.assertEqual(config['cli_config']
                         ['min_supported_version'], '2.0.0')

        # Roll back to the first revision
        rollback_tags = ['rollback-test', 'service-rollback']
        config_service.rollback_config(
            request=objects.RollbackConfigRequest(
                config_type=connectors.ConfigHistoryType.SERVICE,
                revision=history['configs'][-2]['revision'],
                description='Rolling back service config',
                tags=rollback_tags,
            ),
            username='test@nvidia.com',
        )

        # Verify the rollback
        history = self._get_config_history(config_types=['SERVICE'])
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='SERVICE',
            expected_name='',
            expected_description='Roll back SERVICE to r2: Rolling back service config',
            expected_tags=rollback_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['cli_config']['cli_name'], 'test-cli')
        self.assertEqual(config['cli_config']['min_supported_version'], '1.0.0')
        self.assertEqual(config['cli_config']['credential']['endpoint'], 's3://test-bucket')
        self.assertEqual(config['cli_config']['credential']['access_key_id'], 'test-key')
        self.assertEqual(config['cli_config']['credential']['region'], 'us-east-1')

    def test_workflow_config_history(self):
        """Test history entries for workflow config operations."""
        self._verify_initial_config_entry('WORKFLOW')

        # Test first workflow config update
        first_workflow_config = {
            'workflow_info': {'tags': ['test-tag']},
        }
        first_tags = ['workflow-update', 'backend-config']
        config_service.patch_workflow_configs(
            request=objects.PatchConfigRequest(
                configs_dict=first_workflow_config,
                description='First workflow config update',
                tags=first_tags
            ),
            username='test@nvidia.com',
        )

        # Test second workflow config update
        second_workflow_config = {
            'workflow_info': {'tags': ['updated-tag']},
        }
        second_tags = ['workflow-update', 'backend-change']
        config_service.patch_workflow_configs(
            request=objects.PatchConfigRequest(
                configs_dict=second_workflow_config,
                description='Second workflow config update',
                tags=second_tags
            ),
            username='test@nvidia.com',
        )

        # Verify both updates
        history = self._get_config_history()
        self._verify_history_entry(
            history['configs'][-2],
            expected_type='WORKFLOW',
            expected_name='',
            expected_description='First workflow config update',
            expected_tags=first_tags,
        )
        config = history['configs'][-2]['data']
        self.assertEqual(config['workflow_info']['tags'], ['test-tag'])
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='WORKFLOW',
            expected_name='',
            expected_description='Second workflow config update',
            expected_tags=second_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['workflow_info']['tags'], ['updated-tag'])

        # Roll back to the first revision
        rollback_tags = ['rollback-test', 'workflow-rollback']
        config_service.rollback_config(
            request=objects.RollbackConfigRequest(
                config_type=connectors.ConfigHistoryType.WORKFLOW,
                revision=history['configs'][-2]['revision'],
                description='Rolling back workflow config',
                tags=rollback_tags,
            ),
            username='test@nvidia.com',
        )

        # Verify the rollback
        history = self._get_config_history(config_types=['WORKFLOW'])
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='WORKFLOW',
            expected_name='',
            expected_description='Roll back WORKFLOW to r2: Rolling back workflow config',
            expected_tags=rollback_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['workflow_info']['tags'], ['test-tag'])

    def test_dataset_config_history(self):
        """Test history entries for dataset config operations."""
        self._verify_initial_config_entry('DATASET')

        # Test first dataset config update
        first_tags = ['dataset-update', 'credential-config']
        config_service.patch_dataset_configs(
            request=objects.PatchConfigRequest(
                configs_dict={'default_bucket': 'test-bucket'},
                description='First dataset config update',
                tags=first_tags
            ),
            username='test@nvidia.com',
        )

        # Test second dataset config update
        second_tags = ['dataset-update', 'new-dataset']
        config_service.patch_dataset_configs(
            request=objects.PatchConfigRequest(
                configs_dict={'default_bucket': 'new-bucket'},
                description='Second dataset config update',
                tags=second_tags
            ),
            username='test@nvidia.com',
        )

        # Verify both updates
        history = self._get_config_history()
        self._verify_history_entry(
            history['configs'][-2],
            expected_type='DATASET',
            expected_name='',
            expected_description='First dataset config update',
            expected_tags=first_tags,
        )
        config = history['configs'][-2]['data']
        self.assertEqual(config['default_bucket'], 'test-bucket')
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='DATASET',
            expected_name='',
            expected_description='Second dataset config update',
            expected_tags=second_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['default_bucket'], 'new-bucket')

        # Roll back to the first revision
        rollback_tags = ['rollback-test', 'dataset-rollback']
        config_service.rollback_config(
            request=objects.RollbackConfigRequest(
                config_type=connectors.ConfigHistoryType.DATASET,
                revision=history['configs'][-2]['revision'],
                description='Rolling back dataset config',
                tags=rollback_tags,
            ),
            username='test@nvidia.com',
        )

        # Verify the rollback
        history = self._get_config_history(config_types=['DATASET'])
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='DATASET',
            expected_name='',
            expected_description='Roll back DATASET to r2: Rolling back dataset config',
            expected_tags=rollback_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['default_bucket'], 'test-bucket')

    def test_dataset_bucket_config_history(self):
        """Test history entries for dataset bucket config operations."""
        self._verify_initial_config_entry('DATASET')

        # First, create the bucket using the global dataset config update
        initial_bucket_config = {
            'buckets': {
                'test-bucket': {
                    'dataset_path': 's3://test-bucket/datasets',
                    'region': 'us-east-1',
                    'mode': 'read-write',
                    'check_key': False,
                    'description': 'Test bucket for testing',
                }
            }
        }
        config_service.patch_dataset_configs(
            request=objects.PatchConfigRequest(
                configs_dict=initial_bucket_config,
                description='Creating test bucket',
                tags=['bucket-creation']
            ),
            username='test@nvidia.com',
        )

        # Test first dataset bucket config update
        first_bucket_config = {
            'mode': 'read-only',
            'dataset_path': 's3://test-bucket/datasets',
            'region': 'us-east-1',
        }
        first_tags = ['bucket-update', 'first-bucket']
        config_service.patch_dataset(
            name='test-bucket',
            request=objects.PatchDatasetRequest(
                configs_dict=first_bucket_config,
                description='First dataset bucket config update',
                tags=first_tags
            ),
            username='test@nvidia.com',
        )

        # Test second dataset bucket config update
        second_bucket_config = {
            'mode': 'read-write',
            'dataset_path': 's3://new-bucket/datasets',
            'region': 'us-west-1',
        }
        second_tags = ['bucket-update', 'second-bucket']
        config_service.patch_dataset(
            name='test-bucket',
            request=objects.PatchDatasetRequest(
                configs_dict=second_bucket_config,
                description='Second dataset bucket config update',
                tags=second_tags
            ),
            username='test@nvidia.com',
        )

        # Verify both updates
        history = self._get_config_history()
        self._verify_history_entry(
            history['configs'][-2],
            expected_type='DATASET',
            expected_name='test-bucket',
            expected_description='First dataset bucket config update',
            expected_tags=first_tags,
        )
        config = history['configs'][-2]['data']
        self.assertEqual(config['buckets']['test-bucket']['mode'], 'read-only')
        self.assertEqual(
            config['buckets']['test-bucket']['dataset_path'],
            's3://test-bucket/datasets'
        )
        self.assertEqual(config['buckets']['test-bucket']['region'], 'us-east-1')

        self._verify_history_entry(
            history['configs'][-1],
            expected_type='DATASET',
            expected_name='test-bucket',
            expected_description='Second dataset bucket config update',
            expected_tags=second_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['buckets']['test-bucket']['mode'], 'read-write')
        self.assertEqual(
            config['buckets']['test-bucket']['dataset_path'],
            's3://new-bucket/datasets'
        )
        self.assertEqual(config['buckets']['test-bucket']['region'], 'us-west-1')

        # Test deleting the bucket
        delete_tags = ['bucket-delete', 'cleanup']
        config_service.delete_dataset(
            name='test-bucket',
            request=objects.ConfigsRequest(
                description='Deleting dataset bucket config',
                tags=delete_tags,
            ),
            username='test@nvidia.com',
        )

        # Verify the deletion
        history = self._get_config_history(config_types=['DATASET'])
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='DATASET',
            expected_name='test-bucket',
            expected_description='Deleting dataset bucket config',
            expected_tags=delete_tags,
        )
        config = history['configs'][-1]['data']
        self.assertNotIn('test-bucket', config['buckets'])

    def test_backend_config_history(self):
        """Test history entries for backend config operations."""
        self.create_test_backend(backend_name='test-backend')

        self._verify_initial_config_entry('BACKEND')

        # Test first backend config update
        first_update_tags = ['backend-update', 'first-update']
        config_service.update_backend(
            name='test-backend',
            request=objects.PostBackendRequest(
                configs=objects.BackendConfig(
                    scheduler_settings=connectors.BackendSchedulerSettings(
                        scheduler_type=connectors.BackendSchedulerType.SCHEDULER_PLUGINS,
                        scheduler_name='test-scheduler',
                        coscheduling=True,
                        scheduler_timeout=12,
                    ),
                ),
                description='First backend config update',
                tags=first_update_tags,
            ),
            username='test@nvidia.com',
        )

        # Test second backend config update
        second_update_tags = ['backend-update', 'second-update']
        config_service.update_backend(
            name='test-backend',
            request=objects.PostBackendRequest(
                configs=objects.BackendConfig(
                    scheduler_settings=connectors.BackendSchedulerSettings(
                        scheduler_type=connectors.BackendSchedulerType.SCHEDULER_PLUGINS,
                        scheduler_name='test-scheduler-2',
                        coscheduling=False,
                        scheduler_timeout=13,
                    ),
                ),
                description='Second backend config update',
                tags=second_update_tags,
            ),
            username='test@nvidia.com',
        )

        # Verify both updates
        history = self._get_config_history()
        self._verify_history_entry(
            history['configs'][-2],
            expected_type='BACKEND',
            expected_name='test-backend',
            expected_description='First backend config update',
            expected_tags=first_update_tags,
        )
        self.assertEqual(history['configs'][-2]['data']
                         [0]['scheduler_settings']['scheduler_type'], 'scheduler-plugins')
        self.assertEqual(history['configs'][-2]['data']
                         [0]['scheduler_settings']['scheduler_name'], 'test-scheduler')
        self.assertEqual(history['configs'][-2]['data']
                         [0]['scheduler_settings']['coscheduling'], True)
        self.assertEqual(history['configs'][-2]['data']
                         [0]['scheduler_settings']['scheduler_timeout'], 12)
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='BACKEND',
            expected_name='test-backend',
            expected_description='Second backend config update',
            expected_tags=second_update_tags,
        )
        self.assertEqual(history['configs'][-1]['data']
                         [0]['scheduler_settings']['scheduler_type'], 'scheduler-plugins')
        self.assertEqual(history['configs'][-1]['data']
                         [0]['scheduler_settings']['scheduler_name'], 'test-scheduler-2')
        self.assertEqual(history['configs'][-1]['data']
                         [0]['scheduler_settings']['coscheduling'], False)
        self.assertEqual(history['configs'][-1]['data']
                         [0]['scheduler_settings']['scheduler_timeout'], 13)

        # Roll back to the first revision
        rollback_tags = ['rollback-test', 'backend-rollback']
        config_service.rollback_config(
            request=objects.RollbackConfigRequest(
                config_type=connectors.ConfigHistoryType.BACKEND,
                revision=history['configs'][-2]['revision'],
                description='Rolling back backend config',
                tags=rollback_tags,
            ),
            username='test@nvidia.com',
        )

        # Verify the rollback
        history = self._get_config_history(config_types=['BACKEND'])
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='BACKEND',
            expected_name='',
            expected_description='Roll back BACKEND to r3: Rolling back backend config',
            expected_tags=rollback_tags,
        )
        self.assertEqual(history['configs'][-1]['data'][0]
                         ['scheduler_settings']['scheduler_type'], 'scheduler-plugins')
        self.assertEqual(history['configs'][-1]['data'][0]
                         ['scheduler_settings']['scheduler_name'], 'test-scheduler')
        self.assertEqual(history['configs'][-1]['data'][0]
                         ['scheduler_settings']['coscheduling'], True)
        self.assertEqual(history['configs'][-1]['data'][0]
                         ['scheduler_settings']['scheduler_timeout'], 12)

    def test_pool_config_history(self):
        """Test history entries for pool config operations."""
        pool_name = 'test_pool'
        backend_name = 'test_backend'
        self.create_test_backend(backend_name=backend_name)
        self.create_test_pool(pool_name=pool_name, backend=backend_name)

        self._verify_initial_config_entry('POOL')

        # Test first pool config update
        first_description = 'First pool description'
        first_update_tags = ['pool-update', 'first-change']
        config_service.patch_pool(
            name=pool_name,
            request=objects.PatchPoolRequest(
                configs_dict={'description': first_description},
                description='First pool config update',
                tags=first_update_tags,
            ),
            username='test@nvidia.com',
        )

        # Test second pool config update
        second_description = 'Second pool description'
        second_update_tags = ['pool-update', 'second-change']
        config_service.patch_pool(
            name=pool_name,
            request=objects.PatchPoolRequest(
                configs_dict={'description': second_description},
                description='Second pool config update',
                tags=second_update_tags,
            ),
            username='test@nvidia.com',
        )

        # Verify both updates
        history = self._get_config_history()
        self._verify_history_entry(
            history['configs'][-2],
            expected_type='POOL',
            expected_name=pool_name,
            expected_description='First pool config update',
            expected_tags=first_update_tags,
        )
        config = history['configs'][-2]['data']
        self.assertEqual(config['pools'][pool_name]
                         ['description'], first_description)
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='POOL',
            expected_name=pool_name,
            expected_description='Second pool config update',
            expected_tags=second_update_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['pools'][pool_name]
                         ['description'], second_description)

        # Roll back to the first revision
        rollback_tags = ['rollback-test', 'pool-rollback']
        config_service.rollback_config(
            request=objects.RollbackConfigRequest(
                config_type=connectors.ConfigHistoryType.POOL,
                revision=history['configs'][-2]['revision'],
                description='Rolling back pool config',
                tags=rollback_tags,
            ),
            username='test@nvidia.com',
        )

        # Verify the rollback
        history = self._get_config_history(config_types=['POOL'])
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='POOL',
            expected_name='',
            expected_description='Roll back POOL to r4: Rolling back pool config',
            expected_tags=rollback_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['pools'][pool_name]['description'], first_description)

    def test_pod_template_config_history(self):
        """Test history entries for pod template config operations."""
        self._verify_initial_config_entry('POD_TEMPLATE')

        # Test first pod template config update
        first_config = {
            'spec': {'nodeSelector': {'test-label': 'first-value'}}}
        first_tags = ['template-update', 'first-change']
        config_service.put_pod_template(
            name='default',
            request=objects.PutPodTemplateRequest(
                configs=first_config,
                description='First pod template update',
                tags=first_tags
            ),
            username='test@nvidia.com',
        )

        # Test second pod template config update
        second_config = {
            'spec': {'nodeSelector': {'test-label': 'second-value'}}}
        second_tags = ['template-update', 'second-change']
        config_service.put_pod_template(
            name='default',
            request=objects.PutPodTemplateRequest(
                configs=second_config,
                description='Second pod template update',
                tags=second_tags
            ),
            username='test@nvidia.com',
        )

        # Verify both updates
        history = self._get_config_history()
        self._verify_history_entry(
            history['configs'][-2],
            expected_type='POD_TEMPLATE',
            expected_name='default',
            expected_description='First pod template update',
            expected_tags=first_tags,
        )
        config = history['configs'][-2]['data']
        self.assertEqual(config['default']['spec']
                         ['nodeSelector']['test-label'], 'first-value')
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='POD_TEMPLATE',
            expected_name='default',
            expected_description='Second pod template update',
            expected_tags=second_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['default']['spec']
                         ['nodeSelector']['test-label'], 'second-value')

        # Roll back to the first revision
        rollback_tags = ['rollback-test', 'pod-template-rollback']
        config_service.rollback_config(
            request=objects.RollbackConfigRequest(
                config_type=connectors.ConfigHistoryType.POD_TEMPLATE,
                revision=history['configs'][-2]['revision'],
                description='Rolling back pod template config',
                tags=rollback_tags,
            ),
            username='test@nvidia.com',
        )

        # Verify the rollback
        history = self._get_config_history(config_types=['POD_TEMPLATE'])
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='POD_TEMPLATE',
            expected_name='',
            expected_description='Roll back POD_TEMPLATE to r3: Rolling back pod template config',
            expected_tags=rollback_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['default']['spec']['nodeSelector']['test-label'], 'first-value')

    def test_resource_validation_config_history(self):
        """Test history entries for resource validation config operations."""
        self._verify_initial_config_entry('RESOURCE_VALIDATION')

        # Test first resource validation config update
        first_config = [
            {
                'operator': 'LE',
                'left_operand': '{% if USER_CPU is none %}1{% else %}{{USER_CPU}}{% endif %}',
                'right_operand': '{{K8_CPU}}',
                'assert_message': (
                    'Value {% if USER_CPU is none %}1{% else %}{{USER_CPU}}{% endif %} '
                    'too high for CPU'
                ),
            },
        ]
        first_tags = ['validation-update', 'first-check']
        config_service.put_resource_validation(
            name='default_cpu',
            request=objects.PutResourceValidationRequest(
                configs=first_config,
                description='First resource validation update',
                tags=first_tags
            ),
            username='test@nvidia.com',
        )

        # Test second resource validation config update
        second_config = [
            {
                'operator': 'GE',
                'left_operand':
                    '{% if USER_MEMORY is none %}1Gi{% else %}{{USER_MEMORY}}{% endif %}',
                'right_operand': '{{K8_MEMORY}}',
                'assert_message': (
                    'Value {% if USER_MEMORY is none %}1Gi{% else %}{{USER_MEMORY}}{% endif %} '
                    'too low for memory'
                ),
            },
        ]
        second_tags = ['validation-update', 'second-check']
        config_service.put_resource_validation(
            name='default_memory',
            request=objects.PutResourceValidationRequest(
                configs=second_config,
                description='Second resource validation update',
                tags=second_tags
            ),
            username='test@nvidia.com',
        )

        # Verify both updates
        history = self._get_config_history()
        self._verify_history_entry(
            history['configs'][-2],
            expected_type='RESOURCE_VALIDATION',
            expected_name='default_cpu',
            expected_description='First resource validation update',
            expected_tags=first_tags,
        )
        config = history['configs'][-2]['data']
        self.assertEqual(config['default_cpu'][0]['operator'], 'LE')
        self.assertEqual(
            config['default_cpu'][0]['left_operand'],
            '{% if USER_CPU is none %}1{% else %}{{USER_CPU}}{% endif %}'
        )
        self.assertEqual(config['default_cpu'][0]
                         ['right_operand'], '{{K8_CPU}}')
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='RESOURCE_VALIDATION',
            expected_name='default_memory',
            expected_description='Second resource validation update',
            expected_tags=second_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['default_memory'][0]['operator'], 'GE')
        self.assertEqual(
            config['default_memory'][0]['left_operand'],
            '{% if USER_MEMORY is none %}1Gi{% else %}{{USER_MEMORY}}{% endif %}'
        )
        self.assertEqual(config['default_memory'][0]
                         ['right_operand'], '{{K8_MEMORY}}')

        # Roll back to the first revision
        rollback_tags = ['rollback-test', 'resource-validation-rollback']
        config_service.rollback_config(
            request=objects.RollbackConfigRequest(
                config_type=connectors.ConfigHistoryType.RESOURCE_VALIDATION,
                revision=history['configs'][-2]['revision'],
                description='Rolling back resource validation config',
                tags=rollback_tags,
            ),
            username='test@nvidia.com',
        )

        # Verify the rollback
        history = self._get_config_history(config_types=['RESOURCE_VALIDATION'])
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='RESOURCE_VALIDATION',
            expected_name='',
            expected_description='Roll back RESOURCE_VALIDATION to r3: '
            'Rolling back resource validation config',
            expected_tags=rollback_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['default_cpu'][0]['operator'], 'LE')
        self.assertEqual(
            config['default_cpu'][0]['left_operand'],
            '{% if USER_CPU is none %}1{% else %}{{USER_CPU}}{% endif %}'
        )
        self.assertEqual(config['default_cpu'][0]['right_operand'], '{{K8_CPU}}')

    def test_backend_test_config_history(self):
        """Test history entries for backend test config operations."""
        self._verify_initial_config_entry('BACKEND_TEST')

        # Test first backend test config update
        first_tags = ['backend-test-update', 'first-test']
        config_service.put_backend_test(
            name='test-backend',
            request=objects.PutBackendTestRequest(
                configs=connectors.BackendTests(
                    name='test-backend',
                    description='A backend test',
                    cron_schedule='0 2 * * *',
                    node_conditions=['node-condition-1'],
                    common_pod_template=['default_user']
                ),
                description='First backend test update',
                tags=first_tags
            ),
            username='test@nvidia.com',
        )

        # Test second backend test config update
        second_tags = ['backend-test-update', 'second-test']
        config_service.patch_backend_test(
            name='test-backend',
            request=objects.PatchBackendTestRequest(
                configs_dict={
                    'name': 'test-backend-test',
                    'description': 'Another backend test',
                    'cron_schedule': '1 2 * * *',
                },
                description='Second backend test update',
                tags=second_tags
            ),
            username='test@nvidia.com',
        )

        # Verify both updates
        history = self._get_config_history()
        self._verify_history_entry(
            history['configs'][-2],
            expected_type='BACKEND_TEST',
            expected_name='test-backend',
            expected_description='First backend test update',
            expected_tags=first_tags,
        )
        config = history['configs'][-2]['data']
        self.assertEqual(config['test-backend']['name'], 'test-backend')
        self.assertEqual(config['test-backend']['description'], 'A backend test')
        self.assertEqual(config['test-backend']['cron_schedule'], '0 2 * * *')
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='BACKEND_TEST',
            expected_name='test-backend',
            expected_description='Second backend test update',
            expected_tags=second_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['test-backend']['name'], 'test-backend')
        self.assertEqual(config['test-backend']['description'], 'Another backend test')
        self.assertEqual(config['test-backend']['cron_schedule'], '1 2 * * *')

        # Roll back to the first revision
        rollback_tags = ['rollback-test', 'backend-test-rollback']
        config_service.rollback_config(
            request=objects.RollbackConfigRequest(
                config_type=connectors.ConfigHistoryType.BACKEND_TEST,
                revision=history['configs'][-2]['revision'],
                description='Rolling back backend test config',
                tags=rollback_tags,
            ),
            username='test@nvidia.com',
        )

        # Verify the rollback
        history = self._get_config_history(config_types=['BACKEND_TEST'])
        self._verify_history_entry(
            history['configs'][-1],
            expected_type='BACKEND_TEST',
            expected_name='',
            expected_description='Roll back BACKEND_TEST to r2: Rolling back backend test config',
            expected_tags=rollback_tags,
        )
        config = history['configs'][-1]['data']
        self.assertEqual(config['test-backend']['name'], 'test-backend')
        self.assertEqual(config['test-backend']['description'], 'A backend test')
        self.assertEqual(config['test-backend']['cron_schedule'], '0 2 * * *')

    def test_config_history_filters(self):
        """Test filtering of config history entries."""
        self.create_test_backend(backend_name='test-backend')
        base_time = datetime.datetime.now(datetime.timezone.utc)

        service_tags = ['service-test', 'filter-test']
        config_service.patch_service_configs(
            request=objects.PatchConfigRequest(
                configs_dict={}, tags=service_tags),
            username='test@nvidia.com',
        )

        template_config = {'spec': {'nodeSelector': {'test-label': 'test-value'}}}
        template_tags = ['template-test', 'filter-test']
        config_service.put_pod_template(
            name='test-template',
            request=objects.PutPodTemplateRequest(configs=template_config, tags=template_tags),
            username='test@nvidia.com',
        )

        validation_config = [
            {
                'operator': 'LE',
                'left_operand': '{% if USER_CPU is none %}1{% else %}{{USER_CPU}}{% endif %}',
                'right_operand': '{{K8_CPU}}',
                'assert_message': (
                    'Value {% if USER_CPU is none %}1{% else %}{{USER_CPU}}{% endif %} '
                    'too high for CPU'
                ),
            },
        ]
        validation_tags = ['validation-test', 'filter-test']
        config_service.put_resource_validation(
            name='default_cpu',
            request=objects.PutResourceValidationRequest(
                configs=validation_config, tags=validation_tags
            ),
            username='test@nvidia.com',
        )

        backend_tags = ['backend-test', 'filter-test']
        config_service.update_backend(
            name='test-backend',
            request=objects.PostBackendRequest(
                configs=objects.BackendConfig(description='test-description'),
                tags=backend_tags,
            ),
            username='test@nvidia.com',
        )

        # Test filtering by config type
        history = self._get_config_history(config_types=['SERVICE'])
        self.assertEqual(len(history['configs']), 2)  # 1 initial + 1 update
        self.assertEqual(history['configs'][-1]['config_type'], 'SERVICE')
        self.assertEqual(sorted(history['configs'][-1]['tags']), sorted(service_tags))
        self.assertEqual(history['configs'][-1]['data']
                         ['service_base_url'], 'https://0.0.0.0')

        # Test filtering by multiple config types
        history = self._get_config_history(config_types=['SERVICE', 'BACKEND'])
        # 2 initial + 1 test backend created + 2 updates
        self.assertEqual(len(history['configs']), 5)

        config_types = {entry['config_type'] for entry in history['configs']}
        self.assertEqual(config_types, {'SERVICE', 'BACKEND'})

        # Test filtering by name
        history = self._get_config_history(name='test-template')
        self.assertEqual(len(history['configs']), 1)
        self.assertEqual(history['configs'][-1]['name'], 'test-template')
        self.assertEqual(sorted(history['configs'][-1]['tags']), sorted(template_tags))
        self.assertEqual(history['configs'][-1]['data']['test-template']
                         ['spec']['nodeSelector']['test-label'], 'test-value')

        # Test filtering by time range
        history = self._get_config_history(
            created_after=base_time,
            created_before=base_time + datetime.timedelta(minutes=1),
        )
        self.assertEqual(len(history['configs']), 4)  # All entries should be within range
        for entry in history['configs']:
            if entry['config_type'] == 'SERVICE':
                self.assertEqual(sorted(entry['tags']), sorted(service_tags))
            elif entry['config_type'] == 'POD_TEMPLATE':
                self.assertEqual(sorted(entry['tags']), sorted(template_tags))
            elif entry['config_type'] == 'RESOURCE_VALIDATION':
                self.assertEqual(sorted(entry['tags']), sorted(validation_tags))
            elif entry['config_type'] == 'BACKEND':
                self.assertEqual(sorted(entry['tags']), sorted(backend_tags))

        # Test filtering by tags
        history = self._get_config_history(tags=['filter-test'])
        self.assertEqual(len(history['configs']), 4)  # All updates have 'filter-test' tag
        for entry in history['configs']:
            self.assertIn('filter-test', entry['tags'])

        # Test filtering by multiple tags
        history = self._get_config_history(tags=['filter-test', 'service-test'])
        self.assertEqual(len(history['configs']), 1)  # Only service update has both tags
        self.assertEqual(history['configs'][0]['config_type'], 'SERVICE')
        self.assertEqual(sorted(history['configs'][0]['tags']), sorted(service_tags))
        self.assertEqual(history['configs'][0]['data']
                         ['service_base_url'], 'https://0.0.0.0')

        # Test filtering by non-existent tags
        history = self._get_config_history(tags=['non-existent-tag'])
        self.assertEqual(len(history['configs']), 0)

        # Test omit_data parameter
        history = self._get_config_history(omit_data=True, config_types=['SERVICE'])
        self.assertEqual(len(history['configs']), 2)
        for entry in history['configs']:
            self.assertIsNone(entry['data'])
            self.assertIn('config_type', entry)
            self.assertIn('name', entry)
            self.assertIn('revision', entry)
            self.assertIn('username', entry)
            self.assertIn('created_at', entry)
            self.assertIn('tags', entry)
            self.assertIn('description', entry)

    def test_delete_config_history_revision(self):
        """Test deleting specific config history revisions."""
        # Create multiple service config updates to have multiple revisions
        config_service.patch_service_configs(
            request=objects.PatchConfigRequest(
                configs_dict={'cli_config': {'cli_name': 'test-cli-v1'}},
                description='First service update',
                tags=['first-update']
            ),
            username='test@nvidia.com',
        )

        config_service.patch_service_configs(
            request=objects.PatchConfigRequest(
                configs_dict={'cli_config': {'cli_name': 'test-cli-v2'}},
                description='Second service update',
                tags=['second-update']
            ),
            username='test@nvidia.com',
        )

        config_service.patch_service_configs(
            request=objects.PatchConfigRequest(
                configs_dict={'cli_config': {'cli_name': 'test-cli-v3'}},
                description='Third service update',
                tags=['third-update']
            ),
            username='test@nvidia.com',
        )

        # Get the history to check revision numbers
        history = self._get_config_history(config_types=['SERVICE'])
        self.assertEqual(len(history['configs']), 4)  # 1 initial + 3 updates

        # Get revision numbers (they should be 1, 2, 3, 4)
        revisions = sorted([entry['revision'] for entry in history['configs']])
        self.assertEqual(revisions, [1, 2, 3, 4])

        current_revision = max(revisions)
        middle_revision = revisions[1]  # Should be revision 2

        # Test successful soft deletion of a non-current revision
        config_service.delete_config_history_revision(
            config_type='SERVICE',
            revision=middle_revision,
            username='test@nvidia.com',
        )

        # Verify the revision is not returned in history queries
        history_after_delete = self._get_config_history(config_types=['SERVICE'])
        self.assertEqual(len(history_after_delete['configs']), 3)  # One less than before
        remaining_revisions = [entry['revision'] for entry in history_after_delete['configs']]
        self.assertNotIn(middle_revision, remaining_revisions)

        # Query the database directly to verify soft delete metadata
        postgres = connectors.PostgresConnector.get_instance()
        query = """
            SELECT revision, deleted_by, deleted_at
            FROM config_history
            WHERE config_type = %s AND revision = %s
        """
        results = postgres.execute_fetch_command(
            query, ('service', middle_revision), return_raw=True)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['revision'], middle_revision)
        self.assertEqual(results[0]['deleted_by'], 'test@nvidia.com')
        self.assertIsNotNone(results[0]['deleted_at'])

        # Verify we can't roll back to a deleted revision
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            config_service.rollback_config(
                request=objects.RollbackConfigRequest(
                    config_type=connectors.ConfigHistoryType.SERVICE,
                    revision=middle_revision,
                    description='Attempting to roll back to deleted revision',
                ),
                username='test@nvidia.com',
            )
        self.assertIn('Cannot roll back to revision', str(context.exception))
        self.assertIn('as it was deleted', str(context.exception))

        # Test error when trying to delete current revision
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            config_service.delete_config_history_revision(
                config_type='SERVICE',
                revision=current_revision,
                username='test@nvidia.com',
            )

        expected_error = (
            f'Cannot delete the current revision {current_revision} for config type SERVICE'
        )
        self.assertIn(expected_error, str(context.exception))

        # Test error when trying to delete non-existent revision
        non_existent_revision = 999
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            config_service.delete_config_history_revision(
                config_type='SERVICE',
                revision=non_existent_revision,
                username='test@nvidia.com',
            )

        expected_error = (
            f'No config history entry found for type SERVICE at revision {non_existent_revision}'
        )
        self.assertIn(expected_error, str(context.exception))

        # Test error when trying to delete a revision with invalid config type
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            config_service.delete_config_history_revision(
                config_type='INVALID',
                revision=current_revision,
                username='test@nvidia.com',
            )

        expected_error = 'Invalid config type "INVALID"'
        self.assertIn(expected_error, str(context.exception))

        # Test error when trying to delete a revision that was already deleted
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            config_service.delete_config_history_revision(
                config_type='SERVICE',
                revision=middle_revision,
                username='test@nvidia.com',
            )
        expected_error = (
            f'No config history entry found for type SERVICE at revision {middle_revision}'
        )
        self.assertIn(expected_error, str(context.exception))

    def test_update_config_history_tags(self):
        """Test updating tags for config history revisions."""
        # Create initial service config with tags
        initial_tags = ['initial-tag', 'service-tag']
        config_service.patch_service_configs(
            request=objects.PatchConfigRequest(
                configs_dict={'cli_config': {'cli_name': 'test-cli-v1'}},
                description='Initial service update',
                tags=initial_tags
            ),
            username='test@nvidia.com',
        )

        # Get the history to check revision number
        history = self._get_config_history(config_types=['SERVICE'])
        self.assertEqual(len(history['configs']), 2)  # 1 initial + 1 update
        revision = history['configs'][-1]['revision']
        self.assertEqual(sorted(history['configs'][-1]['tags']), sorted(initial_tags))

        # Test adding new tags
        new_tags = ['new-tag', 'service-tag']  # service-tag already exists
        config_service.update_config_history_tags(
            config_type='service',
            revision=revision,
            request=objects.UpdateConfigTagsRequest(set_tags=new_tags)
        )

        # Verify tags were updated correctly (should have unique tags)
        history = self._get_config_history(config_types=['SERVICE'])
        expected_tags = sorted(list(set(initial_tags + new_tags)))
        self.assertEqual(sorted(history['configs'][-1]['tags']), expected_tags)

        # Test removing tags
        delete_tags = ['initial-tag', 'new-tag']
        config_service.update_config_history_tags(
            config_type='service',
            revision=revision,
            request=objects.UpdateConfigTagsRequest(delete_tags=delete_tags)
        )

        # Verify tags were removed correctly
        history = self._get_config_history(config_types=['SERVICE'])
        expected_tags = ['service-tag']  # Only this tag should remain
        self.assertEqual(sorted(history['configs'][-1]['tags']), expected_tags)

        # Test adding and removing tags simultaneously
        config_service.update_config_history_tags(
            config_type='service',
            revision=revision,
            request=objects.UpdateConfigTagsRequest(
                set_tags=['final-tag', 'service-tag'],  # service-tag already exists
                delete_tags=['service-tag']
            )
        )

        # Verify final tag state
        history = self._get_config_history(config_types=['SERVICE'])
        expected_tags = ['final-tag']  # service-tag was removed, final-tag added
        self.assertEqual(sorted(history['configs'][-1]['tags']), expected_tags)

        # Test error cases
        # 1. Invalid config type
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            config_service.update_config_history_tags(
                config_type='invalid',
                revision=1,
                request=objects.UpdateConfigTagsRequest(set_tags=['test-tag'])
            )
        self.assertIn('Invalid config type', str(context.exception))

        # 2. Non-existent revision
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            config_service.update_config_history_tags(
                config_type='service',
                revision=999,
                request=objects.UpdateConfigTagsRequest(set_tags=['test-tag'])
            )
        self.assertIn('No config history entry found', str(context.exception))

    def test_get_config_diff(self):
        """Test the get_config_diff functionality with dataset buckets."""
        # Create initial dataset config with a bucket
        test_bucket = connectors.BucketConfig(
            check_key=False,
            dataset_path='swift://test-endpoint/AUTH_test-team/dev/testuser/datasets',
            default_credential=credentials.BasicDataCredential(
                access_key='test-secret',
                access_key_id='testuser:AUTH_team-osmo',
            ),
            description='My fancy dataset',
            mode='read-write',
            region='us-east-1',
        )
        config_service.put_dataset_configs(
            request=objects.PutDatasetRequest(
                configs=connectors.DatasetConfig(buckets={
                    'test-bucket-1': test_bucket,
                }),
            ),
            username='test@nvidia.com',
        )

        # Change the bucket description
        config_service.patch_dataset_configs(
            request=objects.PatchConfigRequest(
                configs_dict={'buckets': {
                    'test-bucket-1': {'description': 'My extra fancy dataset'}
                }},
            ),
            username='test@nvidia.com',
        )

        # Update the access key
        config_service.patch_dataset_configs(
            request=objects.PatchConfigRequest(
                configs_dict={'buckets': {
                    'test-bucket-1': {
                        'default_credential': {
                            'access_key': 'updated-secret',
                            'access_key_id': 'testuser:AUTH_team-osmo',
                        },
                    }}},
            ),
            username='test@nvidia.com',
        )

        # Get history to access revision numbers
        history = self._get_config_history(config_types=['DATASET'])
        self.assertEqual(len(history['configs']), 4)  # 1 initial + 3 updates

        initial_history_entry = history['configs'][0]
        new_bucket_history_entry = history['configs'][1]
        updated_description_history_entry = history['configs'][2]
        updated_access_key_history_entry = history['configs'][3]

        # Test 1: Diff between same revision (should be empty)
        response = config_service.get_config_diff(
            request=objects.ConfigDiffRequest(
                config_type=connectors.ConfigHistoryType.DATASET,
                first_revision=initial_history_entry['revision'],
                second_revision=initial_history_entry['revision'],
            ),
        )
        self.assertEqual(response.first_data, initial_history_entry['data'])
        self.assertEqual(response.second_data, initial_history_entry['data'])

        # Test 2: Add the new bucket
        response = config_service.get_config_diff(
            request=objects.ConfigDiffRequest(
                config_type=connectors.ConfigHistoryType.DATASET,
                first_revision=initial_history_entry['revision'],
                second_revision=new_bucket_history_entry['revision'],
            ),
        )
        self.assertEqual(
            response.first_data,
            initial_history_entry['data']
        )
        self.assertEqual(
            response.second_data['buckets']['test-bucket-1'].dataset_path,
            new_bucket_history_entry['data']['buckets']['test-bucket-1']['dataset_path']
        )

        # Test 3: Value changed
        response = config_service.get_config_diff(
            request=objects.ConfigDiffRequest(
                config_type=connectors.ConfigHistoryType.DATASET,
                first_revision=new_bucket_history_entry['revision'],
                second_revision=updated_description_history_entry['revision'],
            ),
        )
        self.assertEqual(
            response.first_data.buckets['test-bucket-1'].description,
            new_bucket_history_entry['data']['buckets']['test-bucket-1']['description']
        )
        self.assertEqual(
            response.second_data['buckets']['test-bucket-1']['description'],
            updated_description_history_entry['data']['buckets']['test-bucket-1']['description']
        )

        # Test 4: Secret changed
        response = config_service.get_config_diff(
            request=objects.ConfigDiffRequest(
                config_type=connectors.ConfigHistoryType.DATASET,
                first_revision=updated_description_history_entry['revision'],
                second_revision=updated_access_key_history_entry['revision'],
            ),
        )
        self.assertIsInstance(
            response.first_data.buckets['test-bucket-1'].default_credential.access_key,
            pydantic.SecretStr
        )
        self.assertEqual(
            response.second_data['buckets']['test-bucket-1']['default_credential']['access_key'],
            f'********** <secret changed in r{updated_access_key_history_entry["revision"]}>'
        )

        # Test 7: Non-existent revision
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            config_service.get_config_diff(
                request=objects.ConfigDiffRequest(
                    config_type=connectors.ConfigHistoryType.DATASET,
                    first_revision=999,
                    second_revision=initial_history_entry['revision'],
                ),
            )
        self.assertIn('No config history entry found', str(context.exception))


if __name__ == '__main__':
    runner.run_test()
