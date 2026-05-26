# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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
Unit tests for the storage client module.

Targets the public surface of ``Client`` and ``SingleObjectClient`` by patching
the downstream operation functions (``uploading.upload_objects``,
``downloading.download_objects``, ``copying.copy_objects``,
``listing.list_objects``, ``streaming.stream_object``, and
``deleting.delete_objects``) so the tests exercise the dispatch logic, path
resolution, header propagation, and error paths without any real network or
filesystem I/O.
"""

import unittest
from unittest import mock

from src.lib.data.storage import client as client_module
from src.lib.data.storage import copying
from src.lib.data.storage import deleting
from src.lib.data.storage import downloading
from src.lib.data.storage import listing
from src.lib.data.storage import streaming
from src.lib.data.storage import uploading
from src.lib.data.storage.backends import backends
from src.lib.data.storage.credentials import credentials
from src.lib.utils import osmo_errors


def _make_static_credential(endpoint: str) -> credentials.StaticDataCredential:
    """Helper that constructs a deterministic static data credential for tests."""
    return credentials.StaticDataCredential(
        endpoint=endpoint,
        access_key_id='test-access-key-id',
        access_key='test-access-key',
        region='us-east-1',
    )


def _make_client(storage_uri: str = 's3://bucket/sub') -> client_module.Client:
    """Helper that builds a Client scoped to ``s3://bucket/sub`` by default."""
    return client_module.Client.create(
        storage_uri=storage_uri,
        data_credential=_make_static_credential('s3://bucket'),
    )


