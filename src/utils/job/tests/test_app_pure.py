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

from src.lib.utils import common as lib_common, osmo_errors
from src.utils.job import app as app_module


APP_NAME = 'my-app'
APP_UUID = 'abcdef0123456789abcdef0123456789'
USER = 'alice'
DESCRIPTION = 'demo app'


def _row(**kwargs):
    """Rows returned from execute_fetch_command(..., return_raw=True) are dict-like."""
    return dict(kwargs)


def _make_database(fetch_return=None, commit_raises=None, workflow_configs=None):
    """Build a mock PostgresConnector with common helpers stubbed."""
    database = mock.Mock()
    database.execute_fetch_command = mock.Mock(return_value=fetch_return or [])
    if commit_raises is not None:
        database.execute_commit_command = mock.Mock(side_effect=commit_raises)
    else:
        database.execute_commit_command = mock.Mock()
    database.get_workflow_configs = mock.Mock(return_value=workflow_configs or mock.Mock())
    return database


class AppStatusDeletedTest(unittest.TestCase):
    """Tests for AppStatus.deleted() predicate at app.py:51-53."""

    def test_deleted_status_is_deleted(self):
        self.assertTrue(app_module.AppStatus.DELETED.deleted())

    def test_pending_delete_status_is_deleted(self):
        self.assertTrue(app_module.AppStatus.PENDING_DELETE.deleted())

    def test_pending_status_is_not_deleted(self):
        self.assertFalse(app_module.AppStatus.PENDING.deleted())

    def test_ready_status_is_not_deleted(self):
        self.assertFalse(app_module.AppStatus.READY.deleted())


class AppFetchFromDbTest(unittest.TestCase):
    """Tests for App.fetch_from_db (app.py:77-90)."""

    def _row_kwargs(self):
        return _row(uuid=APP_UUID, name=APP_NAME, description=DESCRIPTION,
                    owner=USER, created_date=datetime.datetime(2026, 1, 1))

    def test_fetch_from_db_returns_app_when_row_exists(self):
        database = _make_database(fetch_return=[self._row_kwargs()])
        result = app_module.App.fetch_from_db(database, APP_NAME)
        self.assertIsInstance(result, app_module.App)
        self.assertEqual(result.uuid, APP_UUID)
        self.assertEqual(result.name, APP_NAME)
        database.execute_fetch_command.assert_called_once()
        # Confirm the SQL is parameterised by name.
        args = database.execute_fetch_command.call_args.args
        self.assertIn('FROM apps WHERE name', args[0])
        self.assertEqual(args[1], (APP_NAME,))
        self.assertTrue(args[2])  # return_raw=True

    def test_fetch_from_db_raises_when_row_missing(self):
        database = _make_database(fetch_return=[])
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            app_module.App.fetch_from_db(database, APP_NAME)
        self.assertIn(APP_NAME, str(ctx.exception))


class AppFetchFromDbFromUuidTest(unittest.TestCase):
    """Tests for App.fetch_from_db_from_uuid (app.py:93-106)."""

    def _row_kwargs(self):
        return _row(uuid=APP_UUID, name=APP_NAME, description=DESCRIPTION,
                    owner=USER, created_date=datetime.datetime(2026, 1, 2))

    def test_fetch_from_uuid_returns_app_when_row_exists(self):
        database = _make_database(fetch_return=[self._row_kwargs()])
        result = app_module.App.fetch_from_db_from_uuid(database, APP_UUID)
        self.assertIsInstance(result, app_module.App)
        self.assertEqual(result.uuid, APP_UUID)
        args = database.execute_fetch_command.call_args.args
        self.assertIn('FROM apps WHERE uuid', args[0])
        self.assertEqual(args[1], (APP_UUID,))

    def test_fetch_from_uuid_raises_when_row_missing(self):
        database = _make_database(fetch_return=[])
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            app_module.App.fetch_from_db_from_uuid(database, APP_UUID)
        self.assertIn(APP_UUID, str(ctx.exception))


