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
from typing import cast
import unittest
from unittest import mock

from src.lib.utils import osmo_errors, priority as wf_priority
from src.service.core.workflow import objects
from src.utils import connectors
from src.utils.job import common as task_common, task, workflow


_FIXED_NOW = datetime.datetime(2026, 1, 2, 12, 0, 0)
_SUBMIT_TIME = datetime.datetime(2026, 1, 2, 10, 0, 0)


class _FixedNowDateTime(datetime.datetime):
    """datetime.datetime subclass whose now() is pinned for determinism."""

    @classmethod
    def now(cls, tz=None):
        return _FIXED_NOW


# Stand-in for the `datetime` module as seen from objects.py, so that
# `datetime.datetime.now()` inside the module under test is deterministic.
_FAKE_DATETIME_MODULE = types.SimpleNamespace(
    datetime=_FixedNowDateTime, timedelta=datetime.timedelta)


def _backend_info(
        grafana_url: str = 'https://grafana.example.com/d/osmo',
        dashboard_url: str = 'https://dashboard.example.com',
        k8s_namespace: str = 'osmo-ns') -> types.SimpleNamespace:
    return types.SimpleNamespace(
        grafana_url=grafana_url,
        dashboard_url=dashboard_url,
        k8s_namespace=k8s_namespace,
    )


def _patch_context(database=None, method: str = 'dev'):
    """Patch WorkflowServiceContext.get() with a namespace test double."""
    fake_context = types.SimpleNamespace(
        database=database if database is not None else mock.Mock(),
        config=types.SimpleNamespace(method=method),
    )
    return mock.patch.object(
        objects.WorkflowServiceContext, 'get', return_value=fake_context)


def _submit_info(policy=None, pod_label_prefix: str = '') -> objects.WorkflowSubmitInfo:
    database = mock.Mock()
    database.get_workflow_configs.return_value = types.SimpleNamespace(
        labels_config=types.SimpleNamespace(
            policy=policy if policy is not None else [],
            pod_label_prefix=pod_label_prefix),
    )
    context = cast(
        objects.WorkflowServiceContext,
        types.SimpleNamespace(
            database=database,
            config=types.SimpleNamespace(method='dev', redis_url='redis://test')),
    )
    return objects.WorkflowSubmitInfo.model_construct(
        context=context,
        base32_id='abcdefghijklmnopqrstuvwxyz012345',
        name='workflow-1',
        user='user-1',
        pool='pool-1',
        backend='backend-1',
    )


def _workflow_row(
        status: str = 'RUNNING',
        start_time: datetime.datetime | None = None,
        end_time: datetime.datetime | None = None,
        labels: dict | None = None) -> dict:
    return {
        'submitted_by': 'user-1',
        'workflow_id': 'workflow-1',
        'workflow_uuid': 'a' * 32,
        'submit_time': _SUBMIT_TIME,
        'start_time': start_time,
        'end_time': end_time,
        'status': status,
        'backend': 'backend-1',
        'pool': 'pool-1',
        'app_owner': 'owner-1',
        'app_name': 'app-1',
        'app_version': 3,
        'priority': 'NORMAL',
        'labels': labels,
    }


def _task_row(status: str = 'RUNNING') -> dict:
    row = _workflow_row(status=status)
    row.update({
        'name': 'task-0',
        'retry_id': 0,
        'node_name': 'node-1',
        'disk_count': 2.5,
        'cpu_count': 4.4,
        'memory_count': 8.0,
        'gpu_count': 1.6,
    })
    return row


class TestWorkflowServiceConfigDefaultAdmin(unittest.TestCase):
    """Covers WorkflowServiceConfig.validate_default_admin."""

    def test_validate_default_admin_non_dict_input_returns_input_unchanged(self):
        values = 'not-a-mapping'

        result = objects.WorkflowServiceConfig.validate_default_admin(  # type: ignore[operator]
            values)

        self.assertEqual(result, 'not-a-mapping')

    def test_validate_default_admin_username_without_password_raises_value_error(self):
        with self.assertRaises(ValueError) as raised:
            objects.WorkflowServiceConfig.validate_default_admin(  # type: ignore[operator]
                {'default_admin_username': 'admin'})

        self.assertIn('default_admin_password must be set', str(raised.exception))

    def test_validate_default_admin_username_with_password_returns_values(self):
        values = {'default_admin_username': 'admin', 'default_admin_password': 'secret'}

        result = objects.WorkflowServiceConfig.validate_default_admin(  # type: ignore[operator]
            values)

        self.assertEqual(result, values)


class TestWorkflowServiceContext(unittest.TestCase):
    """Covers the WorkflowServiceContext singleton accessors."""

    def test_get_before_initialization_raises_value_error(self):
        with mock.patch.object(objects.WorkflowServiceContext, '_instance', None):
            with self.assertRaises(ValueError) as raised:
                objects.WorkflowServiceContext.get()

        self.assertIn('before initialization', str(raised.exception))

    def test_get_after_set_returns_the_registered_instance(self):
        instance = cast(
            objects.WorkflowServiceContext, types.SimpleNamespace(database=None))

        with mock.patch.object(objects.WorkflowServiceContext, '_instance', None):
            objects.WorkflowServiceContext.set(instance)
            result = objects.WorkflowServiceContext.get()

        self.assertIs(result, instance)


class TestSubmitResponseValidation(unittest.TestCase):
    """Covers the exactly-one-of logs/spec rule on SubmitResponse."""

    def test_submit_response_with_neither_logs_nor_spec_raises(self):
        with self.assertRaises(ValueError) as raised:
            objects.SubmitResponse(name='workflow-1')

        self.assertIn('Exactly one of', str(raised.exception))

    def test_submit_response_with_both_logs_and_spec_raises(self):
        with self.assertRaises(ValueError) as raised:
            objects.SubmitResponse(name='workflow-1', logs='logs-url', spec='spec-url')

        self.assertIn('Exactly one of', str(raised.exception))

    def test_submit_response_with_only_spec_is_accepted(self):
        response = objects.SubmitResponse(name='workflow-1', spec='spec-url')

        self.assertEqual(response.spec, 'spec-url')


class TestGetTimeDiff(unittest.TestCase):
    """Covers get_time_diff rounding behavior."""

    def test_get_time_diff_default_interval_returns_hours(self):
        result = objects.get_time_diff(
            datetime.datetime(2026, 1, 2, 8, 0, 0),
            datetime.datetime(2026, 1, 2, 12, 30, 0))

        self.assertEqual(result, 4.5)

    def test_get_time_diff_custom_interval_returns_minutes(self):
        result = objects.get_time_diff(
            datetime.datetime(2026, 1, 2, 8, 0, 0),
            datetime.datetime(2026, 1, 2, 8, 30, 0),
            round_to=60)

        self.assertEqual(result, 30.0)

    def test_get_time_diff_end_before_start_returns_negative(self):
        result = objects.get_time_diff(
            datetime.datetime(2026, 1, 2, 12, 0, 0),
            datetime.datetime(2026, 1, 2, 11, 0, 0))

        self.assertEqual(result, -1.0)


