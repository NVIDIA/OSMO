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
import unittest
from unittest import mock

from src.lib.utils import osmo_errors
from src.service.core.app import app_service, objects as app_objects
from src.tests.common import runner
from src.utils import connectors
from src.utils.job import app as job_app


def _make_app(name='my_app', owner='alice@example.com', uuid='app-uuid-1'):
    """Build an App instance without hitting the database."""
    return job_app.App(
        uuid=uuid,
        name=name,
        description='desc',
        owner=owner,
        created_date=datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc),
    )


def _make_app_version(uuid='app-uuid-1', version=1,
                      status=job_app.AppStatus.READY,
                      uri='s3://bucket/app-uuid-1/1/workflow_app.txt',
                      created_by='alice@example.com'):
    """Build an AppVersion instance without hitting the database."""
    return job_app.AppVersion(
        uuid=uuid,
        version=version,
        created_by=created_by,
        created_date=datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc),
        uri=uri,
        status=status,
    )


def _make_list_entry(name='my_app', uuid='app-uuid-1',
                     owner='alice@example.com', latest_version=1):
    """Build a ListEntry so pydantic accepts it in ListResponse."""
    return app_objects.ListEntry(
        uuid=uuid,
        name=name,
        description='desc',
        created_date=datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc),
        owner=owner,
        latest_version=latest_version,
    )


def _make_version_entry(version=1, created_by='alice@example.com', status='READY'):
    """Build a GetVersionEntry so pydantic accepts it in GetAppResponse."""
    return app_objects.GetVersionEntry(
        version=version,
        created_by=created_by,
        created_date=datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc),
        status=status,
    )


class TestListApps(unittest.TestCase):
    """Covers list_apps (lines 48-62)."""

    def test_list_apps_limit_above_1000_raises_user_error(self):
        with mock.patch.object(app_service.connectors, 'PostgresConnector'):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                app_service.list_apps(
                    name=None,
                    users=None,
                    all_users=False,
                    offset=0,
                    limit=1001,
                    order=connectors.ListOrder.ASC,
                    username='alice@example.com',
                )

        self.assertIn('Limit must be less than 1000', str(ctx.exception))

    def test_list_apps_no_users_no_all_users_scopes_to_username(self):
        list_entry = _make_list_entry()
        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.helpers, 'list_apps',
                               return_value=[list_entry]) as list_apps_mock:
            postgres_cls.get_instance.return_value = mock.Mock(name='postgres')
            response = app_service.list_apps(
                name=None,
                users=None,
                all_users=False,
                offset=0,
                limit=20,
                order=connectors.ListOrder.ASC,
                username='alice@example.com',
            )

        # entered_username=True path: helpers.list_apps is called with the caller's username.
        args, _ = list_apps_mock.call_args
        # helpers.list_apps signature: (postgres, name, username, users, offset, limit, order)
        self.assertEqual(args[2], 'alice@example.com')
        self.assertEqual(response.apps, [list_entry])
        self.assertFalse(response.more_entries)

    def test_list_apps_all_users_flag_skips_username_scope(self):
        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.helpers, 'list_apps',
                               return_value=[]) as list_apps_mock:
            postgres_cls.get_instance.return_value = mock.Mock(name='postgres')
            app_service.list_apps(
                name=None,
                users=None,
                all_users=True,
                offset=0,
                limit=20,
                order=connectors.ListOrder.ASC,
                username='alice@example.com',
            )

        # entered_username=False path: helpers.list_apps is called with username=None.
        args, _ = list_apps_mock.call_args
        self.assertIsNone(args[2])

    def test_list_apps_asc_more_entries_trims_first_entry(self):
        # limit=2 means helpers.list_apps is called with limit+1=3;
        # with 3 results returned, more_entries=True and apps[1:] is returned in ASC order.
        result = [_make_list_entry(name='e0'), _make_list_entry(name='e1'),
                  _make_list_entry(name='e2')]
        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.helpers, 'list_apps',
                               return_value=result):
            postgres_cls.get_instance.return_value = mock.Mock()
            response = app_service.list_apps(
                name=None,
                users=None,
                all_users=True,
                offset=0,
                limit=2,
                order=connectors.ListOrder.ASC,
                username='alice@example.com',
            )

        self.assertTrue(response.more_entries)
        self.assertEqual(response.apps, result[1:])

    def test_list_apps_desc_trims_tail_to_limit(self):
        # DESC order with more_entries True should slice apps[:limit].
        result = [_make_list_entry(name='e0'), _make_list_entry(name='e1'),
                  _make_list_entry(name='e2')]
        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.helpers, 'list_apps',
                               return_value=result):
            postgres_cls.get_instance.return_value = mock.Mock()
            response = app_service.list_apps(
                name=None,
                users=None,
                all_users=True,
                offset=0,
                limit=2,
                order=connectors.ListOrder.DESC,
                username='alice@example.com',
            )

        self.assertTrue(response.more_entries)
        self.assertEqual(response.apps, result[:2])