class AppDeleteFromDbTest(unittest.TestCase):
    """Tests for App.delete_from_db (app.py:109-117)."""

    def test_delete_from_db_deletes_when_app_exists(self):
        row = _row(uuid=APP_UUID, name=APP_NAME, description=DESCRIPTION,
                   owner=USER, created_date=datetime.datetime(2026, 1, 3))
        database = _make_database(fetch_return=[row])
        app_module.App.delete_from_db(database, APP_NAME)
        # fetch_from_db is called first, then execute_commit_command with DELETE.
        database.execute_fetch_command.assert_called_once()
        database.execute_commit_command.assert_called_once()
        args = database.execute_commit_command.call_args.args
        self.assertIn('DELETE FROM apps', args[0])
        self.assertEqual(args[1], (APP_NAME,))

    def test_delete_from_db_raises_when_app_missing(self):
        database = _make_database(fetch_return=[])
        with self.assertRaises(osmo_errors.OSMOUserError):
            app_module.App.delete_from_db(database, APP_NAME)
        database.execute_commit_command.assert_not_called()


class AppInsertIntoDbTest(unittest.TestCase):
    """Tests for App.insert_into_db (app.py:120-149)."""

    def test_insert_returns_app_with_supplied_fields(self):
        database = _make_database()
        fixed_time = datetime.datetime(2026, 5, 20, 12, 0, 0)
        with mock.patch.object(lib_common, 'current_time', return_value=fixed_time), \
             mock.patch.object(lib_common, 'generate_unique_id', return_value=APP_UUID), \
             mock.patch.object(app_module.job_common, 'get_workflow_app_path',
                               return_value='s3://bucket/app_path'), \
             mock.patch.object(app_module.job_common, 'get_app_path',
                               return_value=mock.Mock()):
            result = app_module.App.insert_into_db(
                database, APP_NAME, USER, DESCRIPTION)
        self.assertEqual(result.uuid, APP_UUID)
        self.assertEqual(result.name, APP_NAME)
        self.assertEqual(result.description, DESCRIPTION)
        self.assertEqual(result.owner, USER)
        self.assertEqual(result.created_date, fixed_time)
        # execute_commit_command called with the multi-statement transaction.
        database.execute_commit_command.assert_called_once()
        cmd, args = database.execute_commit_command.call_args.args
        self.assertIn('INSERT INTO apps', cmd)
        self.assertIn('INSERT INTO app_versions', cmd)
        # First INSERT: (uuid, name, owner, created_date, description).
        self.assertEqual(args[0], APP_UUID)
        self.assertEqual(args[1], APP_NAME)
        self.assertEqual(args[2], USER)
        self.assertEqual(args[3], fixed_time)
        self.assertEqual(args[4], DESCRIPTION)
        # Second INSERT: (uuid, version=1, created_by, created_date, uri, status=PENDING).
        self.assertEqual(args[5], APP_UUID)
        self.assertEqual(args[6], 1)
        self.assertEqual(args[7], USER)
        self.assertEqual(args[8], fixed_time)
        self.assertEqual(args[9], 's3://bucket/app_path')
        self.assertEqual(args[10], app_module.AppStatus.PENDING.value)

    def test_insert_translates_database_error_to_user_error(self):
        database = _make_database(
            commit_raises=osmo_errors.OSMODatabaseError('duplicate key'))
        with mock.patch.object(lib_common, 'current_time',
                               return_value=datetime.datetime(2026, 1, 1)), \
             mock.patch.object(lib_common, 'generate_unique_id',
                               return_value=APP_UUID), \
             mock.patch.object(app_module.job_common, 'get_workflow_app_path',
                               return_value='s3://bucket/app_path'), \
             mock.patch.object(app_module.job_common, 'get_app_path',
                               return_value=mock.Mock()):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                app_module.App.insert_into_db(database, APP_NAME, USER, DESCRIPTION)
        self.assertIn(APP_NAME, str(ctx.exception))
        self.assertIn('already exists', str(ctx.exception))


