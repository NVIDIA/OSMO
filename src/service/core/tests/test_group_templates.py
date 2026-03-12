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

import copy
import datetime
import os
import tempfile

from src.lib.utils import common, osmo_errors, priority as wf_priority
from src.service.core.config import config_service, objects as config_objects
from src.service.core.tests import fixture as service_fixture
from src.utils import connectors
from src.utils.job import common as task_common, task
from src.utils.progress_check import progress
from src.tests.common import runner


# A minimal valid ComputeDomain group template used across tests
_COMPUTE_DOMAIN_TEMPLATE = {
    'apiVersion': 'resource.nvidia.com/v1beta1',
    'kind': 'ComputeDomain',
    'metadata': {
        'name': 'compute-domain-{{WF_GROUP_UUID}}',
    },
    'spec': {
        'channel': {
            'resourceClaimTemplate': {
                'name': 'compute-domain-{{WF_GROUP_UUID}}',
            }
        }
    },
}


class GroupTemplateCRUDTest(service_fixture.ServiceTestFixture):
    """Tests for Group Template REST API endpoints: PUT, GET, LIST, DELETE."""

    def setUp(self):
        super().setUp()
        self.database = connectors.PostgresConnector.get_instance()

    def test_put_and_get_single_template(self):
        """PUT a group template via API, then GET it and verify the body matches."""
        self.create_test_group_template('compute-domain', _COMPUTE_DOMAIN_TEMPLATE)

        response = self.client.get('/api/configs/group_template/compute-domain')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), _COMPUTE_DOMAIN_TEMPLATE)

    def test_list_group_templates_returns_all(self):
        """PUT two group templates, then LIST returns both by name."""
        second_template = {
            'apiVersion': 'v1',
            'kind': 'ConfigMap',
            'metadata': {'name': 'shared-config'},
        }
        self.create_test_group_template('compute-domain', _COMPUTE_DOMAIN_TEMPLATE)
        self.create_test_group_template('shared-config', second_template)

        response = self.client.get('/api/configs/group_template')
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIsInstance(body, dict)
        self.assertIn('compute-domain', body)
        self.assertIn('shared-config', body)

    def test_put_bulk_group_templates(self):
        """PUT multiple templates in one request via the bulk endpoint."""
        second_template = {
            'apiVersion': 'v1',
            'kind': 'ConfigMap',
            'metadata': {'name': 'shared-config'},
        }
        config_service.put_group_templates(
            request=config_objects.PutGroupTemplatesRequest(configs={
                'compute-domain': _COMPUTE_DOMAIN_TEMPLATE,
                'shared-config': second_template,
            }),
            username='test@nvidia.com',
        )

        response = self.client.get('/api/configs/group_template')
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn('compute-domain', body)
        self.assertIn('shared-config', body)

    def test_put_overwrites_existing_template(self):
        """PUT an existing template name replaces it with the new body."""
        self.create_test_group_template('compute-domain', _COMPUTE_DOMAIN_TEMPLATE)

        updated = copy.deepcopy(_COMPUTE_DOMAIN_TEMPLATE)
        updated['metadata']['name'] = 'compute-domain-updated'
        self.create_test_group_template('compute-domain', updated)

        response = self.client.get('/api/configs/group_template/compute-domain')
        self.assertEqual(response.json()['metadata']['name'], 'compute-domain-updated')

    def test_delete_unused_template_succeeds(self):
        """DELETE a template that is not assigned to any pool removes it from the DB."""
        self.create_test_group_template('compute-domain', _COMPUTE_DOMAIN_TEMPLATE)

        config_service.delete_group_template(
            name='compute-domain',
            request=config_objects.ConfigsRequest(),
            username='test@nvidia.com',
        )

        response = self.client.get('/api/configs/group_template/compute-domain')
        self.assertEqual(response.status_code, 404)

    def test_delete_template_in_use_raises_error(self):
        """DELETE a template referenced by a pool raises OSMOUserError with pool name in message."""
        self.create_test_backend(self.database)
        self.create_test_group_template('compute-domain', _COMPUTE_DOMAIN_TEMPLATE)
        self.create_test_pool(
            pool_name='nvlink-pool',
            backend='test_backend',
            common_group_templates=['compute-domain'],
        )

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            config_service.delete_group_template(
                name='compute-domain',
                request=config_objects.ConfigsRequest(),
                username='test@nvidia.com',
            )
        self.assertIn('nvlink-pool', str(context.exception))

    def test_template_missing_api_version_raises_error(self):
        """A template without apiVersion raises OSMOUserError on insert."""
        invalid = {'kind': 'ComputeDomain', 'metadata': {'name': 'cd-1'}}
        with self.assertRaises(osmo_errors.OSMOUserError):
            connectors.GroupTemplate(group_template=invalid).insert_into_db(
                self.database, 'invalid-template')

    def test_template_missing_kind_raises_error(self):
        """A template without kind raises OSMOUserError on insert."""
        invalid = {'apiVersion': 'v1', 'metadata': {'name': 'cd-1'}}
        with self.assertRaises(osmo_errors.OSMOUserError):
            connectors.GroupTemplate(group_template=invalid).insert_into_db(
                self.database, 'invalid-template')

    def test_template_missing_metadata_name_raises_error(self):
        """A template without metadata.name raises OSMOUserError on insert."""
        invalid = {'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': {}}
        with self.assertRaises(osmo_errors.OSMOUserError):
            connectors.GroupTemplate(group_template=invalid).insert_into_db(
                self.database, 'invalid-template')

    def test_template_with_namespace_raises_error(self):
        """A template with metadata.namespace raises OSMOUserError on insert."""
        invalid = copy.deepcopy(_COMPUTE_DOMAIN_TEMPLATE)
        invalid['metadata']['namespace'] = 'user-namespace'
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            connectors.GroupTemplate(group_template=invalid).insert_into_db(
                self.database, 'namespaced-template')
        self.assertIn('namespace', str(context.exception).lower())


