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

import datetime
import types
import typing
import unittest
from unittest import mock

import pydantic

from src.lib.utils import osmo_errors
from src.service.core.workflow import objects
from src.utils import connectors


def _postgres(encrypted: dict) -> mock.Mock:
    """Return a PostgresConnector stand-in whose encrypt_dict returns a fixed mapping."""
    postgres = mock.Mock()
    postgres.encrypt_dict.return_value = encrypted
    return postgres


def _as_postgres(postgres: mock.Mock) -> connectors.PostgresConnector:
    """Type the connector stand-in for the credential helpers."""
    return typing.cast(connectors.PostgresConnector, postgres)


def _workflow_config(**credential_config) -> connectors.WorkflowConfig:
    return connectors.WorkflowConfig(credential_config=credential_config)


def _backend_info(grafana_url: str = '', dashboard_url: str = '',
                  namespace: str = 'osmo') -> types.SimpleNamespace:
    return types.SimpleNamespace(grafana_url=grafana_url, dashboard_url=dashboard_url,
                                 k8s_namespace=namespace)


def _context(database: typing.Any) -> typing.Any:
    return types.SimpleNamespace(database=database,
                                 config=types.SimpleNamespace(method='prod', redis_url='redis://'))


def _submit_info(context: typing.Any, **overrides) -> objects.WorkflowSubmitInfo:
    """Build a WorkflowSubmitInfo without running validation on the fake context."""
    fields = {
        'context': context,
        'base32_id': 'abc123',
        'name': '',
        'parent_workflow_id': None,
        'app_uuid': None,
        'app_version': None,
        'user': 'alice',
        'pool': 'pool-a',
        'backend': '',
    }
    fields.update(overrides)
    return objects.WorkflowSubmitInfo.model_construct(**fields)


class TestWorkflowServiceConfigDefaultAdmin(unittest.TestCase):
    """Covers WorkflowServiceConfig.validate_default_admin (lines 140, 144)."""

    def test_default_admin_username_without_password_is_rejected(self):
        with self.assertRaisesRegex(pydantic.ValidationError, 'default_admin_password'):
            objects.WorkflowServiceConfig.model_validate({'default_admin_username': 'admin'})

    def test_non_mapping_input_is_forwarded_to_pydantic_validation(self):
        with self.assertRaises(pydantic.ValidationError):
            objects.WorkflowServiceConfig.model_validate('not-a-mapping')


class TestWorkflowServiceContext(unittest.TestCase):
    """Covers WorkflowServiceContext.get (line 164)."""

    def test_get_before_initialization_raises_value_error(self):
        with mock.patch.object(objects.WorkflowServiceContext, '_instance', None):
            with self.assertRaisesRegex(ValueError, 'before initialization'):
                objects.WorkflowServiceContext.get()


class TestSubmitResponse(unittest.TestCase):
    """Covers SubmitResponse.logs_or_spec (line 213)."""

    def test_neither_logs_nor_spec_is_rejected(self):
        with self.assertRaisesRegex(pydantic.ValidationError, 'Exactly one of'):
            objects.SubmitResponse(name='wf-1')

    def test_both_logs_and_spec_is_rejected(self):
        with self.assertRaisesRegex(pydantic.ValidationError, 'Exactly one of'):
            objects.SubmitResponse(name='wf-1', logs='logs-url', spec='spec-url')

    def test_spec_only_is_accepted(self):
        response = objects.SubmitResponse(name='wf-1', spec='spec-url')

        self.assertEqual(response.spec, 'spec-url')


class TestListTaskAggregatedResponse(unittest.TestCase):
    """Covers ListTaskAggregatedResponse.from_db_rows (lines 340-341)."""

    def test_from_db_rows_aggregates_rows_by_workflow(self):
        row = {
            'workflow_id': 'wf-1',
            'submitted_by': 'alice',
            'pool': 'pool-a',
            'disk_count': 1.5,
            'cpu_count': 3.4,
            'memory_count': 8.0,
            'gpu_count': 2.6,
            'priority': 'NORMAL',
        }

        response = objects.ListTaskAggregatedResponse.from_db_rows([row])

        self.assertEqual(len(response.summaries), 1)
        self.assertEqual(response.summaries[0].workflow_id, 'wf-1')
        self.assertEqual(response.summaries[0].cpu, 3)
        self.assertEqual(response.summaries[0].gpu, 3)