class TestUseBackendInfoCache(unittest.TestCase):
    """Covers the backend lookup cache used by the URL generators."""

    def test_lookup_without_cache_fetches_backend_every_call(self):
        backend_info = _backend_info()

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                return_value=backend_info) as fetch_from_db:
            first = objects.use_backend_info_cache('backend-1')
            second = objects.use_backend_info_cache('backend-1')

        self.assertIs(first, backend_info)
        self.assertIs(second, backend_info)
        self.assertEqual(fetch_from_db.call_count, 2)

    def test_lookup_with_cache_fetches_backend_once_and_stores_it(self):
        backend_info = _backend_info()
        backend_lookup: dict = {}

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                return_value=backend_info) as fetch_from_db:
            first = objects.use_backend_info_cache('backend-1', backend_lookup)
            second = objects.use_backend_info_cache('backend-1', backend_lookup)

        self.assertIs(first, backend_info)
        self.assertIs(second, backend_info)
        fetch_from_db.assert_called_once()
        self.assertEqual(backend_lookup, {'backend-1': backend_info})

    def test_lookup_caches_resource_error_as_missing_backend(self):
        backend_lookup: dict = {}

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                side_effect=osmo_errors.OSMOResourceError('no resources')) as fetch_from_db:
            result = objects.use_backend_info_cache('backend-1', backend_lookup)

        self.assertIsNone(result)
        self.assertEqual(backend_lookup, {'backend-1': None})
        fetch_from_db.assert_called_once()

    def test_lookup_returns_none_when_backend_is_not_found(self):
        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                side_effect=osmo_errors.OSMOBackendError('missing backend')):
            result = objects.use_backend_info_cache('backend-1')

        self.assertIsNone(result)


class TestGetWorkflowQueuedTime(unittest.TestCase):
    """Covers get_workflow_queued_time for raw rows and workflow objects."""

    def test_raw_row_with_start_time_returns_start_minus_submit(self):
        row = _workflow_row(start_time=datetime.datetime(2026, 1, 2, 10, 30, 0))

        result = objects.get_workflow_queued_time(row, use_raw_row=True)

        self.assertEqual(result, datetime.timedelta(minutes=30))

    def test_raw_row_cancelled_before_start_uses_end_time(self):
        row = _workflow_row(
            start_time=None, end_time=datetime.datetime(2026, 1, 2, 10, 15, 0))

        result = objects.get_workflow_queued_time(row, use_raw_row=True)

        self.assertEqual(result, datetime.timedelta(minutes=15))

    def test_raw_row_not_started_uses_current_time(self):
        row = _workflow_row(start_time=None, end_time=None)

        with mock.patch.object(
                objects.common, 'current_time', return_value=_FIXED_NOW):
            result = objects.get_workflow_queued_time(row, use_raw_row=True)

        self.assertEqual(result, datetime.timedelta(hours=2))

    def test_raw_row_missing_time_columns_returns_zero_timedelta(self):
        with mock.patch.object(
                objects.common, 'current_time', return_value=_FIXED_NOW):
            result = objects.get_workflow_queued_time({}, use_raw_row=True)

        self.assertEqual(result, datetime.timedelta())

    def test_workflow_object_with_start_time_returns_start_minus_submit(self):
        workflow_obj = types.SimpleNamespace(
            start_time=datetime.datetime(2026, 1, 2, 11, 0, 0),
            end_time=None,
            submit_time=_SUBMIT_TIME)

        result = objects.get_workflow_queued_time(workflow_obj)

        self.assertEqual(result, datetime.timedelta(hours=1))

    def test_workflow_object_not_started_uses_current_time(self):
        workflow_obj = types.SimpleNamespace(
            start_time=None, end_time=None, submit_time=_SUBMIT_TIME)

        with mock.patch.object(
                objects.common, 'current_time', return_value=_FIXED_NOW):
            result = objects.get_workflow_queued_time(workflow_obj)

        self.assertEqual(result, datetime.timedelta(hours=2))


class TestGetWorkflowDuration(unittest.TestCase):
    """Covers get_workflow_duration for raw rows and workflow objects."""

    def test_raw_row_with_start_and_end_returns_elapsed_time(self):
        row = _workflow_row(
            start_time=datetime.datetime(2026, 1, 2, 10, 0, 0),
            end_time=datetime.datetime(2026, 1, 2, 11, 0, 0))

        result = objects.get_workflow_duration(row, use_raw_row=True)

        self.assertEqual(result, datetime.timedelta(hours=1))

    def test_raw_row_still_running_uses_current_time_as_end(self):
        row = _workflow_row(
            start_time=datetime.datetime(2026, 1, 2, 10, 0, 0), end_time=None)

        with mock.patch.object(
                objects.common, 'current_time', return_value=_FIXED_NOW):
            result = objects.get_workflow_duration(row, use_raw_row=True)

        self.assertEqual(result, datetime.timedelta(hours=2))

    def test_raw_row_not_started_returns_none(self):
        row = _workflow_row(start_time=None, end_time=None)

        result = objects.get_workflow_duration(row, use_raw_row=True)

        self.assertIsNone(result)

    def test_raw_row_missing_time_columns_returns_none(self):
        result = objects.get_workflow_duration({}, use_raw_row=True)

        self.assertIsNone(result)

    def test_workflow_object_with_start_and_end_returns_elapsed_time(self):
        workflow_obj = types.SimpleNamespace(
            start_time=datetime.datetime(2026, 1, 2, 10, 0, 0),
            end_time=datetime.datetime(2026, 1, 2, 10, 45, 0))

        result = objects.get_workflow_duration(workflow_obj)

        self.assertEqual(result, datetime.timedelta(minutes=45))

    def test_workflow_object_not_started_returns_none(self):
        workflow_obj = types.SimpleNamespace(start_time=None, end_time=None)

        result = objects.get_workflow_duration(workflow_obj)

        self.assertIsNone(result)


