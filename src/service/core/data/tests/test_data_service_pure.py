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
import io
import types
import unittest
from unittest import mock

from src.lib.utils import osmo_errors
from src.service.core.data import data_service, objects
from src.utils import connectors


def _row(**kwargs) -> types.SimpleNamespace:
    """Build a fake postgres row matching execute_fetch_command's namespace shape."""
    return types.SimpleNamespace(**kwargs)


def _make_dataset_row(**overrides):
    """A typical 'dataset' table row, ready for SimpleNamespace mocking."""
    base = {
        'id': 'dataset-id-1',
        'name': 'mydataset',
        'bucket': 'mybucket',
        'is_collection': False,
        'hash_location': 's3://mybucket/datasets/dataset-id-1/hashes',
        'hash_location_size': 0,
        'created_by': 'alice',
        'created_date': datetime.datetime(2026, 1, 1, 12, 0, 0),
        'labels': {},
        'last_version': 0,
    }
    base.update(overrides)
    return _row(**base)


def _make_version_row(**overrides):
    """A typical 'dataset_version' row."""
    base = {
        'dataset_id': 'dataset-id-1',
        'version_id': '1',
        'location': 's3://mybucket/datasets/dataset-id-1/manifests/1.json',
        'status': objects.DatasetStatus.READY.name,
        'checksum': 'sha-checksum',
        'size': 100,
        'created_by': 'alice',
        'created_date': datetime.datetime(2026, 1, 1, 12, 0, 0),
        'last_used': datetime.datetime(2026, 1, 1, 12, 0, 0),
        'metadata': {},
        'name': 'mydataset',
    }
    base.update(overrides)
    return _row(**base)


def _bucket_config():
    """A simple BucketConfig usable by data_service code paths."""
    return connectors.BucketConfig(
        dataset_path='s3://mybucket/datasets',
        region='us-east-1',
        description='test',
        mode='read-write',
        default_credential=None,
    )


def _dataset_configs(default_bucket: str = 'mybucket'):
    """A DatasetConfig with a single bucket."""
    return connectors.DatasetConfig(
        buckets={'mybucket': _bucket_config()},
        default_bucket=default_bucket,
    )


class CreateUuidTest(unittest.TestCase):
    """Tests for create_uuid (lines 42-44)."""

    def test_create_uuid_returns_url_safe_string(self):
        result = data_service.create_uuid()
        self.assertIsInstance(result, str)
        # urlsafe_b64encode of 16 bytes is 24 chars; we strip the 2 trailing '=' -> 22.
        self.assertEqual(22, len(result))

    def test_create_uuid_does_not_contain_padding(self):
        result = data_service.create_uuid()
        self.assertNotIn('=', result)

    def test_create_uuid_distinct_calls_yield_distinct_values(self):
        # Sanity: two calls should not collide (uuid4 bytes used).
        first = data_service.create_uuid()
        second = data_service.create_uuid()
        self.assertNotEqual(first, second)


class GetDatasetTest(unittest.TestCase):
    """Tests for get_dataset (lines 51, 55, 57-58, 60)."""

    def test_returns_first_row_when_dataset_exists(self):
        postgres = mock.Mock()
        ds_row = _make_dataset_row(name='ds1', bucket='b1')
        postgres.execute_fetch_command.return_value = [ds_row]

        result = data_service.get_dataset(postgres, 'b1', 'ds1')

        self.assertIs(ds_row, result)
        # Verifies the helper passed name/bucket parameters in the documented order.
        args = postgres.execute_fetch_command.call_args.args
        self.assertEqual(('ds1', 'b1'), args[1])

    def test_raises_user_error_when_dataset_missing(self):
        postgres = mock.Mock()
        postgres.execute_fetch_command.return_value = []

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.get_dataset(postgres, 'b1', 'missing')

        self.assertIn('missing', str(ctx.exception))
        self.assertIn('b1', str(ctx.exception))


class GetDatasetVersionTest(unittest.TestCase):
    """Tests for get_dataset_version (lines 68, 74, 76-77, 83, 85, 87-91, 93)."""

    def test_returns_first_row_without_tag(self):
        postgres = mock.Mock()
        version_row = _make_version_row()
        postgres.execute_fetch_command.return_value = [version_row]

        result = data_service.get_dataset_version(postgres, 'b1', 'ds1', '')

        self.assertIs(version_row, result)
        # No tag => only [name, bucket] passed.
        passed_args = postgres.execute_fetch_command.call_args.args[1]
        self.assertEqual(('ds1', 'b1'), passed_args)

    def test_with_tag_passes_extended_args(self):
        postgres = mock.Mock()
        version_row = _make_version_row()
        postgres.execute_fetch_command.return_value = [version_row]

        data_service.get_dataset_version(postgres, 'b1', 'ds1', 'mytag')

        passed_args = postgres.execute_fetch_command.call_args.args[1]
        # name, bucket, tag, tag, name, bucket
        self.assertEqual(('ds1', 'b1', 'mytag', 'mytag', 'ds1', 'b1'), passed_args)

    def test_raises_user_error_without_tag_when_missing(self):
        postgres = mock.Mock()
        postgres.execute_fetch_command.return_value = []

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.get_dataset_version(postgres, 'b1', 'ds1', '')

        # Falls back to "latest" in the message body (line 90 path).
        self.assertIn('latest', str(ctx.exception))

    def test_raises_user_error_with_tag_when_missing(self):
        postgres = mock.Mock()
        postgres.execute_fetch_command.return_value = []

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.get_dataset_version(postgres, 'b1', 'ds1', 'v42')

        self.assertIn('v42', str(ctx.exception))


class IsCollectionTest(unittest.TestCase):
    """Tests for is_collection (line 97)."""

    def test_returns_true_for_collection_row(self):
        postgres = mock.Mock()
        postgres.execute_fetch_command.return_value = [
            _make_dataset_row(is_collection=True)
        ]

        self.assertTrue(data_service.is_collection(postgres, 'b1', 'mycoll'))

    def test_returns_false_for_dataset_row(self):
        postgres = mock.Mock()
        postgres.execute_fetch_command.return_value = [
            _make_dataset_row(is_collection=False)
        ]

        self.assertFalse(data_service.is_collection(postgres, 'b1', 'ds1'))


class GetCollectionDatasetsTest(unittest.TestCase):
    """Tests for get_collection_datasets (line 104, 116)."""

    def test_returns_postgres_rows(self):
        postgres = mock.Mock()
        rows = [_row(dataset_id='d1', version_id='1', location='s3://x/a',
                     hash_location='s3://x/h', size=42, name='d1')]
        postgres.execute_fetch_command.return_value = rows

        result = data_service.get_collection_datasets(postgres, 'b1', 'coll')

        self.assertEqual(rows, result)