class TestGetApp(unittest.TestCase):
    """Covers get_app (lines 73-85)."""

    def test_get_app_returns_app_metadata_and_versions(self):
        app_info = _make_app(name='my_app', owner='alice@example.com')
        version_entries = [_make_version_entry(version=1)]

        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app.App, 'fetch_from_db',
                               return_value=app_info) as fetch_mock, \
             mock.patch.object(app_service.helpers, 'get_app_versions',
                               return_value=version_entries) as versions_mock:
            postgres_cls.get_instance.return_value = mock.Mock(name='postgres')
            response = app_service.get_app(
                name='my_app',
                version=None,
                limit=20,
                order=connectors.ListOrder.ASC,
            )

        fetch_mock.assert_called_once()
        versions_mock.assert_called_once()
        self.assertEqual(response.uuid, app_info.uuid)
        self.assertEqual(response.name, 'my_app')
        self.assertEqual(response.owner, 'alice@example.com')
        self.assertEqual(response.versions, version_entries)


class TestGetAppContent(unittest.TestCase):
    """Covers get_app_content (lines 91-110)."""

    def test_get_app_content_raises_when_version_not_ready(self):
        pending_version = _make_app_version(status=job_app.AppStatus.PENDING)
        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app.AppVersion, 'fetch_from_db',
                               return_value=pending_version):
            postgres_cls.get_instance.return_value = mock.Mock()

            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                app_service.get_app_content(name='my_app', version=1)

        self.assertIn('not available', str(ctx.exception))

    def test_get_app_content_raises_when_workflow_app_credential_missing(self):
        ready_version = _make_app_version(status=job_app.AppStatus.READY)
        workflow_config = mock.Mock()
        workflow_config.workflow_app.credential = None
        context = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config

        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app.AppVersion, 'fetch_from_db',
                               return_value=ready_version), \
             mock.patch.object(app_service.workflow_objects.WorkflowServiceContext, 'get',
                               return_value=context):
            postgres_cls.get_instance.return_value = mock.Mock()

            with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
                app_service.get_app_content(name='my_app', version=None)

        self.assertIn('credential is not set', str(ctx.exception))

    def test_get_app_content_returns_stream_from_storage(self):
        ready_version = _make_app_version(status=job_app.AppStatus.READY)
        workflow_config = mock.Mock()
        workflow_config.workflow_app.credential = mock.Mock(name='cred')
        context = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        storage_client = mock.Mock()
        storage_client.get_object_stream.return_value = iter([b'workflow:\n  name: x\n'])

        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app.AppVersion, 'fetch_from_db',
                               return_value=ready_version), \
             mock.patch.object(app_service.workflow_objects.WorkflowServiceContext, 'get',
                               return_value=context), \
             mock.patch.object(app_service.storage.Client, 'create',
                               return_value=storage_client) as storage_create:
            postgres_cls.get_instance.return_value = mock.Mock()

            response = app_service.get_app_content(name='my_app', version=None)

        storage_create.assert_called_once()
        storage_client.get_object_stream.assert_called_once_with(ready_version.uri)
        # A StreamingResponse is returned; verify status is a 2xx (fastapi default).
        self.assertEqual(response.status_code, 200)


class TestCreateApp(unittest.TestCase):
    """Covers create_app (lines 118-128)."""

    def test_create_app_validates_inserts_and_enqueues_upload(self):
        inserted_app = _make_app(name='my_app', owner='alice@example.com', uuid='new-uuid')
        upload_instance = mock.Mock()

        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app, 'validate_app_content') as validate_mock, \
             mock.patch.object(app_service.app.App, 'insert_into_db',
                               return_value=inserted_app) as insert_mock, \
             mock.patch.object(app_service.jobs, 'UploadApp',
                               return_value=upload_instance) as upload_cls:
            postgres_cls.get_instance.return_value = mock.Mock(name='postgres')

            app_service.create_app(
                name='my_app',
                description='a description',
                app_content='workflow: {name: my_app}',
                username='alice@example.com',
            )

        validate_mock.assert_called_once_with('workflow: {name: my_app}')
        insert_mock.assert_called_once()
        upload_cls.assert_called_once_with(
            app_uuid='new-uuid',
            app_name='my_app',
            app_version=1,
            app_content='workflow: {name: my_app}',
            user='alice@example.com',
        )
        upload_instance.send_job_to_queue.assert_called_once()