class TestGenerateGrafanaUrl(unittest.TestCase):
    """Covers grafana URL generation and its time-window arithmetic."""

    def test_missing_backend_returns_none(self):
        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                side_effect=osmo_errors.OSMOBackendError('missing')):
            result = objects.generate_grafana_url('a' * 32, 'backend-1')

        self.assertIsNone(result)

    def test_backend_without_grafana_url_returns_none(self):
        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                return_value=_backend_info(grafana_url='')):
            result = objects.generate_grafana_url('a' * 32, 'backend-1')

        self.assertIsNone(result)

    def test_workflow_without_times_uses_one_hour_window_until_now(self):
        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            result = objects.generate_grafana_url('a' * 32, 'backend-1')

        self.assertEqual(
            result,
            'https://grafana.example.com/d/osmo?var-namespace=osmo-ns'
            '&var-uuid=aaaaaaaaaaaaaaaa&from=now-1h&to=now')

    def test_end_time_older_than_one_hour_shifts_both_window_bounds(self):
        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            result = objects.generate_grafana_url(
                'a' * 32, 'backend-1',
                end_time=datetime.datetime(2026, 1, 2, 8, 0, 0))

        self.assertEqual(
            result,
            'https://grafana.example.com/d/osmo?var-namespace=osmo-ns'
            '&var-uuid=aaaaaaaaaaaaaaaa&from=now-5h&to=now-4h')

    def test_recent_start_time_sets_window_start_to_rounded_up_age(self):
        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            result = objects.generate_grafana_url(
                'a' * 32, 'backend-1',
                start_time=datetime.datetime(2026, 1, 2, 9, 30, 0))

        self.assertEqual(
            result,
            'https://grafana.example.com/d/osmo?var-namespace=osmo-ns'
            '&var-uuid=aaaaaaaaaaaaaaaa&from=now-3h&to=now')

    def test_start_time_older_than_thirty_days_falls_back_to_one_hour_window(self):
        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            result = objects.generate_grafana_url(
                'a' * 32, 'backend-1',
                start_time=datetime.datetime(2024, 1, 1, 0, 0, 0))

        self.assertEqual(
            result,
            'https://grafana.example.com/d/osmo?var-namespace=osmo-ns'
            '&var-uuid=aaaaaaaaaaaaaaaa&from=now-1h&to=now')

    def test_grafana_url_with_existing_query_string_appends_with_ampersand(self):
        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                return_value=_backend_info(
                    grafana_url='https://grafana.example.com/d/osmo?orgId=1')), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            result = objects.generate_grafana_url('a' * 32, 'backend-1')

        self.assertEqual(
            result,
            'https://grafana.example.com/d/osmo?orgId=1&var-namespace=osmo-ns'
            '&var-uuid=aaaaaaaaaaaaaaaa&from=now-1h&to=now')


class TestGenerateDashboardUrl(unittest.TestCase):
    """Covers workflow-level Kubernetes dashboard URL generation."""

    def test_dashboard_url_searches_namespace_for_uuid_prefix(self):
        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()):
            result = objects.generate_dashboard_url('b' * 32, 'backend-1')

        self.assertEqual(
            result,
            'https://dashboard.example.com/#/search?namespace=osmo-ns'
            '&q=bbbbbbbbbbbbbbbb')

    def test_backend_without_dashboard_url_returns_none(self):
        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                return_value=_backend_info(dashboard_url='')):
            result = objects.generate_dashboard_url('b' * 32, 'backend-1')

        self.assertIsNone(result)


class TestGenerateTaskDashboardUrl(unittest.TestCase):
    """Covers task-level Kubernetes dashboard URL generation."""

    def test_task_dashboard_url_points_at_the_pod_page(self):
        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()):
            result = objects.generate_task_dashboard_url('pod-1', 'backend-1')

        self.assertEqual(
            result,
            'https://dashboard.example.com/#/pod/osmo-ns/pod-1?namespace=osmo-ns')

    def test_task_dashboard_url_returns_none_without_backend(self):
        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                side_effect=osmo_errors.OSMOBackendError('missing')):
            result = objects.generate_task_dashboard_url('pod-1', 'backend-1')

        self.assertIsNone(result)