class TestCredentialOptions(unittest.TestCase):
    """Covers CredentialOptions.validate_credential and get_credential
    (lines 881-883, 885-886, 888, 891-896, 898)."""

    def test_no_credential_set_is_rejected(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'Exactly one of'):
            objects.CredentialOptions()

    def test_two_credentials_set_is_rejected(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'Exactly one of'):
            objects.CredentialOptions(
                generic_credential={'credential': {'key': 'value'}},
                registry_credential={'registry': 'nvcr.io', 'username': 'u', 'auth': 'a'})

    def test_non_mapping_input_is_forwarded_to_pydantic_validation(self):
        with self.assertRaises(pydantic.ValidationError):
            objects.CredentialOptions.model_validate('not-a-mapping')

    def test_get_credential_returns_the_registry_credential(self):
        options = objects.CredentialOptions(
            registry_credential={'registry': 'nvcr.io', 'username': 'u', 'auth': 'a'})

        self.assertIs(options.get_credential(), options.registry_credential)

    def test_get_credential_returns_the_data_credential(self):
        options = objects.CredentialOptions(
            data_credential={'endpoint': 's3://bucket', 'access_key_id': 'k',
                             'access_key': 's'})

        self.assertIs(options.get_credential(), options.data_credential)

    def test_get_credential_returns_the_generic_credential(self):
        options = objects.CredentialOptions(
            generic_credential={'credential': {'key': 'value'}})

        self.assertIs(options.get_credential(), options.generic_credential)

    def test_get_credential_without_any_credential_raises_user_error(self):
        options = objects.CredentialOptions.model_construct(
            registry_credential=None, data_credential=None, generic_credential=None)

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'Exactly one of'):
            options.get_credential()


class TestUserRegistryCredential(unittest.TestCase):
    """Covers UserRegistryCredential (lines 740, 743-745, 755, 760)."""

    def test_type_is_registry(self):
        self.assertEqual(objects.UserRegistryCredential.type(),
                         connectors.CredentialType.REGISTRY)

    def test_to_db_row_encrypts_username_and_auth_into_hstore(self):
        credential = objects.UserRegistryCredential(
            registry='nvcr.io', username='alice', auth='token')
        postgres = _postgres({'username': 'enc-user', 'auth': 'enc-auth'})

        record = credential.to_db_row('alice', _as_postgres(postgres))

        self.assertEqual(record.cred_type, 'REGISTRY')
        self.assertEqual(record.profile, 'nvcr.io')
        self.assertEqual(record.payload, '"username"=>"enc-user","auth"=>"enc-auth"')

    def test_valid_cred_skips_network_check_for_disabled_registry(self):
        credential = objects.UserRegistryCredential(
            registry='nvcr.io/nvidia', username='alice', auth='token')
        config = _workflow_config(disable_registry_validation=['nvcr.io'])

        with mock.patch.object(objects.common, 'registry_auth') as registry_auth:
            credential.valid_cred(config)

        registry_auth.assert_not_called()

    def test_valid_cred_raises_credential_error_on_non_200_response(self):
        credential = objects.UserRegistryCredential(
            registry='nvcr.io', username='alice', auth='token')
        config = _workflow_config()

        with mock.patch.object(objects.common, 'registry_auth',
                               return_value=types.SimpleNamespace(status_code=401)):
            with self.assertRaisesRegex(osmo_errors.OSMOCredentialError,
                                        'Registry authentication failed'):
                credential.valid_cred(config)

    def test_valid_cred_accepts_authenticated_registry(self):
        credential = objects.UserRegistryCredential(
            registry='nvcr.io', username='alice', auth='token')
        config = _workflow_config()

        with mock.patch.object(objects.common, 'registry_auth',
                               return_value=types.SimpleNamespace(status_code=200)) as auth:
            credential.valid_cred(config)

        auth.assert_called_once_with('https://nvcr.io/v2/', 'alice', 'token')


