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
Functional tests for APIs defined in workflow_service.py
"""

import logging

from fastapi import testclient

from src.service.agent import helpers as agent_service_helpers
from src.service.core import service
from src.service.core.workflow import objects
from src.tests.common import fixtures, runner
from src.tests.common.registry import registry
from src.utils import connectors
from src.utils.connectors import postgres
from src.utils.job import workflow
from src.utils import backend_messages


logger = logging.getLogger(__name__)


class WorkflowServiceTestCase(
    fixtures.SslProxyFixture,
    fixtures.PostgresFixture,
    fixtures.PostgresTestIsolationFixture,
    fixtures.RedisStorageFixture,
    fixtures.DockerRegistryFixture,
    fixtures.OsmoTestFixture,
):
    """
    Functional tests for APIs defined in workflow_service.py
    """

    TEST_IMAGE_NAME = 'test_image'

    client: testclient.TestClient

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        # Setup the service application and correponding TestClient
        service.configure_app(
            service.app,
            objects.WorkflowServiceConfig(
                log_file=None,
                postgres_host=cls.postgres_container.get_container_host_ip(),
                postgres_port=cls.postgres_container.get_database_port(),
                postgres_password=cls.postgres_container.password,
                postgres_database_name=cls.postgres_container.dbname,
                postgres_user=cls.postgres_container.username,
                redis_host=cls.redis_container.get_container_host_ip(),
                redis_port=cls.redis_container.get_exposed_port(cls.redis_params.port),
                redis_password=cls.redis_params.password,
                redis_db_number=cls.redis_params.db_number,
                redis_tls_enable=False,
                method='dev',
            ),
        )
        cls.client = testclient.TestClient(service.app)

        # Create a test image
        cls.registry_container.create_image(cls.TEST_IMAGE_NAME)

    def test_submit_workflow_success(self):
        # Arrange
        pool_name = 'test_pool'
        backend_name = 'test_backend'
        platform_name = 'test_platform'
        self.create_backend(backend_name)
        self.create_pool(pool_name, backend_name, platform_name)
        workflow_template = self.create_workflow_template(platform_name)

        # Act
        response = self.client.post(
            f'/api/pool/{pool_name}/workflow',
            json=workflow_template.dict(),
        )

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertIn('name', response.json())
        workflow_obj = workflow.Workflow.fetch_from_db(
            postgres.PostgresConnector.get_instance(),
            response.json()['name'],
        )
        self.assertEqual(workflow_obj.status, workflow.WorkflowStatus.PENDING)
        self.assertTrue(
            self.is_workflow_job_in_queue(f'dedupe:{workflow_obj.workflow_uuid}-submit'),
        )

    def create_backend(self, backend_name: str):
        postgres_connector = postgres.PostgresConnector.get_instance()
        message = backend_messages.InitBody(
            k8s_uid='test_k8s_uid',
            k8s_namespace='test_k8s_namespace',
            version='test_version',
            node_condition_prefix='test_prefix/',
        )
        agent_service_helpers.create_backend(
            postgres_connector,
            backend_name,
            message,
        )

    def create_pool(
        self,
        pool_name: str,
        backend_name: str,
        platform_name: str,
    ):
        resp = self.client.put(
            '/api/configs/pool',
            json={
                'description': 'Creating test_pool',
                'configs': {
                    pool_name: connectors.Pool(
                        name=pool_name,
                        backend=backend_name,
                        platforms={
                            platform_name: connectors.Platform(),
                        },
                    ).dict(),
                },
            },
        )
        self.assertEqual(resp.status_code, 200, f'Failed to create pool: {resp.json()}')

    def create_workflow_template(self, platform_name: str) -> workflow.TemplateSpec:
        # SSL Proxy is used to access the registry from the workflow service
        registry_url = self.ssl_proxy.get_endpoint(
            registry.REGISTRY_NAME, registry.REGISTRY_PORT)

        return workflow.TemplateSpec(
            file=f'''workflow:
  name: test_workflow
  resources:
    default:
      cpu: 1
      memory: 1Gi
      storage: 1Gi
      platform: {platform_name}
  tasks:
  - name: task1
    image: {f'{registry_url}/{self.TEST_IMAGE_NAME}'}
    command: [sh]
    args: [/tmp/run.sh]
    files:
    - contents: |
        echo "task 1"
      path: /tmp/run.sh
  - name: task2
    image: {f'{registry_url}/{self.TEST_IMAGE_NAME}'}
    command: [sh]
    args: [/tmp/run.sh]
    files:
    - contents: |
        echo "task 2"
      path: /tmp/run.sh
    inputs:
    - task: task1
''',
        )

    def is_workflow_job_in_queue(self, job_key: str) -> bool:
        """
        Given a job key, check that the job is in the queue via Redis.

        Args:
            job_key (str): The UUID of the job to check for
        """
        logger.info('Checking if job %s is in queue', job_key)
        redis_client = self.redis_container.get_client()
        return redis_client.get(job_key) is not None


if __name__ == '__main__':
    runner.run_test()