class TestUpdateApp(unittest.TestCase):
    """Covers update_app (lines 139-155)."""

    def test_update_app_bumps_version_and_returns_edit_response(self):
        version_info = _make_app_version(
            uuid='app-uuid-1', version=2, status=job_app.AppStatus.PENDING)
        upload_instance = mock.Mock()

        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app, 'validate_app_content') as validate_mock, \
             mock.patch.object(app_service.app.AppVersion, 'insert_into_db',
                               return_value=version_info) as insert_mock, \
             mock.patch.object(app_service.jobs, 'UploadApp',
                               return_value=upload_instance) as upload_cls:
            postgres_cls.get_instance.return_value = mock.Mock()

            response = app_service.update_app(
                name='my_app',
                app_content='workflow: {name: my_app}',
                username='alice@example.com',
            )

        validate_mock.assert_called_once_with('workflow: {name: my_app}')
        insert_mock.assert_called_once()
        upload_cls.assert_called_once_with(
            app_uuid='app-uuid-1',
            app_version=2,
            app_content='workflow: {name: my_app}',
        )
        upload_instance.send_job_to_queue.assert_called_once()
        self.assertEqual(response.uuid, 'app-uuid-1')
        self.assertEqual(response.version, 2)
        self.assertEqual(response.name, 'my_app')
        self.assertEqual(response.created_by, 'alice@example.com')


class TestDeleteApp(unittest.TestCase):
    """Covers delete_app (lines 164-198)."""

    def test_delete_app_version_and_all_versions_specified_raises(self):
        with mock.patch.object(app_service.connectors, 'PostgresConnector'):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                app_service.delete_app(
                    name='my_app',
                    version=1,
                    all_versions=True,
                    username='alice@example.com',
                )

        self.assertIn('Cannot specify both', str(ctx.exception))

    def test_delete_app_no_version_no_all_versions_raises(self):
        with mock.patch.object(app_service.connectors, 'PostgresConnector'):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                app_service.delete_app(
                    name='my_app',
                    version=None,
                    all_versions=False,
                    username='alice@example.com',
                )

        self.assertIn('Must specify a version', str(ctx.exception))

    def test_delete_app_wrong_owner_raises(self):
        app_info = _make_app(owner='bob@example.com')
        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app.App, 'fetch_from_db', return_value=app_info):
            postgres_cls.get_instance.return_value = mock.Mock()

            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                app_service.delete_app(
                    name='my_app',
                    version=1,
                    all_versions=False,
                    username='alice@example.com',
                )

        self.assertIn('someone else', str(ctx.exception))

    def test_delete_app_specific_version_marks_pending_delete_and_enqueues(self):
        app_info = _make_app(owner='alice@example.com', uuid='app-uuid-1')
        version_info = _make_app_version(status=job_app.AppStatus.READY)
        delete_instance = mock.Mock()

        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app.App, 'fetch_from_db', return_value=app_info), \
             mock.patch.object(app_service.app.AppVersion, 'fetch_from_db',
                               return_value=version_info), \
             mock.patch.object(job_app.AppVersion, 'update_status') as update_status_mock, \
             mock.patch.object(app_service.jobs, 'DeleteApp',
                               return_value=delete_instance) as delete_cls:
            postgres_cls.get_instance.return_value = mock.Mock()

            result = app_service.delete_app(
                name='my_app',
                version=1,
                all_versions=False,
                username='alice@example.com',
            )

        update_status_mock.assert_called_once()
        # status arg is the second positional after `self`; call_args indexes only real args.
        _, called_kwargs = update_status_mock.call_args
        called_args = update_status_mock.call_args.args
        self.assertIn(job_app.AppStatus.PENDING_DELETE,
                      list(called_args) + list(called_kwargs.values()))
        delete_cls.assert_called_once_with(app_uuid='app-uuid-1', app_versions=[1])
        delete_instance.send_job_to_queue.assert_called_once()
        self.assertEqual(result, {'versions': [1]})

    def test_delete_app_specific_version_skips_already_deleted(self):
        app_info = _make_app(owner='alice@example.com', uuid='app-uuid-1')
        deleted_version = _make_app_version(status=job_app.AppStatus.DELETED)
        delete_instance = mock.Mock()

        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app.App, 'fetch_from_db', return_value=app_info), \
             mock.patch.object(app_service.app.AppVersion, 'fetch_from_db',
                               return_value=deleted_version), \
             mock.patch.object(job_app.AppVersion, 'update_status') as update_status_mock, \
             mock.patch.object(app_service.jobs, 'DeleteApp',
                               return_value=delete_instance) as delete_cls:
            postgres_cls.get_instance.return_value = mock.Mock()

            result = app_service.delete_app(
                name='my_app',
                version=1,
                all_versions=False,
                username='alice@example.com',
            )

        update_status_mock.assert_not_called()
        delete_cls.assert_called_once_with(app_uuid='app-uuid-1', app_versions=[])
        self.assertEqual(result, {'versions': []})

    def test_delete_app_all_versions_marks_active_ones_pending_delete(self):
        app_info = _make_app(owner='alice@example.com', uuid='app-uuid-1')
        version_ready = _make_app_version(version=1, status=job_app.AppStatus.READY)
        version_pending = _make_app_version(version=2, status=job_app.AppStatus.PENDING)
        version_already_deleted = _make_app_version(version=3, status=job_app.AppStatus.DELETED)
        delete_instance = mock.Mock()

        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app.App, 'fetch_from_db', return_value=app_info), \
             mock.patch.object(app_service.app.AppVersion, 'list_from_db',
                               return_value=[version_ready, version_pending,
                                             version_already_deleted]), \
             mock.patch.object(job_app.AppVersion, 'update_status') as update_status_mock, \
             mock.patch.object(app_service.jobs, 'DeleteApp',
                               return_value=delete_instance) as delete_cls:
            postgres_cls.get_instance.return_value = mock.Mock()

            result = app_service.delete_app(
                name='my_app',
                version=None,
                all_versions=True,
                username='alice@example.com',
            )

        # Versions 1 and 2 should be marked PENDING_DELETE; version 3 skipped.
        self.assertEqual(update_status_mock.call_count, 2)
        delete_cls.assert_called_once_with(app_uuid='app-uuid-1', app_versions=[1, 2])
        delete_instance.send_job_to_queue.assert_called_once()
        self.assertEqual(result, {'versions': [1, 2]})