class TestGetWorkflowTags(unittest.TestCase):
    """Covers get_workflow_tags."""

    def test_get_workflow_tags_returns_tag_column_values(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = [
            {'tag': 'nightly'}, {'tag': 'release'}]

        with _patch_context(database=database):
            result = objects.get_workflow_tags('workflow-1')

        self.assertEqual(result, ['nightly', 'release'])
        self.assertEqual(
            database.execute_fetch_command.call_args.args[1],
            ('workflow-1', 'workflow-1'))

    def test_get_workflow_tags_without_rows_returns_empty_list(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        with _patch_context(database=database):
            result = objects.get_workflow_tags('workflow-1')

        self.assertEqual(result, [])


class TestListEntryFromDbRow(unittest.TestCase):
    """Covers ListEntry / ListResponse construction from database rows."""

    def test_dev_method_overview_uses_api_workflow_path(self):
        row = _workflow_row()

        with _patch_context(method='dev'), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            entry = objects.ListEntry.from_db_row(row, 'https://osmo.test', {})

        self.assertEqual(entry.overview, 'https://osmo.test/api/workflow/workflow-1')

    def test_non_dev_method_overview_uses_ui_workflows_path(self):
        row = _workflow_row()

        with _patch_context(method='prod'), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            entry = objects.ListEntry.from_db_row(row, 'https://osmo.test', {})

        self.assertEqual(entry.overview, 'https://osmo.test/workflows/workflow-1')

    def test_running_workflow_has_no_error_logs_link(self):
        row = _workflow_row(status='RUNNING')

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            entry = objects.ListEntry.from_db_row(row, 'https://osmo.test', {})

        self.assertIsNone(entry.error_logs)
        self.assertEqual(
            entry.logs, 'https://osmo.test/api/workflow/workflow-1/logs')

    def test_failed_workflow_gets_error_logs_link(self):
        row = _workflow_row(status='FAILED_SUBMISSION')

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            entry = objects.ListEntry.from_db_row(row, 'https://osmo.test', {})

        self.assertEqual(
            entry.error_logs,
            'https://osmo.test/api/workflow/workflow-1/error_logs')

    def test_null_labels_column_becomes_empty_map(self):
        row = _workflow_row(labels=None)

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            entry = objects.ListEntry.from_db_row(row, 'https://osmo.test', {})

        self.assertEqual(entry.labels, {})

    def test_stored_labels_are_returned_on_the_entry(self):
        row = _workflow_row(labels={'project': 'alpha'})

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            entry = objects.ListEntry.from_db_row(row, 'https://osmo.test', {})

        self.assertEqual(entry.labels, {'project': 'alpha'})

    def test_queued_time_and_duration_are_derived_from_row_timestamps(self):
        row = _workflow_row(
            start_time=datetime.datetime(2026, 1, 2, 10, 30, 0),
            end_time=datetime.datetime(2026, 1, 2, 11, 0, 0))

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            entry = objects.ListEntry.from_db_row(row, 'https://osmo.test', {})

        self.assertEqual(entry.queued_time, datetime.timedelta(minutes=30))
        self.assertEqual(entry.duration, datetime.timedelta(minutes=30))

    def test_list_response_reuses_one_backend_lookup_for_all_rows(self):
        rows = [_workflow_row(), _workflow_row()]

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                return_value=_backend_info()) as fetch_from_db, \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            response = objects.ListResponse.from_db_rows(
                rows, 'https://osmo.test', True)

        self.assertEqual(len(response.workflows), 2)
        self.assertTrue(response.more_entries)
        fetch_from_db.assert_called_once()

    def test_list_response_without_rows_reports_no_more_entries(self):
        with _patch_context():
            response = objects.ListResponse.from_db_rows([], 'https://osmo.test', False)

        self.assertEqual(response.workflows, [])
        self.assertFalse(response.more_entries)


class TestListTaskEntryFromDbRow(unittest.TestCase):
    """Covers ListTaskEntry / ListTaskResponse construction from rows."""

    def test_dev_method_overview_uses_api_workflow_path(self):
        row = _task_row()

        with _patch_context(method='dev'), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            entry = objects.ListTaskEntry.from_db_row(row, 'https://osmo.test', {})

        self.assertEqual(entry.overview, 'https://osmo.test/api/workflow/workflow-1')

    def test_non_dev_method_overview_uses_ui_workflows_path(self):
        row = _task_row()

        with _patch_context(method='prod'), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            entry = objects.ListTaskEntry.from_db_row(row, 'https://osmo.test', {})

        self.assertEqual(entry.overview, 'https://osmo.test/workflows/workflow-1')

    def test_task_logs_link_includes_task_name(self):
        row = _task_row(status='RUNNING')

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            entry = objects.ListTaskEntry.from_db_row(row, 'https://osmo.test', {})

        self.assertEqual(
            entry.logs,
            'https://osmo.test/api/workflow/workflow-1/logs?task_name=task-0')
        self.assertIsNone(entry.error_logs)

    def test_failed_task_error_logs_link_includes_task_name(self):
        row = _task_row(status='FAILED')

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            entry = objects.ListTaskEntry.from_db_row(row, 'https://osmo.test', {})

        self.assertEqual(
            entry.error_logs,
            'https://osmo.test/api/workflow/workflow-1/error_logs?task_name=task-0')

    def test_fractional_resource_counts_are_rounded_for_cpu_and_gpu(self):
        row = _task_row()

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db', return_value=_backend_info()), \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            entry = objects.ListTaskEntry.from_db_row(row, 'https://osmo.test', {})

        self.assertEqual(entry.cpu, 4)
        self.assertEqual(entry.gpu, 2)
        self.assertEqual(entry.storage, 2.5)
        self.assertEqual(entry.memory, 8.0)

    def test_list_task_response_reuses_one_backend_lookup_for_all_rows(self):
        rows = [_task_row(), _task_row()]

        with _patch_context(), mock.patch.object(
                connectors.Backend, 'fetch_from_db',
                return_value=_backend_info()) as fetch_from_db, \
                mock.patch.object(objects, 'datetime', _FAKE_DATETIME_MODULE):
            response = objects.ListTaskResponse.from_db_rows(rows, 'https://osmo.test')

        self.assertEqual(len(response.tasks), 2)
        fetch_from_db.assert_called_once()


class TestListTaskAggregatedResponse(unittest.TestCase):
    """Covers the aggregated task summary response."""

    def test_from_db_rows_keeps_workflow_id_on_each_summary(self):
        rows = [{
            'workflow_id': 'workflow-1',
            'submitted_by': 'user-1',
            'pool': 'pool-1',
            'disk_count': 1.5,
            'cpu_count': 2.0,
            'memory_count': 4.0,
            'gpu_count': 1.0,
            'priority': 'NORMAL',
        }]

        response = objects.ListTaskAggregatedResponse.from_db_rows(rows)

        self.assertEqual(len(response.summaries), 1)
        self.assertEqual(response.summaries[0].workflow_id, 'workflow-1')
        self.assertEqual(response.summaries[0].cpu, 2)

    def test_from_db_rows_without_rows_returns_empty_summaries(self):
        response = objects.ListTaskAggregatedResponse.from_db_rows([])

        self.assertEqual(response.summaries, [])


class TestCredentialProtocolDefaults(unittest.TestCase):
    """Covers the CredentialProtocol placeholder implementations."""

    def test_protocol_type_returns_none(self):
        self.assertIsNone(objects.CredentialProtocol.type())

    def test_protocol_to_db_row_returns_none(self):
        stub = types.SimpleNamespace()

        result = objects.CredentialProtocol.to_db_row(
            cast(objects.CredentialProtocol, stub), 'user-1', mock.Mock())

        self.assertIsNone(result)

    def test_protocol_valid_cred_returns_none(self):
        stub = types.SimpleNamespace()

        result = objects.CredentialProtocol.valid_cred(
            cast(objects.CredentialProtocol, stub), mock.Mock())

        self.assertIsNone(result)


class TestUserRegistryCredential(unittest.TestCase):
    """Covers registry credential persistence and validation."""

    def test_type_is_registry(self):
        self.assertEqual(
            objects.UserRegistryCredential.type(), connectors.CredentialType.REGISTRY)

    def test_to_db_row_encrypts_username_and_auth_into_hstore_payload(self):
        credential = objects.UserRegistryCredential(
            registry='nvcr.io/nvidia', username='user', auth='token')
        postgres = mock.Mock()
        postgres.encrypt_dict.return_value = {
            'username': 'user', 'auth': 'encrypted-token'}

        record = credential.to_db_row('user-1', postgres)

        postgres.encrypt_dict.assert_called_once_with(
            {'username': 'user', 'auth': 'token'}, 'user-1')
        self.assertEqual(record.cred_type, connectors.CredentialType.REGISTRY.value)
        self.assertEqual(record.profile, 'nvcr.io/nvidia')
        self.assertEqual(
            record.payload, '"username"=>"user","auth"=>"encrypted-token"')

    def test_valid_cred_skips_authentication_for_disabled_registry_scope(self):
        credential = objects.UserRegistryCredential(
            registry='nvcr.io/nvidia', username='user', auth='token')
        workflow_config = mock.Mock()
        workflow_config.credential_config.disable_registry_validation = ['nvcr.io']

        with mock.patch.object(objects.common, 'registry_auth') as registry_auth:
            credential.valid_cred(workflow_config)

        registry_auth.assert_not_called()

    def test_valid_cred_rejects_registry_that_refuses_the_token(self):
        credential = objects.UserRegistryCredential(
            registry='nvcr.io/nvidia', username='user', auth='token')
        workflow_config = mock.Mock()
        workflow_config.credential_config.disable_registry_validation = []

        with mock.patch.object(
                objects.common, 'registry_auth',
                return_value=types.SimpleNamespace(status_code=401)):
            with self.assertRaises(osmo_errors.OSMOCredentialError) as raised:
                credential.valid_cred(workflow_config)

        self.assertIn('Registry authentication failed', raised.exception.message)


class TestUserDataCredential(unittest.TestCase):
    """Covers data credential persistence and validation."""

    def test_type_is_data(self):
        self.assertEqual(
            objects.UserDataCredential.type(), connectors.CredentialType.DATA)

    def test_to_db_row_includes_all_optional_connection_settings(self):
        credential = objects.UserDataCredential(
            endpoint='s3://bucket',
            access_key_id='key-id',
            access_key='key-secret',
            region='us-west-2',
            override_url='https://minio.example.com',
            addressing_style='path')
        postgres = mock.Mock()
        postgres.encrypt_dict.side_effect = lambda payload, user: payload

        record = credential.to_db_row('user-1', postgres)

        self.assertEqual(
            postgres.encrypt_dict.call_args.args[0],
            {
                'access_key_id': 'key-id',
                'access_key': 'key-secret',
                'region': 'us-west-2',
                'override_url': 'https://minio.example.com',
                'addressing_style': 'path',
            })
        self.assertEqual(record.cred_type, connectors.CredentialType.DATA.value)
        self.assertEqual(record.profile, 's3://bucket')
        self.assertIn('"region"=>"us-west-2"', record.payload)

    def test_to_db_row_omits_unset_optional_connection_settings(self):
        credential = objects.UserDataCredential(
            endpoint='s3://bucket', access_key_id='key-id', access_key='key-secret')
        postgres = mock.Mock()
        postgres.encrypt_dict.side_effect = lambda payload, user: payload

        credential.to_db_row('user-1', postgres)

        self.assertEqual(
            postgres.encrypt_dict.call_args.args[0],
            {'access_key_id': 'key-id', 'access_key': 'key-secret'})

    def test_valid_cred_skips_authentication_for_disabled_scheme(self):
        credential = objects.UserDataCredential(
            endpoint='s3://bucket', access_key_id='key-id', access_key='key-secret')
        storage_backend = mock.Mock()
        storage_backend.scheme = 's3'
        workflow_config = mock.Mock()
        workflow_config.credential_config.disable_data_validation = ['s3']

        with mock.patch.object(
                objects.storage, 'construct_storage_backend',
                return_value=storage_backend):
            credential.valid_cred(workflow_config)

        storage_backend.data_auth.assert_not_called()

    def test_valid_cred_authenticates_against_the_storage_backend(self):
        credential = objects.UserDataCredential(
            endpoint='s3://bucket',
            access_key_id='key-id',
            access_key='key-secret',
            region='us-west-2')
        storage_backend = mock.Mock()
        storage_backend.scheme = 's3'
        workflow_config = mock.Mock()
        workflow_config.credential_config.disable_data_validation = []

        with mock.patch.object(
                objects.storage, 'construct_storage_backend',
                return_value=storage_backend):
            credential.valid_cred(workflow_config)

        storage_backend.data_auth.assert_called_once()
        data_cred = storage_backend.data_auth.call_args.args[0]
        self.assertEqual(data_cred.access_key_id, 'key-id')
        self.assertEqual(data_cred.access_key.get_secret_value(), 'key-secret')
        self.assertEqual(data_cred.region, 'us-west-2')


class TestUserCredential(unittest.TestCase):
    """Covers generic credential persistence and listing."""

    def test_type_is_generic(self):
        self.assertEqual(
            objects.UserCredential.type(), connectors.CredentialType.GENERIC)

    def test_to_db_row_has_no_profile_and_encrypts_the_whole_map(self):
        credential = objects.UserCredential(credential={'token': 'plain'})
        postgres = mock.Mock()
        postgres.encrypt_dict.return_value = {'token': 'encrypted'}

        record = credential.to_db_row('user-1', postgres)

        postgres.encrypt_dict.assert_called_once_with({'token': 'plain'}, 'user-1')
        self.assertEqual(record.cred_type, connectors.CredentialType.GENERIC.value)
        self.assertIsNone(record.profile)
        self.assertEqual(record.payload, '"token"=>"encrypted"')

    def test_from_db_row_projects_name_type_and_profile(self):
        rows = [
            types.SimpleNamespace(
                cred_name='registry-1', cred_type='REGISTRY', profile='nvcr.io'),
            types.SimpleNamespace(
                cred_name='generic-1', cred_type='GENERIC', profile=None),
        ]

        result = objects.UserCredential.from_db_row(rows)

        self.assertEqual(result, [
            {'cred_name': 'registry-1', 'cred_type': 'REGISTRY', 'profile': 'nvcr.io'},
            {'cred_name': 'generic-1', 'cred_type': 'GENERIC', 'profile': None},
        ])

    def test_from_db_row_without_rows_returns_empty_list(self):
        self.assertEqual(objects.UserCredential.from_db_row([]), [])

    def test_valid_cred_accepts_any_generic_payload(self):
        credential = objects.UserCredential(credential={'token': 'plain'})

        self.assertIsNone(credential.valid_cred(mock.Mock()))


class TestCredentialOptions(unittest.TestCase):
    """Covers the exactly-one-credential rule on CredentialOptions."""

    def test_no_credential_set_raises_user_error(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            objects.CredentialOptions()

        self.assertIn('Exactly one of', raised.exception.message)

    def test_two_credentials_set_raises_user_error(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            objects.CredentialOptions(
                registry_credential=objects.UserRegistryCredential(
                    registry='nvcr.io', username='user', auth='token'),
                generic_credential=objects.UserCredential(credential={'token': 'x'}))

    def test_non_mapping_input_is_returned_unchanged_by_the_validator(self):
        values = 'not-a-mapping'

        result = objects.CredentialOptions.validate_credential(  # type: ignore[operator]
            values)

        self.assertEqual(result, 'not-a-mapping')

    def test_get_credential_returns_the_registry_credential(self):
        registry_credential = objects.UserRegistryCredential(
            registry='nvcr.io', username='user', auth='token')
        options = objects.CredentialOptions(registry_credential=registry_credential)

        self.assertIs(options.get_credential(), registry_credential)

    def test_get_credential_returns_the_data_credential(self):
        data_credential = objects.UserDataCredential(
            endpoint='s3://bucket', access_key_id='key-id', access_key='key-secret')
        options = objects.CredentialOptions(data_credential=data_credential)

        self.assertIs(options.get_credential(), data_credential)

    def test_get_credential_returns_the_generic_credential(self):
        generic_credential = objects.UserCredential(credential={'token': 'x'})
        options = objects.CredentialOptions(generic_credential=generic_credential)

        self.assertIs(options.get_credential(), generic_credential)

    def test_get_credential_without_any_credential_raises_user_error(self):
        options = objects.CredentialOptions.model_construct(
            registry_credential=None, data_credential=None, generic_credential=None)

        with self.assertRaises(osmo_errors.OSMOUserError) as raised:
            options.get_credential()

        self.assertIn('Exactly one of', raised.exception.message)


class TestInsertFailedSubmissionToDb(unittest.TestCase):
    """Covers the failed-submission database write."""

    def test_failed_submission_is_written_with_labels_and_returned(self):
        submit_info = _submit_info()
        workflow_obj = mock.Mock()

        with mock.patch.object(
                workflow.Workflow, 'from_workflow',
                return_value=workflow_obj) as from_workflow:
            result = submit_info.insert_failed_submission_to_db(
                'spec is invalid', labels={'project': 'alpha'})

        self.assertIs(result, workflow_obj)
        workflow_obj.insert_to_db.assert_called_once_with()
        self.assertEqual(
            from_workflow.call_args.kwargs['labels'], {'project': 'alpha'})
        self.assertEqual(
            from_workflow.call_args.kwargs['failure_message'], 'spec is invalid')

    def test_failed_submission_without_labels_passes_none(self):
        submit_info = _submit_info()
        workflow_obj = mock.Mock()

        with mock.patch.object(
                workflow.Workflow, 'from_workflow', return_value=workflow_obj) as from_workflow:
            submit_info.insert_failed_submission_to_db('spec is invalid')

        self.assertIsNone(from_workflow.call_args.kwargs['labels'])


class TestConstructWorkflowDictErrors(unittest.TestCase):
    """Covers the malformed-spec paths of construct_workflow_dict."""

    def test_malformed_yaml_records_failed_submission_and_raises_usage_error(self):
        submit_info = _submit_info()
        template_spec = mock.Mock()
        template_spec.load_template_with_variables.return_value = 'workflow: [unclosed'

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(backend='backend-1')), \
                mock.patch.object(
                    objects.WorkflowSubmitInfo,
                    'insert_failed_submission_to_db') as insert_failed:
            with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
                submit_info.construct_workflow_dict(template_spec)

        self.assertIn('not properly formatted', raised.exception.message)
        insert_failed.assert_called_once()
        self.assertEqual(
            submit_info.name,
            f'failed-{submit_info.base32_id}')

    def test_malformed_yaml_still_raises_when_failed_submission_write_fails(self):
        submit_info = _submit_info()
        template_spec = mock.Mock()
        template_spec.load_template_with_variables.return_value = 'workflow: [unclosed'

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(backend='backend-1')), \
                mock.patch.object(
                    objects.WorkflowSubmitInfo, 'insert_failed_submission_to_db',
                    side_effect=RuntimeError('database is down')):
            with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
                submit_info.construct_workflow_dict(template_spec)

        self.assertIn('not properly formatted', raised.exception.message)

    def test_scalar_labels_section_raises_usage_error(self):
        submit_info = _submit_info()
        template_spec = mock.Mock()
        template_spec.load_template_with_variables.return_value = '''
version: 2
workflow:
  name: workflow
  labels: not-a-map
'''

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(backend='backend-1')):
            with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
                submit_info.construct_workflow_dict(template_spec)

        self.assertIn('map of string keys', raised.exception.message)

    def test_pool_backend_is_recorded_on_the_submit_info(self):
        submit_info = _submit_info()
        template_spec = mock.Mock()
        template_spec.load_template_with_variables.return_value = '''
version: 2
workflow:
  name: workflow
'''

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(backend='backend-9')):
            result = submit_info.construct_workflow_dict(template_spec)

        self.assertEqual(submit_info.backend, 'backend-9')
        self.assertEqual(submit_info.name, 'workflow')
        self.assertNotIn('labels', result['workflow'])