class GetCollectionInfoTest(unittest.TestCase):
    """Tests for get_collection_info (lines 123-127, 129-131, 142)."""

    def test_returns_collection_entries_for_each_row(self):
        postgres = mock.Mock()
        # First fetch (collection_datasets), then unused.
        postgres.execute_fetch_command.return_value = [
            _row(dataset_id='d1', version_id='1',
                 location='s3://mybucket/datasets/d1/manifests/1.json',
                 hash_location='s3://mybucket/datasets/d1/hashes',
                 size=42, name='d1'),
        ]
        postgres.get_dataset_configs.return_value = _dataset_configs()

        rows = data_service.get_collection_info(postgres, 'mybucket', 'coll')

        self.assertEqual(1, len(rows))
        self.assertEqual('d1', rows[0].name)
        self.assertEqual('1', rows[0].version)
        self.assertEqual(42, rows[0].size)


class UploadStartResumeTest(unittest.TestCase):
    """Tests for upload_start resume branch (lines 235-272)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.get_dataset_configs.return_value = _dataset_configs()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_resume_without_version_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.upload_start(
                bucket='mybucket', name='ds1', tag='', description='',
                metadata={}, resume=True, user_header='alice')
        self.assertIn('Version is required', str(ctx.exception))

    def test_resume_non_numeric_tag_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.upload_start(
                bucket='mybucket', name='ds1', tag='not-a-number',
                description='', metadata={}, resume=True,
                user_header='alice')
        self.assertIn('must be a number', str(ctx.exception))

    def test_resume_dataset_missing_raises(self):
        self.postgres.execute_fetch_command.return_value = []
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.upload_start(
                bucket='mybucket', name='ds1', tag='1', description='',
                metadata={}, resume=True, user_header='alice')
        self.assertIn('does not exist to resume', str(ctx.exception))

    def test_resume_collection_dataset_raises(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(is_collection=True),
        ]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.upload_start(
                bucket='mybucket', name='ds1', tag='1', description='',
                metadata={}, resume=True, user_header='alice')
        self.assertIn('is a Collection', str(ctx.exception))

    def test_resume_no_pending_version_raises(self):
        # First call: dataset row (id, is_collection=False); second: empty version rows.
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=False, id='dataset-id-1',
                               hash_location='s3://mybucket/datasets/dataset-id-1/hashes')],
            [],
        ]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.upload_start(
                bucket='mybucket', name='ds1', tag='1', description='',
                metadata={}, resume=True, user_header='alice')
        self.assertIn('PENDING versions', str(ctx.exception))

    def test_resume_returns_response_when_pending_version_exists(self):
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=False, id='dataset-id-1',
                               hash_location='s3://mybucket/datasets/dataset-id-1/hashes')],
            [_make_version_row(version_id='5',
                               location='s3://mybucket/datasets/dataset-id-1/manifests/5.json')],
        ]
        response = data_service.upload_start(
            bucket='mybucket', name='ds1', tag='5', description='',
            metadata={}, resume=True, user_header='alice')
        self.assertEqual('5', response.version_id)
        self.assertEqual(
            's3://mybucket/datasets/dataset-id-1/manifests/5.json',
            response.manifest_path,
        )
        self.assertEqual(
            's3://mybucket/datasets/dataset-id-1/hashes',
            response.storage_path,
        )


class UploadStartCreateTest(unittest.TestCase):
    """Tests for upload_start create-new branch (lines 274-345)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.get_dataset_configs.return_value = _dataset_configs()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_numeric_tag_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.upload_start(
                bucket='mybucket', name='ds1', tag='42', description='',
                metadata={}, resume=False, user_header='alice')
        self.assertIn('Tags cannot be a number', str(ctx.exception))

    def test_existing_collection_name_raises(self):
        # First fetch: returns row marked as collection (CONFLICT path).
        self.postgres.execute_fetch_command.return_value = [
            _row(id='coll-id', is_collection=True,
                 hash_location='s3://mybucket/datasets/coll-id/hashes'),
        ]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.upload_start(
                bucket='mybucket', name='cn', tag='', description='',
                metadata={}, resume=False, user_header='alice')
        self.assertIn('already a Collection', str(ctx.exception))

    def test_creates_new_dataset_returns_response(self):
        # First call: insert-or-fetch dataset row (not a collection).
        # Second call: insert dataset_version row.
        self.postgres.execute_fetch_command.side_effect = [
            [_row(id='did', is_collection=False,
                  hash_location='s3://mybucket/datasets/did/hashes')],
            [_row(version_id='1',
                  location='s3://mybucket/datasets/did/manifests/1.json')],
        ]
        response = data_service.upload_start(
            bucket='mybucket', name='ds1', tag='', description='desc',
            metadata={}, resume=False, user_header='alice')
        self.assertEqual('1', response.version_id)
        self.assertEqual('s3://mybucket/datasets/did/hashes',
                         response.storage_path)
        self.assertEqual(
            's3://mybucket/datasets/did/manifests/1.json',
            response.manifest_path,
        )

    def test_create_retries_on_db_error_and_eventually_raises(self):
        # First fetch: dataset row OK.
        # Subsequent (insert) fetch calls all raise OSMODatabaseError, retry up to 5 times.
        dataset_row = _row(id='did', is_collection=False,
                           hash_location='s3://mybucket/datasets/did/hashes')
        self.postgres.execute_fetch_command.side_effect = (
            [[dataset_row]] +
            [osmo_errors.OSMODatabaseError('boom')] * 6
        )
        with self.assertRaises(osmo_errors.OSMODatabaseError) as ctx:
            data_service.upload_start(
                bucket='mybucket', name='ds1', tag='', description='',
                metadata={}, resume=False, user_header='alice')
        self.assertIn('Create Dataset Version Failure', str(ctx.exception))