class TestUserDataCredential(unittest.TestCase):
    """Covers UserDataCredential (lines 781, 784, 789-790, 792-793, 795-796,
    798, 800, 807-809, 811, 820)."""

    def test_type_is_data(self):
        self.assertEqual(objects.UserDataCredential.type(), connectors.CredentialType.DATA)

    def test_to_db_row_omits_unset_optional_fields(self):
        credential = objects.UserDataCredential(
            endpoint='s3://bucket', access_key_id='key-id', access_key='secret')
        postgres = _postgres({'access_key_id': 'enc-id', 'access_key': 'enc-secret'})

        record = credential.to_db_row('alice', _as_postgres(postgres))

        self.assertEqual(record.cred_type, 'DATA')
        self.assertEqual(record.profile, 's3://bucket')
        self.assertEqual(postgres.encrypt_dict.call_args.args[0],
                         {'access_key_id': 'key-id', 'access_key': 'secret'})

    def test_to_db_row_includes_region_override_url_and_addressing_style(self):
        credential = objects.UserDataCredential(
            endpoint='s3://bucket', access_key_id='key-id', access_key='secret',
            region='us-east-1', override_url='http://minio:9000', addressing_style='path')
        postgres = _postgres({'access_key_id': 'enc-id'})

        credential.to_db_row('alice', _as_postgres(postgres))

        self.assertEqual(
            postgres.encrypt_dict.call_args.args[0],
            {'access_key_id': 'key-id', 'access_key': 'secret', 'region': 'us-east-1',
             'override_url': 'http://minio:9000', 'addressing_style': 'path'})

    def test_valid_cred_skips_validation_for_disabled_scheme(self):
        credential = objects.UserDataCredential(
            endpoint='s3://bucket', access_key_id='key-id', access_key='secret')
        config = _workflow_config(disable_data_validation=['s3'])
        backend = mock.Mock()
        backend.scheme = 's3'

        with mock.patch.object(objects.storage, 'construct_storage_backend',
                               return_value=backend):
            credential.valid_cred(config)

        backend.data_auth.assert_not_called()

    def test_valid_cred_authenticates_against_the_storage_backend(self):
        credential = objects.UserDataCredential(
            endpoint='s3://bucket', access_key_id='key-id', access_key='secret')
        config = _workflow_config()
        backend = mock.Mock()
        backend.scheme = 's3'

        with mock.patch.object(objects.storage, 'construct_storage_backend',
                               return_value=backend):
            credential.valid_cred(config)

        self.assertEqual(backend.data_auth.call_count, 1)
        self.assertEqual(backend.data_auth.call_args.args[0].access_key_id, 'key-id')


class TestUserCredential(unittest.TestCase):
    """Covers UserCredential (lines 834, 837-838, 843, 848, 865)."""

    def test_type_is_generic(self):
        self.assertEqual(objects.UserCredential.type(), connectors.CredentialType.GENERIC)

    def test_to_db_row_has_no_profile(self):
        credential = objects.UserCredential(credential={'token': 'plain'})
        postgres = _postgres({'token': 'enc-token'})

        record = credential.to_db_row('alice', _as_postgres(postgres))

        self.assertEqual(record.cred_type, 'GENERIC')
        self.assertIsNone(record.profile)
        self.assertEqual(record.payload, '"token"=>"enc-token"')

    def test_from_db_row_projects_name_type_and_profile(self):
        rows = [types.SimpleNamespace(cred_name='c1', cred_type='GENERIC', profile=None)]

        creds = objects.UserCredential.from_db_row(rows)

        self.assertEqual(creds,
                         [{'cred_name': 'c1', 'cred_type': 'GENERIC', 'profile': None}])

    def test_valid_cred_is_a_no_op(self):
        credential = objects.UserCredential(credential={'token': 'plain'})

        self.assertIsNone(credential.valid_cred(_workflow_config()))