class TestClientCreate(unittest.TestCase):
    """
    Tests the argument-validation paths and model validator on ``Client.create``.
    """

    def test_create_no_inputs_raises_usage_error(self):
        """All three optional inputs are None -> OSMOUsageError."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            client_module.Client.create()  # type: ignore[call-overload]

        self.assertIn(
            'One of (data_credential, storage_uri, storage_backend) must be provided',
            str(raised.exception),
        )

    def test_create_storage_uri_and_storage_backend_raises_usage_error(self):
        """Providing both storage_uri and storage_backend -> OSMOUsageError."""
        storage_backend = backends.construct_storage_backend(uri='s3://bucket/key')

        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            client_module.Client.create(  # type: ignore[call-overload]
                storage_uri='s3://bucket/key',
                storage_backend=storage_backend,
                data_credential=_make_static_credential('s3://bucket'),
            )

        self.assertIn(
            'Either storage_backend or storage_uri can be provided, not both',
            str(raised.exception),
        )

    def test_create_with_storage_uri_succeeds(self):
        """storage_uri provided -> client uses it verbatim."""
        client = client_module.Client.create(
            storage_uri='s3://bucket/path',
            data_credential=_make_static_credential('s3://bucket'),
        )

        self.assertEqual(client.storage_uri, 's3://bucket/path')

    def test_create_with_storage_backend_uses_backend_uri(self):
        """storage_backend without storage_uri -> client uses backend.uri."""
        storage_backend = backends.construct_storage_backend(uri='s3://bucket/key')

        client = client_module.Client.create(
            storage_backend=storage_backend,
            data_credential=_make_static_credential('s3://bucket'),
        )

        self.assertEqual(client.storage_uri, 's3://bucket/key')

    def test_create_with_only_data_credential_uses_credential_endpoint(self):
        """Only data_credential provided -> client uses credential.endpoint."""
        cred = _make_static_credential('s3://bucket/path')

        client = client_module.Client.create(data_credential=cred)

        self.assertEqual(client.storage_uri, 's3://bucket/path')

    def test_create_scope_to_container_uses_container_uri(self):
        """scope_to_container=True -> client uses backend.container_uri."""
        client = client_module.Client.create(
            storage_uri='s3://bucket/sub/prefix',
            data_credential=_make_static_credential('s3://bucket'),
            scope_to_container=True,
        )

        self.assertEqual(client.storage_uri, 's3://bucket')

    def test_create_credential_profile_mismatch_raises_credential_error(self):
        """Credential endpoint profile != storage URI profile -> OSMOCredentialError."""
        cred = _make_static_credential('s3://other-bucket')

        with self.assertRaises(osmo_errors.OSMOCredentialError) as raised:
            client_module.Client.create(
                storage_uri='s3://my-bucket/key',
                data_credential=cred,
            )

        self.assertIn(
            'Credential endpoint must match the storage backend profile',
            str(raised.exception),
        )

    def test_create_credential_profile_match_succeeds(self):
        """Credential endpoint profile == storage URI profile -> no validation error."""
        cred = _make_static_credential('s3://bucket')

        client = client_module.Client.create(
            storage_uri='s3://bucket/key',
            data_credential=cred,
        )

        self.assertIs(client.data_credential, cred)

    def test_create_returns_client_with_executor_params_kwarg(self):
        """Optional kwargs (e.g., metrics_dir) are forwarded to the client."""
        client = client_module.Client.create(
            storage_uri='s3://bucket/key',
            data_credential=_make_static_credential('s3://bucket'),
            metrics_dir='/tmp/metrics',
        )

        self.assertEqual(client.metrics_dir, '/tmp/metrics')


class TestValidateRemotePath(unittest.TestCase):
    """
    Exercises the branches of ``_validate_remote_path`` through the public
    ``Client.delete_objects`` API. ``delete_objects`` invokes the validation
    helper, then forwards the resolved prefix into ``deleting.delete_objects``;
    by patching that downstream call we can both observe the resolved prefix
    on the happy paths and trigger the error paths without making any real
    network/storage calls.
    """

    def setUp(self):
        # Storage URI 's3://bucket/sub' -> backend.container = 'bucket', backend.path = 'sub'.
        self.client = _make_client()

    @staticmethod
    def _build_summary_mock() -> mock.MagicMock:
        summary = mock.MagicMock(spec=deleting.DeleteSummary)
        summary.success_count = 0
        summary.failures = []
        return summary

    def test_delete_objects_with_none_prefix_uses_backend_path(self):
        """remote_path=None -> returns storage_backend.path."""
        with mock.patch.object(
            client_module.deleting,
            'delete_objects',
            return_value=self._build_summary_mock(),
        ) as mock_delete:
            self.client.delete_objects(prefix=None)

        delete_params = mock_delete.call_args[0][1]
        self.assertEqual(delete_params.prefix, 'sub')

    def test_delete_objects_with_empty_prefix_uses_backend_path(self):
        """Falsy ('' empty string) remote_path -> returns storage_backend.path."""
        with mock.patch.object(
            client_module.deleting,
            'delete_objects',
            return_value=self._build_summary_mock(),
        ) as mock_delete:
            self.client.delete_objects(prefix='')

        delete_params = mock_delete.call_args[0][1]
        self.assertEqual(delete_params.prefix, 'sub')

    def test_delete_objects_with_storage_uri_prefix_uses_backend_path(self):
        """remote_path == self.storage_uri -> returns storage_backend.path."""
        with mock.patch.object(
            client_module.deleting,
            'delete_objects',
            return_value=self._build_summary_mock(),
        ) as mock_delete:
            self.client.delete_objects(prefix='s3://bucket/sub')

        delete_params = mock_delete.call_args[0][1]
        self.assertEqual(delete_params.prefix, 'sub')

    def test_delete_objects_with_backend_path_prefix_returns_path(self):
        """remote_path == storage_backend.path -> returns the same value."""
        with mock.patch.object(
            client_module.deleting,
            'delete_objects',
            return_value=self._build_summary_mock(),
        ) as mock_delete:
            self.client.delete_objects(prefix='sub')

        delete_params = mock_delete.call_args[0][1]
        self.assertEqual(delete_params.prefix, 'sub')

    def test_delete_objects_with_relative_prefix_joins_with_backend_path(self):
        """relative remote_path -> os.path.join(backend.path, remote_path)."""
        with mock.patch.object(
            client_module.deleting,
            'delete_objects',
            return_value=self._build_summary_mock(),
        ) as mock_delete:
            self.client.delete_objects(prefix='inner')

        delete_params = mock_delete.call_args[0][1]
        self.assertEqual(delete_params.prefix, 'sub/inner')

    def test_delete_objects_with_absolute_prefix_inside_backend_returns_path(self):
        """Absolute remote_path with '://' contained in backend -> returns its path."""
        with mock.patch.object(
            client_module.deleting,
            'delete_objects',
            return_value=self._build_summary_mock(),
        ) as mock_delete:
            self.client.delete_objects(prefix='s3://bucket/sub/inner')

        delete_params = mock_delete.call_args[0][1]
        self.assertEqual(delete_params.prefix, 'sub/inner')

    def test_delete_objects_with_leading_slash_prefix_raises_usage_error(self):
        """Leading '/' in remote_path -> OSMOUsageError before any API call."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            self.client.delete_objects(prefix='/abs/path')

        self.assertIn(
            'Remote path cannot start with leading slash',
            str(raised.exception),
        )

    def test_delete_objects_with_absolute_prefix_outside_backend_raises_usage_error(self):
        """Absolute remote_path pointing to a different backend -> OSMOUsageError."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            self.client.delete_objects(prefix='s3://other-bucket/key')

        self.assertIn(
            'does not contain remote path',
            str(raised.exception),
        )


def _build_upload_summary() -> mock.MagicMock:
    summary = mock.MagicMock(spec=uploading.UploadSummary)
    summary.retries = 0
    summary.failures = []
    return summary


def _build_download_summary() -> mock.MagicMock:
    summary = mock.MagicMock(spec=downloading.DownloadSummary)
    summary.retries = 0
    summary.failures = []
    return summary


def _build_copy_summary() -> mock.MagicMock:
    summary = mock.MagicMock(spec=copying.CopySummary)
    summary.retries = 0
    summary.failures = []
    return summary


class TestUploadObjects(unittest.TestCase):
    """
    Tests dispatch behavior for ``Client.upload_objects`` across its
    str/list source variants and its destination_name validation paths.
    """

    def setUp(self):
        self.client = _make_client()

    def test_upload_objects_with_str_source_dispatches_single_path(self):
        """str source is wrapped into a single-element list passed downstream."""
        with mock.patch.object(
            client_module.uploading,
            'upload_objects',
            return_value=_build_upload_summary(),
        ) as mock_upload:
            self.client.upload_objects('/local/file')

        upload_params = mock_upload.call_args[0][1]
        self.assertEqual(len(upload_params.upload_paths), 1)
        self.assertEqual(upload_params.upload_paths[0].destination.container, 'bucket')

    def test_upload_objects_with_list_source_passes_all_paths(self):
        """list source yields one UploadPath per element."""
        with mock.patch.object(
            client_module.uploading,
            'upload_objects',
            return_value=_build_upload_summary(),
        ) as mock_upload:
            self.client.upload_objects(['/local/a', '/local/b'])

        upload_params = mock_upload.call_args[0][1]
        self.assertEqual(len(upload_params.upload_paths), 2)

    def test_upload_objects_str_with_glob_and_destination_name_raises_usage_error(self):
        """destination_name + source ending in '/*' -> OSMOUsageError."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            self.client.upload_objects(
                '/local/dir/*',
                destination_name='renamed',
            )

        self.assertIn(
            'Destination name remapping is not supported for source that ends with "/*"',
            str(raised.exception),
        )

    def test_upload_objects_list_with_destination_name_raises_usage_error(self):
        """destination_name with multiple sources -> OSMOUsageError."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            self.client.upload_objects(
                ['/local/a', '/local/b'],
                destination_name='renamed',  # type: ignore[call-overload]
            )

        self.assertIn(
            'Destination name remapping is not supported for multiple sources',
            str(raised.exception),
        )

    def test_upload_objects_with_str_destination_name_propagates_to_path(self):
        """destination_name is forwarded to the resulting UploadPath."""
        with mock.patch.object(
            client_module.uploading,
            'upload_objects',
            return_value=_build_upload_summary(),
        ) as mock_upload:
            self.client.upload_objects(
                '/local/file',
                destination_name='renamed',
            )

        upload_params = mock_upload.call_args[0][1]
        self.assertEqual(upload_params.upload_paths[0].destination.name, 'renamed')

    def test_upload_objects_with_extra_headers_succeeds(self):
        """extra_headers are accepted alongside client-level headers without error."""
        client = client_module.Client.create(
            storage_uri='s3://bucket/sub',
            data_credential=_make_static_credential('s3://bucket'),
            headers={'X-Client': 'on'},
        )

        with mock.patch.object(
            client_module.uploading,
            'upload_objects',
            return_value=_build_upload_summary(),
        ) as mock_upload:
            client.upload_objects(
                '/local/file',
                extra_headers={'X-Extra': 'yes'},
            )

        # The upload call goes through; client_factory was invoked with both
        # ClientHeaders (from client.headers) and UploadRequestHeaders (from extra_headers).
        self.assertEqual(mock_upload.call_count, 1)


class TestUploadWithWorkerInputs(unittest.TestCase):
    """
    Tests dispatch behavior for ``Client.upload_with_worker_inputs`` for
    both list and generator source variants.
    """

    def setUp(self):
        self.client = _make_client()

    def test_upload_with_worker_inputs_list_passes_list_param(self):
        """list source -> upload_worker_inputs is set on the params."""
        worker_input = uploading.UploadWorkerInput(
            source='/tmp/source',
            container='bucket',
            destination='sub/dest',
            size=0,
        )
        with mock.patch.object(
            client_module.uploading,
            'upload_objects',
            return_value=_build_upload_summary(),
        ) as mock_upload:
            self.client.upload_with_worker_inputs([worker_input])

        upload_params = mock_upload.call_args[0][1]
        self.assertEqual(upload_params.upload_worker_inputs, [worker_input])
        self.assertIsNone(upload_params.upload_worker_inputs_generator)

    def test_upload_with_worker_inputs_generator_passes_generator_param(self):
        """generator source -> upload_worker_inputs_generator is set on params."""
        worker_input = uploading.UploadWorkerInput(
            source='/tmp/source',
            container='bucket',
            destination='sub/dest',
            size=0,
        )

        def _generator():
            yield worker_input

        gen = _generator()

        with mock.patch.object(
            client_module.uploading,
            'upload_objects',
            return_value=_build_upload_summary(),
        ) as mock_upload:
            self.client.upload_with_worker_inputs(gen)

        upload_params = mock_upload.call_args[0][1]
        # Pydantic wraps the generator in a ValidatorIterator, so identity
        # comparison won't work; assert the generator field is set and the
        # list field is not.
        self.assertIsNotNone(upload_params.upload_worker_inputs_generator)
        self.assertIsNone(upload_params.upload_worker_inputs)


class TestCopyObjects(unittest.TestCase):
    """
    Tests dispatch behavior of ``Client.copy_objects`` across its source
    variants (None/empty/list/str) and its error paths.
    """

    def setUp(self):
        self.client = _make_client()

    def test_copy_objects_none_source_uses_empty_source_path(self):
        """source=None -> copy from backend.path (single empty source)."""
        with mock.patch.object(
            client_module.copying,
            'copy_objects',
            return_value=_build_copy_summary(),
        ) as mock_copy:
            self.client.copy_objects(destination_prefix='dest')

        copy_params = mock_copy.call_args[0][1]
        self.assertEqual(len(copy_params.source), 1)
        self.assertEqual(copy_params.source[0].prefix, 'sub')
        self.assertEqual(copy_params.destination.prefix, 'sub/dest')

    def test_copy_objects_empty_string_source_uses_empty_source_path(self):
        """source='' -> uses the same default empty source path branch."""
        with mock.patch.object(
            client_module.copying,
            'copy_objects',
            return_value=_build_copy_summary(),
        ) as mock_copy:
            self.client.copy_objects(
                destination_prefix='dest',
                source='',
            )

        copy_params = mock_copy.call_args[0][1]
        self.assertEqual(len(copy_params.source), 1)

    def test_copy_objects_str_source_dispatches_single_path(self):
        """str source -> wrapped into a single source path."""
        with mock.patch.object(
            client_module.copying,
            'copy_objects',
            return_value=_build_copy_summary(),
        ) as mock_copy:
            self.client.copy_objects(
                destination_prefix='dest',
                source='inner',
            )

        copy_params = mock_copy.call_args[0][1]
        self.assertEqual(len(copy_params.source), 1)
        self.assertEqual(copy_params.source[0].prefix, 'sub/inner')

    def test_copy_objects_list_source_passes_all_paths(self):
        """list source -> one source path per list element."""
        with mock.patch.object(
            client_module.copying,
            'copy_objects',
            return_value=_build_copy_summary(),
        ) as mock_copy:
            self.client.copy_objects(
                destination_prefix='dest',
                source=['a', 'b'],
            )

        copy_params = mock_copy.call_args[0][1]
        self.assertEqual(len(copy_params.source), 2)

    def test_copy_objects_str_with_glob_and_destination_name_raises_usage_error(self):
        """destination_name + source ending in '/*' -> OSMOUsageError."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            self.client.copy_objects(
                destination_prefix='dest',
                source='inner/*',
                destination_name='renamed',
            )

        self.assertIn(
            'Destination name remapping is not supported for source that ends with "/*"',
            str(raised.exception),
        )

    def test_copy_objects_list_with_destination_name_raises_usage_error(self):
        """destination_name + list source -> OSMOUsageError."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            self.client.copy_objects(  # type: ignore[call-overload]
                destination_prefix='dest',
                source=['a', 'b'],
                destination_name='renamed',
            )

        self.assertIn(
            'Destination name remapping is not supported for multiple sources',
            str(raised.exception),
        )


class TestDownloadObjects(unittest.TestCase):
    """
    Tests dispatch behavior of ``Client.download_objects`` across its source
    variants and its missing-destination error path.
    """

    def setUp(self):
        self.client = _make_client()

    def test_download_objects_none_source_uses_backend_path(self):
        """source=None -> downloads from backend.path."""
        with mock.patch.object(
            client_module.downloading,
            'download_objects',
            return_value=_build_download_summary(),
        ) as mock_download:
            self.client.download_objects(destination='/local/dst')

        download_params = mock_download.call_args[0][1]
        self.assertEqual(len(download_params.download_paths), 1)
        self.assertEqual(download_params.download_paths[0].source.prefix, 'sub')

    def test_download_objects_str_source_dispatches_single_path(self):
        """str source -> single download path."""
        with mock.patch.object(
            client_module.downloading,
            'download_objects',
            return_value=_build_download_summary(),
        ) as mock_download:
            self.client.download_objects(
                destination='/local/dst',
                source='inner',
            )

        download_params = mock_download.call_args[0][1]
        self.assertEqual(len(download_params.download_paths), 1)
        self.assertEqual(download_params.download_paths[0].source.prefix, 'sub/inner')

    def test_download_objects_list_source_passes_all_paths(self):
        """list source -> one download path per element."""
        with mock.patch.object(
            client_module.downloading,
            'download_objects',
            return_value=_build_download_summary(),
        ) as mock_download:
            self.client.download_objects(
                destination='/local/dst',
                source=['a', 'b'],
            )

        download_params = mock_download.call_args[0][1]
        self.assertEqual(len(download_params.download_paths), 2)

    def test_download_objects_empty_destination_raises_usage_error(self):
        """destination='' -> OSMOUsageError before any I/O."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            self.client.download_objects(destination='')

        self.assertIn(
            'Download destination is required',
            str(raised.exception),
        )


