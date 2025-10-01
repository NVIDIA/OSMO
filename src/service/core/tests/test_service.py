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

import io
import logging
import os
import subprocess
from typing import Any, List

from src.lib.utils import common, credentials, priority as wf_priority, version
from src.service.agent import helpers as agent_helpers
from src.service.core import install_script_loader, service
from src.service.core.config import config_service, helpers, objects as config_objects
from src.service.core.tests import fixture as service_fixture
from src.service.core.workflow import objects as workflow_objects
from src.utils import backend_messages, connectors
from src.utils.job import common as task_common, workflow
from src.tests.common import runner


logger = logging.getLogger(__name__)


class ServiceTestCase(service_fixture.ServiceTestFixture):
    """
    Functional tests for all APIs defined in service.py
    """

    def test_get_default_pool(self):
        database = connectors.postgres.PostgresConnector.get_instance()
        response = self.client.get('/api/configs/pool?verbose=true')

        pools = response.json()['pools']
        self.assertTrue('default' in pools)
        self.assertTrue('default' in pools['default']['platforms'])

        default_pod_template: dict[str, Any] = {}
        for pod_template in config_objects.DEFAULT_POD_TEMPLATES.values():
            default_pod_template = common.recursive_dict_update(
                default_pod_template, pod_template, common.merge_lists_on_name)

        default_resource_validations = []
        for validation_rules in config_objects.DEFAULT_RESOURCE_CHECKS.values():
            default_resource_validations.extend(validation_rules)

        self.assertEqual('default', pools['default']['backend'])
        self.assertDictEqual(default_pod_template, pools['default']['parsed_pod_template'])
        self.assertEqual(
            default_resource_validations, pools['default']['parsed_resource_validations'])
        self.assertDictEqual(
            config_objects.DEFAULT_VARIABLES, pools['default']['common_default_variables'])

        # Patch the pool with new backend name
        self.create_test_backend(database, backend_name='my_backend')
        config_service.patch_pool(
            name='default',
            request=config_objects.PatchPoolRequest(
                configs_dict={
                    'backend': 'my_backend',
                },
            ),
            username='test@nvidia.com',
        )
        response = self.client.get('/api/configs/pool?verbose=true')
        pools = response.json()['pools']
        self.assertEqual('my_backend', pools['default']['backend'])
        self.assertDictEqual(default_pod_template, pools['default']['parsed_pod_template'])
        self.assertEqual(
            default_resource_validations, pools['default']['parsed_resource_validations'])
        self.assertDictEqual(
            config_objects.DEFAULT_VARIABLES, pools['default']['common_default_variables'])

    def test_get_osmo_client_linux(self):
        # Arrange
        self.patch_cli_config()
        file_content = b'test data in a file'
        self.upload_cli_clients(file_content, str(version.VERSION))

        # Act
        response = self.client.get('/client/osmo_client')

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, file_content)

    def test_get_osmo_client_macos(self):
        # Arrange
        self.patch_cli_config()
        file_content = b'test data in a file'
        self.upload_cli_clients(file_content, str(version.VERSION))
        os_type = install_script_loader.CliOSType.MACOS.value

        # Act
        response = self.client.get(
            '/client/osmo_client', params={'os_type': os_type})

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, file_content)

    def test_get_osmo_client_error_if_missing_from_datastore(self):
        # Arrange
        self.patch_cli_config()

        # Act
        response = self.client.get('/client/osmo_client')

        # Assert
        self.assertEqual(response.status_code, 500)
        self.assertIn('unable to pull the newest clients', response.text)

    def test_get_osmo_client_redownload_if_cache_miss(self):
        # Arrange
        self.patch_cli_config()
        file_content = b'test data in a file'
        self.upload_cli_clients(file_content, str(version.VERSION))
        self.client.get('/client/osmo_client')  # cache the client locally
        os.remove(
            f'{service.CLI_STORAGE_PATH}/{service.LINUX_CLI_NAME}')

        # Act
        response = self.client.get('/client/osmo_client')

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, file_content)

    def test_get_osmo_client_updates_client_if_config_changes(self):
        # Arrange v1 client
        self.patch_cli_config()
        file_content_v1 = b'version 1 client data'
        self.upload_cli_clients(file_content_v1, str(version.VERSION))
        response = self.client.get('/client/osmo_client')
        self.assertEqual(response.content, file_content_v1)

        # Arrange v2 client
        next_version = version.VERSION.copy()
        next_version.revision = str(int(next_version.revision) + 1)
        file_content_v2 = b'version 2 client data'
        self.upload_cli_clients(file_content_v2, str(next_version))
        self.patch_cli_config(cli_name=str(next_version))

        # Act
        response = self.client.get('/client/osmo_client')

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, file_content_v2)

    def test_get_script_valid_install_sh(self):
        # Arrange / Act
        response = self.client.get('/client/install.sh')

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertIn('content-type', response.headers)
        self.assertIn('text/x-shellscript',
                      response.headers.get('content-type'))

        # Run the script through bash with the `-n` flag to check for syntax errors
        with subprocess.Popen(
            ['bash', '-n'],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        ) as process:
            _, stderr = process.communicate(input=response.content)
            self.assertEqual(process.returncode, 0,
                             f'Syntax error in install.sh: {stderr.decode()}')

    def test_get_client_version_with_config_override(self):
        # Arrange
        test_version = version.VERSION.copy()
        test_version.revision = str(int(test_version.revision) + 1)
        helpers.patch_configs(
            config_objects.PatchConfigRequest(
                configs_dict=connectors.postgres.ServiceConfig(
                    cli_config=connectors.postgres.CliConfig(cli_name=str(test_version)),
                ).dict(),
            ),
            config_type=connectors.ConfigType.SERVICE,
            username='test@nvidia.com',
        )

        # Act
        response = self.client.get('/client/version')

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), test_version)

    def test_get_client_version_without_config_override(self):
        # Arrange / Act
        response = self.client.get('/client/version')

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), version.VERSION)

    def test_get_client_version_plaintext(self):
        # Arrange / Act
        response = self.client.get(
            '/client/version', headers={'accept': 'text/plain'})

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertIn('content-type', response.headers)
        self.assertIn('text/plain', response.headers.get('content-type'))
        self.assertEqual(response.text, str(version.VERSION))

    def test_get_version_matches_version_yaml(self):
        # Arrange / Act
        response = self.client.get('/api/version')

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), version.VERSION)

    def test_outdated_client_receives_no_update_prompt(self):
        # Arrange
        test_version = version.VERSION.copy()
        test_version.major = str(int(test_version.major) - 1)

        # Act
        response = self.client.get('/api/version',
                                   headers={version.VERSION_HEADER: str(test_version)})

        # Assert
        self.assertEqual(response.status_code, 200)

    def test_outdated_client_receives_update_prompt_if_min_supported_version_is_set(self):
        # Arrange
        self.patch_cli_config(min_supported_version=str(version.VERSION))
        test_version = version.VERSION.copy()
        test_version.major = str(int(test_version.major) - 1)

        # Act
        response = self.client.get('/api/version',
                                   headers={version.VERSION_HEADER: str(test_version)})

        # Assert
        self.assertEqual(response.status_code, 400)
        self.assertIn('client/install.sh', str(response.content))

    def test_get_users_from_all_workflows(self):
        # Arrange
        users = [
            'test_user_1',
            'test_user_2',
        ]
        for user in users:
            workflow.Workflow(
                workflow_name='test_workflow',
                workflow_uuid=common.generate_unique_id(),
                user=user,
                backend='test_backend',
                logs='',
                groups=[],
                priority=wf_priority.WorkflowPriority.NORMAL,
                database=connectors.postgres.PostgresConnector.get_instance(),
            ).insert_to_db()

        # Act
        response = self.client.get('/api/users')

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertEqual(sorted(users), sorted(response.json()))

    def test_get_users_empty_results(self):
        # Arrange
        users: List[str] = []

        # Act
        response = self.client.get('/api/users')

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertCountEqual(users, response.json())

    def test_get_available_workflow_tags_from_workflow_configs(self):
        # Arrange
        tags = [
            'test_tag_1',
            'test_tag_2',
        ]
        helpers.patch_configs(
            config_objects.PatchConfigRequest(
                configs_dict=connectors.postgres.WorkflowConfig(
                    workflow_info=connectors.postgres.WorkflowInfo(tags=tags)).dict(),
            ),
            config_type=connectors.ConfigType.WORKFLOW,
            username='test@nvidia.com',
        )

        # Act
        response = self.client.get('/api/tag')

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertIn('tags', response.json())
        self.assertCountEqual(response.json()['tags'], tags)

    def test_get_available_workflow_tags_empty_results(self):
        # Arrange / Act
        response = self.client.get('/api/tag')

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertIn('tags', response.json())
        self.assertEqual(response.json()['tags'], [])

    def test_get_python_package_index(self):
        # Arrange
        self.patch_cli_config()
        package_names = ['test_package_1.0.0.whl', 'test_package_2.0.0.whl']
        package_contents = [b'test content 1', b'test content 2']
        for package_name, package_content in zip(package_names, package_contents):
            self.upload_python_package(package_content, package_name)

        # Act / Assert (simulates pip)

        # Get top level index
        response = self.client.get('/client/pypi/simple')
        html_content = response.text
        self.assertIn(
            '<a href="/client/pypi/simple/nvidia-osmo/">nvidia-osmo</a>', html_content)

        # Make request to nvidia-osmo/ endpoint
        response = self.client.get('/client/pypi/simple/nvidia-osmo')
        html_content = response.text
        for package_name in package_names:
            self.assertIn(
                f'<a href="/client/pypi/simple/nvidia-osmo/{package_name}">{package_name}</a>',
                html_content)

        # Make request for latest package
        response = self.client.get(
            f'/client/pypi/simple/nvidia-osmo/{package_names[-1]}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, package_contents[-1])

    def test_update_pool_labels(self):
        '''
        Test that the pool labels are updated when the pod spec with different
        node selector is updated.
        '''
        database = connectors.postgres.PostgresConnector.get_instance()

        # Create test backend
        self.create_test_backend(database)

        resource_spec = {
            'hostname': 'test_host',
            'available': True,
            'label_fields': {'test_label': 'test_value'},
            'taints': [],
            'allocatable_fields': {
                'ephemeral-storage': '100Gi',
                'memory': '100Gi',
                'cpu': '1',
            },
        }
        agent_helpers.update_resource(
            database, 'test_backend', backend_messages.ResourceBody(**resource_spec))
        pod_template = {
            'spec': {
                'nodeSelector': {
                    'test_label': 'test_value',
                }
            }
        }
        config_service.put_pod_template(
            name='test_pod_template',
            request=config_objects.PutPodTemplateRequest(configs=pod_template),
            username='test@nvidia.com',
        )

        another_pod_template = {
            'spec': {
                'nodeSelector': {
                    'test_label': 'another_value',
                },
            },
        }
        config_service.put_pod_template(
            name='another_pod_template',
            request=config_objects.PutPodTemplateRequest(configs=another_pod_template),
            username='test@nvidia.com',
        )

        # Use the helper function to create the pool
        self.create_test_pool(
            pool_name='test_pool',
            backend='test_backend',
            common_pod_template=['test_pod_template']
        )

        resource = workflow_objects.get_resources().resources[0]
        self.assertTrue('test_pool/test_platform' in resource.exposed_fields['pool/platform'])

        # Update to use another pod template, and update the node selectors
        config_service.patch_pool(
            name='test_pool',
            request=config_objects.PatchPoolRequest(
                configs_dict={
                    'common_pod_template': ['another_pod_template'],
                },
            ),
            username='test@nvidia.com',
        )
        updated_resource = workflow_objects.get_resources().resources[0]
        # The pool/platform should be empty because the node now matches to no pool/platform
        self.assertEqual(updated_resource.exposed_fields['pool/platform'], [])

    def test_patch_pool_config(self):
        '''
        Simple test for patching the pool config.
        '''
        database = connectors.postgres.PostgresConnector.get_instance()
        self.create_test_backend(database, backend_name='test_backend')

        # Use the helper function to create the pool
        self.create_test_pool(pool_name='test_pool', backend='test_backend')

        pool = self.client.get('/api/configs/pool/test_pool').json()
        self.assertEqual(pool['name'], 'test_pool')
        self.assertEqual(pool['enable_maintenance'], False)
        self.assertEqual(pool['description'], 'test_description')
        self.assertEqual(pool['default_platform'], 'test_platform')
        self.assertTrue('test_platform' in pool['platforms'])
        self.assertEqual(pool['backend'], 'test_backend')

        config_service.patch_pool(
            name='test_pool',
            request=config_objects.PatchPoolRequest(
                configs_dict={
                    'enable_maintenance': True,
                    'description': 'updated_description',
                },
            ),
            username='test@nvidia.com',
        )
        patched_pool = self.client.get('/api/configs/pool/test_pool').json()
        # Check updated fields
        self.assertEqual(patched_pool['enable_maintenance'], True)
        self.assertEqual(patched_pool['description'], 'updated_description')

        # Check unchanged fields
        self.assertEqual(patched_pool['name'], 'test_pool')
        self.assertEqual(patched_pool['default_platform'], 'test_platform')
        self.assertTrue('test_platform' in patched_pool['platforms'])
        self.assertEqual(patched_pool['backend'], 'test_backend')

    def test_substitute_tokens(self):
        '''
        Test that the tokens are substituted correctly in the pod spec.
        '''
        # Create a dummy TaskGroup object for testing token substitution
        database = connectors.PostgresConnector.get_instance()

        # Setup backend
        self.create_test_backend(database)

        # Setup workflow configs
        workflow_configs = connectors.WorkflowConfig(**{
            'workflow_data': {
                'credential': {
                    'endpoint': 's3://bucket.io/AUTH_myteam/workflows',
                    'access_key_id': 'myteam',
                    'access_key': 'test_access_key',
                    'region': 'us-east-1',
                },
            },
        })
        config_service.put_workflow_configs(
            request=config_objects.PutWorkflowRequest(
                configs=workflow_configs,
            ),
            username='test@nvidia.com',
        )

        # Setup pod template with tokens
        pod_template = {
            'spec': {
                'nodeSelector': {
                    'kubernetes.io/arch': 'amd64',
                },
                'volumes': [
                    {
                        'name': 'amlfs-01',
                        'persistentVolumeClaim': {
                            'claimName': 'amlfs-01'
                        }
                    },
                ],
                'containers': [
                    {
                        'name': '{{USER_CONTAINER_NAME}}',
                        'volumeMounts': [
                            {
                                'name': 'amlfs-01',
                                'subPath': 'gear/{{WF_SUBMITTED_BY}}',
                                'mountPath': '/mnt/amlfs-01/{{WF_SUBMITTED_BY}}'
                            },
                        ]
                    },
                    {
                        'name': 'osmo-ctrl',
                        'volumeMounts': [
                            {
                                'name': 'amlfs-01',
                                'subPath': 'gear/{{WF_SUBMITTED_BY}}',
                                'mountPath': '/mnt/amlfs-01/{{WF_SUBMITTED_BY}}'
                            },

                        ]
                    }
                ]
            }
        }
        config_service.put_pod_template(
            name='test_pod_template',
            request=config_objects.PutPodTemplateRequest(configs=pod_template),
            username='test@nvidia.com',
        )

        # Use the helper function to create the pool
        self.create_test_pool(
            pool_name='test_pool',
            backend='test_backend',
            common_pod_template=['test_pod_template']
        )

        # Create task group and convert to pod specs
        task_group = self.create_task_group(database)
        pods, _, _ = task_group.convert_all_pod_specs(
            common.generate_unique_id(),
            'test@nvidia.com',
            'test_pool',
            workflow_configs,
            task_common.WorkflowPlugins(),
            wf_priority.WorkflowPriority.NORMAL,
            None
        )

        # Verify token substitution in pod specs
        containers = pods[0]['spec']['containers']
        found_test_task = False
        found_osmo_ctrl = False
        for container in containers:
            if container['name'] in ['test-task', 'osmo-ctrl']:
                found_volume_mount = False
                for volume_mount in container['volumeMounts']:
                    if volume_mount['name'] == 'amlfs-01':
                        found_volume_mount = True
                        # Check that the subPath and mountPath are resolved correctly
                        self.assertEqual(volume_mount['subPath'], 'gear/test')
                        self.assertEqual(volume_mount['mountPath'], '/mnt/amlfs-01/test')
                self.assertTrue(found_volume_mount)
                if container['name'] == 'test-task':
                    found_test_task = True
                elif container['name'] == 'osmo-ctrl':
                    found_osmo_ctrl = True
        # Check that both containers were found, and paths were resolved correctly
        self.assertTrue(found_test_task)
        self.assertTrue(found_osmo_ctrl)

    def patch_cli_config(self,
                         cli_name: str | None = None,
                         min_supported_version: str | None = None):
        helpers.patch_configs(
            config_objects.PatchConfigRequest(
                configs_dict=connectors.postgres.ServiceConfig(
                    cli_config=connectors.postgres.CliConfig(
                        cli_name=cli_name,
                        min_supported_version=min_supported_version,
                        credential=credentials.DataCredential(
                            endpoint=f's3://{service_fixture.TEST_BUCKET_NAME}/client/dev',
                            access_key_id=service_fixture.TEST_ACCESS_KEY_ID,
                            access_key=service_fixture.TEST_ACCESS_KEY,
                        ),
                    ),
                ).dict(),
            ),
            config_type=connectors.ConfigType.SERVICE,
            username='test@nvidia.com',
        )

    def upload_cli_clients(self, file_content: bytes, cli_version: str):
        self.s3_client.upload_fileobj(
            io.BytesIO(file_content),
            service_fixture.TEST_BUCKET_NAME,
            f'client/dev/osmo-client-linux_{cli_version}.tgz',
        )
        self.s3_client.upload_fileobj(
            io.BytesIO(file_content),
            service_fixture.TEST_BUCKET_NAME,
            f'client/dev/osmo-client-macos_{cli_version}.pkg',
        )

    def upload_python_package(self, file_content: bytes, package_name: str):
        self.s3_client.upload_fileobj(
            io.BytesIO(file_content),
            service_fixture.TEST_BUCKET_NAME,
            f'client/dev/pypi/simple/nvidia-osmo/{package_name}',
        )


if __name__ == '__main__':
    runner.run_test()