class UploadFinishTest(unittest.TestCase):
    """Tests for upload_finish (lines 358-399)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.get_dataset_configs.return_value = _dataset_configs()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_missing_version_raises_database_error(self):
        # First call: get_dataset returns row.  Second call: version rows empty.
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row()],
            [],
        ]
        with self.assertRaises(osmo_errors.OSMODatabaseError) as ctx:
            data_service.upload_finish(
                bucket='mybucket', name='ds1', tag='', version_id='99',
                checksum='cs', size=10, labels={}, update_dataset_size=10)
        self.assertIn('does not exist', str(ctx.exception))

    def test_finish_with_named_tag_inserts_two_rows(self):
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row()],
            [_make_version_row(dataset_id='did', version_id='1')],
            # update_labels' UPDATE/RETURNING call:
            [_row(labels={})],
        ]
        data_service.upload_finish(
            bucket='mybucket', name='ds1', tag='my-tag', version_id='1',
            checksum='cs', size=10, labels={}, update_dataset_size=10)
        # Find the insert call into dataset_tag.
        # First execute_commit_command: BEGIN/UPDATE block.
        # Second execute_commit_command: insert into dataset_tag with two rows.
        commit_calls = self.postgres.execute_commit_command.call_args_list
        self.assertGreaterEqual(len(commit_calls), 2)
        # The second commit's args include 'my-tag' (the explicit tag insert).
        second_args = commit_calls[1].args[1]
        self.assertIn('my-tag', second_args)


class BuildCollectionTest(unittest.TestCase):
    """Tests for build_collection (lines 407-462)."""

    def test_returns_inital_when_no_changes(self):
        postgres = mock.Mock()
        result = data_service.build_collection(
            postgres, 'mybucket', inital_datasets={'d1': '2'})
        self.assertEqual({'d1': '2'}, result)

    def test_remove_collection_pops_only_matching_versions(self):
        postgres = mock.Mock()
        # is_collection lookup => True; collection rows include d1@2 and d2@1.
        postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=True)],  # is_collection inner get_dataset
            [
                _row(dataset_id='d1', version_id='2', location='s3://x/d1',
                     hash_location='s3://x/h1', size=1, name='d1'),
                _row(dataset_id='d2', version_id='1', location='s3://x/d2',
                     hash_location='s3://x/h2', size=2, name='d2'),
            ],
        ]
        result = data_service.build_collection(
            postgres, 'mybucket',
            inital_datasets={'d1': '2', 'd2': '1', 'd3': '7'},
            remove_datasets=[objects.DatasetStructure(name='coll', tag='')],
        )
        # d1 and d2 popped, d3 untouched.
        self.assertEqual({'d3': '7'}, result)

    def test_remove_collection_version_mismatch_raises(self):
        postgres = mock.Mock()
        postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=True)],
            [_row(dataset_id='d1', version_id='2',
                  location='s3://x/d1', hash_location='s3://x/h1',
                  size=1, name='d1')],
        ]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.build_collection(
                postgres, 'mybucket',
                inital_datasets={'d1': '5'},
                remove_datasets=[
                    objects.DatasetStructure(name='coll', tag=''),
                ],
            )
        self.assertIn('Cannot Delete', str(ctx.exception))

    def test_remove_dataset_with_mismatch_tag_raises(self):
        postgres = mock.Mock()
        # is_collection -> False, then get_dataset_version returns d1 at v=2.
        postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=False)],
            [_make_version_row(dataset_id='d1', version_id='2', name='d1')],
        ]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.build_collection(
                postgres, 'mybucket',
                inital_datasets={'d1': '5'},
                remove_datasets=[
                    objects.DatasetStructure(name='d1', tag='v2'),
                ],
            )
        self.assertIn('Cannot Delete', str(ctx.exception))

    def test_add_collection_with_version_mismatch_raises(self):
        postgres = mock.Mock()
        # is_collection -> True, then collection rows return d1@v1.
        postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=True)],
            [_row(dataset_id='d1', version_id='1', location='s3://x/a',
                  hash_location='s3://x/h', size=1, name='d1')],
        ]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.build_collection(
                postgres, 'mybucket',
                inital_datasets={'d1': '2'},
                add_datasets=[
                    objects.DatasetStructure(name='coll', tag=''),
                ],
            )
        self.assertIn('appears more than once', str(ctx.exception))

    def test_add_dataset_with_version_mismatch_raises(self):
        postgres = mock.Mock()
        postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=False)],
            [_make_version_row(dataset_id='d1', version_id='1', name='d1')],
        ]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.build_collection(
                postgres, 'mybucket',
                inital_datasets={'d1': '2'},
                add_datasets=[
                    objects.DatasetStructure(name='d1', tag='v1'),
                ],
            )
        self.assertIn('appears more than once', str(ctx.exception))

    def test_add_dataset_uses_latest_when_no_tag(self):
        postgres = mock.Mock()
        postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=False)],
            [_make_version_row(dataset_id='d1', version_id='3', name='d1')],
        ]
        result = data_service.build_collection(
            postgres, 'mybucket',
            add_datasets=[objects.DatasetStructure(name='d1', tag='')],
        )
        # d1 mapped to version 3.
        self.assertEqual({'d1': '3'}, result)


class CleanDatasetTest(unittest.TestCase):
    """Tests for clean_dataset (lines 651, 660)."""

    def test_executes_commit_with_pending_delete_status(self):
        postgres = mock.Mock()
        info = _row(id='did1')
        data_service.clean_dataset(postgres, info)
        args = postgres.execute_commit_command.call_args.args
        self.assertIn('did1', args[1])
        self.assertIn(objects.DatasetStatus.PENDING_DELETE.name, args[1])


class GetFileContentSecurityTest(unittest.TestCase):
    """Tests for get_file_content path validation (lines 1054-1080)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.get_dataset_configs.return_value = _dataset_configs()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_rejects_path_outside_dataset_hash_prefix(self):
        # Dataset's hash prefix differs from the requested path's prefix
        # even though the bucket (container) matches.
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(
                hash_location='s3://mybucket/datasets/dataset-id-1/hashes')
        ]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.get_file_content(
                bucket='mybucket', name='ds1',
                storage_path='s3://mybucket/datasets/other-dataset/hashes/abc',
                filename=None,
            )
        self.assertIn('does not belong', str(ctx.exception))

    def test_rejects_path_with_different_container(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(
                hash_location='s3://mybucket/datasets/dataset-id-1/hashes')
        ]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.get_file_content(
                bucket='mybucket', name='ds1',
                storage_path='s3://otherbucket/datasets/dataset-id-1/hashes/x',
                filename=None,
            )
        self.assertIn('does not belong', str(ctx.exception))

    @mock.patch('src.service.core.data.data_service.storage.SingleObjectClient')
    def test_returns_streaming_response_for_valid_path(self, mock_single_client):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(
                hash_location='s3://mybucket/datasets/dataset-id-1/hashes')
        ]
        client = mock.Mock()
        # `BytesStream` will be iterated; return iterable of bytes.
        client.get_object_stream.return_value = iter([b'hello'])
        mock_single_client.create.return_value = client

        response = data_service.get_file_content(
            bucket='mybucket', name='ds1',
            storage_path='s3://mybucket/datasets/dataset-id-1/hashes/abc',
            filename='lipsum.txt',
        )

        self.assertEqual('text/plain', response.media_type)

    @mock.patch('src.service.core.data.data_service.storage.SingleObjectClient')
    def test_falls_back_to_octet_stream_when_no_filename(self, mock_single_client):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(
                hash_location='s3://mybucket/datasets/dataset-id-1/hashes')
        ]
        client = mock.Mock()
        client.get_object_stream.return_value = iter([b''])
        mock_single_client.create.return_value = client

        response = data_service.get_file_content(
            bucket='mybucket', name='ds1',
            storage_path='s3://mybucket/datasets/dataset-id-1/hashes/abc',
            filename=None,
        )

        # No filename, hash key has no extension.
        self.assertEqual('application/octet-stream', response.media_type)


