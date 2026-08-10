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

import collections
import datetime
import unittest
from unittest import mock

import pydantic

from src.lib.utils import common, osmo_errors, priority as wf_priority
from src.utils import connectors
from src.utils.job import task, workflow


def _task_dict(name: str) -> dict:
    return {'name': name, 'image': 'image', 'command': ['echo']}


def _workflow_spec(task_name: str = 'task', pool: str = 'pool') -> workflow.WorkflowSpec:
    return workflow.WorkflowSpec(
        name='wf',
        pool=pool,
        groups=[{'name': 'group', 'tasks': [_task_dict(task_name)]}])


def _pool(default_platform: str | None = 'cpu',
          platforms: dict | None = None,
          topology_keys: list | None = None) -> connectors.Pool:
    return connectors.Pool(
        name='pool',
        backend='backend',
        default_platform=default_platform,
        platforms=platforms if platforms is not None else {'cpu': connectors.Platform()},
        topology_keys=topology_keys or [])


def _resources_entry(exposed_fields: dict) -> workflow.ResourcesEntry:
    return workflow.ResourcesEntry.model_construct(
        hostname='node-1',
        exposed_fields=exposed_fields,
        taints=[],
        usage_fields={},
        non_workflow_usage_fields={},
        allocatable_fields={},
        platform_allocatable_fields=None,
        platform_available_fields=None,
        platform_workflow_allocatable_fields=None,
        config_fields=None,
        backend='backend',
        label_fields=None,
        pool_platform_labels={},
        resource_type=connectors.BackendResourceType.SHARED)


def _assertion(left: str, right: str) -> connectors.ResourceAssertion:
    return connectors.ResourceAssertion(
        operator=connectors.ResourceAssertion.OperatorType.GE,
        left_operand=left,
        right_operand=right,
        assert_message='not enough resources')


def _mock_database() -> mock.Mock:
    database = mock.Mock(spec=connectors.PostgresConnector)
    database.get_workflow_configs.return_value = connectors.WorkflowConfig()
    return database


def _workflow_obj(database: mock.Mock,
                  status: workflow.WorkflowStatus = workflow.WorkflowStatus.PENDING,
                  workflow_id_internal: str | None = 'wf-1') -> workflow.Workflow:
    return workflow.Workflow(
        workflow_name='wf',
        workflow_id_internal=workflow_id_internal,
        workflow_uuid='a' * 32,
        groups=[],
        user='alice',
        logs='',
        database=database,
        backend='backend',
        pool='pool',
        status=status,
        priority=wf_priority.WorkflowPriority.NORMAL)