class TestDownloadWithWorkerInputs(unittest.TestCase):
    """
    Tests dispatch behavior for ``Client.download_with_worker_inputs`` for
    both list and generator source variants.
    """

    def setUp(self):
        self.client = _make_client()

    def test_download_with_worker_inputs_list_passes_list_param(self):
        """list source -> download_worker_inputs is set on the params."""
        worker_input = downloading.DownloadWorkerInput(
            container='bucket',
            source='sub/file',
            destination='/tmp/file',
            size=0,
        )
        with mock.patch.object(
            client_module.downloading,
            'download_objects',
            return_value=_build_download_summary(),
        ) as mock_download:
            self.client.download_with_worker_inputs([worker_input])

        download_params = mock_download.call_args[0][1]
        self.assertEqual(download_params.download_worker_inputs, [worker_input])
        self.assertIsNone(download_params.download_worker_inputs_generator)

    def test_download_with_worker_inputs_generator_passes_generator_param(self):
        """generator source -> download_worker_inputs_generator is set on params."""
        worker_input = downloading.DownloadWorkerInput(
            container='bucket',
            source='sub/file',
            destination='/tmp/file',
            size=0,
        )

        def _generator():
            yield worker_input

        gen = _generator()

        with mock.patch.object(
            client_module.downloading,
            'download_objects',
            return_value=_build_download_summary(),
        ) as mock_download:
            self.client.download_with_worker_inputs(gen)

        download_params = mock_download.call_args[0][1]
        # Pydantic wraps the generator in a ValidatorIterator, so identity
        # comparison won't work; assert the generator field is set and the
        # list field is not.
        self.assertIsNotNone(download_params.download_worker_inputs_generator)
        self.assertIsNone(download_params.download_worker_inputs)