class GetManifestTest(unittest.TestCase):
    """Tests for get_manifest (lines 1016-1035)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.get_dataset_configs.return_value = _dataset_configs()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_raises_database_error_when_version_missing(self):
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row()],
            [],  # no version row
        ]
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            data_service.get_manifest(bucket='mybucket', name='ds1', version='1')

    @mock.patch('src.service.core.data.data_service.storage.SingleObjectClient')
    def test_returns_parsed_manifest_json(self, mock_single_client):
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row()],
            [_row(location='s3://mybucket/datasets/dataset-id-1/manifests/1.json')],
        ]
        manifest_bytes = io.BytesIO(b'[{"hash": "abc"}]')
        client = mock.Mock()
        client.get_object_stream.return_value = manifest_bytes
        mock_single_client.create.return_value = client

        result = data_service.get_manifest(
            bucket='mybucket', name='ds1', version='1')
        self.assertEqual([{'hash': 'abc'}], result)


class RenameTest(unittest.TestCase):
    """Tests for rename (lines 911-921)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_immutable_dataset_raises(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(labels={'osmo1_entry': True})
        ]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.rename('mybucket', 'old', 'new')
        self.assertIn('cannot be renamed', str(ctx.exception))

    def test_db_error_translated_to_user_error(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(labels={})
        ]
        self.postgres.execute_commit_command.side_effect = (
            osmo_errors.OSMODatabaseError('duplicate'))
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.rename('mybucket', 'old', 'new')
        self.assertIn('already being used', str(ctx.exception))

    def test_successful_rename_invokes_update_command(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(id='did', labels={})
        ]
        data_service.rename('mybucket', 'old', 'newname')
        args = self.postgres.execute_commit_command.call_args.args
        self.assertEqual(('newname', 'did'), args[1])


class ChangeNameTagLabelMetadataTest(unittest.TestCase):
    """Tests for change_name_tag_label_metadata (lines 942-970)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_collection_with_tag_payload_raises(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(is_collection=True)
        ]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.change_name_tag_label_metadata(
                bucket='mybucket', name='c1', tag=None,
                set_tag=['v1'], delete_tag=[],
                set_label={}, delete_label=[],
                set_metadata={}, delete_metadata=[],
            )
        self.assertIn('do not support', str(ctx.exception))

    def test_setting_latest_tag_raises(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(is_collection=False)
        ]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.change_name_tag_label_metadata(
                bucket='mybucket', name='ds1', tag=None,
                set_tag=['latest'], delete_tag=[],
                set_label={}, delete_label=[],
                set_metadata={}, delete_metadata=[],
            )
        self.assertIn('Cannot add or delete', str(ctx.exception))

    def test_no_changes_returns_empty_response(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(is_collection=False)
        ]
        response = data_service.change_name_tag_label_metadata(
            bucket='mybucket', name='ds1', tag=None,
            set_tag=[], delete_tag=[],
            set_label={}, delete_label=[],
            set_metadata={}, delete_metadata=[],
        )
        self.assertIsNone(response.tag_response)
        self.assertIsNone(response.label_response)
        self.assertIsNone(response.metadata_response)


class GetPathInformationTest(unittest.TestCase):
    """Tests for get_path_information (lines 1309-1313)."""

    def test_returns_path_and_region_from_bucket_config(self):
        postgres = mock.Mock()
        postgres.get_dataset_configs.return_value = _dataset_configs()
        with mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=postgres,
        ):
            response = data_service.get_path_information(bucket='mybucket')
        self.assertEqual('s3://mybucket/datasets', response.path)
        self.assertEqual('us-east-1', response.region)


class QueryDatasetTest(unittest.TestCase):
    """Tests for query_dataset (lines 1227-1303)."""

    def test_empty_command_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.query_dataset(bucket='mybucket', command='')
        self.assertIn('No query', str(ctx.exception))


class UpdateLabelsTest(unittest.TestCase):
    """Tests for update_labels (lines 849-870)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.execute_fetch_command.return_value = [_row(labels={'k': 'v'})]
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_set_labels_returns_postgres_labels(self):
        response = data_service.update_labels(
            'mybucket', 'ds1', set_label={'k': 'v'}, delete_label=[])
        self.assertEqual({'k': 'v'}, response.metadata)

    def test_delete_labels_passes_labels_in_args(self):
        data_service.update_labels(
            'mybucket', 'ds1', set_label={}, delete_label=['key1'])
        args = self.postgres.execute_fetch_command.call_args.args[1]
        # delete_label produces '{key1}' as the path string.
        self.assertIn('{key1}', args)


class UpdateMetadataTest(unittest.TestCase):
    """Tests for update_meatdata (lines 878-907)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_no_dataset_raises_user_error(self):
        self.postgres.execute_fetch_command.return_value = []
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.update_meatdata(
                'mybucket', 'ds1', tag='latest',
                set_key={'k': 'v'}, delete_key=[])
        self.assertIn('not a Dataset', str(ctx.exception))

    def test_returns_metadata_from_postgres(self):
        self.postgres.execute_fetch_command.return_value = [
            _row(metadata={'x': 1})]
        response = data_service.update_meatdata(
            'mybucket', 'ds1', tag='latest',
            set_key={'x': 1}, delete_key=[])
        self.assertEqual({'x': 1}, response.metadata)


class CreateCollectionTest(unittest.TestCase):
    """Tests for create_collection (lines 1180-1212)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_create_collection_collision_raises(self):
        # Force the inner build_collection path to do nothing,
        # then the conflict-on-insert path returns no row from `WHERE id = ...`.
        with mock.patch.object(data_service, 'build_collection',
                               return_value={'d1': '1'}):
            self.postgres.execute_fetch_command.side_effect = [
                [_row(id='cid', is_collection=True)],  # first insert
                [],  # second fetch returns nothing
            ]
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                data_service.create_collection(
                    bucket='mybucket', name='cn',
                    datasets=[objects.DatasetStructure(name='d1', tag='')],
                    username='alice',
                )
            self.assertIn('already being used', str(ctx.exception))