class TestGetTimeDiff(unittest.TestCase):
    """Covers get_time_diff (lines 1406-1407)."""

    def test_time_difference_defaults_to_hours(self):
        start = datetime.datetime(2026, 1, 1, 0, 0, 0)
        end = datetime.datetime(2026, 1, 1, 3, 0, 0)

        self.assertEqual(objects.get_time_diff(start, end), 3.0)

    def test_time_difference_honours_custom_round_to(self):
        start = datetime.datetime(2026, 1, 1, 0, 0, 0)
        end = datetime.datetime(2026, 1, 1, 0, 5, 0)

        self.assertEqual(objects.get_time_diff(start, end, round_to=60), 5.0)


class TestUseBackendInfoCache(unittest.TestCase):
    """Covers use_backend_info_cache (lines 1423-1426)."""

    def test_resource_error_is_translated_to_missing_backend(self):
        with mock.patch.object(objects.WorkflowServiceContext, 'get',
                               return_value=_context(mock.Mock())):
            with mock.patch.object(objects.connectors.Backend, 'fetch_from_db',
                                   side_effect=osmo_errors.OSMOResourceError('gone')):
                self.assertIsNone(objects.use_backend_info_cache('backend-a'))

    def test_backend_error_is_translated_to_missing_backend(self):
        with mock.patch.object(objects.WorkflowServiceContext, 'get',
                               return_value=_context(mock.Mock())):
            with mock.patch.object(objects.connectors.Backend, 'fetch_from_db',
                                   side_effect=osmo_errors.OSMOBackendError('down')):
                self.assertIsNone(objects.use_backend_info_cache('backend-a'))

    def test_fetched_backend_is_stored_in_the_supplied_lookup(self):
        backend_info = _backend_info()
        lookup: dict = {}

        with mock.patch.object(objects.WorkflowServiceContext, 'get',
                               return_value=_context(mock.Mock())):
            with mock.patch.object(objects.connectors.Backend, 'fetch_from_db',
                                   return_value=backend_info):
                result = objects.use_backend_info_cache('backend-a', lookup)

        self.assertIs(result, backend_info)
        self.assertEqual(lookup, {'backend-a': backend_info})

    def test_cached_backend_is_returned_without_a_database_fetch(self):
        backend_info = _backend_info()
        lookup = {'backend-a': backend_info}

        with mock.patch.object(objects.WorkflowServiceContext, 'get',
                               return_value=_context(mock.Mock())):
            with mock.patch.object(objects.connectors.Backend,
                                   'fetch_from_db') as fetch_from_db:
                result = objects.use_backend_info_cache('backend-a', lookup)

        self.assertIs(result, backend_info)
        fetch_from_db.assert_not_called()


class TestGetWorkflowQueuedTime(unittest.TestCase):
    """Covers get_workflow_queued_time (lines 1439-1440, 1442, 1445,
    1449-1451)."""

    def test_raw_row_without_timestamps_returns_zero_duration(self):
        self.assertEqual(objects.get_workflow_queued_time({}, use_raw_row=True),
                         datetime.timedelta())

    def test_raw_row_uses_start_time_minus_submit_time(self):
        row = {
            'submit_time': datetime.datetime(2026, 1, 1, 0, 0, 0),
            'start_time': datetime.datetime(2026, 1, 1, 0, 5, 0),
            'end_time': None,
        }

        self.assertEqual(objects.get_workflow_queued_time(row, use_raw_row=True),
                         datetime.timedelta(minutes=5))

    def test_raw_row_falls_back_to_end_time_when_never_started(self):
        row = {
            'submit_time': datetime.datetime(2026, 1, 1, 0, 0, 0),
            'start_time': None,
            'end_time': datetime.datetime(2026, 1, 1, 0, 2, 0),
        }

        self.assertEqual(objects.get_workflow_queued_time(row, use_raw_row=True),
                         datetime.timedelta(minutes=2))

    def test_attribute_row_uses_start_time_minus_submit_time(self):
        row = types.SimpleNamespace(
            submit_time=datetime.datetime(2026, 1, 1, 0, 0, 0),
            start_time=datetime.datetime(2026, 1, 1, 0, 7, 0),
            end_time=None)

        self.assertEqual(objects.get_workflow_queued_time(row),
                         datetime.timedelta(minutes=7))

    def test_pending_workflow_is_still_queueing_now(self):
        row = types.SimpleNamespace(
            submit_time=datetime.datetime(2020, 1, 1, 0, 0, 0),
            start_time=None,
            end_time=None)

        self.assertGreater(objects.get_workflow_queued_time(row), datetime.timedelta())