class TestListObjects(unittest.TestCase):
    """
    Tests parameter construction for ``Client.list_objects``.
    """

    def setUp(self):
        self.client = _make_client()

    def test_list_objects_with_no_prefix_uses_backend_path(self):
        """prefix=None -> ListParams.prefix joins backend.path with '' (trailing slash)."""
        with mock.patch.object(
            client_module.listing,
            'list_objects',
            return_value=mock.MagicMock(spec=listing.ListStream),
        ) as mock_list:
            self.client.list_objects()

        list_params = mock_list.call_args[0][1]
        # os.path.join('sub', '') -> 'sub/'
        self.assertEqual(list_params.prefix, 'sub/')
        self.assertEqual(list_params.container, 'bucket')
        self.assertTrue(list_params.recursive)

    def test_list_objects_with_prefix_joins_under_backend_path(self):
        """prefix is joined under backend.path."""
        with mock.patch.object(
            client_module.listing,
            'list_objects',
            return_value=mock.MagicMock(spec=listing.ListStream),
        ) as mock_list:
            self.client.list_objects(prefix='inner')

        list_params = mock_list.call_args[0][1]
        self.assertEqual(list_params.prefix, 'sub/inner')

    def test_list_objects_propagates_regex_and_recursive(self):
        """Caller-supplied regex/recursive land in ListParams."""
        with mock.patch.object(
            client_module.listing,
            'list_objects',
            return_value=mock.MagicMock(spec=listing.ListStream),
        ) as mock_list:
            self.client.list_objects(regex=r'.*\.txt$', recursive=False)

        list_params = mock_list.call_args[0][1]
        self.assertEqual(list_params.regex, r'.*\.txt$')
        self.assertFalse(list_params.recursive)