class TestConstructWorkflowSpecFromDict(unittest.TestCase):
    """Covers spec validation failures in construct_workflow_spec_from_dict."""

    def test_invalid_spec_records_failed_submission_and_raises_usage_error(self):
        submit_info = _submit_info()

        with mock.patch.object(
                objects.WorkflowSubmitInfo,
                'insert_failed_submission_to_db') as insert_failed:
            with self.assertRaises(osmo_errors.OSMOUsageError):
                submit_info.construct_workflow_spec_from_dict({'version': 2})

        insert_failed.assert_called_once()
        self.assertIsNone(insert_failed.call_args.kwargs['labels'])

    def test_invalid_spec_forwards_submitted_labels_to_failed_submission(self):
        submit_info = _submit_info()
        workflow_dict = {
            'version': 2,
            'workflow': {'labels': {'project': 'alpha'}},
        }

        with mock.patch.object(
                objects.WorkflowSubmitInfo,
                'insert_failed_submission_to_db') as insert_failed:
            with self.assertRaises(osmo_errors.OSMOUsageError):
                submit_info.construct_workflow_spec_from_dict(workflow_dict)

        self.assertEqual(
            insert_failed.call_args.kwargs['labels'], {'project': 'alpha'})

    def test_invalid_spec_still_raises_when_failed_submission_write_fails(self):
        submit_info = _submit_info()

        with mock.patch.object(
                objects.WorkflowSubmitInfo, 'insert_failed_submission_to_db',
                side_effect=RuntimeError('database is down')):
            with self.assertRaises(osmo_errors.OSMOUsageError):
                submit_info.construct_workflow_spec_from_dict({'version': 2})