class TestRenameApp(unittest.TestCase):
    """Covers rename_app (lines 206-225)."""

    def test_rename_app_wrong_owner_raises(self):
        app_info = _make_app(owner='bob@example.com')
        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app.App, 'fetch_from_db', return_value=app_info):
            postgres_cls.get_instance.return_value = mock.Mock()

            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                app_service.rename_app(
                    name='my_app',
                    new_name='new_app',
                    username='alice@example.com',
                )

        self.assertIn('someone else', str(ctx.exception))

    def test_rename_app_success_when_new_name_free(self):
        app_info = _make_app(owner='alice@example.com', name='my_app')
        rename_mock = mock.Mock()

        def fetch_side_effect(postgres, name):  # pylint: disable=unused-argument
            if name == 'my_app':
                return app_info
            raise osmo_errors.OSMOUserError(f'App {name} does not exist.')

        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app.App, 'fetch_from_db',
                               side_effect=fetch_side_effect), \
             mock.patch.object(job_app.App, 'rename', rename_mock):
            postgres_cls.get_instance.return_value = mock.Mock()

            result = app_service.rename_app(
                name='my_app',
                new_name='new_app',
                username='alice@example.com',
            )

        rename_mock.assert_called_once()
        self.assertEqual(result, 'new_app')

    def test_rename_app_new_name_already_exists_raises(self):
        app_info = _make_app(owner='alice@example.com', name='my_app')
        existing = _make_app(owner='alice@example.com', name='new_app', uuid='other-uuid')

        def fetch_side_effect(postgres, name):  # pylint: disable=unused-argument
            if name == 'my_app':
                return app_info
            if name == 'new_app':
                return existing
            raise osmo_errors.OSMOUserError(f'App {name} does not exist.')

        with mock.patch.object(app_service.connectors, 'PostgresConnector') as postgres_cls, \
             mock.patch.object(app_service.app.App, 'fetch_from_db',
                               side_effect=fetch_side_effect), \
             mock.patch.object(job_app.App, 'rename') as rename_mock:
            postgres_cls.get_instance.return_value = mock.Mock()

            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                app_service.rename_app(
                    name='my_app',
                    new_name='new_app',
                    username='alice@example.com',
                )

        self.assertIn('already exists', str(ctx.exception))
        rename_mock.assert_not_called()


if __name__ == '__main__':
    runner.run_test()