class PoolGroupTemplateTest(service_fixture.ServiceTestFixture):
    """Tests that Pool.calculate_group_templates correctly populates parsed_group_templates."""

    def setUp(self):
        super().setUp()
        self.database = connectors.PostgresConnector.get_instance()
        self.create_test_backend(self.database)

    def test_pool_with_single_group_template(self):
        """Pool assigned one group template has it in parsed_group_templates."""
        self.create_test_group_template('compute-domain', _COMPUTE_DOMAIN_TEMPLATE)
        self.create_test_pool(
            pool_name='nvlink-pool',
            backend='test_backend',
            common_group_templates=['compute-domain'],
        )

        pool = connectors.Pool.fetch_from_db(self.database, 'nvlink-pool')
        self.assertEqual(len(pool.parsed_group_templates), 1)
        self.assertEqual(
            pool.parsed_group_templates[0]['metadata']['name'],
            _COMPUTE_DOMAIN_TEMPLATE['metadata']['name'],
        )

    def test_pool_with_multiple_distinct_templates(self):
        """Pool assigned two templates with different kinds has both in parsed_group_templates."""
        second_template = {
            'apiVersion': 'v1',
            'kind': 'ConfigMap',
            'metadata': {'name': 'shared-config'},
        }
        self.create_test_group_template('compute-domain', _COMPUTE_DOMAIN_TEMPLATE)
        self.create_test_group_template('shared-config', second_template)
        self.create_test_pool(
            pool_name='nvlink-pool',
            backend='test_backend',
            common_group_templates=['compute-domain', 'shared-config'],
        )

        pool = connectors.Pool.fetch_from_db(self.database, 'nvlink-pool')
        self.assertEqual(len(pool.parsed_group_templates), 2)
        kinds = {t['kind'] for t in pool.parsed_group_templates}
        self.assertIn('ComputeDomain', kinds)
        self.assertIn('ConfigMap', kinds)

    def test_pool_group_templates_merged_on_same_resource_key(self):
        """Two templates with the same (apiVersion, kind, metadata.name) are merged into one entry."""
        base_template = {
            'apiVersion': 'resource.nvidia.com/v1beta1',
            'kind': 'ComputeDomain',
            'metadata': {'name': 'compute-domain-shared'},
            'spec': {'channel': {'mode': 'single'}},
        }
        patch_template = {
            'apiVersion': 'resource.nvidia.com/v1beta1',
            'kind': 'ComputeDomain',
            'metadata': {'name': 'compute-domain-shared'},
            'spec': {'extra': 'value'},
        }
        self.create_test_group_template('base-cd', base_template)
        self.create_test_group_template('patch-cd', patch_template)
        self.create_test_pool(
            pool_name='nvlink-pool',
            backend='test_backend',
            common_group_templates=['base-cd', 'patch-cd'],
        )

        pool = connectors.Pool.fetch_from_db(self.database, 'nvlink-pool')
        self.assertEqual(len(pool.parsed_group_templates), 1)
        merged = pool.parsed_group_templates[0]
        self.assertEqual(merged['spec']['channel']['mode'], 'single')
        self.assertEqual(merged['spec']['extra'], 'value')

    def test_pool_parsed_templates_updated_when_template_changes(self):
        """After updating a group template, the pool's parsed_group_templates reflects the change."""
        self.create_test_group_template('compute-domain', _COMPUTE_DOMAIN_TEMPLATE)
        self.create_test_pool(
            pool_name='nvlink-pool',
            backend='test_backend',
            common_group_templates=['compute-domain'],
        )

        updated = copy.deepcopy(_COMPUTE_DOMAIN_TEMPLATE)
        updated['spec']['channel']['resourceClaimTemplate']['name'] = 'updated-name'
        self.create_test_group_template('compute-domain', updated)

        pool = connectors.Pool.fetch_from_db(self.database, 'nvlink-pool')
        self.assertEqual(
            pool.parsed_group_templates[0]['spec']['channel']['resourceClaimTemplate']['name'],
            'updated-name',
        )

    def test_pool_with_no_group_templates(self):
        """Pool with empty common_group_templates has an empty parsed_group_templates."""
        self.create_test_pool(pool_name='plain-pool', backend='test_backend')

        pool = connectors.Pool.fetch_from_db(self.database, 'plain-pool')
        self.assertEqual(pool.parsed_group_templates, [])

    def test_pool_nonexistent_group_template_raises_error(self):
        """Assigning a non-existent group template name to a pool raises an error."""
        with self.assertRaises(osmo_errors.OSMOUsageError):
            self.create_test_pool(
                pool_name='bad-pool',
                backend='test_backend',
                common_group_templates=['does-not-exist'],
            )