class TestGetWorkflowDuration(unittest.TestCase):
    """Covers get_workflow_duration (lines 1462-1463, 1465-1467)."""

    def test_raw_row_without_timestamps_returns_none(self):
        self.assertIsNone(objects.get_workflow_duration({}, use_raw_row=True))

    def test_raw_row_uses_end_time_minus_start_time(self):
        row = {
            'start_time': datetime.datetime(2026, 1, 1, 0, 0, 0),
            'end_time': datetime.datetime(2026, 1, 1, 1, 0, 0),
        }

        self.assertEqual(objects.get_workflow_duration(row, use_raw_row=True),
                         datetime.timedelta(hours=1))

    def test_attribute_row_without_start_time_returns_none(self):
        row = types.SimpleNamespace(start_time=None, end_time=None)

        self.assertIsNone(objects.get_workflow_duration(row))

    def test_attribute_row_uses_end_time_minus_start_time(self):
        row = types.SimpleNamespace(
            start_time=datetime.datetime(2026, 1, 1, 0, 0, 0),
            end_time=datetime.datetime(2026, 1, 1, 0, 30, 0))

        self.assertEqual(objects.get_workflow_duration(row),
                         datetime.timedelta(minutes=30))

    def test_running_workflow_duration_is_measured_against_now(self):
        row = types.SimpleNamespace(
            start_time=datetime.datetime(2020, 1, 1, 0, 0, 0), end_time=None)

        duration = objects.get_workflow_duration(row)

        self.assertIsNotNone(duration)
        self.assertGreater(typing.cast(datetime.timedelta, duration), datetime.timedelta())


class TestGenerateGrafanaUrl(unittest.TestCase):
    """Covers generate_grafana_url (lines 1481, 1488-1492, 1496-1498,
    1501-1505, 1507-1508)."""

    def test_unknown_backend_has_no_grafana_url(self):
        with mock.patch.object(objects, 'use_backend_info_cache', return_value=None):
            self.assertIsNone(objects.generate_grafana_url('uuid', 'backend-a'))

    def test_backend_without_grafana_url_returns_none(self):
        with mock.patch.object(objects, 'use_backend_info_cache',
                               return_value=_backend_info(grafana_url='')):
            self.assertIsNone(objects.generate_grafana_url('uuid', 'backend-a'))

    def test_running_workflow_window_ends_at_now(self):
        with mock.patch.object(objects, 'use_backend_info_cache',
                               return_value=_backend_info(
                                   grafana_url='https://grafana/d/osmo')):
            url = objects.generate_grafana_url('uuid', 'backend-a')

        self.assertEqual(
            url,
            'https://grafana/d/osmo?var-namespace=osmo&var-uuid=uuid&from=now-1h&to=now')

    def test_long_finished_workflow_window_ends_in_the_past(self):
        with mock.patch.object(objects, 'use_backend_info_cache',
                               return_value=_backend_info(
                                   grafana_url='https://grafana/d/osmo')):
            url = objects.generate_grafana_url(
                'uuid', 'backend-a', end_time=datetime.datetime(2020, 1, 1))

        self.assertNotIn('&to=now&', f'{url}&')
        self.assertIn('&to=now-', str(url))

    def test_start_time_older_than_thirty_days_keeps_the_default_window(self):
        with mock.patch.object(objects, 'use_backend_info_cache',
                               return_value=_backend_info(
                                   grafana_url='https://grafana/d/osmo')):
            url = objects.generate_grafana_url(
                'uuid', 'backend-a', start_time=datetime.datetime(2020, 1, 1))

        self.assertIn('&from=now-1h', str(url))

    def test_recent_start_time_sets_the_window_from_the_start(self):
        # Rounded up from just over two hours, so the value is stable.
        start_time = datetime.datetime.now() - datetime.timedelta(hours=2)

        with mock.patch.object(objects, 'use_backend_info_cache',
                               return_value=_backend_info(
                                   grafana_url='https://grafana/d/osmo')):
            url = objects.generate_grafana_url('uuid', 'backend-a', start_time=start_time)

        self.assertIn('&from=now-3h', str(url))

    def test_base_url_with_existing_query_is_extended_with_an_ampersand(self):
        with mock.patch.object(objects, 'use_backend_info_cache',
                               return_value=_backend_info(
                                   grafana_url='https://grafana/d/osmo?orgId=1')):
            url = objects.generate_grafana_url('uuid', 'backend-a')

        self.assertIn('?orgId=1&var-namespace=osmo', str(url))

    def test_workflow_uuid_is_truncated_to_sixteen_characters(self):
        with mock.patch.object(objects, 'use_backend_info_cache',
                               return_value=_backend_info(
                                   grafana_url='https://grafana/d/osmo')):
            url = objects.generate_grafana_url('0123456789abcdefghij', 'backend-a')

        self.assertIn('&var-uuid=0123456789abcdef&', str(url))