class WorkflowSpecUnnamedSpecEntriesTest(unittest.TestCase):
    """The duplicate-name check must skip entries that carry no name at all."""

    def test_task_spec_objects_are_checked_for_duplicate_names(self):
        first = task.TaskSpec(name='dup', image='image', command=['echo'])
        second = task.TaskSpec(name='DUP', image='image', command=['echo'])

        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.WorkflowSpec(name='wf', tasks=[first, second])

        self.assertIn('same name', str(ctx.exception))

    def test_task_entry_without_name_is_not_reported_as_duplicate(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.WorkflowSpec(name='wf', tasks=[{'image': 'image', 'command': ['echo']}])

        self.assertNotIn('same name', str(ctx.exception))

    def test_group_entry_without_name_is_not_reported_as_duplicate(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.WorkflowSpec(name='wf', groups=[{'tasks': [_task_dict('task')]}])

        self.assertNotIn('same name', str(ctx.exception))

    def test_group_task_without_name_is_not_reported_as_duplicate(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.WorkflowSpec(
                name='wf',
                groups=[{'name': 'group', 'tasks': [{'image': 'image', 'command': ['echo']}]}])

        self.assertNotIn('same name', str(ctx.exception))


class WorkflowSpecParseTest(unittest.TestCase):
    """WorkflowSpec.parse resolves platforms, topology keys and group ordering."""

    def _parse(self, spec: workflow.WorkflowSpec,
               pool_info: connectors.Pool) -> workflow.WorkflowSpec:
        with mock.patch.object(connectors.PostgresConnector, 'get_instance',
                               return_value=_mock_database()), \
             mock.patch.object(connectors.Pool, 'fetch_from_db', return_value=pool_info):
            return spec.parse(_mock_database(), 'backend', 'pool', {})

    def test_parse_assigns_pool_default_platform_to_resource(self):
        spec = _workflow_spec()

        parsed = self._parse(spec, _pool(default_platform='cpu'))

        self.assertEqual(parsed.resources['default'].platform, 'cpu')

    def test_parse_rejects_resource_without_platform_when_pool_has_no_default(self):
        spec = _workflow_spec()

        with self.assertRaises(osmo_errors.OSMOResourceError) as ctx:
            self._parse(spec, _pool(default_platform=None))

        self.assertIn('does not have a platform', ctx.exception.message)

    def test_parse_rejects_pool_default_platform_missing_from_platforms(self):
        spec = _workflow_spec()

        with self.assertRaises(osmo_errors.OSMOResourceError) as ctx:
            self._parse(spec, _pool(default_platform='gpu',
                                    platforms={'cpu': connectors.Platform()}))

        self.assertIn('does not have a platform', ctx.exception.message)

    def test_parse_rejects_topology_key_not_offered_by_pool(self):
        spec = workflow.WorkflowSpec(
            name='wf',
            resources={'default': {'platform': 'cpu', 'topology': [{'key': 'rack'}]}},
            groups=[{'name': 'group', 'tasks': [_task_dict('task')]}])

        with self.assertRaises(osmo_errors.OSMOSubmissionError) as ctx:
            self._parse(spec, _pool(topology_keys=[]))

        self.assertIn('Topology key "rack"', ctx.exception.message)

    def test_parse_accepts_topology_key_offered_by_pool(self):
        spec = workflow.WorkflowSpec(
            name='wf',
            resources={'default': {'platform': 'cpu', 'topology': [{'key': 'rack'}]}},
            groups=[{'name': 'group', 'tasks': [_task_dict('task')]}])
        pool_info = _pool(topology_keys=[
            connectors.TopologyKey(key='rack', label='topology.kubernetes.io/rack')])

        parsed = self._parse(spec, pool_info)

        self.assertEqual(parsed.resources['default'].topology[0].key, 'rack')

    def test_parse_keeps_explicit_timeout_in_parsed_spec(self):
        spec = workflow.WorkflowSpec(
            name='wf',
            timeout={'exec_timeout': '1h'},
            resources={'default': {'platform': 'cpu'}},
            groups=[{'name': 'group', 'tasks': [_task_dict('task')]}])

        parsed = self._parse(spec, _pool())

        self.assertEqual(parsed.timeout.exec_timeout, datetime.timedelta(hours=1))
        self.assertIn('timeout', parsed.model_fields_set)

    def test_parse_drops_unset_timeout_from_parsed_spec(self):
        spec = _workflow_spec()

        parsed = self._parse(spec, _pool())

        self.assertNotIn('timeout', parsed.model_fields_set)

    def test_parse_wraps_group_revalidation_failure_as_usage_error(self):
        spec = workflow.WorkflowSpec(
            name='wf',
            resources={'default': {'platform': 'cpu'}},
            groups=[{'name': 'group',
                     'tasks': [_task_dict('task-a'), dict(_task_dict('task-b'), lead=True)]}])
        spec.groups[0].tasks[0].lead = True

        with self.assertRaises(osmo_errors.OSMOUsageError) as ctx:
            self._parse(spec, _pool())

        self.assertIn('leader', ctx.exception.message)

    def test_parse_rejects_group_input_referencing_unknown_task(self):
        spec = workflow.WorkflowSpec(
            name='wf',
            resources={'default': {'platform': 'cpu'}},
            groups=[{'name': 'group',
                     'tasks': [dict(_task_dict('task'), inputs=[{'task': 'nowhere'}])]}])

        with self.assertRaises(osmo_errors.OSMOSubmissionError) as ctx:
            self._parse(spec, _pool())

        self.assertIn('Task input nowhere does not exist', ctx.exception.message)

    def test_parse_rejects_upstream_group_declared_after_consumer(self):
        spec = workflow.WorkflowSpec(
            name='wf',
            resources={'default': {'platform': 'cpu'}},
            groups=[
                {'name': 'consumer',
                 'tasks': [dict(_task_dict('reader'), inputs=[{'task': 'writer'}])]},
                {'name': 'producer', 'tasks': [_task_dict('writer')]},
            ])

        with self.assertRaises(ValueError) as ctx:
            self._parse(spec, _pool())

        self.assertIn('requires input group', str(ctx.exception))


class WorkflowSpecValidateResourcesTest(unittest.TestCase):
    """Resource admission: platform lookup, static rules and per-node rules."""

    def _validate(self, spec: workflow.WorkflowSpec, pool_info: connectors.Pool,
                  resources: dict) -> None:
        with mock.patch.object(connectors.PostgresConnector, 'get_instance',
                               return_value=_mock_database()), \
             mock.patch.object(connectors.Pool, 'fetch_from_db', return_value=pool_info):
            spec.validate_resources(resources)

    def test_validate_resources_rejects_task_without_any_platform(self):
        spec = _workflow_spec()

        with self.assertRaises(osmo_errors.OSMOResourceError) as ctx:
            self._validate(spec, _pool(default_platform=None), {})

        self.assertIn('does not have a platform', ctx.exception.message)

    def test_validate_resources_rejects_platform_missing_from_pool(self):
        spec = _workflow_spec()
        spec.groups[0].tasks[0].resources = connectors.ResourceSpec(platform='gpu')

        with self.assertRaises(osmo_errors.OSMOResourceError) as ctx:
            self._validate(spec, _pool(platforms={'cpu': connectors.Platform()}), {})

        self.assertIn('does not exist in pool', ctx.exception.message)

    def test_validate_resources_accepts_topology_key_offered_by_pool(self):
        spec = _workflow_spec()
        spec.groups[0].tasks[0].resources = connectors.ResourceSpec(
            platform='cpu',
            topology=[connectors.TopologyRequirement(
                key='rack', requirementType=connectors.TopologyRequirementType.PREFERRED)])
        pool_info = _pool(topology_keys=[
            connectors.TopologyKey(key='rack', label='topology.kubernetes.io/rack')])

        self._validate(spec, pool_info, {})

        self.assertEqual(spec.groups[0].tasks[0].resources.topology[0].key, 'rack')

    def test_validate_resources_rejects_topology_key_missing_from_pool(self):
        spec = _workflow_spec()
        spec.groups[0].tasks[0].resources = connectors.ResourceSpec(
            platform='cpu',
            topology=[connectors.TopologyRequirement(key='rack')])

        with self.assertRaises(osmo_errors.OSMOResourceError):
            self._validate(spec, _pool(topology_keys=[]), {})

    def test_validate_resources_reports_failing_static_rule_as_user_error(self):
        spec = _workflow_spec()
        spec.groups[0].tasks[0].resources = connectors.ResourceSpec(platform='cpu', cpu=1)
        platform = connectors.Platform(
            parsed_resource_validations=[_assertion('{{USER_CPU}}', '4')])

        with mock.patch.object(connectors.ResourceAssertion, 'evaluate',
                               side_effect=AssertionError('cpu too small')):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                self._validate(spec, _pool(platforms={'cpu': platform}), {})

        self.assertIn('cpu too small', ctx.exception.message)

    def test_validate_resources_accepts_node_satisfying_kubernetes_rule(self):
        spec = _workflow_spec()
        spec.groups[0].tasks[0].resources = connectors.ResourceSpec(platform='cpu', gpu=1)
        platform = connectors.Platform(
            parsed_resource_validations=[_assertion('{{K8_GPU}}', '{{USER_GPU}}')])
        resources = {'cpu': [_resources_entry({'gpu': '8'})]}

        with mock.patch.object(connectors.ResourceAssertion, 'evaluate') as evaluate:
            self._validate(spec, _pool(platforms={'cpu': platform}), resources)

        evaluate.assert_called_once()

    def test_validate_resources_rejects_platform_absent_from_available_resources(self):
        spec = _workflow_spec()
        spec.groups[0].tasks[0].resources = connectors.ResourceSpec(platform='cpu', gpu=1)
        platform = connectors.Platform(
            parsed_resource_validations=[_assertion('{{K8_GPU}}', '{{USER_GPU}}')])

        with self.assertRaises(osmo_errors.OSMOResourceError) as ctx:
            self._validate(spec, _pool(platforms={'cpu': platform}), {'gpu': []})

        self.assertIn('There are no resources in platform cpu', ctx.exception.message)

    def test_validate_resources_reports_per_node_reasons_when_no_node_matches(self):
        spec = _workflow_spec()
        spec.groups[0].tasks[0].resources = connectors.ResourceSpec(platform='cpu', gpu=16)
        platform = connectors.Platform(
            parsed_resource_validations=[_assertion('{{K8_GPU}}', '{{USER_GPU}}')])
        resources = {'cpu': [_resources_entry(
            {'gpu': '8', 'kubernetes.io/arch': 'amd64', 'nvidia.com/gpu': '8'})]}

        with mock.patch.object(connectors.ResourceAssertion, 'evaluate',
                               side_effect=AssertionError('not enough gpus')):
            with self.assertRaises(osmo_errors.OSMOResourceError) as ctx:
                self._validate(spec, _pool(platforms={'cpu': platform}), resources)

        self.assertIn('not enough gpus', ctx.exception.message)
        self.assertIn('osmo resource list', ctx.exception.message)

    def test_validate_resources_reports_failure_without_table_when_no_nodes_exist(self):
        spec = _workflow_spec()
        spec.groups[0].tasks[0].resources = connectors.ResourceSpec(platform='cpu', gpu=1)
        platform = connectors.Platform(
            parsed_resource_validations=[_assertion('{{K8_GPU}}', '{{USER_GPU}}')])

        with self.assertRaises(osmo_errors.OSMOResourceError) as ctx:
            self._validate(spec, _pool(platforms={'cpu': platform}), {'cpu': []})

        self.assertIn('Resource validation failed for task: task', ctx.exception.message)


class WorkflowSpecValidateCredentialsTest(unittest.TestCase):
    """Image digests are pinned from the registry manifest response."""

    def _spec(self) -> workflow.WorkflowSpec:
        return workflow.WorkflowSpec(
            name='wf',
            groups=[{'name': 'group', 'tasks': [
                {'name': 'task', 'image': 'nvcr.io/nvstaging/osmo/app:latest',
                 'command': ['echo']}]}])

    def _validate(self, spec: workflow.WorkflowSpec, response: mock.Mock) -> None:
        database = _mock_database()
        database.get_all_data_creds.return_value = {}
        with mock.patch.object(connectors.PostgresConnector, 'get_instance',
                               return_value=database), \
             mock.patch('src.utils.job.workflow.common.registry_auth', return_value=response):
            spec.validate_credentials('alice')

    def test_validate_credentials_pins_digest_from_manifest_list_body(self):
        spec = self._spec()
        response = mock.Mock(
            status_code=200,
            headers={'Content-Type': common.DOCKER_MANIFEST_LIST_ENCODING})
        response.json.return_value = {'digest': 'sha256:listdigest'}

        self._validate(spec, response)

        self.assertEqual(spec.groups[0].tasks[0].image,
                         'nvcr.io/nvstaging/osmo/app:latest@sha256:listdigest')

    def test_validate_credentials_pins_digest_from_capitalized_header(self):
        spec = self._spec()
        response = mock.Mock(
            status_code=200,
            headers={'Content-Type': 'application/vnd.oci.image.manifest.v1+json',
                     'Docker-Content-Digest': 'sha256:headerdigest'})

        self._validate(spec, response)

        self.assertEqual(spec.groups[0].tasks[0].image,
                         'nvcr.io/nvstaging/osmo/app:latest@sha256:headerdigest')

    def test_validate_credentials_leaves_image_unpinned_when_headers_incomplete(self):
        spec = self._spec()
        response = mock.Mock(status_code=200, headers={})

        self._validate(spec, response)

        self.assertEqual(spec.groups[0].tasks[0].image, 'nvcr.io/nvstaging/osmo/app:latest')


class WorkflowSpecValidateRegistryFailureTest(unittest.TestCase):
    def test_validate_registry_raises_when_no_credential_authenticates(self):
        spec = workflow.WorkflowSpec(
            name='wf',
            tasks=[{'name': 'task', 'image': 'nvcr.io/nvstaging/osmo/app:latest',
                    'command': ['echo']}])
        database = _mock_database()
        database.get_matching_registry_creds.return_value = [
            ('nvcr.io/nvstaging/osmo', {'username': 'user', 'auth': 'token'}),
        ]

        with mock.patch('src.utils.job.workflow.common.registry_auth',
                        return_value=mock.Mock(status_code=401)), \
             mock.patch.object(connectors.PostgresConnector, 'get_instance',
                               return_value=database):
            with self.assertRaises(osmo_errors.OSMOCredentialError) as ctx:
                spec.validate_registry('alice', spec.tasks[0], {}, [])

        self.assertIn('Unable to authenticate for pulling image', ctx.exception.message)


class WorkflowSpecValidateGenericCredTest(unittest.TestCase):
    def _group_task(self, credentials_map: dict) -> task.TaskSpec:
        return task.TaskSpec(name='task', image='image', command=['echo'],
                             credentials=credentials_map)

    def test_validate_generic_cred_rejects_unknown_credential_key(self):
        database = _mock_database()
        database.get_generic_cred.return_value = {'username': 'value'}
        spec = _workflow_spec()
        group_task = self._group_task({'my-cred': {'MY_ENV': 'password'}})

        with self.assertRaises(osmo_errors.OSMOCredentialError) as ctx:
            spec.validate_generic_cred('alice', database, group_task, {})

        self.assertIn('password is not a valid credential key', ctx.exception.message)

    def test_validate_generic_cred_accepts_known_credential_key(self):
        database = _mock_database()
        database.get_generic_cred.return_value = {'password': 'value'}
        spec = _workflow_spec()
        group_task = self._group_task({'my-cred': {'MY_ENV': 'password'}})
        cache: dict = {}

        spec.validate_generic_cred('alice', database, group_task, cache)

        self.assertEqual(cache, {'my-cred': {'password': 'value'}})

    def test_validate_generic_cred_accepts_mount_path_string(self):
        database = _mock_database()
        database.get_generic_cred.return_value = {'password': 'value'}
        spec = _workflow_spec()
        group_task = self._group_task({'my-cred': '/mnt/creds'})

        spec.validate_generic_cred('alice', database, group_task, {})

        database.get_generic_cred.assert_called_once_with('alice', 'my-cred')

    def test_validate_generic_cred_reuses_cached_payload(self):
        database = _mock_database()
        spec = _workflow_spec()
        group_task = self._group_task({'my-cred': {'MY_ENV': 'password'}})

        spec.validate_generic_cred('alice', database, group_task,
                                   {'my-cred': {'password': 'value'}})

        database.get_generic_cred.assert_not_called()

    def test_validate_generic_cred_rejects_non_string_non_dict_mapping(self):
        database = _mock_database()
        database.get_generic_cred.return_value = {'password': 'value'}
        spec = _workflow_spec()
        group_task = self._group_task({'my-cred': '/mnt/creds'})
        group_task.credentials = {'my-cred': ['password']}  # type: ignore[dict-item]

        with self.assertRaises(osmo_errors.OSMOCredentialError) as ctx:
            spec.validate_generic_cred('alice', database, group_task, {})

        self.assertIn('is not a valid credential map', ctx.exception.message)


class WorkflowSpecValidateDataTest(unittest.TestCase):
    """Data credential admission, including the ambient-credential bypass."""

    def _group_task(self, inputs: list | None = None,
                    outputs: list | None = None) -> task.TaskSpec:
        return task.TaskSpec(name='task', image='image', command=['echo'],
                             inputs=inputs or [], outputs=outputs or [])

    def _backend(self, supports_environment_auth: bool = False) -> mock.Mock:
        return mock.Mock(scheme='s3', uri='s3://bucket/key', profile='default',
                         supports_environment_auth=supports_environment_auth)

    def test_validate_data_authorizes_input_url_with_configured_credential(self):
        spec = _workflow_spec()
        backend = self._backend()
        group_task = self._group_task(inputs=[{'url': 's3://bucket/key'}])
        credential = mock.Mock()
        seen_input: set = set()

        with mock.patch('src.utils.job.workflow.storage.construct_storage_backend',
                        return_value=backend):
            spec.validate_data('alice', group_task, seen_input, set(), [],
                               {'default': credential})

        backend.data_auth.assert_called_once_with(credential,
                                                 workflow.storage.AccessType.READ)
        self.assertEqual(seen_input, {'s3://bucket/key'})

    def test_validate_data_authorizes_output_url_for_write(self):
        spec = _workflow_spec()
        backend = self._backend()
        group_task = self._group_task(outputs=[{'url': 's3://bucket/key'}])
        credential = mock.Mock()

        with mock.patch('src.utils.job.workflow.storage.construct_storage_backend',
                        return_value=backend):
            spec.validate_data('alice', group_task, set(), set(), [],
                               {'default': credential})

        backend.data_auth.assert_called_once_with(credential,
                                                 workflow.storage.AccessType.WRITE)

    def test_validate_data_skips_scheme_with_validation_disabled(self):
        spec = _workflow_spec()
        backend = self._backend()
        group_task = self._group_task(inputs=[{'url': 's3://bucket/key'}])

        with mock.patch('src.utils.job.workflow.storage.construct_storage_backend',
                        return_value=backend):
            spec.validate_data('alice', group_task, set(), set(), ['s3'], {})

        backend.data_auth.assert_not_called()

    def test_validate_data_skips_uri_already_validated(self):
        spec = _workflow_spec()
        backend = self._backend()
        group_task = self._group_task(inputs=[{'url': 's3://bucket/key'}])
        credential = mock.Mock()

        with mock.patch('src.utils.job.workflow.storage.construct_storage_backend',
                        return_value=backend):
            spec.validate_data('alice', group_task, {'s3://bucket/key'}, set(), [],
                               {'default': credential})

        backend.data_auth.assert_not_called()

    def test_validate_data_allows_ambient_credentials_without_configured_credential(self):
        spec = _workflow_spec()
        backend = self._backend(supports_environment_auth=True)
        group_task = self._group_task(inputs=[{'url': 's3://bucket/key'}])
        seen_input: set = set()

        with mock.patch('src.utils.job.workflow.storage.construct_storage_backend',
                        return_value=backend):
            spec.validate_data('alice', group_task, seen_input, set(), [], {})

        self.assertEqual(seen_input, set())

    def test_validate_data_rejects_missing_credential_without_ambient_support(self):
        spec = _workflow_spec()
        backend = self._backend(supports_environment_auth=False)
        group_task = self._group_task(inputs=[{'url': 's3://bucket/key'}])

        with mock.patch('src.utils.job.workflow.storage.construct_storage_backend',
                        return_value=backend):
            with self.assertRaises(osmo_errors.OSMOCredentialError) as ctx:
                spec.validate_data('alice', group_task, set(), set(), [], {})

        self.assertIn('No credentials configured for s3://bucket/key', ctx.exception.message)

    def test_validate_data_ignores_task_to_task_input(self):
        spec = _workflow_spec()
        group_task = self._group_task(inputs=[{'task': 'other'}])

        with mock.patch('src.utils.job.workflow.storage.construct_storage_backend') as construct:
            spec.validate_data('alice', group_task, set(), set(), [], {})

        construct.assert_not_called()

    def test_validate_data_rejects_unsupported_input_spec_type(self):
        spec = _workflow_spec()
        group_task = self._group_task()
        group_task.inputs = [task.TaskKPI(index='0', path='p')]  # type: ignore[list-item]

        with self.assertRaises(osmo_errors.OSMOUsageError) as ctx:
            spec.validate_data('alice', group_task, set(), set(), [], {})

        self.assertIn('Input/Output spec is not valid', ctx.exception.message)


class WorkflowSpecValidateNameAndInputsTest(unittest.TestCase):
    def _spec(self) -> workflow.WorkflowSpec:
        return workflow.WorkflowSpec(
            name='wf',
            groups=[{'name': 'group', 'tasks': [
                dict(_task_dict('task'), inputs=[{'task': 'previous-wf-1:previous-task'}])]}])

    def test_validate_name_and_inputs_rejects_unfinished_previous_workflow_task(self):
        spec = self._spec()
        previous_task = mock.Mock(status=task.TaskGroupStatus.RUNNING)

        with mock.patch.object(connectors.PostgresConnector, 'get_instance',
                               return_value=_mock_database()), \
             mock.patch.object(task.Task, 'fetch_from_db', return_value=previous_task):
            with self.assertRaises(osmo_errors.OSMOSubmissionError) as ctx:
                spec.validate_name_and_inputs()

        self.assertIn('Input tasks from previous workflows must be finished',
                      ctx.exception.message)

    def test_validate_name_and_inputs_accepts_finished_previous_workflow_task(self):
        spec = self._spec()
        previous_task = mock.Mock(status=task.TaskGroupStatus.COMPLETED)

        with mock.patch.object(connectors.PostgresConnector, 'get_instance',
                               return_value=_mock_database()), \
             mock.patch.object(task.Task, 'fetch_from_db',
                               return_value=previous_task) as fetch_from_db:
            spec.validate_name_and_inputs()

        self.assertEqual(fetch_from_db.call_args.args[1:], ('previous-wf-1', 'previous-task'))


class WorkflowSpecSavedSpecTest(unittest.TestCase):
    def test_saved_spec_includes_explicitly_set_timeout(self):
        spec = workflow.WorkflowSpec(
            name='wf',
            timeout={'exec_timeout': '1h'},
            groups=[{'name': 'group', 'tasks': [_task_dict('task')]}])

        saved = spec.saved_spec()

        self.assertEqual(saved['timeout']['exec_timeout'], datetime.timedelta(hours=1))

    def test_saved_spec_omits_unset_timeout(self):
        spec = _workflow_spec()

        saved = spec.saved_spec()

        self.assertNotIn('timeout', saved)


class WorkflowSpecGetNumTasksTest(unittest.TestCase):
    def test_get_num_tasks_sums_tasks_across_groups(self):
        spec = workflow.WorkflowSpec(
            name='wf',
            groups=[
                {'name': 'group-a', 'tasks': [_task_dict('task-a')]},
                {'name': 'group-b',
                 'tasks': [_task_dict('task-b'), dict(_task_dict('task-c'), lead=True)]},
            ])

        self.assertEqual(spec.get_num_tasks(), 3)


class TemplateSpecLoadTemplateWithVariablesTest(unittest.TestCase):
    """Jinja variable coercion and osmo token protection."""

    def _render(self, spec: workflow.TemplateSpec, file_text: str = 'workflow: {}',
                default_values: dict | None = None) -> mock.Mock:
        with mock.patch('src.utils.job.workflow.workflow_utils.parse_workflow_spec',
                        return_value=(file_text, default_values)), \
             mock.patch.object(connectors.PostgresConnector, 'get_instance',
                               return_value=_mock_database()), \
             mock.patch('src.utils.job.workflow.jinja_sandbox.sandboxed_jinja_substitute',
                        return_value='rendered') as substitute:
            spec.load_template_with_variables()
        return substitute

    def test_load_template_returns_rendered_workflow(self):
        spec = workflow.TemplateSpec(file='spec.yaml')

        with mock.patch('src.utils.job.workflow.workflow_utils.parse_workflow_spec',
                        return_value=('workflow: {}', None)), \
             mock.patch.object(connectors.PostgresConnector, 'get_instance',
                               return_value=_mock_database()), \
             mock.patch('src.utils.job.workflow.jinja_sandbox.sandboxed_jinja_substitute',
                        return_value='rendered'):
            result = spec.load_template_with_variables()

        self.assertEqual(result, 'rendered')

    def test_load_template_seeds_template_data_with_default_values(self):
        spec = workflow.TemplateSpec(file='spec.yaml')

        substitute = self._render(spec, default_values={'epochs': 3})

        self.assertEqual(substitute.call_args.args[1], {'epochs': 3})

    def test_load_template_coerces_integer_set_variable(self):
        spec = workflow.TemplateSpec(file='spec.yaml', set_variables=['epochs=5'])

        substitute = self._render(spec)

        self.assertEqual(substitute.call_args.args[1]['epochs'], 5)

    def test_load_template_coerces_float_set_variable(self):
        spec = workflow.TemplateSpec(file='spec.yaml', set_variables=['ratio=1.5'])

        substitute = self._render(spec)

        self.assertEqual(substitute.call_args.args[1]['ratio'], 1.5)

    def test_load_template_keeps_non_numeric_set_variable_as_string(self):
        spec = workflow.TemplateSpec(file='spec.yaml', set_variables=['stage=train'])

        substitute = self._render(spec)

        self.assertEqual(substitute.call_args.args[1]['stage'], 'train')

    def test_load_template_splits_set_variable_on_first_equals_only(self):
        spec = workflow.TemplateSpec(file='spec.yaml', set_variables=['expr=a=b'])

        substitute = self._render(spec)

        self.assertEqual(substitute.call_args.args[1]['expr'], 'a=b')

    def test_load_template_rejects_set_variable_without_equals(self):
        spec = workflow.TemplateSpec(file='spec.yaml', set_variables=['epochs'])

        with self.assertRaises(osmo_errors.OSMOUsageError) as ctx:
            self._render(spec)

        self.assertIn('is incorrectly formatted', ctx.exception.message)

    def test_load_template_keeps_numeric_string_variable_as_string(self):
        spec = workflow.TemplateSpec(file='spec.yaml', set_string_variables=['epochs=5'])

        substitute = self._render(spec)

        self.assertEqual(substitute.call_args.args[1]['epochs'], '5')

    def test_load_template_rejects_string_variable_without_equals(self):
        spec = workflow.TemplateSpec(file='spec.yaml', set_string_variables=['epochs'])

        with self.assertRaises(osmo_errors.OSMOUsageError) as ctx:
            self._render(spec)

        self.assertIn('is incorrectly formatted', ctx.exception.message)

    def test_load_template_shields_osmo_tokens_from_jinja_substitution(self):
        spec = workflow.TemplateSpec(file='spec.yaml')

        substitute = self._render(spec, file_text='name: {{uuid}}')

        rendered_text = substitute.call_args.args[0]
        template_data = substitute.call_args.args[1]
        self.assertNotIn('{{uuid}}', rendered_text)
        self.assertIn('{{uuid}}', template_data.values())

    def test_load_template_wraps_jinja_template_error_as_usage_error(self):
        spec = workflow.TemplateSpec(file='spec.yaml')

        with mock.patch('src.utils.job.workflow.workflow_utils.parse_workflow_spec',
                        return_value=('workflow: {}', None)), \
             mock.patch.object(connectors.PostgresConnector, 'get_instance',
                               return_value=_mock_database()), \
             mock.patch('src.utils.job.workflow.jinja_sandbox.sandboxed_jinja_substitute',
                        side_effect=workflow.jinja_sandbox.exceptions.TemplateError('boom')):
            with self.assertRaises(osmo_errors.OSMOUsageError) as ctx:
                spec.load_template_with_variables()

        self.assertIn('Jinja Template Error', ctx.exception.message)


class LogInfoFetchLogInfoFromDbTest(unittest.TestCase):
    def test_fetch_log_info_returns_logs_and_backend(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = [
            mock.Mock(logs='s3://logs/wf-1', backend='backend')]

        log_info = workflow.LogInfo.fetch_log_info_from_db(database, 'wf-1')

        self.assertEqual(log_info.logs, 's3://logs/wf-1')
        self.assertEqual(log_info.backend, 'backend')

    def test_fetch_log_info_raises_when_workflow_missing(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = []

        with self.assertRaises(osmo_errors.OSMODatabaseError) as ctx:
            workflow.LogInfo.fetch_log_info_from_db(database, 'wf-1')

        self.assertIn('Workflow wf-1 is not found', ctx.exception.message)


class WorkflowInsertToDbTest(unittest.TestCase):
    def test_insert_marks_failed_submission_as_immediately_finished(self):
        database = _mock_database()
        workflow_obj = _workflow_obj(database,
                                     status=workflow.WorkflowStatus.FAILED_SUBMISSION)

        workflow_obj.insert_to_db()

        self.assertEqual(workflow_obj.start_time, workflow_obj.submit_time)
        self.assertEqual(workflow_obj.end_time, workflow_obj.submit_time)

    def test_insert_leaves_pending_workflow_without_start_and_end_time(self):
        database = _mock_database()
        workflow_obj = _workflow_obj(database)

        workflow_obj.insert_to_db()

        self.assertIsNone(workflow_obj.start_time)
        self.assertIsNone(workflow_obj.end_time)

    def test_insert_retries_after_transient_database_error(self):
        database = _mock_database()
        database.execute_commit_command.side_effect = [
            osmo_errors.OSMODatabaseError('duplicate workflow_id'), None, None]
        workflow_obj = _workflow_obj(database)

        workflow_obj.insert_to_db()

        self.assertEqual(database.execute_commit_command.call_count, 3)

    def test_insert_raises_after_retry_budget_is_exhausted(self):
        database = _mock_database()
        database.execute_commit_command.side_effect = \
            osmo_errors.OSMODatabaseError('duplicate workflow_id')
        workflow_obj = _workflow_obj(database)

        with self.assertRaises(osmo_errors.OSMODatabaseError):
            workflow_obj.insert_to_db()

        self.assertEqual(database.execute_commit_command.call_count,
                         workflow.INSERT_RETRY_COUNT)

    def test_insert_writes_output_path_from_workflow_data_base_url(self):
        database = _mock_database()
        database.get_workflow_configs.return_value = connectors.WorkflowConfig(
            workflow_data={'base_url': 's3://outputs'})
        workflow_obj = _workflow_obj(database)

        workflow_obj.insert_to_db()

        self.assertEqual(workflow_obj.outputs, 's3://outputs/wf-1')


class WorkflowWorkflowIdTest(unittest.TestCase):
    def test_workflow_id_reads_from_database_when_not_cached(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = [{'workflow_id': 'wf-7'}]
        workflow_obj = _workflow_obj(database, workflow_id_internal=None)

        self.assertEqual(workflow_obj.workflow_id, 'wf-7')

    def test_workflow_id_raises_when_workflow_not_inserted(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = []
        workflow_obj = _workflow_obj(database, workflow_id_internal=None)

        with self.assertRaises(osmo_errors.OSMODatabaseError) as ctx:
            _ = workflow_obj.workflow_id

        self.assertIn('needs to be inserted in the database first', ctx.exception.message)


class WorkflowFromWorkflowTest(unittest.TestCase):
    def test_from_workflow_deconstructs_parent_workflow_id(self):
        database = _mock_database()

        workflow_obj = workflow.Workflow.from_workflow(
            database, 'wf', 'a' * 32, 'alice', 'backend', 'pool',
            parent_workflow_id='parent-3')

        self.assertEqual(workflow_obj.parent_name, 'parent')
        self.assertEqual(workflow_obj.parent_job_id, 3)

    def test_from_workflow_defaults_to_failed_submission_without_parent(self):
        database = _mock_database()

        workflow_obj = workflow.Workflow.from_workflow(
            database, 'wf', 'a' * 32, 'alice', 'backend', 'pool',
            failure_message='bad spec')

        self.assertIsNone(workflow_obj.parent_name)
        self.assertIsNone(workflow_obj.parent_job_id)
        self.assertEqual(workflow_obj.status, workflow.WorkflowStatus.FAILED_SUBMISSION)
        self.assertEqual(workflow_obj.failure_message, 'bad spec')


class WorkflowFromWorkflowSpecTest(unittest.TestCase):
    def _from_spec(self, parent_workflow_id: str | None) -> workflow.Workflow:
        spec = workflow.WorkflowSpec(
            name='wf',
            pool='pool',
            backend='backend',
            groups=[{'name': 'group', 'tasks': [_task_dict('task')]}])
        database = _mock_database()
        uuids = {'group': common.generate_unique_id(),
                 'task': common.generate_unique_id()}
        with mock.patch.object(connectors.Pool, 'fetch_from_db',
                               return_value=_pool()):
            return workflow.Workflow.from_workflow_spec(
                database, 'wf', 'a' * 32, 'alice', spec, '', uuids,
                collections.defaultdict(set), collections.defaultdict(set),
                parent_workflow_id=parent_workflow_id)

    def test_from_workflow_spec_deconstructs_parent_workflow_id(self):
        workflow_obj = self._from_spec('parent-2')

        self.assertEqual(workflow_obj.parent_name, 'parent')
        self.assertEqual(workflow_obj.parent_job_id, 2)

    def test_from_workflow_spec_fills_timeout_defaults_from_config(self):
        workflow_obj = self._from_spec(None)

        self.assertEqual(workflow_obj.timeout.exec_timeout, datetime.timedelta(days=60))
        self.assertEqual(len(workflow_obj.groups), 1)


class WorkflowFetchNewJobIdTest(unittest.TestCase):
    def test_fetch_new_job_id_returns_one_for_first_submission(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = []

        self.assertEqual(workflow.Workflow.fetch_new_job_id(database, 'wf'), 1)

    def test_fetch_new_job_id_increments_latest_job_id(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = [mock.Mock(job_id=4)]

        self.assertEqual(workflow.Workflow.fetch_new_job_id(database, 'wf'), 5)


class WorkflowFetchFromDbTest(unittest.TestCase):
    def test_fetch_from_db_raises_when_workflow_missing(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = []

        with self.assertRaises(osmo_errors.OSMODatabaseError) as ctx:
            workflow.Workflow.fetch_from_db(database, 'wf-1')

        self.assertIn('Workflow wf-1 is not found', ctx.exception.message)


class WorkflowUpdateFieldsTest(unittest.TestCase):
    def test_update_log_to_db_writes_logs_field_for_workflow(self):
        database = _mock_database()
        workflow_obj = _workflow_obj(database)

        workflow_obj.update_log_to_db('s3://logs/wf-1')

        command, args = database.execute_commit_command.call_args.args
        self.assertIn('logs = %s', command)
        self.assertEqual(args, ('s3://logs/wf-1', 'wf-1'))

    def test_update_events_to_db_writes_events_field_for_workflow(self):
        database = _mock_database()
        workflow_obj = _workflow_obj(database)

        workflow_obj.update_events_to_db('s3://events/wf-1')

        command, args = database.execute_commit_command.call_args.args
        self.assertIn('events = %s', command)
        self.assertEqual(args, ('s3://events/wf-1', 'wf-1'))

    def test_update_cancelled_by_only_targets_alive_uncancelled_workflow(self):
        database = _mock_database()
        workflow_obj = _workflow_obj(database)

        workflow_obj.update_cancelled_by('alice')

        command, args = database.execute_commit_command.call_args.args
        self.assertIn("status IN ('PENDING', 'RUNNING', 'WAITING')", command)
        self.assertIn('cancelled_by = NULL', command)
        self.assertEqual(args, ('alice', 'wf-1'))


class WorkflowUpdateStatusToDbTest(unittest.TestCase):
    """The workflow status users see is aggregated from group statuses."""

    def _update(self, group_statuses: list,
                current_status: workflow.WorkflowStatus = workflow.WorkflowStatus.PENDING,
                canceled_by: str = '') -> tuple:
        database = _mock_database()
        database.execute_fetch_command.return_value = [
            mock.Mock(status=status) for status in group_statuses]
        workflow_obj = _workflow_obj(database, status=current_status)
        update_time = datetime.datetime(2026, 1, 1, 12, 0, 0)
        result = workflow_obj.update_status_to_db(update_time, canceled_by)
        return result, database

    def test_all_groups_completed_reports_completed(self):
        result, database = self._update(['COMPLETED', 'COMPLETED'])

        self.assertEqual(result, workflow.WorkflowStatus.COMPLETED)
        command, _ = database.execute_commit_command.call_args.args
        self.assertIn('end_time = %s', command)

    def test_running_group_reports_running_and_sets_start_time(self):
        result, database = self._update(['RUNNING', 'WAITING'])

        self.assertEqual(result, workflow.WorkflowStatus.RUNNING)
        command, _ = database.execute_commit_command.call_args.args
        self.assertIn('start_time = CASE WHEN start_time IS NULL', command)

    def test_unstarted_groups_keep_pending_without_database_write(self):
        result, database = self._update(['WAITING', 'SUBMITTING'])

        self.assertEqual(result, workflow.WorkflowStatus.PENDING)
        database.execute_commit_command.assert_not_called()

    def test_canceled_group_reports_failed_canceled(self):
        result, _ = self._update(['FAILED_CANCELED', 'COMPLETED'])

        self.assertEqual(result, workflow.WorkflowStatus.FAILED_CANCELED)

    def test_canceled_group_records_canceling_user(self):
        _, database = self._update(['FAILED_CANCELED'], canceled_by='alice')

        command, args = database.execute_commit_command.call_args.args
        self.assertIn('cancelled_by = %s', command)
        self.assertIn('alice', args)

    def test_server_error_group_takes_precedence_over_generic_failure(self):
        result, _ = self._update(['FAILED_SERVER_ERROR', 'FAILED_BACKEND_ERROR'])

        self.assertEqual(result, workflow.WorkflowStatus.FAILED_SERVER_ERROR)

    def test_exec_timeout_group_reports_failed_exec_timeout(self):
        result, _ = self._update(['FAILED_EXEC_TIMEOUT', 'FAILED_BACKEND_ERROR'])

        self.assertEqual(result, workflow.WorkflowStatus.FAILED_EXEC_TIMEOUT)

    def test_queue_timeout_group_reports_failed_queue_timeout(self):
        result, _ = self._update(['FAILED_QUEUE_TIMEOUT', 'FAILED_BACKEND_ERROR'])

        self.assertEqual(result, workflow.WorkflowStatus.FAILED_QUEUE_TIMEOUT)

    def test_single_failure_reason_is_reported_specifically(self):
        result, _ = self._update(['FAILED_BACKEND_ERROR', 'FAILED_UPSTREAM'])

        self.assertEqual(result, workflow.WorkflowStatus.FAILED_BACKEND_ERROR)

    def test_mixed_failure_reasons_report_generic_failed(self):
        result, _ = self._update(['FAILED_BACKEND_ERROR', 'FAILED_IMAGE_PULL'])

        self.assertEqual(result, workflow.WorkflowStatus.FAILED)

    def test_workflow_without_groups_reports_completed(self):
        result, _ = self._update([])

        self.assertEqual(result, workflow.WorkflowStatus.COMPLETED)

    def test_rescheduled_group_reports_running(self):
        result, _ = self._update(['RESCHEDULED'])

        self.assertEqual(result, workflow.WorkflowStatus.RUNNING)

    def test_unchanged_status_skips_database_write(self):
        result, database = self._update(
            ['COMPLETED'], current_status=workflow.WorkflowStatus.COMPLETED)

        self.assertEqual(result, workflow.WorkflowStatus.COMPLETED)
        database.execute_commit_command.assert_not_called()


class WorkflowSendNotificationTest(unittest.TestCase):
    def _send(self, slack: bool, email: bool) -> mock.Mock:
        database = _mock_database()
        database.get_service_configs.return_value = mock.Mock(
            service_base_url='https://osmo.test:443/api')
        workflow_obj = _workflow_obj(database)
        profile = connectors.UserProfile(username='alice', slack_notification=slack,
                                         email_notification=email)
        with mock.patch.object(connectors.UserProfile, 'fetch_from_db',
                               return_value=profile), \
             mock.patch('src.utils.job.workflow.notify.Notifier') as notifier_class:
            workflow_obj.send_notification(workflow.WorkflowStatus.COMPLETED)
        return notifier_class.return_value

    def test_send_notification_sends_slack_message_with_workflow_url(self):
        notifier = self._send(slack=True, email=False)

        notifier.send_slack_notification.assert_called_once_with(
            'alice', 'wf-1', 'COMPLETED', 'https://osmo.test/workflows/wf-1')
        notifier.send_email_notification.assert_not_called()

    def test_send_notification_sends_email_when_enabled(self):
        notifier = self._send(slack=False, email=True)

        notifier.send_email_notification.assert_called_once_with(
            'alice', 'wf-1', 'COMPLETED', 'https://osmo.test/workflows/wf-1')
        notifier.send_slack_notification.assert_not_called()

    def test_send_notification_sends_nothing_when_both_preferences_disabled(self):
        notifier = self._send(slack=False, email=False)

        notifier.send_slack_notification.assert_not_called()
        notifier.send_email_notification.assert_not_called()


class WorkflowGetGroupObjsTest(unittest.TestCase):
    def test_get_group_objs_builds_group_per_database_row(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = [mock.Mock(), mock.Mock()]
        workflow_obj = _workflow_obj(database)

        with mock.patch.object(task.TaskGroup, 'from_db_row',
                               return_value=mock.Mock()) as from_db_row:
            groups = workflow_obj.get_group_objs()

        self.assertEqual(len(groups), 2)
        self.assertEqual(from_db_row.call_args.kwargs, {'load_tasks': False})


class WorkflowMarkGroupsAsWaitingTest(unittest.TestCase):
    def test_mark_groups_as_waiting_returns_true_when_groups_transitioned(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = [mock.Mock()]
        workflow_obj = _workflow_obj(database)

        self.assertTrue(workflow_obj.mark_groups_as_waiting())

    def test_mark_groups_as_waiting_returns_false_when_workflow_was_canceled(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = []
        workflow_obj = _workflow_obj(database)

        self.assertFalse(workflow_obj.mark_groups_as_waiting())


class GetNumWorkflowsAndTasksTest(unittest.TestCase):
    def test_counts_are_returned_without_status_filters(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = [
            {'workflow_count': 2, 'task_count': 5}]

        counts = workflow.get_num_workflows_and_tasks(database, 'alice')

        self.assertEqual(counts, (2, 5))
        command, args = database.execute_fetch_command.call_args.args
        self.assertNotIn('ANY', command)
        self.assertEqual(args, ('alice',))

    def test_workflow_status_filter_is_added_to_query(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = [
            {'workflow_count': 1, 'task_count': 1}]

        workflow.get_num_workflows_and_tasks(
            database, 'alice', workflow_statuses=[workflow.WorkflowStatus.RUNNING])

        command, args = database.execute_fetch_command.call_args.args
        self.assertIn('w.status = ANY(%s)', command)
        self.assertEqual(args, ('alice', ['RUNNING']))

    def test_task_status_filter_is_added_to_query(self):
        database = _mock_database()
        database.execute_fetch_command.return_value = [
            {'workflow_count': 1, 'task_count': 3}]

        workflow.get_num_workflows_and_tasks(
            database, 'alice', task_statuses=[task.TaskGroupStatus.RUNNING])

        command, args = database.execute_fetch_command.call_args.args
        self.assertIn('t.status = ANY(%s)', command)
        self.assertEqual(args, ('alice', ['RUNNING']))


if __name__ == '__main__':
    unittest.main()