class UpdateCollectionTest(unittest.TestCase):
    """Tests for update_collection (lines 1325-1373)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_recollect_dataset_raises(self):
        # get_dataset returns a non-collection row.
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(is_collection=False)]
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.update_collection(
                bucket='mybucket', name='ds1',
                add_datasets=[], remove_datasets=[])
        self.assertIn('Cannot recollect', str(ctx.exception))


class DeleteDatasetTest(unittest.TestCase):
    """Tests for delete_dataset early branches (lines 675-700)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.get_dataset_configs.return_value = _dataset_configs()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_finish_invokes_clean_dataset(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(id='did',
                              hash_location='s3://mybucket/datasets/did/hashes',
                              hash_location_size=42)]
        response = data_service.delete_dataset(
            bucket='mybucket', name='ds1', tag=None,
            all_flag=False, finish=True)
        self.assertEqual(['s3://mybucket/datasets/did/hashes'],
                         response.delete_locations)
        self.assertEqual(42, response.cleaned_size)

    def test_collection_delete_returns_empty_response(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(is_collection=True, id='cid')]
        response = data_service.delete_dataset(
            bucket='mybucket', name='c1', tag=None,
            all_flag=False, finish=False)
        self.assertEqual([], response.delete_locations)
        self.assertEqual([], response.versions)


class GetDatasetInfoTest(unittest.TestCase):
    """Tests for get_dataset_info (lines 153-221)."""

    def _make_version_row_for_info(self, **overrides):
        base = {
            'dataset_id': 'did',
            'version_id': '1',
            'location': 's3://mybucket/datasets/did/manifests/1.json',
            'status': objects.DatasetStatus.READY.name,
            'checksum': 'cs',
            'size': 100,
            'created_by': 'alice',
            'created_date': datetime.datetime(2026, 1, 1, 12, 0, 0),
            'last_used': datetime.datetime(2026, 1, 1, 12, 0, 0),
            'metadata': {},
        }
        base.update(overrides)
        return _row(**base)

    def test_no_results_raises_database_error(self):
        postgres = mock.Mock()
        postgres.execute_fetch_command.return_value = []
        with self.assertRaises(osmo_errors.OSMODatabaseError) as ctx:
            data_service.get_dataset_info(
                postgres, 'mybucket', 'ds1', '', False, None)
        self.assertIn('any entry', str(ctx.exception))

    def test_returns_entries_with_default_filters(self):
        # First fetch: matching version.
        # Second/third fetch: collections, tags (empty for simplicity).
        postgres = mock.Mock()
        postgres.execute_fetch_command.side_effect = [
            [self._make_version_row_for_info()],
            [],  # collections
            [],  # tags
        ]
        postgres.get_dataset_configs.return_value = _dataset_configs()
        rows = data_service.get_dataset_info(
            postgres, 'mybucket', 'ds1', '', False, None)
        self.assertEqual(1, len(rows))
        self.assertEqual('1', rows[0].version)
        self.assertEqual('mybucket', 'mybucket')

    def test_with_tag_count_and_desc_order(self):
        postgres = mock.Mock()
        postgres.execute_fetch_command.side_effect = [
            [self._make_version_row_for_info(version_id='5')],
            [],
            [_row(tag='tag-a'), _row(tag='tag-b')],
        ]
        postgres.get_dataset_configs.return_value = _dataset_configs()
        rows = data_service.get_dataset_info(
            postgres, 'mybucket', 'ds1', tag='tag-a',
            all_flag=False, count=10,
            order=connectors.ListOrder.DESC)
        self.assertEqual(1, len(rows))
        self.assertEqual(['tag-a', 'tag-b'], rows[0].tags)

    def test_with_all_flag_true(self):
        postgres = mock.Mock()
        postgres.execute_fetch_command.side_effect = [
            [self._make_version_row_for_info()],
            [_row(name='collA')],
            [],
        ]
        postgres.get_dataset_configs.return_value = _dataset_configs()
        rows = data_service.get_dataset_info(
            postgres, 'mybucket', 'ds1', '', True, None)
        self.assertEqual(['collA'], rows[0].collections)