class TestGenerateDashboardUrl(unittest.TestCase):
    """Covers generate_dashboard_url (lines 1521, 1523)."""

    def test_backend_without_dashboard_url_returns_none(self):
        with mock.patch.object(objects, 'use_backend_info_cache',
                               return_value=_backend_info(dashboard_url='')):
            self.assertIsNone(objects.generate_dashboard_url('uuid', 'backend-a'))

    def test_dashboard_url_searches_the_backend_namespace(self):
        with mock.patch.object(objects, 'use_backend_info_cache',
                               return_value=_backend_info(
                                   dashboard_url='https://dash', namespace='osmo-ns')):
            url = objects.generate_dashboard_url('0123456789abcdefghij', 'backend-a')

        self.assertEqual(url, 'https://dash/#/search?namespace=osmo-ns&q=0123456789abcdef')


class TestGenerateTaskDashboardUrl(unittest.TestCase):
    """Covers generate_task_dashboard_url (lines 1530, 1532-1533, 1535,
    1537)."""

    def test_unknown_backend_returns_none(self):
        with mock.patch.object(objects, 'use_backend_info_cache', return_value=None):
            self.assertIsNone(objects.generate_task_dashboard_url('pod-1', 'backend-a'))

    def test_task_dashboard_url_points_at_the_task_pod(self):
        with mock.patch.object(objects, 'use_backend_info_cache',
                               return_value=_backend_info(
                                   dashboard_url='https://dash', namespace='osmo-ns')):
            url = objects.generate_task_dashboard_url('pod-1', 'backend-a')

        self.assertEqual(url, 'https://dash/#/pod/osmo-ns/pod-1?namespace=osmo-ns')