class CreateGroupGroupTemplateTest(service_fixture.ServiceTestFixture):
    """Integration tests that group template resources are rendered and prepended during
    task group KB spec generation (get_kb_specs)."""

    def setUp(self):
        super().setUp()
        self.database = connectors.PostgresConnector.get_instance()
        self.create_test_backend(self.database)

        # Set up minimal workflow config (required by get_kb_specs)
        workflow_config = connectors.WorkflowConfig(
            workflow_data={
                'credential': {
                    'endpoint': 's3://bucket.io/AUTH_test/workflows',
                    'access_key_id': 'test',
                    'access_key': 'test_key',
                    'region': 'us-east-1',
                },
            },
        )
        config_service.put_workflow_configs(
            request=config_objects.PutWorkflowRequest(configs=workflow_config),
            username='test@nvidia.com',
        )

        self._tmpdir_obj = tempfile.TemporaryDirectory()
        self._progress_writer = progress.ProgressWriter(
            os.path.join(self._tmpdir_obj.name, 'progress.txt'))

        self.create_test_group_template('compute-domain', _COMPUTE_DOMAIN_TEMPLATE)
        self.create_test_pool(
            pool_name='nvlink-pool',
            backend='test_backend',
            common_group_templates=['compute-domain'],
        )
        self.task_group = self.create_task_group(self.database)

    def tearDown(self):
        self._tmpdir_obj.cleanup()
        super().tearDown()

    def _run_get_kb_specs(self, pool_name: str, task_group: task.TaskGroup):
        """Helper to invoke get_kb_specs with standard test arguments."""
        workflow_config = self.database.get_workflow_configs()
        backend_config_cache = connectors.BackendConfigCache()
        return task_group.get_kb_specs(
            workflow_uuid=common.generate_unique_id(),
            user='test@nvidia.com',
            workflow_config=workflow_config,
            backend_config_cache=backend_config_cache,
            backend_name='test_backend',
            pool=pool_name,
            progress_writer=self._progress_writer,
            progress_iter_freq=datetime.timedelta(minutes=1),
            workflow_plugins=task_common.WorkflowPlugins(),
            priority=wf_priority.WorkflowPriority.NORMAL,
        )

    def test_group_template_resources_prepended(self):
        """Group template resources appear before pod/secret resources in kb_resources."""
        kb_resources, _ = self._run_get_kb_specs('nvlink-pool', self.task_group)

        self.assertGreater(len(kb_resources), 0)
        first_resource = kb_resources[0]
        self.assertEqual(first_resource['apiVersion'], _COMPUTE_DOMAIN_TEMPLATE['apiVersion'])
        self.assertEqual(first_resource['kind'], _COMPUTE_DOMAIN_TEMPLATE['kind'])

    def test_group_template_variable_substitution_in_kb_specs(self):
        """WF_GROUP_UUID token in the template name is replaced with the actual group UUID."""
        kb_resources, _ = self._run_get_kb_specs('nvlink-pool', self.task_group)

        group_template_resource = kb_resources[0]
        rendered_name = group_template_resource['metadata']['name']
        self.assertNotIn('{{', rendered_name)
        self.assertIn(self.task_group.group_uuid, rendered_name)

    def test_group_template_osmo_labels_on_rendered_resource(self):
        """OSMO labels (osmo.group_uuid, osmo.workflow_uuid, etc.) are present on the
        rendered resource."""
        kb_resources, _ = self._run_get_kb_specs('nvlink-pool', self.task_group)

        rendered_labels = kb_resources[0]['metadata']['labels']
        self.assertIn('osmo.group_uuid', rendered_labels)
        self.assertIn('osmo.workflow_uuid', rendered_labels)
        self.assertTrue(rendered_labels['osmo.group_uuid'])

    def test_group_template_resource_types_recorded_on_task_group(self):
        """After get_kb_specs, group_template_resource_types on the TaskGroup is populated."""
        self._run_get_kb_specs('nvlink-pool', self.task_group)

        self.assertEqual(len(self.task_group.group_template_resource_types), 1)
        recorded = self.task_group.group_template_resource_types[0]
        self.assertEqual(recorded['apiVersion'], _COMPUTE_DOMAIN_TEMPLATE['apiVersion'])
        self.assertEqual(recorded['kind'], _COMPUTE_DOMAIN_TEMPLATE['kind'])

    def test_no_group_templates_no_prepended_resources(self):
        """A pool with no group templates does not prepend any extra resources."""
        self.create_test_pool(pool_name='plain-pool', backend='test_backend')
        task_group = self.create_task_group(self.database)

        kb_resources, _ = self._run_get_kb_specs('plain-pool', task_group)

        self.assertEqual(task_group.group_template_resource_types, [])

        # First resource should not be a ComputeDomain
        for resource in kb_resources:
            self.assertNotEqual(resource.get('kind'), 'ComputeDomain')


if __name__ == '__main__':
    runner.run_test()
