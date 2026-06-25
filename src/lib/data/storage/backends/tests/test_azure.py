# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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
Unit tests for the Azure Blob Storage backend client.
"""

import datetime
import os
import tempfile
import unittest
from unittest import mock

import pydantic

from azure.core import exceptions
from azure.storage import blob

from src.lib.data.storage.backends import azure
from src.lib.data.storage.core import client as core_client
from src.lib.data.storage.credentials import credentials


class GetAzureTimeoutTest(unittest.TestCase):
    """Tests for _get_azure_timeout reading the OSMO_AZURE_TIMEOUT env var."""

    def test_default_when_env_unset(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            # pylint: disable=protected-access
            result = azure._get_azure_timeout()
        self.assertEqual(result, datetime.timedelta(hours=24))

    def test_env_override(self):
        with mock.patch.dict(os.environ, {azure.OSMO_AZURE_TIMEOUT: '15m'}):
            # pylint: disable=protected-access
            result = azure._get_azure_timeout()
        self.assertEqual(result, datetime.timedelta(minutes=15))


class GetAzureMaxRetryCountTest(unittest.TestCase):
    """Tests for _get_azure_max_retry_count clamping and env override."""

    def test_default_when_env_unset(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            # pylint: disable=protected-access
            result = azure._get_azure_max_retry_count()
        self.assertEqual(result, 3)

    def test_env_value_used(self):
        with mock.patch.dict(os.environ, {azure.OSMO_AZURE_MAX_RETRY_COUNT: '7'}):
            # pylint: disable=protected-access
            result = azure._get_azure_max_retry_count()
        self.assertEqual(result, 7)

    def test_clamps_below_one(self):
        with mock.patch.dict(os.environ, {azure.OSMO_AZURE_MAX_RETRY_COUNT: '0'}):
            # pylint: disable=protected-access
            result = azure._get_azure_max_retry_count()
        self.assertEqual(result, 1)


class GetDeleteBlobsBatchSizeTest(unittest.TestCase):
    """Tests for _get_delete_blobs_batch_size respecting the 256-blob API cap."""

    def test_default_is_256(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            # pylint: disable=protected-access
            result = azure._get_delete_blobs_batch_size()
        self.assertEqual(result, 256)

    def test_env_can_lower(self):
        with mock.patch.dict(os.environ, {azure.OSMO_AZURE_DELETE_BLOBS_BATCH_SIZE: '10'}):
            # pylint: disable=protected-access
            result = azure._get_delete_blobs_batch_size()
        self.assertEqual(result, 10)

    def test_env_clamps_to_256(self):
        with mock.patch.dict(os.environ, {azure.OSMO_AZURE_DELETE_BLOBS_BATCH_SIZE: '500'}):
            # pylint: disable=protected-access
            result = azure._get_delete_blobs_batch_size()
        self.assertEqual(result, 256)


class GetCopySasExpiryTimeTest(unittest.TestCase):
    """Tests for _get_copy_sas_expiry_time reading OSMO_AZURE_COPY_SAS_EXPIRY_TIME."""

    def test_default_is_one_hour(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            # pylint: disable=protected-access
            result = azure._get_copy_sas_expiry_time()
        self.assertEqual(result, datetime.timedelta(hours=1))

    def test_env_override(self):
        with mock.patch.dict(os.environ, {azure.OSMO_AZURE_COPY_SAS_EXPIRY_TIME: '30m'}):
            # pylint: disable=protected-access
            result = azure._get_copy_sas_expiry_time()
        self.assertEqual(result, datetime.timedelta(minutes=30))


class GetMd5ChecksumTest(unittest.TestCase):
    """Tests for _get_md5_checksum extracting hex from BlobProperties content_settings."""

    def test_returns_hex_when_md5_present(self):
        blob_properties = mock.Mock(spec=blob.BlobProperties)
        blob_properties.content_settings = mock.Mock()
        blob_properties.content_settings.content_md5 = b'\xde\xad\xbe\xef'

        # pylint: disable=protected-access
        result = azure._get_md5_checksum(blob_properties)

        self.assertEqual(result, 'deadbeef')

    def test_returns_none_when_md5_absent(self):
        blob_properties = mock.Mock(spec=blob.BlobProperties)
        blob_properties.content_settings = mock.Mock()
        blob_properties.content_settings.content_md5 = None

        # pylint: disable=protected-access
        result = azure._get_md5_checksum(blob_properties)

        self.assertIsNone(result)


class AzureErrorHandlerTest(unittest.TestCase):
    """Tests for AzureErrorHandler.eligible and handle_error."""

    def test_eligible_true_for_azure_error(self):
        handler = azure.AzureErrorHandler()
        err = exceptions.AzureError('boom')
        self.assertTrue(handler.eligible(err))

    def test_eligible_false_for_unrelated(self):
        handler = azure.AzureErrorHandler()
        self.assertFalse(handler.eligible(ValueError('not azure')))

    def test_handle_error_raises_storage_client_error_with_args(self):
        handler = azure.AzureErrorHandler()
        err = exceptions.AzureError('connection refused')
        context = core_client.APIContext()

        with self.assertRaises(core_client.OSMODataStorageClientError) as ctx:
            handler.handle_error(err, context)

        self.assertIn('AzureError', str(ctx.exception))
        self.assertIn('connection refused', str(ctx.exception))
        self.assertIs(ctx.exception.__cause__, err)

    def test_handle_error_uses_str_when_no_args(self):
        handler = azure.AzureErrorHandler()

        class NoArgsAzureError(exceptions.AzureError):
            def __init__(self):  # pylint: disable=super-init-not-called
                self.args = ()

            def __str__(self):
                return 'stringified'

        err = NoArgsAzureError()
        context = core_client.APIContext()

        with self.assertRaises(core_client.OSMODataStorageClientError) as ctx:
            handler.handle_error(err, context)

        self.assertIn('stringified', str(ctx.exception))


def _make_resumable_stream(
    *,
    offset=None,
    length=None,
    chunks=None,
    read_data=b'',
):
    """
    Build an AzureBlobStorageResumableStream whose download_blob returns a
    fake downloader with read()/chunks() driven by `read_data`/`chunks`.
    """
    blob_client = mock.Mock(spec=blob.BlobClient)
    downloader = mock.Mock(spec=blob.StorageStreamDownloader)
    downloader.read.return_value = read_data
    downloader.chunks.return_value = iter(chunks or [])
    blob_client.download_blob.return_value = downloader

    handler = azure.AzureErrorHandler()
    stream = azure.AzureBlobStorageResumableStream(
        blob_client=blob_client,
        error_handler=handler,
        offset=offset,
        length=length,
    )
    return stream, blob_client, downloader


class AzureBlobStorageResumableStreamInitTest(unittest.TestCase):
    """Tests for the __init__ math: offset/length translate to absolute end."""

    def test_offset_defaults_to_zero(self):
        stream, _, _ = _make_resumable_stream()
        # pylint: disable=protected-access
        self.assertEqual(stream._offset, 0)
        self.assertIsNone(stream._end)
        self.assertIsNone(stream._current_stream)
        self.assertIsNone(stream._current_chunk_iterator)
        self.assertFalse(stream._exhausted)

    def test_length_sets_inclusive_end(self):
        stream, _, _ = _make_resumable_stream(offset=100, length=50)
        # pylint: disable=protected-access
        self.assertEqual(stream._offset, 100)
        # end = offset + length - 1
        self.assertEqual(stream._end, 149)

    def test_length_none_sets_end_to_none(self):
        stream, _, _ = _make_resumable_stream(offset=10)
        # pylint: disable=protected-access
        self.assertIsNone(stream._end)


class AzureBlobStorageResumableStreamReadTest(unittest.TestCase):
    """Tests for AzureBlobStorageResumableStream.read()."""

    def test_invalid_n_raises(self):
        stream, _, _ = _make_resumable_stream()
        with self.assertRaises(ValueError):
            stream.read(-2)

    def test_read_returns_data_and_tracks_bytes(self):
        stream, blob_client, downloader = _make_resumable_stream(
            offset=0, length=10, read_data=b'abcde',
        )
        result = stream.read(5)

        self.assertEqual(result, b'abcde')
        self.assertEqual(stream.size, 5)
        blob_client.download_blob.assert_called_once_with(offset=0, length=10)
        downloader.read.assert_called_once_with(size=5)

    def test_read_marks_exhausted_when_past_end(self):
        # offset=0, length=4 -> _end=3; reading 4 bytes puts position at 4 > 3.
        stream, _, _ = _make_resumable_stream(
            offset=0, length=4, read_data=b'abcd',
        )
        stream.read(4)
        # pylint: disable=protected-access
        self.assertTrue(stream._exhausted)

    def test_read_marks_exhausted_on_empty_data(self):
        # No range -> _end is None; empty read should still flip _exhausted.
        stream, _, _ = _make_resumable_stream(read_data=b'')
        result = stream.read(-1)
        self.assertEqual(result, b'')
        # pylint: disable=protected-access
        self.assertTrue(stream._exhausted)

    def test_read_after_exhausted_returns_empty(self):
        stream, _, _ = _make_resumable_stream(read_data=b'')
        stream.read(-1)  # exhaust
        self.assertEqual(stream.read(10), b'')

    def test_read_uses_remaining_length_after_partial(self):
        # Drive two consecutive reads: first 4 bytes, then 4 more.
        # _end = 0 + 8 - 1 = 7; second download_blob call should be
        # offset=4, length=4 (i.e. _end - position + 1).
        stream, blob_client, downloader = _make_resumable_stream(
            offset=0, length=8, read_data=b'abcd',
        )

        first = stream.read(4)
        # Force creation of a new stream by manually resetting the current
        # downloader to force a second download_blob call.
        # pylint: disable=protected-access
        stream._current_stream = None
        downloader.read.return_value = b'efgh'
        second = stream.read(4)

        self.assertEqual(first, b'abcd')
        self.assertEqual(second, b'efgh')
        self.assertEqual(stream.size, 8)
        # Second call should ask for remaining 4 bytes from offset 4.
        self.assertEqual(
            blob_client.download_blob.call_args_list[1],
            mock.call(offset=4, length=4),
        )


class AzureBlobStorageResumableStreamNextTest(unittest.TestCase):
    """Tests for AzureBlobStorageResumableStream.__next__()."""

    def test_next_yields_chunks_and_tracks_bytes(self):
        stream, _, _ = _make_resumable_stream(
            offset=0, length=10, chunks=[b'abc', b'de'],
        )

        first = next(stream)
        second = next(stream)

        self.assertEqual(first, b'abc')
        self.assertEqual(second, b'de')
        self.assertEqual(stream.size, 5)

    def test_next_raises_stop_iteration_when_underlying_exhausted(self):
        stream, _, _ = _make_resumable_stream(chunks=[])

        with self.assertRaises(StopIteration):
            next(stream)
        # pylint: disable=protected-access
        self.assertTrue(stream._exhausted)

    def test_next_returns_stop_iteration_after_exhausted_state(self):
        stream, _, _ = _make_resumable_stream(chunks=[b'abc'])
        # pylint: disable=protected-access
        stream._exhausted = True

        with self.assertRaises(StopIteration):
            next(stream)

    def test_next_marks_exhausted_when_past_end(self):
        # offset=0, length=4 -> _end=3; first chunk of 5 bytes exceeds end.
        stream, _, _ = _make_resumable_stream(
            offset=0, length=4, chunks=[b'abcde'],
        )
        next(stream)
        # pylint: disable=protected-access
        self.assertTrue(stream._exhausted)


def _build_client(azure_mock=None, data_cred=None):
    """Build an AzureBlobStorageClient with a mock azure_client_factory."""
    azure_mock = azure_mock or mock.Mock(spec=blob.BlobServiceClient)
    if data_cred is None:
        data_cred = credentials.StaticDataCredential(
            endpoint='azure://acct',
            access_key_id='unused',
            access_key=pydantic.SecretStr(
                'DefaultEndpointsProtocol=https;'
                'AccountName=acct;AccountKey=k1;'
                'EndpointSuffix=core.windows.net'
            ),
        )
    return azure.AzureBlobStorageClient(
        azure_client_factory=lambda: azure_mock,
        data_cred=data_cred,
    ), azure_mock


class AzureBlobStorageClientCloseTest(unittest.TestCase):
    """Tests for AzureBlobStorageClient.close()."""

    def test_close_invokes_underlying_client(self):
        client, azure_mock = _build_client()
        client.close()
        azure_mock.close.assert_called_once()

    def test_close_swallows_underlying_exception(self):
        client, azure_mock = _build_client()
        azure_mock.close.side_effect = RuntimeError('boom')
        # Should not raise — close() catches everything.
        client.close()


class AzureBlobStorageClientGetObjectInfoTest(unittest.TestCase):
    """Tests for AzureBlobStorageClient.get_object_info()."""

    def test_returns_response_with_properties(self):
        client, azure_mock = _build_client()
        blob_properties = mock.Mock(spec=blob.BlobProperties)
        blob_properties.name = 'k'
        blob_properties.size = 42
        blob_properties.content_settings = mock.Mock(content_md5=b'\x01\x02')
        last_modified = datetime.datetime(2026, 1, 1)
        blob_properties.last_modified = last_modified

        blob_client = mock.Mock(spec=blob.BlobClient)
        blob_client.get_blob_properties.return_value = blob_properties
        azure_mock.get_blob_client.return_value = blob_client

        response = client.get_object_info('bucket', 'k')

        self.assertEqual(response.result.key, 'k')
        self.assertEqual(response.result.size, 42)
        self.assertEqual(response.result.checksum, '0102')
        self.assertEqual(response.result.last_modified, last_modified)
        azure_mock.get_blob_client.assert_called_once_with('bucket', 'k')


class AzureBlobStorageClientObjectExistsTest(unittest.TestCase):
    """Tests for AzureBlobStorageClient.object_exists()."""

    def test_object_exists_true_when_no_checksum(self):
        client, azure_mock = _build_client()
        blob_properties = mock.Mock(spec=blob.BlobProperties)
        blob_properties.name = 'k'
        blob_properties.size = 1
        blob_properties.content_settings = mock.Mock(content_md5=None)
        blob_properties.last_modified = None
        blob_client = mock.Mock(spec=blob.BlobClient)
        blob_client.get_blob_properties.return_value = blob_properties
        azure_mock.get_blob_client.return_value = blob_client

        response = client.object_exists('bucket', 'k')

        self.assertTrue(response.result.exists)
        self.assertIsNotNone(response.result.info)

    def test_object_exists_checksum_mismatch(self):
        client, azure_mock = _build_client()
        blob_properties = mock.Mock(spec=blob.BlobProperties)
        blob_properties.name = 'k'
        blob_properties.size = 1
        blob_properties.content_settings = mock.Mock(content_md5=b'\xab')
        blob_properties.last_modified = None
        blob_client = mock.Mock(spec=blob.BlobClient)
        blob_client.get_blob_properties.return_value = blob_properties
        azure_mock.get_blob_client.return_value = blob_client

        response = client.object_exists('bucket', 'k', checksum='nope')

        self.assertFalse(response.result.exists)

    def test_object_exists_false_when_not_found(self):
        client, azure_mock = _build_client()
        blob_client = mock.Mock(spec=blob.BlobClient)
        blob_client.get_blob_properties.side_effect = exceptions.ResourceNotFoundError(
            'gone',
        )
        azure_mock.get_blob_client.return_value = blob_client

        response = client.object_exists('bucket', 'missing')

        self.assertFalse(response.result.exists)
        self.assertIsNone(response.result.info)

    def test_object_exists_propagates_unrelated_storage_error(self):
        client, azure_mock = _build_client()
        # Cause get_object_info to raise OSMODataStorageClientError NOT
        # caused by ResourceNotFoundError.
        blob_client = mock.Mock(spec=blob.BlobClient)
        blob_client.get_blob_properties.side_effect = exceptions.AzureError(
            'transient',
        )
        azure_mock.get_blob_client.return_value = blob_client

        with self.assertRaises(core_client.OSMODataStorageClientError):
            client.object_exists('bucket', 'k')


class AzureBlobStorageClientGetObjectTest(unittest.TestCase):
    """Tests for AzureBlobStorageClient.get_object()."""

    def test_length_without_offset_raises(self):
        client, _ = _build_client()
        with self.assertRaises(core_client.OSMODataStorageClientError):
            client.get_object('bucket', 'k', length=10)

    def test_get_object_returns_resumable_stream(self):
        client, azure_mock = _build_client()
        blob_properties = mock.Mock(spec=blob.BlobProperties)
        blob_properties.name = 'k'
        blob_properties.size = 10
        blob_properties.content_settings = mock.Mock(content_md5=None)
        blob_properties.last_modified = None
        blob_client = mock.Mock(spec=blob.BlobClient)
        blob_client.get_blob_properties.return_value = blob_properties
        azure_mock.get_blob_client.return_value = blob_client

        response = client.get_object('bucket', 'k', offset=2, length=4)

        self.assertEqual(response.result.key, 'k')
        self.assertEqual(response.result.size, 10)
        self.assertIsInstance(
            response.result.body,
            azure.AzureBlobStorageResumableStream,
        )


def _make_blob_properties(name, size=10, md5=None, last_modified=None):
    bp = mock.Mock(spec=blob.BlobProperties)
    bp.name = name
    bp.size = size
    bp.content_settings = mock.Mock(content_md5=md5)
    bp.last_modified = last_modified
    return bp


def _make_blob_prefix(name):
    bp = mock.Mock(spec=blob.BlobPrefix)
    bp.name = name
    return bp


class AzureBlobStorageClientListObjectsTest(unittest.TestCase):
    """Tests for AzureBlobStorageClient.list_objects() iteration logic."""

    def test_prefix_is_object_yields_single_entry(self):
        client, azure_mock = _build_client()
        target_properties = _make_blob_properties('data/file.txt')
        blob_client = mock.Mock(spec=blob.BlobClient)
        blob_client.get_blob_properties.return_value = target_properties
        azure_mock.get_blob_client.return_value = blob_client

        response = client.list_objects('bucket', 'data/file.txt')
        items = list(response.result.objects)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].key, 'data/file.txt')

    def test_lists_blob_entries(self):
        client, azure_mock = _build_client()
        # Make the prefix-as-object check return not-found so we fall
        # through to walk_blobs.
        blob_client = mock.Mock(spec=blob.BlobClient)
        blob_client.get_blob_properties.side_effect = exceptions.ResourceNotFoundError(
            'gone',
        )
        azure_mock.get_blob_client.return_value = blob_client

        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_properties('data/a.txt', size=1),
            _make_blob_properties('data/b.txt', size=2),
        ])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects('bucket', 'data')
        items = list(response.result.objects)

        self.assertEqual([i.key for i in items], ['data/a.txt', 'data/b.txt'])

    def test_recursive_false_passes_delimiter(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects('bucket', 'data/', recursive=False)
        list(response.result.objects)

        kwargs = container_client.walk_blobs.call_args.kwargs
        self.assertEqual(kwargs['delimiter'], '/')

    def test_recursive_true_uses_empty_delimiter(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects('bucket', 'data/', recursive=True)
        list(response.result.objects)

        kwargs = container_client.walk_blobs.call_args.kwargs
        self.assertEqual(kwargs['delimiter'], '')

    def test_blob_prefix_yielded_as_directory(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_prefix('data/sub/'),
        ])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects('bucket', 'data/', recursive=False)
        items = list(response.result.objects)

        self.assertEqual(len(items), 1)
        self.assertTrue(items[0].is_directory)
        self.assertEqual(items[0].key, 'data/sub/')

    def test_blob_prefix_without_trailing_slash_normalizes(self):
        client, azure_mock = _build_client()
        prefix_no_slash = _make_blob_prefix('data/sub')
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([prefix_no_slash])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects('bucket', 'data/', recursive=False)
        items = list(response.result.objects)

        self.assertEqual(items[0].key, 'data/sub/')

    def test_start_after_skips_earlier_prefix(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_prefix('data/a/'),
            _make_blob_prefix('data/b/'),
        ])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects(
            'bucket',
            'data/',
            range_query=core_client.RangeQueryParams(start_after='data/a/'),
            recursive=False,
        )
        items = list(response.result.objects)

        self.assertEqual([i.key for i in items], ['data/b/'])

    def test_end_at_past_prefix_stops_iteration(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_prefix('data/a/'),
            _make_blob_prefix('data/z/'),
        ])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects(
            'bucket',
            'data/',
            range_query=core_client.RangeQueryParams(end_at='data/c/'),
            recursive=False,
        )
        items = list(response.result.objects)

        self.assertEqual([i.key for i in items], ['data/a/'])

    def test_end_at_exact_prefix_includes_then_stops(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_prefix('data/a/'),
            _make_blob_prefix('data/b/'),
            _make_blob_prefix('data/c/'),
        ])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects(
            'bucket',
            'data/',
            range_query=core_client.RangeQueryParams(end_at='data/b/'),
            recursive=False,
        )
        items = list(response.result.objects)

        self.assertEqual([i.key for i in items], ['data/a/', 'data/b/'])

    def test_regex_filters_prefix(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_prefix('data/keepme/'),
            _make_blob_prefix('data/skipme/'),
        ])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects(
            'bucket',
            'data/',
            regex=r'keep.*',
            recursive=False,
        )
        items = list(response.result.objects)

        self.assertEqual([i.key for i in items], ['data/keepme/'])

    def test_blob_properties_start_after_skips_earlier(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_properties('data/a.txt'),
            _make_blob_properties('data/b.txt'),
        ])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects(
            'bucket',
            'data/',
            range_query=core_client.RangeQueryParams(start_after='data/a.txt'),
        )
        items = list(response.result.objects)

        self.assertEqual([i.key for i in items], ['data/b.txt'])

    def test_blob_properties_end_at_past_stops(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_properties('data/a.txt'),
            _make_blob_properties('data/z.txt'),
        ])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects(
            'bucket',
            'data/',
            range_query=core_client.RangeQueryParams(end_at='data/c.txt'),
        )
        items = list(response.result.objects)

        self.assertEqual([i.key for i in items], ['data/a.txt'])

    def test_blob_properties_end_at_exact_includes_then_stops(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_properties('data/a.txt'),
            _make_blob_properties('data/b.txt'),
            _make_blob_properties('data/c.txt'),
        ])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects(
            'bucket',
            'data/',
            range_query=core_client.RangeQueryParams(end_at='data/b.txt'),
        )
        items = list(response.result.objects)

        self.assertEqual([i.key for i in items], ['data/a.txt', 'data/b.txt'])

    def test_blob_properties_directory_entries_skipped(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_properties('data/dir/'),
            _make_blob_properties('data/file.txt'),
        ])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects('bucket', 'data/')
        items = list(response.result.objects)

        # Trailing-slash blob is treated as a directory and skipped.
        self.assertEqual([i.key for i in items], ['data/file.txt'])

    def test_regex_filters_blob_properties(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_properties('data/keepme.txt'),
            _make_blob_properties('data/skipme.txt'),
        ])
        azure_mock.get_container_client.return_value = container_client

        response = client.list_objects(
            'bucket',
            'data/',
            regex=r'keep.*',
        )
        items = list(response.result.objects)

        self.assertEqual([i.key for i in items], ['data/keepme.txt'])

    def test_warning_logged_when_regex_matches_nothing(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_properties('data/a.txt'),
        ])
        azure_mock.get_container_client.return_value = container_client

        with self.assertLogs('src.lib.data.storage.backends.azure', 'WARNING') as logs:
            response = client.list_objects(
                'bucket',
                'data/',
                regex=r'nomatch',
            )
            list(response.result.objects)

        joined = '\n'.join(logs.output)
        self.assertIn('No entries matched regex', joined)

    def test_warning_logged_when_prefix_returns_nothing(self):
        client, azure_mock = _build_client()
        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([])
        azure_mock.get_container_client.return_value = container_client

        with self.assertLogs('src.lib.data.storage.backends.azure', 'WARNING') as logs:
            response = client.list_objects('bucket', 'empty/')
            list(response.result.objects)

        joined = '\n'.join(logs.output)
        self.assertIn('No entries found for prefix', joined)


class AzureBlobStorageClientUploadTest(unittest.TestCase):
    """Tests for AzureBlobStorageClient.upload()."""

    def test_upload_streams_file_and_returns_size(self):
        client, azure_mock = _build_client()
        blob_client = mock.Mock(spec=blob.BlobClient)
        azure_mock.get_blob_client.return_value = blob_client

        with tempfile.NamedTemporaryFile(mode='wb', delete=False) as fp:
            fp.write(b'1234')
            path = fp.name

        try:
            recorded: list[int] = []
            blob_client.upload_blob.side_effect = lambda **kw: (
                kw['progress_hook'](4, None) or None
            )

            response = client.upload(
                path,
                'bucket',
                'k',
                progress_hook=recorded.append,
            )
        finally:
            os.remove(path)

        self.assertEqual(response.result.size, 4)
        self.assertEqual(recorded, [4])

    def test_upload_failure_emits_negative_progress_and_reraises(self):
        client, azure_mock = _build_client()
        blob_client = mock.Mock(spec=blob.BlobClient)
        azure_mock.get_blob_client.return_value = blob_client

        with tempfile.NamedTemporaryFile(mode='wb', delete=False) as fp:
            fp.write(b'12345')
            path = fp.name

        recorded: list[int] = []

        def boom(**kwargs):
            kwargs['progress_hook'](3, None)
            raise exceptions.AzureError('upload failed')

        blob_client.upload_blob.side_effect = boom

        try:
            with self.assertRaises(core_client.OSMODataStorageClientError):
                client.upload(
                    path,
                    'bucket',
                    'k',
                    progress_hook=recorded.append,
                )
        finally:
            os.remove(path)

        # Progress is reported as delta. After +3 progress, the rollback
        # call progress(-amount_uploaded=-3) emits transferred=-3-3=-6.
        self.assertEqual(recorded, [3, -6])


class AzureBlobStorageClientDownloadTest(unittest.TestCase):
    """Tests for AzureBlobStorageClient.download()."""

    def test_download_writes_file_and_returns_size(self):
        client, azure_mock = _build_client()
        blob_client = mock.Mock(spec=blob.BlobClient)
        azure_mock.get_blob_client.return_value = blob_client

        downloader = mock.Mock(spec=blob.StorageStreamDownloader)

        def fake_download_blob(**kwargs):
            kwargs['progress_hook'](5, None)
            return downloader

        downloader.readinto.side_effect = lambda f: f.write(b'hello')
        blob_client.download_blob.side_effect = fake_download_blob

        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            path = tmp.name

        try:
            recorded: list[int] = []
            response = client.download(
                'bucket', 'k', path,
                progress_hook=recorded.append,
            )
            with open(path, 'rb') as read_fp:
                content = read_fp.read()
        finally:
            os.remove(path)

        self.assertEqual(response.result.size, 5)
        self.assertEqual(content, b'hello')
        self.assertEqual(recorded, [5])

    def test_download_failure_removes_partial_file(self):
        client, azure_mock = _build_client()
        blob_client = mock.Mock(spec=blob.BlobClient)
        azure_mock.get_blob_client.return_value = blob_client

        def fake_download_blob(**kwargs):
            kwargs['progress_hook'](2, None)
            raise exceptions.AzureError('download failed')

        blob_client.download_blob.side_effect = fake_download_blob

        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            path = tmp.name

        try:
            recorded: list[int] = []
            with self.assertRaises(core_client.OSMODataStorageClientError):
                client.download(
                    'bucket', 'k', path,
                    progress_hook=recorded.append,
                )
            self.assertFalse(os.path.exists(path))
        finally:
            if os.path.exists(path):
                os.remove(path)

        # Progress is reported as delta: after +2, rollback emits -2-2=-4.
        self.assertEqual(recorded, [2, -4])


class AzureBlobStorageClientCopyTest(unittest.TestCase):
    """Tests for AzureBlobStorageClient.copy()."""

    def _setup_blob_clients(self, azure_mock):
        source_blob_client = mock.Mock(spec=blob.BlobClient)
        source_blob_client.account_name = 'acct'
        source_blob_client.container_name = 'srcbucket'
        source_blob_client.blob_name = 'srckey'
        source_blob_client.url = 'https://acct.blob.core.windows.net/srcbucket/srckey'

        destination_blob_client = mock.Mock(spec=blob.BlobClient)
        destination_blob_properties = mock.Mock(spec=blob.BlobProperties)
        destination_blob_properties.size = 99
        destination_blob_client.get_blob_properties.return_value = (
            destination_blob_properties
        )

        azure_mock.get_blob_client.side_effect = [
            source_blob_client,
            destination_blob_client,
        ]
        return source_blob_client, destination_blob_client

    @mock.patch('src.lib.data.storage.backends.azure.blob.generate_blob_sas')
    def test_copy_with_static_credential_uses_account_key(self, mock_gen_sas):
        mock_gen_sas.return_value = 'sas-token-static'
        client, azure_mock = _build_client()
        _, destination_blob_client = self._setup_blob_clients(azure_mock)

        recorded: list[int] = []
        response = client.copy(
            'srcbucket', 'srckey',
            'dstbucket', 'dstkey',
            progress_hook=recorded.append,
        )

        self.assertEqual(response.result.size, 99)
        self.assertEqual(recorded, [99])
        # SAS generated with account_key (extracted from connection string).
        sas_kwargs = mock_gen_sas.call_args.kwargs
        self.assertEqual(sas_kwargs['account_key'], 'k1')
        self.assertEqual(sas_kwargs['account_name'], 'acct')
        # Destination uploads from the SAS URL.
        destination_blob_client.upload_blob_from_url.assert_called_once_with(
            'https://acct.blob.core.windows.net/srcbucket/srckey?sas-token-static',
        )

    @mock.patch('src.lib.data.storage.backends.azure.blob.generate_blob_sas')
    def test_copy_with_default_credential_uses_user_delegation_key(
        self,
        mock_gen_sas,
    ):
        mock_gen_sas.return_value = 'sas-token-delegation'
        default_cred = credentials.DefaultDataCredential(endpoint='azure://acct')
        client, azure_mock = _build_client(data_cred=default_cred)
        self._setup_blob_clients(azure_mock)
        azure_mock.get_user_delegation_key.return_value = 'udk-stub'

        client.copy('srcbucket', 'srckey', 'dstbucket', 'dstkey')

        azure_mock.get_user_delegation_key.assert_called_once()
        sas_kwargs = mock_gen_sas.call_args.kwargs
        self.assertEqual(sas_kwargs['user_delegation_key'], 'udk-stub')
        self.assertNotIn('account_key', sas_kwargs)

    def test_copy_raises_when_account_name_missing(self):
        client, azure_mock = _build_client()
        source_blob_client = mock.Mock(spec=blob.BlobClient)
        source_blob_client.account_name = None
        destination_blob_client = mock.Mock(spec=blob.BlobClient)
        azure_mock.get_blob_client.side_effect = [
            source_blob_client,
            destination_blob_client,
        ]

        # ValueError gets wrapped into OSMODataStorageClientError because it's
        # not an AzureError. Confirm a ValueError surfaces unchanged.
        with self.assertRaises(ValueError):
            client.copy('srcbucket', 'srckey', 'dstbucket', 'dstkey')


class AzureBlobStorageClientDeleteTest(unittest.TestCase):
    """Tests for AzureBlobStorageClient.delete()."""

    def test_delete_batches_objects_and_counts_successes(self):
        client, azure_mock = _build_client()
        # Make prefix-as-object lookup miss so we walk blobs.
        miss_blob_client = mock.Mock(spec=blob.BlobClient)
        miss_blob_client.get_blob_properties.side_effect = (
            exceptions.ResourceNotFoundError('gone')
        )
        azure_mock.get_blob_client.return_value = miss_blob_client

        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_properties('data/a.txt'),
            _make_blob_properties('data/b.txt'),
        ])

        ok = mock.Mock(status_code=202, reason='Accepted')
        container_client.delete_blobs.return_value = [ok, ok]
        azure_mock.get_container_client.return_value = container_client

        # Use a tiny batch size so we exercise the batch-flush branch.
        with mock.patch.dict(
            os.environ,
            {azure.OSMO_AZURE_DELETE_BLOBS_BATCH_SIZE: '1'},
        ):
            response = client.delete('bucket', 'data')

        self.assertEqual(response.result.success_count, 2)
        self.assertEqual(response.result.failures, [])
        # Batch size 1 means two separate delete_blobs calls.
        self.assertEqual(container_client.delete_blobs.call_count, 2)

    def test_delete_records_failures(self):
        client, azure_mock = _build_client()
        miss_blob_client = mock.Mock(spec=blob.BlobClient)
        miss_blob_client.get_blob_properties.side_effect = (
            exceptions.ResourceNotFoundError('gone')
        )
        azure_mock.get_blob_client.return_value = miss_blob_client

        container_client = mock.Mock()
        container_client.walk_blobs.return_value = iter([
            _make_blob_properties('data/a.txt'),
            _make_blob_properties('data/b.txt'),
        ])
        container_client.delete_blobs.return_value = [
            mock.Mock(status_code=202, reason='Accepted'),
            mock.Mock(status_code=404, reason='Not Found'),
        ]
        azure_mock.get_container_client.return_value = container_client

        response = client.delete('bucket', 'data')

        self.assertEqual(response.result.success_count, 1)
        self.assertEqual(len(response.result.failures), 1)
        self.assertEqual(response.result.failures[0].key, 'data/b.txt')
        self.assertIn('Code: 404', response.result.failures[0].message)
        self.assertIn('Not Found', response.result.failures[0].message)


class CreateClientTest(unittest.TestCase):
    """Tests for the module-level create_client() dispatcher."""

    @mock.patch('src.lib.data.storage.backends.azure.blob.BlobServiceClient')
    def test_static_credential_uses_connection_string(self, mock_blob_service):
        data_cred = credentials.StaticDataCredential(
            endpoint='azure://acct',
            access_key_id='unused',
            access_key=pydantic.SecretStr(
                'DefaultEndpointsProtocol=https;'
                'AccountName=acct;AccountKey=k1;'
                'EndpointSuffix=core.windows.net'
            ),
        )

        azure.create_client(data_cred)

        mock_blob_service.from_connection_string.assert_called_once_with(
            conn_str=(
                'DefaultEndpointsProtocol=https;'
                'AccountName=acct;AccountKey=k1;'
                'EndpointSuffix=core.windows.net'
            ),
        )

    def test_default_credential_requires_account_url(self):
        data_cred = credentials.DefaultDataCredential(endpoint='azure://acct')
        with self.assertRaises(ValueError) as ctx:
            azure.create_client(data_cred)
        self.assertIn('account_url required', str(ctx.exception))


class AzureBlobStorageClientFactoryTest(unittest.TestCase):
    """Tests for AzureBlobStorageClientFactory.create()."""

    @mock.patch('src.lib.data.storage.backends.azure.create_client')
    def test_create_passes_account_url(self, mock_create_client):
        mock_create_client.return_value = mock.Mock(spec=blob.BlobServiceClient)
        default_cred = credentials.DefaultDataCredential(endpoint='azure://acct')
        factory = azure.AzureBlobStorageClientFactory(
            data_cred=default_cred,
            account_url='https://acct.blob.core.windows.net',
        )

        result = factory.create()

        self.assertIsInstance(result, azure.AzureBlobStorageClient)
        mock_create_client.assert_called_once_with(
            default_cred,
            account_url='https://acct.blob.core.windows.net',
        )


if __name__ == '__main__':
    unittest.main()