class TestSendWorkflowSpecToQueue(unittest.TestCase):
    """Covers spec upload job construction."""

    def test_templated_spec_is_uploaded_alongside_the_rendered_spec(self):
        submit_info = _submit_info()
        workflow_dict = {
            'version': 2,
            'workflow': {
                'name': 'workflow-1',
                'tasks': [{
                    'name': 'task-0',
                    'files': [{'path': '/tmp/run.sh', 'contents': 'echo hello\n'}],
                }],
            },
        }
        upload_job = mock.Mock()

        with mock.patch.object(
                objects.jobs, 'UploadWorkflowFiles',
                return_value=upload_job) as upload_factory:
            submit_info.send_workflow_spec_to_queue(
                'workflow-1', workflow_dict, 'version: 2\nworkflow: {}\n')

        upload_job.send_job_to_queue.assert_called_once_with()
        files = upload_factory.call_args.kwargs['files']
        self.assertEqual(len(files), 2)
        self.assertEqual(files[1].path, objects.common.TEMPLATED_WORKFLOW_SPEC_FILE_NAME)
        self.assertIn('workflow', files[0].content)

    def test_only_rendered_spec_is_uploaded_without_a_templated_spec(self):
        submit_info = _submit_info()
        workflow_dict = {
            'version': 2,
            'workflow': {
                'name': 'workflow-1',
                'tasks': [{'name': 'task-0'}],
            },
        }
        upload_job = mock.Mock()

        with mock.patch.object(
                objects.jobs, 'UploadWorkflowFiles',
                return_value=upload_job) as upload_factory:
            submit_info.send_workflow_spec_to_queue('workflow-1', workflow_dict)

        files = upload_factory.call_args.kwargs['files']
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].path, objects.common.WORKFLOW_SPEC_FILE_NAME)