class TestGetWorkflowTags(unittest.TestCase):
    """Covers get_workflow_tags (lines 1543-1544, 1550-1551)."""

    def test_tags_are_projected_from_the_query_rows(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = [{'tag': 'nightly'}, {'tag': 'perf'}]

        with mock.patch.object(objects.WorkflowServiceContext, 'get',
                               return_value=_context(database)):
            tags = objects.get_workflow_tags('wf-1')

        self.assertEqual(tags, ['nightly', 'perf'])
        self.assertEqual(database.execute_fetch_command.call_args.args[1], ('wf-1', 'wf-1'))

    def test_workflow_without_tags_returns_empty_list(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        with mock.patch.object(objects.WorkflowServiceContext, 'get',
                               return_value=_context(database)):
            self.assertEqual(objects.get_workflow_tags('wf-1'), [])


class TestInsertFailedSubmissionToDb(unittest.TestCase):
    """Covers WorkflowSubmitInfo.insert_failed_submission_to_db (lines 946,
    953-954)."""

    def test_failed_submission_is_built_and_inserted(self):
        submit_info = _submit_info(_context(mock.Mock()))
        workflow_obj = mock.Mock()

        with mock.patch.object(objects.workflow.Workflow, 'from_workflow',
                               return_value=workflow_obj) as from_workflow:
            result = submit_info.insert_failed_submission_to_db('boom', labels={'team': 'a'})

        self.assertIs(result, workflow_obj)
        workflow_obj.insert_to_db.assert_called_once_with()
        self.assertEqual(from_workflow.call_args.kwargs['labels'], {'team': 'a'})
        self.assertEqual(from_workflow.call_args.kwargs['failure_message'], 'boom')


class TestConstructWorkflowDict(unittest.TestCase):
    """Covers WorkflowSubmitInfo.construct_workflow_dict (lines 970-971, 975,
    978-982, 998)."""

    def test_malformed_yaml_records_a_failed_submission_and_raises(self):
        submit_info = _submit_info(_context(mock.Mock()))
        template_spec = typing.cast(
            objects.workflow.TemplateSpec,
            types.SimpleNamespace(
                load_template_with_variables=lambda: 'workflow: [unclosed'))

        with mock.patch.object(objects.connectors.Pool, 'fetch_from_configmap',
                               return_value=types.SimpleNamespace(backend='backend-a')):
            with mock.patch.object(objects.WorkflowSubmitInfo,
                                   'insert_failed_submission_to_db') as insert:
                with self.assertRaisesRegex(osmo_errors.OSMOUsageError,
                                            'not properly formatted'):
                    submit_info.construct_workflow_dict(template_spec)

        self.assertEqual(submit_info.name, 'failed-abc123')
        self.assertEqual(insert.call_count, 1)

    def test_malformed_yaml_still_raises_when_the_failure_record_cannot_be_saved(self):
        submit_info = _submit_info(_context(mock.Mock()))
        template_spec = typing.cast(
            objects.workflow.TemplateSpec,
            types.SimpleNamespace(
                load_template_with_variables=lambda: 'workflow: [unclosed'))

        with mock.patch.object(objects.connectors.Pool, 'fetch_from_configmap',
                               return_value=types.SimpleNamespace(backend='backend-a')):
            with mock.patch.object(objects.WorkflowSubmitInfo,
                                   'insert_failed_submission_to_db',
                                   side_effect=RuntimeError('db down')):
                with self.assertRaises(osmo_errors.OSMOUsageError):
                    submit_info.construct_workflow_dict(template_spec)

    def test_non_mapping_labels_are_rejected_as_a_usage_error(self):
        submit_info = _submit_info(_context(mock.Mock()))
        template_spec = typing.cast(
            objects.workflow.TemplateSpec,
            types.SimpleNamespace(
                load_template_with_variables=lambda: 'workflow:\n  name: wf\n  labels: nope\n'))

        with mock.patch.object(objects.connectors.Pool, 'fetch_from_configmap',
                               return_value=types.SimpleNamespace(backend='backend-a')):
            with self.assertRaisesRegex(osmo_errors.OSMOUsageError,
                                        'map of string keys'):
                submit_info.construct_workflow_dict(template_spec)

    def test_label_overrides_are_merged_into_the_rendered_spec(self):
        submit_info = _submit_info(_context(mock.Mock()))
        template_spec = typing.cast(
            objects.workflow.TemplateSpec,
            types.SimpleNamespace(
                load_template_with_variables=lambda: 'workflow:\n  name: wf\n  labels: {}\n'))

        with mock.patch.object(objects.connectors.Pool, 'fetch_from_configmap',
                               return_value=types.SimpleNamespace(backend='backend-a')):
            workflow_dict = submit_info.construct_workflow_dict(
                template_spec, label_overrides=['team=infra'])

        self.assertEqual(workflow_dict['workflow']['labels'], {'team': 'infra'})
        self.assertEqual(submit_info.backend, 'backend-a')


class TestConstructWorkflowSpecFromDict(unittest.TestCase):
    """Covers WorkflowSubmitInfo.construct_workflow_spec_from_dict (lines
    1014-1015, 1017-1020, 1022-1025, 1027)."""

    def test_invalid_spec_records_a_failed_submission_with_its_labels(self):
        submit_info = _submit_info(_context(mock.Mock()), name='wf')
        workflow_dict = {'workflow': {'name': 'wf', 'labels': {'team': 'infra'}}}

        with mock.patch.object(objects.WorkflowSubmitInfo,
                                   'insert_failed_submission_to_db') as insert:
            with self.assertRaises(osmo_errors.OSMOUsageError):
                submit_info.construct_workflow_spec_from_dict(workflow_dict)

        self.assertEqual(insert.call_args.kwargs['labels'], {'team': 'infra'})

    def test_invalid_spec_still_raises_when_the_failure_record_cannot_be_saved(self):
        submit_info = _submit_info(_context(mock.Mock()), name='wf')

        with mock.patch.object(objects.WorkflowSubmitInfo,
                                   'insert_failed_submission_to_db',
                               side_effect=RuntimeError('db down')):
            with self.assertRaises(osmo_errors.OSMOUsageError):
                submit_info.construct_workflow_spec_from_dict({'workflow': {}})

    def test_valid_spec_returns_the_inner_workflow_section(self):
        submit_info = _submit_info(_context(mock.Mock()), name='wf')
        versioned = types.SimpleNamespace(workflow=mock.sentinel.rendered_spec)

        with mock.patch.object(objects.workflow, 'VersionedWorkflowSpec',
                               return_value=versioned):
            result = submit_info.construct_workflow_spec_from_dict(
                {'version': 2, 'workflow': {}})

        self.assertIs(result, mock.sentinel.rendered_spec)


class TestSendWorkflowSpecToQueue(unittest.TestCase):
    """Covers WorkflowSubmitInfo.send_workflow_spec_to_queue (lines 1032, 1036,
    1045-1047, 1049-1050, 1052-1054, 1056, 1059, 1061, 1064, 1066, 1068, 1072,
    1077)."""

    def test_rendered_spec_is_queued_as_a_single_workflow_file(self):
        submit_info = _submit_info(_context(mock.Mock()))
        workflow_dict = {
            'workflow': {
                'name': 'wf',
                'tasks': [{'name': 't1', 'files': [{'path': '/a', 'contents': 'x\ny'}]}],
            }
        }

        with mock.patch.object(objects.jobs, 'UploadWorkflowFiles') as upload_job:
            submit_info.send_workflow_spec_to_queue('wf-1', workflow_dict)

        files = upload_job.call_args.kwargs['files']
        self.assertEqual(len(files), 1)
        upload_job.return_value.send_job_to_queue.assert_called_once_with()

    def test_original_templated_spec_is_queued_alongside_the_rendered_spec(self):
        submit_info = _submit_info(_context(mock.Mock()))
        workflow_dict = {'workflow': {'name': 'wf', 'tasks': []}}

        with mock.patch.object(objects.jobs, 'UploadWorkflowFiles') as upload_job:
            submit_info.send_workflow_spec_to_queue(
                'wf-1', workflow_dict, original_templated_spec='workflow: {}\n')

        self.assertEqual(len(upload_job.call_args.kwargs['files']), 2)

    def test_group_task_file_contents_are_converted_to_yaml_literals(self):
        submit_info = _submit_info(_context(mock.Mock()))
        workflow_dict: dict[str, typing.Any] = {
            'workflow': {
                'name': 'wf',
                'groups': [{
                    'name': 'g1',
                    'tasks': [{
                        'name': 't1',
                        'credentials': {'registry-cred': {'alias': 'value'}},
                        'files': [{'path': '/a', 'contents': 'line1\nline2'}],
                    }],
                }],
            }
        }

        with mock.patch.object(objects.jobs, 'UploadWorkflowFiles') as upload_job:
            submit_info.send_workflow_spec_to_queue('wf-1', workflow_dict)

        contents = workflow_dict['workflow']['groups'][0]['tasks'][0]['files'][0]['contents']
        self.assertIsInstance(contents, objects.util_yaml.YamlLiteral)
        self.assertEqual(upload_job.call_args.kwargs['workflow_id'], 'wf-1')


if __name__ == '__main__':
    unittest.main()