class DownloadDatasetsTest(unittest.TestCase):
    """Tests for _download_datasets and download/migrate endpoints (540-646)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.get_dataset_configs.return_value = _dataset_configs()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_collection_branch_with_empty_collection_raises(self):
        # First fetch: get_dataset (collection); second fetch: empty collection rows.
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=True, id='cid')],
            [],
        ]
        with self.assertRaises(osmo_errors.OSMODatabaseError) as ctx:
            data_service._download_datasets(
                self.postgres, 'mybucket', 'c1', 'latest')
        self.assertIn('Collection', str(ctx.exception))

    def test_collection_branch_returns_response(self):
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=True, id='cid')],
            [_row(version_id='1',
                  location='s3://mybucket/datasets/did/manifests/1.json',
                  id='did', bucket='mybucket', name='d1')],
        ]
        response = data_service._download_datasets(
            self.postgres, 'mybucket', 'c1', 'latest')
        self.assertEqual(['d1'], response.dataset_names)
        self.assertEqual(['1'], response.dataset_versions)
        self.assertTrue(response.is_collection)

    def test_dataset_branch_no_ready_raises(self):
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=False, id='did')],
            [],
        ]
        with self.assertRaises(osmo_errors.OSMODatabaseError) as ctx:
            data_service._download_datasets(
                self.postgres, 'mybucket', 'ds1', 'latest')
        self.assertIn('READY dataset', str(ctx.exception))

    def test_dataset_branch_non_json_location_added_to_new_locations(self):
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=False, id='did')],
            [_row(version_id='1',
                  location='s3://mybucket/datasets/did/data',
                  id='did', bucket='mybucket', name='ds1')],
        ]
        response = data_service._download_datasets(
            self.postgres, 'mybucket', 'ds1', 'latest')
        self.assertEqual(
            ['s3://mybucket/datasets/did/manifests/1.json'],
            response.new_locations)

    def test_migrate_runs_update(self):
        # Build a single dataset row whose .json suffix will skip new_location.
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=False, id='did')],
            [_row(version_id='1',
                  location='s3://mybucket/datasets/did/data',
                  id='did', bucket='mybucket', name='ds1')],
        ]
        response = data_service._download_datasets(
            self.postgres, 'mybucket', 'ds1', 'latest', migrate=True)
        # First commit is the migrate UPDATE, second is last_used UPDATE.
        commit_calls = self.postgres.execute_commit_command.call_args_list
        self.assertEqual(2, len(commit_calls))
        self.assertEqual(
            ['s3://mybucket/datasets/did/manifests/1.json'],
            response.new_locations)

    def test_download_router_uses_latest_default(self):
        # Plumbs through to _download_datasets via the router.
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=False, id='did')],
            [_row(version_id='1',
                  location='s3://mybucket/datasets/did/manifests/1.json',
                  id='did', bucket='mybucket', name='ds1')],
        ]
        response = data_service.download(
            bucket='mybucket', name='ds1', tag=None)
        self.assertFalse(response.is_collection)
        self.assertEqual(['ds1'], response.dataset_names)

    def test_migrate_dataset_router_uses_latest_default(self):
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=False, id='did')],
            [_row(version_id='1',
                  location='s3://mybucket/datasets/did/manifests/1.json',
                  id='did', bucket='mybucket', name='ds1')],
        ]
        response = data_service.migrate_dataset(
            bucket='mybucket', name='ds1', tag=None)
        self.assertFalse(response.is_collection)


class DeleteDatasetVersionsTest(unittest.TestCase):
    """Tests for delete_dataset version flow (lines 703-787)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.get_dataset_configs.return_value = _dataset_configs()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def _patch_get_info(self, version_infos):
        return mock.patch.object(
            data_service, 'get_dataset_info',
            return_value=version_infos)

    def test_no_version_with_all_flag_returns_response(self):
        # First fetch: dataset row, then get_dataset_info raises DB error.
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(id='did',
                              hash_location='s3://mybucket/datasets/did/hashes',
                              hash_location_size=11)]
        with mock.patch.object(
            data_service, 'get_dataset_info',
            side_effect=osmo_errors.OSMODatabaseError('no entries'),
        ):
            response = data_service.delete_dataset(
                bucket='mybucket', name='ds1', tag=None,
                all_flag=True, finish=False)
        self.assertEqual(['s3://mybucket/datasets/did/hashes'],
                         response.delete_locations)
        self.assertEqual(11, response.cleaned_size)

    def test_no_version_without_all_flag_propagates(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(id='did')]
        with mock.patch.object(
            data_service, 'get_dataset_info',
            side_effect=osmo_errors.OSMODatabaseError('no entries'),
        ), self.assertRaises(osmo_errors.OSMODatabaseError):
            data_service.delete_dataset(
                bucket='mybucket', name='ds1', tag=None,
                all_flag=False, finish=False)

    def test_active_version_remaining_returns_versions(self):
        # Setup: dataset_info, no newest_ready, version_rows with active status.
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(id='did',
                               hash_location='s3://mybucket/datasets/did/hashes')],
            # newest_ready
            [],
            # version_rows
            [_row(status=objects.DatasetStatus.READY.name,
                  location='s3://mybucket/datasets/did/manifests/2.json')],
        ]
        with self._patch_get_info(
            [_row(version='1', collections=[])],
        ):
            response = data_service.delete_dataset(
                bucket='mybucket', name='ds1', tag='myTag',
                all_flag=False, finish=False)
        # Active READY status found, returns versions only (no delete_locations).
        self.assertEqual(['1'], response.versions)
        self.assertEqual([], response.delete_locations)

    def test_no_active_version_returns_full_delete_locations(self):
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(id='did',
                               hash_location='s3://mybucket/datasets/did/hashes',
                               hash_location_size=99)],
            # newest_ready: present, triggers tag insertion
            [_row(dataset_id='did', version_id='3')],
            # version_rows: a single PENDING_DELETE (inactive) row
            [_row(status=objects.DatasetStatus.PENDING_DELETE.name,
                  location='s3://mybucket/datasets/did/manifests/1.json')],
        ]
        with self._patch_get_info(
            [_row(version='1', collections=['my-coll'])],
        ):
            response = data_service.delete_dataset(
                bucket='mybucket', name='ds1', tag=None,
                all_flag=False, finish=False)
        self.assertEqual(['1'], response.versions)
        # First entry is hash_location, second is the manifest location.
        self.assertEqual(
            ['s3://mybucket/datasets/did/hashes',
             's3://mybucket/datasets/did/manifests/1.json'],
            response.delete_locations)
        self.assertEqual(99, response.cleaned_size)

    def test_no_newest_ready_deletes_latest_tag(self):
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(id='did',
                               hash_location='s3://mybucket/datasets/did/hashes')],
            # newest_ready empty
            [],
            # version_rows: empty (so no active version found, returns delete_locations)
            [],
        ]
        with self._patch_get_info(
            [_row(version='1', collections=[])],
        ):
            response = data_service.delete_dataset(
                bucket='mybucket', name='ds1', tag=None,
                all_flag=True, finish=False)
        self.assertEqual(['1'], response.versions)


class UpdateTagsTest(unittest.TestCase):
    """Tests for update_tags (lines 799-842)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_numeric_set_tag_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.update_tags(
                'mybucket', 'ds1', 'latest',
                set_tags=['42'], delete_tags=[])
        self.assertIn('Cannot set a number', str(ctx.exception))

    def test_set_and_delete_tag_executes_commit_commands(self):
        # First fetch: dataset_version row from get_dataset_version.
        # Second fetch: returning tag rows.
        self.postgres.execute_fetch_command.side_effect = [
            [_make_version_row(dataset_id='did', version_id='1')],
            [_row(tag='final')],
        ]
        response = data_service.update_tags(
            'mybucket', 'ds1', 'latest',
            set_tags=['final'],
            delete_tags=['old-tag'])
        # 1 update for last_used + 1 insert for set_tag + 1 delete for delete_tag = 3
        self.assertEqual(3, self.postgres.execute_commit_command.call_count)
        self.assertEqual('1', response.version_id)
        self.assertEqual(['final'], response.tags)


class UpdateMetadataDeletePathTest(unittest.TestCase):
    """Tests for update_meatdata delete_key branch (lines 882-885)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_delete_key_passes_path_in_args(self):
        self.postgres.execute_fetch_command.return_value = [_row(metadata={})]
        data_service.update_meatdata(
            'mybucket', 'ds1', tag='latest',
            set_key={}, delete_key=['key1'])
        args = self.postgres.execute_fetch_command.call_args.args[1]
        # delete_key produces '{key1}' as the path string in args.
        self.assertIn('{key1}', args)