class AppRenameTest(unittest.TestCase):
    """Tests for App.rename (app.py:151-159)."""

    def _make_app(self):
        return app_module.App(
            uuid=APP_UUID, name=APP_NAME, description=DESCRIPTION,
            owner=USER, created_date=datetime.datetime(2026, 1, 4))

    def test_rename_issues_update_and_mutates_name(self):
        app = self._make_app()
        database = _make_database()
        app.rename(database, 'new-name')
        self.assertEqual(app.name, 'new-name')
        database.execute_commit_command.assert_called_once()
        cmd, args = database.execute_commit_command.call_args.args
        self.assertIn('UPDATE apps', cmd)
        self.assertEqual(args, ('new-name', APP_UUID))


class AppVersionListFromDbTest(unittest.TestCase):
    """Tests for AppVersion.list_from_db (app.py:181-193)."""

    def _row(self, version=1, status='READY'):
        return _row(uuid=APP_UUID, version=version, created_by=USER,
                    created_date=datetime.datetime(2026, 2, version),
                    uri=f's3://bucket/v{version}', status=status)

    def test_list_returns_versions_in_order(self):
        database = _make_database(fetch_return=[self._row(2), self._row(1)])
        result = app_module.AppVersion.list_from_db(database, APP_NAME)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].version, 2)
        self.assertEqual(result[1].version, 1)
        args = database.execute_fetch_command.call_args.args
        self.assertIn('FROM app_versions', args[0])
        self.assertEqual(args[1], (APP_NAME,))

    def test_list_returns_empty_when_no_versions(self):
        database = _make_database(fetch_return=[])
        result = app_module.AppVersion.list_from_db(database, APP_NAME)
        self.assertEqual(result, [])


class AppVersionFetchFromDbTest(unittest.TestCase):
    """Tests for AppVersion.fetch_from_db (app.py:196-219)."""

    def _row(self, version=1, status='READY'):
        return _row(uuid=APP_UUID, version=version, created_by=USER,
                    created_date=datetime.datetime(2026, 3, version),
                    uri=f's3://bucket/v{version}', status=status)

    def test_fetch_with_explicit_version_filters_by_version(self):
        database = _make_database(fetch_return=[self._row(version=3)])
        info = lib_common.AppStructure.from_parts(APP_NAME, version=3)
        result = app_module.AppVersion.fetch_from_db(database, info)
        self.assertEqual(result.version, 3)
        cmd, args, _ = database.execute_fetch_command.call_args.args
        self.assertIn('AND version = %s', cmd)
        self.assertEqual(args, (APP_NAME, 3))

    def test_fetch_without_version_filters_by_ready_status(self):
        database = _make_database(fetch_return=[self._row()])
        info = lib_common.AppStructure(APP_NAME)
        app_module.AppVersion.fetch_from_db(database, info)
        cmd, args, _ = database.execute_fetch_command.call_args.args
        self.assertIn('AND status = %s', cmd)
        # Status parameter should be READY.
        self.assertEqual(args, (APP_NAME, app_module.AppStatus.READY.value))

    def test_fetch_raises_when_row_missing(self):
        database = _make_database(fetch_return=[])
        info = lib_common.AppStructure(APP_NAME)
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            app_module.AppVersion.fetch_from_db(database, info)
        self.assertIn(APP_NAME, str(ctx.exception))


class AppVersionFetchFromDbWithUuidTest(unittest.TestCase):
    """Tests for AppVersion.fetch_from_db_with_uuid (app.py:222-236)."""

    def _row(self):
        return _row(uuid=APP_UUID, version=2, created_by=USER,
                    created_date=datetime.datetime(2026, 4, 1),
                    uri='s3://bucket/v2', status='READY')

    def test_fetch_returns_matching_version(self):
        database = _make_database(fetch_return=[self._row()])
        result = app_module.AppVersion.fetch_from_db_with_uuid(
            database, APP_UUID, 2)
        self.assertEqual(result.uuid, APP_UUID)
        self.assertEqual(result.version, 2)
        args = database.execute_fetch_command.call_args.args
        self.assertEqual(args[1], (APP_UUID, 2))

    def test_fetch_raises_when_row_missing(self):
        database = _make_database(fetch_return=[])
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            app_module.AppVersion.fetch_from_db_with_uuid(database, APP_UUID, 9)
        self.assertIn(APP_UUID, str(ctx.exception))
        self.assertIn('9', str(ctx.exception))