class TestValidateWorkflowSpec(unittest.TestCase):
    """Covers the non-label submission gates in validate_workflow_spec."""

    def test_maintenance_pool_rejects_non_admin_without_persisting_the_workflow(self):
        submit_info = _submit_info()
        rendered_spec = cast(workflow.WorkflowSpec, mock.Mock())
        rendered_spec.labels = {}

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(
                    status=connectors.PoolStatus.MAINTENANCE,
                    resources=types.SimpleNamespace(gpu=None))), \
                mock.patch.object(
                    objects.WorkflowSubmitInfo, 'build_workflow_object') as build_workflow:
            with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
                submit_info.validate_workflow_spec(
                    rendered_spec,
                    group_and_task_uuids={},
                    roles=[],
                    original_templated_spec=None)

        self.assertIn('undergoing maintenance', raised.exception.message)
        build_workflow.assert_not_called()

    def test_backend_without_priority_support_rejects_non_normal_priority(self):
        submit_info = _submit_info()
        rendered_spec = cast(workflow.WorkflowSpec, mock.Mock())
        rendered_spec.labels = {}
        object_factory = mock.Mock()
        object_factory.priority_supported.return_value = False

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(
                    status=connectors.PoolStatus.ONLINE,
                    resources=types.SimpleNamespace(gpu=None))), \
                mock.patch.object(connectors.Backend, 'fetch_from_db'), \
                mock.patch.object(
                    objects.kb_objects, 'get_k8s_object_factory',
                    return_value=object_factory), \
                mock.patch.object(
                    objects.WorkflowSubmitInfo, 'build_workflow_object') as build_workflow:
            with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
                submit_info.validate_workflow_spec(
                    rendered_spec,
                    group_and_task_uuids={},
                    roles=[],
                    original_templated_spec=None,
                    priority=wf_priority.WorkflowPriority.HIGH)

        self.assertIn('does not support priority', raised.exception.message)
        build_workflow.assert_not_called()

    def test_group_gpus_above_pool_guarantee_rejects_normal_priority(self):
        submit_info = _submit_info()
        rendered_spec = cast(workflow.WorkflowSpec, mock.Mock())
        rendered_spec.labels = {}
        rendered_spec.groups = cast(list, [
            types.SimpleNamespace(
                name='group-0',
                tasks=[
                    types.SimpleNamespace(resources=types.SimpleNamespace(gpu=3)),
                    types.SimpleNamespace(resources=types.SimpleNamespace(gpu=2)),
                ]),
        ])
        object_factory = mock.Mock()
        object_factory.priority_supported.return_value = True

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(
                    status=connectors.PoolStatus.ONLINE,
                    resources=types.SimpleNamespace(
                        gpu=types.SimpleNamespace(guarantee=4)))), \
                mock.patch.object(connectors.Backend, 'fetch_from_db'), \
                mock.patch.object(
                    objects.kb_objects, 'get_k8s_object_factory',
                    return_value=object_factory), \
                mock.patch.object(
                    objects.WorkflowSubmitInfo, 'build_workflow_object'), \
                mock.patch.object(
                    objects.WorkflowSubmitInfo, 'send_workflow_spec_to_queue'):
            with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
                submit_info.validate_workflow_spec(
                    rendered_spec,
                    group_and_task_uuids={},
                    roles=[],
                    original_templated_spec=None)

        self.assertIn('4 GPUs guaranteed', raised.exception.message)
        self.assertIn('requires 5 GPUs', raised.exception.message)

    def test_resources_are_grouped_by_platform_before_spec_validation(self):
        submit_info = _submit_info()
        rendered_spec = cast(workflow.WorkflowSpec, mock.Mock())
        rendered_spec.labels = {}
        rendered_spec.groups = []
        object_factory = mock.Mock()
        object_factory.priority_supported.return_value = True
        first_resource = types.SimpleNamespace(
            pool_platform_labels={'pool-1': ['dgx-a100']})
        second_resource = types.SimpleNamespace(
            pool_platform_labels={'pool-1': ['dgx-a100', 'dgx-h100']})

        with mock.patch.object(
                connectors.Pool, 'fetch_from_db',
                return_value=types.SimpleNamespace(
                    status=connectors.PoolStatus.ONLINE,
                    resources=types.SimpleNamespace(gpu=None))), \
                mock.patch.object(connectors.Backend, 'fetch_from_db'), \
                mock.patch.object(
                    objects.kb_objects, 'get_k8s_object_factory',
                    return_value=object_factory), \
                mock.patch.object(
                    objects, 'get_resources',
                    return_value=types.SimpleNamespace(
                        resources=[first_resource, second_resource])):
            warnings = submit_info.validate_workflow_spec(
                rendered_spec,
                group_and_task_uuids={},
                roles=[],
                original_templated_spec=None)

        self.assertEqual(warnings, [])
        cast(mock.Mock, rendered_spec.validate_resources).assert_called_once_with({
            'dgx-a100': [first_resource, second_resource],
            'dgx-h100': [second_resource],
        })
        cast(mock.Mock, rendered_spec.validate_credentials).assert_called_once_with('user-1')