class GetInfoTest(unittest.TestCase):
    """Tests for get_info dispatch (lines 985-994)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.get_dataset_configs.return_value = _dataset_configs()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_collection_dispatches_to_collection_info(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(is_collection=True, id='cid')
        ]
        with mock.patch.object(
            data_service, 'get_collection_info',
            return_value=[],
        ) as mock_info:
            response = data_service.get_info(
                bucket='mybucket', name='c1', tag=None,
                all_flag=False, count=100,
                order=connectors.ListOrder.ASC)
        mock_info.assert_called_once()
        self.assertEqual(objects.DatasetType.COLLECTION, response.type)

    def test_dataset_dispatches_to_dataset_info(self):
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(is_collection=False, id='did')
        ]
        with mock.patch.object(
            data_service, 'get_dataset_info',
            return_value=[],
        ) as mock_info:
            response = data_service.get_info(
                bucket='mybucket', name='ds1', tag='myTag',
                all_flag=False, count=20,
                order=connectors.ListOrder.DESC)
        mock_info.assert_called_once()
        self.assertEqual(objects.DatasetType.DATASET, response.type)


class ListDatasetFromBucketTest(unittest.TestCase):
    """Tests for list_dataset_from_bucket (lines 1097-1171)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.fetch_user_names.return_value = ['alice']
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def _row_dict(self, **kwargs):
        base = {
            'name': 'ds1',
            'id': 'did',
            'bucket': 'mybucket',
            'created_date': datetime.datetime(2026, 1, 1, 12, 0, 0),
            'dv_created_date': datetime.datetime(2026, 1, 2, 12, 0, 0),
            'dv_version_id': '1',
            'hash_location': 's3://mybucket/datasets/did/hashes',
            'hash_location_size': 0,
            'is_collection': False,
        }
        base.update(kwargs)
        return base

    def test_default_returns_dataset_entries(self):
        self.postgres.execute_fetch_command.return_value = [self._row_dict()]
        response = data_service.list_dataset_from_bucket(
            name=None, user=None, buckets=[],
            dataset_type=None, latest_before=None, latest_after=None,
            all_users=False,
            order=connectors.ListOrder.ASC,
            count=20, username='alice')
        self.assertEqual(1, len(response.datasets))
        self.assertEqual('ds1', response.datasets[0].name)

    def test_with_all_filters_set(self):
        self.postgres.execute_fetch_command.return_value = [
            self._row_dict(is_collection=True, dv_created_date=None,
                           dv_version_id=None)
        ]
        response = data_service.list_dataset_from_bucket(
            name='partial',
            user=['bob'],
            buckets=['mybucket'],
            dataset_type=objects.DatasetType.COLLECTION,
            latest_before=datetime.datetime(2026, 12, 31),
            latest_after=datetime.datetime(2026, 1, 1),
            all_users=False,
            order=connectors.ListOrder.DESC,
            count=20,
            username='alice')
        self.postgres.fetch_user_names.assert_called_once_with(['bob'])
        self.assertEqual(objects.DatasetType.COLLECTION,
                         response.datasets[0].type)
        # dv_created_date is None -> last_created should be None
        self.assertIsNone(response.datasets[0].last_created)

    def test_all_users_skips_username_filter(self):
        self.postgres.execute_fetch_command.return_value = []
        response = data_service.list_dataset_from_bucket(
            name=None, user=None, buckets=[],
            dataset_type=None, latest_before=None, latest_after=None,
            all_users=True,
            order=connectors.ListOrder.ASC,
            count=20, username='alice')
        # No fetch_user_names lookup when all_users=True.
        self.postgres.fetch_user_names.assert_not_called()
        self.assertEqual(0, len(response.datasets))

    def test_count_capped_at_1000(self):
        # With count=5000 the SQL should still cap at 1000.
        self.postgres.execute_fetch_command.return_value = []
        data_service.list_dataset_from_bucket(
            name=None, user=None, buckets=[],
            dataset_type=None, latest_before=None, latest_after=None,
            all_users=True,
            order=connectors.ListOrder.ASC,
            count=5000, username='alice')
        passed_args = self.postgres.execute_fetch_command.call_args.args[1]
        self.assertIn(1000, passed_args)


class CreateCollectionFullTest(unittest.TestCase):
    """Tests for create_collection successful path (lines 1180-1218)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_empty_name_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            data_service.create_collection(
                bucket='mybucket', name='',
                datasets=[], username='alice')

    def test_creates_collection_inserts_versions(self):
        with mock.patch.object(data_service, 'build_collection',
                               return_value={'d1': '1'}):
            self.postgres.execute_fetch_command.side_effect = [
                [_row(id='cid', is_collection=True)],
                [_row(id='cid', is_collection=True)],  # confirm exists
            ]
            data_service.create_collection(
                bucket='mybucket', name='cn',
                datasets=[objects.DatasetStructure(name='d1', tag='')],
                username='alice')
        # Last call: insert into collection
        last_commit_args = self.postgres.execute_commit_command.call_args.args
        self.assertIn('INSERT INTO collection', last_commit_args[0])


class UpdateCollectionFullTest(unittest.TestCase):
    """Tests for update_collection collection branch (lines 1332-1370)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_recollect_with_versions(self):
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=True, id='cid')],
            [_row(dataset_id='d1', version_id='1')],
        ]
        with mock.patch.object(data_service, 'build_collection',
                               return_value={'d2': '2'}):
            response = data_service.update_collection(
                bucket='mybucket', name='c1',
                add_datasets=[objects.DatasetStructure(name='d2', tag='')],
                remove_datasets=[])
        self.assertEqual(1, len(response.versions))
        self.assertEqual('d2', response.versions[0].dataset_name)
        self.assertEqual('2', response.versions[0].version)

    def test_recollect_with_empty_versions(self):
        self.postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=True, id='cid')],
            [_row(dataset_id='d1', version_id='1')],
        ]
        with mock.patch.object(data_service, 'build_collection',
                               return_value={}):
            response = data_service.update_collection(
                bucket='mybucket', name='c1',
                add_datasets=[],
                remove_datasets=[
                    objects.DatasetStructure(name='d1', tag='')],
            )
        self.assertEqual([], response.versions)