class TestGetObjectStream(unittest.TestCase):
    """
    Tests dispatch behavior of ``Client.get_object_stream`` across its
    last_n_lines / offset / as_lines / as_io / default options.
    """

    def setUp(self):
        self.client = _make_client()

    def test_get_object_stream_with_last_n_lines_uses_last_n_lines_option(self):
        """last_n_lines -> options is LastNLinesStream and stream_lines is set."""
        with mock.patch.object(
            client_module.streaming,
            'stream_object',
            return_value=mock.MagicMock(spec=streaming.LinesStream),
        ) as mock_stream:
            self.client.get_object_stream('file', last_n_lines=10)

        stream_params = mock_stream.call_args[0][1]
        self.assertIsInstance(stream_params.options, streaming.LastNLinesStream)
        self.assertEqual(stream_params.options.last_n_lines, 10)
        self.assertIn('stream_lines', mock_stream.call_args.kwargs)

    def test_get_object_stream_with_offset_uses_offset_option(self):
        """offset -> options is OffsetStream and stream_lines is unset."""
        with mock.patch.object(
            client_module.streaming,
            'stream_object',
            return_value=mock.MagicMock(spec=streaming.BytesStream),
        ) as mock_stream:
            self.client.get_object_stream('file', 100, length=50)

        stream_params = mock_stream.call_args[0][1]
        self.assertIsInstance(stream_params.options, streaming.OffsetStream)
        self.assertEqual(stream_params.options.offset, 100)
        self.assertEqual(stream_params.options.length, 50)
        self.assertNotIn('stream_lines', mock_stream.call_args.kwargs)
        self.assertNotIn('as_io', mock_stream.call_args.kwargs)

    def test_get_object_stream_with_as_lines_uses_full_stream_with_lines(self):
        """as_lines=True (no offset/last_n_lines) -> FullStream + stream_lines."""
        with mock.patch.object(
            client_module.streaming,
            'stream_object',
            return_value=mock.MagicMock(spec=streaming.LinesStream),
        ) as mock_stream:
            self.client.get_object_stream('file', as_lines=True)

        stream_params = mock_stream.call_args[0][1]
        self.assertIsInstance(stream_params.options, streaming.FullStream)
        self.assertIn('stream_lines', mock_stream.call_args.kwargs)

    def test_get_object_stream_with_as_io_uses_full_stream_with_as_io(self):
        """as_io=True -> FullStream + as_io kwarg."""
        with mock.patch.object(
            client_module.streaming,
            'stream_object',
            return_value=mock.MagicMock(spec=streaming.BytesIO),
        ) as mock_stream:
            self.client.get_object_stream('file', as_io=True)

        stream_params = mock_stream.call_args[0][1]
        self.assertIsInstance(stream_params.options, streaming.FullStream)
        self.assertTrue(mock_stream.call_args.kwargs['as_io'])

    def test_get_object_stream_default_uses_full_stream_bytes(self):
        """No flags -> FullStream + plain bytes (no stream_lines, no as_io)."""
        with mock.patch.object(
            client_module.streaming,
            'stream_object',
            return_value=mock.MagicMock(spec=streaming.BytesStream),
        ) as mock_stream:
            self.client.get_object_stream('file')

        stream_params = mock_stream.call_args[0][1]
        self.assertIsInstance(stream_params.options, streaming.FullStream)
        self.assertNotIn('stream_lines', mock_stream.call_args.kwargs)
        self.assertNotIn('as_io', mock_stream.call_args.kwargs)