class TestGetGroups(unittest.TestCase):
    """Covers group and task query response assembly."""

    @staticmethod
    def _group_row() -> dict:
        return {
            'name': 'group-0',
            'workflow_uuid': 'c' * 32,
            'status': 'RUNNING',
            'failure_message': None,
            'start_time': datetime.datetime(2026, 1, 2, 10, 0, 0),
            'end_time': None,
            'processing_start_time': datetime.datetime(2026, 1, 2, 9, 55, 0),
            'scheduling_start_time': datetime.datetime(2026, 1, 2, 9, 56, 0),
            'initializing_start_time': datetime.datetime(2026, 1, 2, 9, 57, 0),
            'remaining_upstream_groups': '"group-upstream"=>"NULL"',
            'downstream_groups': '"group-downstream"=>"NULL"',
        }

    @staticmethod
    def _group_task_row(status: str = 'RUNNING') -> dict:
        return {
            'workflow_id': 'workflow-1',
            'name': 'task-0',
            'retry_id': 1,
            'status': status,
            'failure_message': None,
            'exit_code': None,
            'scheduling_start_time': None,
            'initializing_start_time': None,
            'start_time': datetime.datetime(2026, 1, 2, 10, 0, 0),
            'end_time': None,
            'input_download_start_time': None,
            'input_download_end_time': None,
            'output_upload_start_time': None,
            'output_upload_end_time': None,
            'pod_name': 'pod-task-0',
            'task_uuid': 'd' * 32,
            'node_name': 'node-1',
            'pod_ip': '10.0.0.1',
            'lead': True,
        }

    def test_group_response_includes_task_links_and_dependency_sets(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = [self._group_row()]

        with _patch_context(), mock.patch.object(
                task.Task, 'list_task_rows_by_group_name',
                return_value=[self._group_task_row()]), \
                mock.patch.object(
                    connectors.Backend, 'fetch_from_db', return_value=_backend_info()):
            groups = objects.get_groups(
                database, 'workflow-1', 'https://osmo.test/logs?a=1',
                'https://osmo.test/events', 'https://osmo.test', 'backend-1')

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].name, 'group-0')
        self.assertEqual(groups[0].remaining_upstream_groups, {'group-upstream'})
        self.assertEqual(groups[0].downstream_groups, {'group-downstream'})
        self.assertEqual(len(groups[0].tasks), 1)
        self.assertEqual(
            groups[0].tasks[0].logs,
            'https://osmo.test/logs?a=1&task_name=task-0&retry_id=1')
        self.assertEqual(
            groups[0].tasks[0].dashboard_url,
            'https://dashboard.example.com/#/pod/osmo-ns/pod-task-0?namespace=osmo-ns')

    def test_running_task_has_no_error_logs_link(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = [self._group_row()]

        with _patch_context(), mock.patch.object(
                task.Task, 'list_task_rows_by_group_name',
                return_value=[self._group_task_row(status='RUNNING')]), \
                mock.patch.object(
                    connectors.Backend, 'fetch_from_db', return_value=_backend_info()):
            groups = objects.get_groups(
                database, 'workflow-1', 'https://osmo.test/logs?a=1',
                'https://osmo.test/events', 'https://osmo.test', 'backend-1')

        self.assertIsNone(groups[0].tasks[0].error_logs)

    def test_failed_task_gets_error_logs_link_with_retry_id(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = [self._group_row()]

        with _patch_context(), mock.patch.object(
                task.Task, 'list_task_rows_by_group_name',
                return_value=[self._group_task_row(status='FAILED')]), \
                mock.patch.object(
                    connectors.Backend, 'fetch_from_db', return_value=_backend_info()):
            groups = objects.get_groups(
                database, 'workflow-1', 'https://osmo.test/logs?a=1',
                'https://osmo.test/events', 'https://osmo.test', 'backend-1')

        self.assertEqual(
            groups[0].tasks[0].error_logs,
            'https://osmo.test/api/workflow/workflow-1/error_logs'
            '?task_name=task-0&retry_id=1')

    def test_workflow_without_groups_returns_empty_list(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        with _patch_context():
            groups = objects.get_groups(
                database, 'workflow-1', 'https://osmo.test/logs',
                'https://osmo.test/events', 'https://osmo.test', 'backend-1')

        self.assertEqual(groups, [])


class TestWorkflowQueryResponseAppLookup(unittest.TestCase):
    """Covers the app metadata lookup inside WorkflowQueryResponse.fetch_from_db."""

    @staticmethod
    def _fetch(app_uuid: str | None, app_side_effect=None, app_return=None):
        database = mock.Mock()
        database.get_workflow_service_url.return_value = 'https://osmo.test'
        database.get_workflow_configs.return_value = types.SimpleNamespace(
            labels_config=types.SimpleNamespace(policy=[]),
        )
        workflow_obj = types.SimpleNamespace(
            workflow_id='workflow-1',
            workflow_uuid='a' * 32,
            user='user-1',
            cancelled_by=None,
            parent_name=None,
            parent_job_id=None,
            app_uuid=app_uuid,
            app_version=7,
            submit_time=_SUBMIT_TIME,
            start_time=None,
            end_time=None,
            status=workflow.WorkflowStatus.RUNNING,
            outputs='',
            pool='pool-1',
            backend='backend-1',
            plugins=task_common.WorkflowPlugins(),
            priority='NORMAL',
            labels={},
            timeout=types.SimpleNamespace(exec_timeout=None, queue_timeout=None),
        )

        with mock.patch.object(
                workflow.Workflow, 'fetch_from_db', return_value=workflow_obj), \
                _patch_context(database=database), \
                mock.patch.object(objects, 'get_groups', return_value=[]), \
                mock.patch.object(objects, 'get_workflow_tags', return_value=[]), \
                mock.patch.object(
                    objects, 'generate_dashboard_url', return_value=None), \
                mock.patch.object(
                    objects, 'generate_grafana_url', return_value=None), \
                mock.patch.object(
                    objects.app.App, 'fetch_from_db_from_uuid',
                    side_effect=app_side_effect, return_value=app_return):
            return objects.WorkflowQueryResponse.fetch_from_db(database, 'workflow-1')

    def test_app_metadata_is_included_when_the_app_is_found(self):
        response = self._fetch(
            app_uuid='app-uuid-1',
            app_return=types.SimpleNamespace(owner='owner-1', name='app-1'))

        self.assertEqual(response.app_owner, 'owner-1')
        self.assertEqual(response.app_name, 'app-1')
        self.assertEqual(response.app_version, 7)

    def test_deleted_app_leaves_app_metadata_empty(self):
        response = self._fetch(
            app_uuid='app-uuid-1',
            app_side_effect=osmo_errors.OSMOUserError('app not found'))

        self.assertIsNone(response.app_owner)
        self.assertIsNone(response.app_name)

    def test_workflow_without_app_uuid_leaves_app_metadata_empty(self):
        response = self._fetch(app_uuid=None)

        self.assertIsNone(response.app_owner)
        self.assertIsNone(response.app_name)


if __name__ == '__main__':
    unittest.main()