class QueryDatasetCommandTest(unittest.TestCase):
    """Tests for query_dataset full body (lines 1231-1303)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.get_dataset_configs.return_value = _dataset_configs()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_no_datasets_raises(self):
        # Mock parser to avoid lark complexity.
        parser = mock.Mock()
        term = mock.Mock()
        term.cmd = 'name = %s'
        term.params = ['foo']
        term.metadata_enabled = False
        parser.parse.return_value = term
        self.postgres.execute_fetch_command.return_value = []
        with mock.patch(
            'src.service.core.data.data_service.query.QueryParser.get_instance',
            return_value=parser,
        ):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                data_service.query_dataset(
                    bucket='mybucket', command='name = foo')
        self.assertIn('No Datasets', str(ctx.exception))

    def test_metadata_enabled_returns_dataset_entries(self):
        parser = mock.Mock()
        term = mock.Mock()
        term.cmd = 'metadata @> %s'
        term.params = ['{}']
        term.metadata_enabled = True
        parser.parse.return_value = term
        self.postgres.execute_fetch_command.return_value = [
            _row(name='ds1', dataset_id='did', version_id='1',
                 status=objects.DatasetStatus.READY.name,
                 created_by='alice',
                 created_date=datetime.datetime(2026, 1, 1, 12, 0, 0),
                 last_used=datetime.datetime(2026, 1, 1, 12, 0, 0),
                 size=10, checksum='cs',
                 location='s3://mybucket/datasets/did/manifests/1.json',
                 metadata={}, id='did')
        ]
        with mock.patch(
            'src.service.core.data.data_service.query.QueryParser.get_instance',
            return_value=parser,
        ):
            response = data_service.query_dataset(
                bucket='mybucket', command='metadata @> {}')
        self.assertEqual(objects.DatasetQueryType.VERSION, response.type)
        self.assertEqual(1, len(response.datasets))

    def test_metadata_disabled_returns_response_entries(self):
        parser = mock.Mock()
        term = mock.Mock()
        term.cmd = 'name = %s'
        term.params = ['ds1']
        term.metadata_enabled = False
        parser.parse.return_value = term
        self.postgres.execute_fetch_command.return_value = [
            _make_dataset_row(name='ds1', is_collection=False)
        ]
        with mock.patch(
            'src.service.core.data.data_service.query.QueryParser.get_instance',
            return_value=parser,
        ):
            response = data_service.query_dataset(
                bucket='mybucket', command='# comment\nname = ds1')
        self.assertEqual(objects.DatasetQueryType.DATASET, response.type)
        self.assertEqual(1, len(response.datasets))


class BuildCollectionExtraTest(unittest.TestCase):
    """Extra build_collection tests for lines 437 and 449."""

    def test_remove_dataset_with_matching_tag_pops(self):
        # is_collection -> False, get_dataset_version returns d1 at v=5.
        postgres = mock.Mock()
        postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=False, id='d1')],
            [_make_version_row(dataset_id='d1', version_id='5', name='d1')],
        ]
        result = data_service.build_collection(
            postgres, 'mybucket',
            inital_datasets={'d1': '5'},
            remove_datasets=[objects.DatasetStructure(name='d1', tag='v5')],
        )
        # d1 popped via line 437.
        self.assertEqual({}, result)

    def test_add_collection_inserts_when_no_conflict(self):
        # is_collection -> True; collection rows include d2@v3 (unique).
        postgres = mock.Mock()
        postgres.execute_fetch_command.side_effect = [
            [_make_dataset_row(is_collection=True, id='cid')],
            [_row(dataset_id='d2', version_id='3', location='s3://x/d2',
                  hash_location='s3://x/h', size=1, name='d2')],
        ]
        result = data_service.build_collection(
            postgres, 'mybucket',
            add_datasets=[objects.DatasetStructure(name='coll', tag='')],
        )
        # Line 449: new_datasets[d2] = 3
        self.assertEqual({'d2': '3'}, result)


class UploadDatasetEndpointTest(unittest.TestCase):
    """Tests for upload_dataset router endpoint (lines 518-529)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.get_dataset_configs.return_value = _dataset_configs()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_upload_dataset_empty_name_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            data_service.upload_dataset(
                bucket='mybucket', name='', tag='',
                description='', metadata={}, resume=False, finish=False,
                version_id='', checksum='', size=0, labels={},
                update_dataset_size=0, username='alice')
        self.assertIn('Name is required', str(ctx.exception))

    def test_upload_dataset_dispatches_to_upload_start(self):
        with mock.patch.object(data_service, 'upload_start',
                               return_value=objects.DataUploadResponse(
                                   version_id='1')) as mock_start:
            data_service.upload_dataset(
                bucket='mybucket', name='ds1', tag='',
                description='', metadata={}, resume=False, finish=False,
                version_id='', checksum='', size=0, labels={},
                update_dataset_size=0, username='alice')
        mock_start.assert_called_once()

    def test_upload_dataset_dispatches_to_upload_finish_when_finishing(self):
        with mock.patch.object(data_service, 'upload_finish') as mock_finish:
            response = data_service.upload_dataset(
                bucket='mybucket', name='ds1', tag='', description='',
                metadata={}, resume=False, finish=True,
                version_id='99', checksum='c', size=10, labels={},
                update_dataset_size=10, username='alice')
        mock_finish.assert_called_once()
        self.assertEqual('99', response.version_id)


class GetBucketInfoTest(unittest.TestCase):
    """Tests for get_bucket_info router endpoint (lines 473-491)."""

    def setUp(self):
        self.postgres = mock.Mock()
        self.postgres.get_dataset_configs.return_value = _dataset_configs()
        self._patcher = mock.patch.object(
            connectors.PostgresConnector, 'get_instance',
            return_value=self.postgres,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()

    def test_default_only_skips_bucket_listing(self):
        with mock.patch.object(
            connectors.UserProfile, 'fetch_from_db',
            return_value=connectors.UserProfile(bucket=None),
        ):
            response = data_service.get_bucket_info(
                default_only=True, username='alice')
        self.assertEqual({}, response.buckets)
        self.assertEqual('mybucket', response.default)

    def test_returns_full_bucket_listing(self):
        with mock.patch.object(
            connectors.UserProfile, 'fetch_from_db',
            return_value=connectors.UserProfile(bucket='mybucket'),
        ):
            response = data_service.get_bucket_info(
                default_only=False, username='alice')
        self.assertIn('mybucket', response.buckets)
        self.assertEqual('mybucket', response.default)


if __name__ == '__main__':
    unittest.main()