class TestSingleObjectClientCreate(unittest.TestCase):
    """
    Tests the argument-validation paths and slicing behavior of
    ``SingleObjectClient.create``.
    """

    def test_create_with_no_inputs_raises_usage_error(self):
        """No storage_uri AND no storage_backend -> OSMOUsageError."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            client_module.SingleObjectClient.create()  # type: ignore[call-overload]

        self.assertIn(
            'Either storage_uri OR storage_backend must be provided',
            str(raised.exception),
        )

    def test_create_with_both_inputs_raises_usage_error(self):
        """Both storage_uri AND storage_backend -> OSMOUsageError."""
        storage_backend = backends.construct_storage_backend(uri='s3://bucket/key')
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            client_module.SingleObjectClient.create(  # type: ignore[call-overload]
                storage_uri='s3://bucket/key',
                storage_backend=storage_backend,
            )

        self.assertIn(
            'Either storage_uri OR storage_backend must be provided',
            str(raised.exception),
        )

    def test_create_with_trailing_slash_raises_usage_error(self):
        """storage_uri ending in '/' -> OSMOUsageError."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            client_module.SingleObjectClient.create(
                storage_uri='s3://bucket/key/',
                data_credential=_make_static_credential('s3://bucket'),
            )

        self.assertIn('cannot end with a slash', str(raised.exception))

    def test_create_with_only_container_raises_usage_error(self):
        """storage_uri pointing only at the container -> OSMOUsageError."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            client_module.SingleObjectClient.create(
                storage_uri='s3://bucket',
                data_credential=_make_static_credential('s3://bucket'),
            )

        self.assertIn('Object URI must contain a basename', str(raised.exception))

    def test_create_with_storage_uri_strips_basename_for_inner_client(self):
        """object_name == basename, storage_client.storage_uri == dirname."""
        single = client_module.SingleObjectClient.create(
            storage_uri='s3://bucket/sub/file.txt',
            data_credential=_make_static_credential('s3://bucket'),
        )

        self.assertEqual(single.object_name, 'file.txt')
        self.assertEqual(single.storage_client.storage_uri, 's3://bucket/sub')

    def test_create_with_storage_backend_strips_basename_for_inner_client(self):
        """storage_backend variant produces the same object_name + dirname."""
        storage_backend = backends.construct_storage_backend(uri='s3://bucket/sub/file.txt')

        single = client_module.SingleObjectClient.create(
            storage_backend=storage_backend,
            data_credential=_make_static_credential('s3://bucket'),
        )

        self.assertEqual(single.object_name, 'file.txt')
        self.assertEqual(single.storage_client.storage_uri, 's3://bucket/sub')


class TestSingleObjectClientOperations(unittest.TestCase):
    """
    Tests the thin-wrapper methods on ``SingleObjectClient`` that delegate
    to the underlying ``Client``.
    """

    def setUp(self):
        self.single = client_module.SingleObjectClient.create(
            storage_uri='s3://bucket/sub/file.txt',
            data_credential=_make_static_credential('s3://bucket'),
        )

    def test_upload_object_with_glob_source_raises_usage_error(self):
        """source ending in '/*' -> OSMOUsageError before any storage call."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            self.single.upload_object('/local/dir/*')

        self.assertIn(
            'Source cannot end with "/*" in ObjectClient.upload_object()',
            str(raised.exception),
        )

    def test_upload_object_forwards_destination_name_as_object_name(self):
        """upload_object delegates to upload_objects with destination_name=object_name."""
        with mock.patch.object(
            client_module.Client,
            'upload_objects',
            return_value=_build_upload_summary(),
        ) as mock_upload:
            self.single.upload_object('/local/file', resume=True)

        kwargs = mock_upload.call_args.kwargs
        self.assertEqual(kwargs['source'], '/local/file')
        self.assertEqual(kwargs['destination_name'], 'file.txt')
        self.assertTrue(kwargs['resume'])

    def test_copy_object_delegates_with_destination_name(self):
        """copy_object delegates to copy_objects."""
        with mock.patch.object(
            client_module.Client,
            'copy_objects',
            return_value=_build_copy_summary(),
        ) as mock_copy:
            self.single.copy_object('renamed_dir', destination_name='renamed.txt')

        kwargs = mock_copy.call_args.kwargs
        self.assertEqual(kwargs['destination_prefix'], 'renamed_dir')
        self.assertEqual(kwargs['destination_name'], 'renamed.txt')

    def test_download_object_delegates_with_destination(self):
        """download_object delegates to download_objects."""
        with mock.patch.object(
            client_module.Client,
            'download_objects',
            return_value=_build_download_summary(),
        ) as mock_download:
            self.single.download_object('/local/dst', resume=True)

        kwargs = mock_download.call_args.kwargs
        self.assertEqual(kwargs['destination'], '/local/dst')
        self.assertTrue(kwargs['resume'])

    def test_get_object_stream_default_delegates_with_object_name(self):
        """No flags -> delegate(object_name)."""
        with mock.patch.object(
            client_module.Client,
            'get_object_stream',
            return_value=mock.MagicMock(spec=streaming.BytesStream),
        ) as mock_stream:
            self.single.get_object_stream()

        # First positional arg (after self) is the object_name.
        self.assertEqual(mock_stream.call_args.args[-1], 'file.txt')
        self.assertEqual(mock_stream.call_args.kwargs, {})

    def test_get_object_stream_with_last_n_lines_delegates(self):
        """last_n_lines -> delegate(object_name, last_n_lines=N, as_lines=True)."""
        with mock.patch.object(
            client_module.Client,
            'get_object_stream',
            return_value=mock.MagicMock(spec=streaming.LinesStream),
        ) as mock_stream:
            self.single.get_object_stream(last_n_lines=5)

        kwargs = mock_stream.call_args.kwargs
        self.assertEqual(kwargs['last_n_lines'], 5)
        self.assertTrue(kwargs['as_lines'])

    def test_get_object_stream_with_offset_delegates(self):
        """offset -> delegate(object_name, offset=O, length=L)."""
        with mock.patch.object(
            client_module.Client,
            'get_object_stream',
            return_value=mock.MagicMock(spec=streaming.BytesStream),
        ) as mock_stream:
            self.single.get_object_stream(100, length=50)

        kwargs = mock_stream.call_args.kwargs
        self.assertEqual(kwargs['offset'], 100)
        self.assertEqual(kwargs['length'], 50)

    def test_get_object_stream_with_as_lines_delegates(self):
        """as_lines=True -> delegate(object_name, as_lines=True)."""
        with mock.patch.object(
            client_module.Client,
            'get_object_stream',
            return_value=mock.MagicMock(spec=streaming.LinesStream),
        ) as mock_stream:
            self.single.get_object_stream(as_lines=True)

        kwargs = mock_stream.call_args.kwargs
        self.assertEqual(kwargs, {'as_lines': True})

    def test_get_object_stream_with_as_io_delegates(self):
        """as_io=True -> delegate(object_name, as_io=True)."""
        with mock.patch.object(
            client_module.Client,
            'get_object_stream',
            return_value=mock.MagicMock(spec=streaming.BytesIO),
        ) as mock_stream:
            self.single.get_object_stream(as_io=True)

        kwargs = mock_stream.call_args.kwargs
        self.assertEqual(kwargs, {'as_io': True})

    def test_delete_object_delegates_with_object_name_prefix(self):
        """delete_object -> delete_objects(prefix=object_name)."""
        delete_summary = mock.MagicMock(spec=deleting.DeleteSummary)
        delete_summary.success_count = 0
        delete_summary.failures = []
        with mock.patch.object(
            client_module.Client,
            'delete_objects',
            return_value=delete_summary,
        ) as mock_delete:
            self.single.delete_object()

        kwargs = mock_delete.call_args.kwargs
        self.assertEqual(kwargs['prefix'], 'file.txt')


if __name__ == '__main__':
    unittest.main()
