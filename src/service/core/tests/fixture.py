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

import logging
import os
import shutil

from fastapi import testclient

from src.lib.utils import common, jinja_sandbox
from src.service.agent import helpers as agent_helpers
from src.service.core import service
from src.service.core.config import config_service
from src.service.core.config import objects as config_objects
from src.service.core.workflow import objects
from src.utils import connectors, backend_messages
from src.utils.job import task
from src.tests.common import fixtures

logger = logging.getLogger(__name__)


TEST_BUCKET_NAME = 'test-bucket'
TEST_ACCESS_KEY_ID = 'testcontainers-localstack'
TEST_ACCESS_KEY = 'testcontainers-localstack'


class ServiceTestFixture(fixtures.PostgresFixture,
                         fixtures.PostgresTestIsolationFixture,
                         fixtures.S3StorageFixture,
                         fixtures.RedisStorageFixture,
                         fixtures.OsmoTestFixture):
    """
    A base test fixture for service tests. Sets up S3, Postgres, and the client to be tested.
    Exposes the client as self.client.
    """

    client: testclient.TestClient

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        # Prepare a bucket in S3 storage
        cls.s3_client.create_bucket(Bucket=TEST_BUCKET_NAME)

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

        jinja_sandbox.SandboxedJinjaRenderer._instance = \
            jinja_sandbox.SandboxedJinjaRenderer(max_time=5)  # pylint: disable=protected-access

    def tearDown(self):
        # Delete all objects in the bucket
        s3_objects = self.s3_client.list_objects_v2(
            Bucket=TEST_BUCKET_NAME)
        if 'Contents' in s3_objects:
            for obj in s3_objects['Contents']:
                self.s3_client.delete_object(
                    Bucket=TEST_BUCKET_NAME, Key=obj['Key'])
                logger.info('Deleted object: %s.', obj['Key'])

        # Remove local CLI cache
        if os.path.exists(service.CLI_STORAGE_PATH):
            shutil.rmtree(service.CLI_STORAGE_PATH)

        super().tearDown()

    def create_test_backend(self, database=None, backend_name='test_backend'):
        """Helper function to create a test backend.

        Args:
            database: Database connector instance. If None, gets the current instance.
            backend_name: Name of the backend to create.

        Returns:
            The created backend configuration
        """
        if database is None:
            database = connectors.postgres.PostgresConnector.get_instance()

        backend = {
            'k8s_uid': 'test_uid',
            'k8s_namespace': 'test_namespace',
            'version': 'test_version',
            'node_condition_prefix': 'test.osmo.nvidia.com/',
        }
        agent_helpers.create_backend(
            database, backend_name, backend_messages.InitBody(**backend))

    def create_test_pool(self, pool_name='test_pool', description='test_description',
                         default_platform='test_platform', backend='test_backend',
                         common_pod_template=None, enable_maintenance=False):
        """Helper function to create a test pool with configurable parameters.

        Args:
            pool_name: Name of the pool
            description: Description of the pool
            default_platform: Default platform for the pool
            backend: Backend for the pool
            common_pod_template: List of pod templates to use (defaults to None)
            enable_maintenance: Whether maintenance mode is enabled

        Returns:
            The created pool configuration
        """
        pool_config = {
            'name': pool_name,
            'description': description,
            'default_platform': default_platform,
            'platforms': {
                default_platform: {},
            },
            'backend': backend,
            'enable_maintenance': enable_maintenance,
        }

        if common_pod_template:
            pool_config['common_pod_template'] = common_pod_template

        config_service.put_pool(
            name=pool_name,
            request=config_objects.PutPoolRequest(
                configs=connectors.Pool(**pool_config)
            ),
            username='test@nvidia.com',
        )
        return pool_config

    def create_task_group(self, database):
        """Helper function to create a task group for token substitution testing."""
        # Create workflow record in database
        workflow_uuid = common.generate_unique_id()
        cmd = '''
            INSERT into workflows
            (workflow_id, workflow_name, workflow_uuid, submitted_by,
             backend, logs, exec_timeout, queue_timeout)
            values (%s , %s, %s, %s, %s, %s, %s, %s)
        '''
        database.execute_commit_command(
            cmd,
            (
                'test_workflow-1',
                'test_workflow',
                workflow_uuid,
                'svc-osmo-admin@nvidia.com',
                'test_backend',
                '', 100, 100
            )
        )

        # Create task spec and group spec
        task_spec = task.TaskSpec(
            name='test_task',
            lead=True,
            image='test_image',
            command=['test_command'],
            resources=connectors.ResourceSpec(
                platform='test_platform',
                cpu=1,
                memory='1Gi',
            ),
            backend='test_backend',
        )
        group_spec = task.TaskGroupSpec(
            name='test_group',
            barrier=True,
            tasks=[task_spec]
        )

        # Create task object and task group
        task_obj = task.Task(
            workflow_id_internal='test_workflow-1',
            workflow_uuid=workflow_uuid,
            name='test_task',
            group_name='test_group',
            task_uuid=common.generate_unique_id(),
            task_db_key=common.generate_unique_id(),
            database=database,
            exit_actions={},
            node_name='test_node',
            backend='test_backend',
            lead=True
        )
        task_group = task.TaskGroup(
            workflow_id_internal='test_workflow-1',
            name='test_group',
            group_uuid=common.generate_unique_id(),
            spec=group_spec,
            tasks=[task_obj],
            remaining_upstream_groups=set(),
            downstream_groups=set(),
            database=database
        )

        return task_group