class AppVersionInsertIntoDbTest(unittest.TestCase):
    """Tests for AppVersion.insert_into_db (app.py:239-284)."""

    def test_insert_returns_appversion_with_next_version(self):
        # execute_fetch_command returns the RETURNING row from the CTE INSERT.
        database = _make_database(
            fetch_return=[{'uuid': APP_UUID, 'version': 4}])
        fixed_time = datetime.datetime(2026, 6, 1, 10, 0, 0)
        with mock.patch.object(lib_common, 'current_time', return_value=fixed_time), \
             mock.patch.object(app_module.job_common, 'get_workflow_app_path',
                               return_value='s3://bucket/v4'), \
             mock.patch.object(app_module.job_common, 'get_app_path',
                               return_value=mock.Mock()):
            result = app_module.AppVersion.insert_into_db(
                database, APP_NAME, USER)
        self.assertEqual(result.uuid, APP_UUID)
        self.assertEqual(result.version, 4)
        self.assertEqual(result.created_by, USER)
        self.assertEqual(result.created_date, fixed_time)
        self.assertEqual(result.uri, 's3://bucket/v4')
        self.assertEqual(result.status, app_module.AppStatus.PENDING)
        # Both the INSERT CTE (fetch) and the UPDATE (commit) run.
        database.execute_fetch_command.assert_called_once()
        database.execute_commit_command.assert_called_once()
        # Commit args carry the app_path, uuid, version tuple.
        cmd, args = database.execute_commit_command.call_args.args
        self.assertIn('UPDATE app_versions', cmd)
        self.assertEqual(args, ('s3://bucket/v4', APP_UUID, 4))

    def test_insert_translates_database_error_to_user_error(self):
        database = _make_database()
        database.execute_fetch_command = mock.Mock(
            side_effect=osmo_errors.OSMODatabaseError('missing app'))
        with mock.patch.object(lib_common, 'current_time',
                               return_value=datetime.datetime(2026, 1, 1)):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                app_module.AppVersion.insert_into_db(database, APP_NAME, USER)
        self.assertIn(APP_NAME, str(ctx.exception))
        self.assertIn('does not exist', str(ctx.exception))


class AppVersionUpdateStatusTest(unittest.TestCase):
    """Tests for AppVersion.update_status (app.py:286-291)."""

    def _make_version(self):
        return app_module.AppVersion(
            uuid=APP_UUID, version=1, created_by=USER,
            created_date=datetime.datetime(2026, 7, 1),
            uri='s3://bucket/v1', status=app_module.AppStatus.PENDING)

    def test_update_status_issues_commit_with_status_value(self):
        version = self._make_version()
        database = _make_database()
        version.update_status(database, app_module.AppStatus.READY)
        database.execute_commit_command.assert_called_once()
        cmd, args = database.execute_commit_command.call_args.args
        self.assertIn('UPDATE app_versions SET status', cmd)
        # Positional args: (status_value, uuid, version).
        self.assertEqual(args,
                         (app_module.AppStatus.READY.value, APP_UUID, 1))


class ValidateAppContentTest(unittest.TestCase):
    """Tests for validate_app_content (app.py:294-296)."""

    def test_delegates_to_parse_workflow_spec(self):
        with mock.patch.object(app_module.workflow_utils,
                               'parse_workflow_spec') as mock_parse:
            app_module.validate_app_content('workflow: {}')
        mock_parse.assert_called_once_with('workflow: {}')

    def test_propagates_user_error_from_parser(self):
        with mock.patch.object(app_module.workflow_utils,
                               'parse_workflow_spec',
                               side_effect=osmo_errors.OSMOUserError('bad spec')):
            with self.assertRaises(osmo_errors.OSMOUserError):
                app_module.validate_app_content('bad content')


if __name__ == '__main__':
    unittest.main()
