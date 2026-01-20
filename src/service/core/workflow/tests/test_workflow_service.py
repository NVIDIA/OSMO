# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION. All rights reserved.
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

import concurrent.futures
import logging
import threading

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
                postgres_pool_maxconn=10,
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

    def test_concurrent_requests_exceed_pool_size(self):
        """
        Test that the service handles concurrent requests exceeding the
        connection pool size (postgres_pool_maxconn is set to 10 in fixture).

        This test sends 20 concurrent requests simultaneously to verify
        the ThreadedConnectionPool correctly queues requests when all
        connections are in use.
        """
        # Arrange
        pool_name = 'test_pool_concurrent'
        backend_name = 'test_backend_concurrent'
        platform_name = 'test_platform_concurrent'
        self.create_backend(backend_name)
        self.create_pool(pool_name, backend_name, platform_name)

        num_concurrent_requests = 20
        results = []
        errors = []
        barrier = threading.Barrier(num_concurrent_requests)

        def submit_workflow(request_id: int):
            """Submit a workflow and return the response."""
            try:
                # Wait for all threads to be ready before making requests
                barrier.wait(timeout=10)

                # Create a unique workflow template for each request
                registry_url = self.ssl_proxy.get_endpoint(
                    registry.REGISTRY_NAME, registry.REGISTRY_PORT)

                workflow_template = workflow.TemplateSpec(
                    file=f'''workflow:
  name: concurrent_test_workflow_{request_id}
  resources:
    default:
      cpu: 1
      memory: 1Gi
      storage: 1Gi
      platform: {platform_name}
  tasks:
  - name: task1
    image: {registry_url}/{self.TEST_IMAGE_NAME}
    command: [sh]
    args: ["-c", "echo 'request {request_id}'"]
''',
                )

                response = self.client.post(
                    f'/api/pool/{pool_name}/workflow',
                    json=workflow_template.dict(),
                )
                return (request_id, response.status_code, response.json())
            except Exception as e: # pylint: disable=broad-exception-caught
                return (request_id, None, str(e))

        # Act - Submit all requests concurrently using ThreadPoolExecutor
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=num_concurrent_requests
        ) as executor:
            futures = [
                executor.submit(submit_workflow, i)
                for i in range(num_concurrent_requests)
            ]

            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                results.append(result)
                if result[1] != 200:
                    errors.append(result)

        # Assert - All requests should succeed
        logger.info(
            'Concurrent request results: %d successful, %d failed',
            len([r for r in results if r[1] == 200]),
            len(errors),
        )

        for error in errors:
            logger.error(
                'Request %d failed with status %s: %s',
                error[0], error[1], error[2],
            )

        self.assertEqual(
            len(results),
            num_concurrent_requests,
            f'Expected {num_concurrent_requests} results, got {len(results)}',
        )
        self.assertEqual(
            len(errors),
            0,
            f'Expected 0 errors, got {len(errors)}: {errors}',
        )

        # Verify all workflows were created successfully
        successful_workflows = [r for r in results if r[1] == 200]
        self.assertEqual(
            len(successful_workflows),
            num_concurrent_requests,
            f'Expected {num_concurrent_requests} successful workflows',
        )

        # Verify each workflow is in PENDING status
        for request_id, status_code, response_json in successful_workflows:
            self.assertEqual(
                status_code,
                200,
                f'Workflow {request_id} should have status code 200, got {status_code}',
            )
            workflow_obj = workflow.Workflow.fetch_from_db(
                postgres.PostgresConnector.get_instance(),
                response_json['name'],
            )
            self.assertEqual(
                workflow_obj.status,
                workflow.WorkflowStatus.PENDING,
                f'Workflow {request_id} should be in PENDING status',
            )


if __name__ == '__main__':
    runner.run_test()
