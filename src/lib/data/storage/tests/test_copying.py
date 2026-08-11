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
Unit tests for the storage copying module.

Targets the public copy contract (``copy_objects``, ``copy_worker``,
``_copy_worker_input_generator``) that decides whether a destination object is
skipped as already present or actually transferred, and how source object keys
are remapped onto destination keys. The tests exercise:

- ``CopyWorkerInput.error_key`` (identity for error reporting)
- ``copy_worker`` resumable-copy decision: the ``object_exists`` checksum probe,
  skipped-vs-transferred size/count accounting, progress updates, and callback
  dispatch for both the skipped and the transferred branch
- ``_copy_worker_input_generator`` destination key computation: source-prefix
  relative paths, multiple source locations, regex forwarding, and the
  ``destination.name`` remapping for directory versus single-object sources
- ``copy_objects`` summary construction and error wrapping into
  ``OperationError`` for both ``ExecutorError`` and generic exceptions
"""

# pylint: disable=protected-access

import contextlib
import os
import unittest
from typing import cast
from unittest import mock

from src.lib.data.storage import common, copying
from src.lib.data.storage.core import client, executor, progress, provider


class _TestClientProvider:
    """Minimal StorageClientProvider implementation used to inject a mock client."""

    def __init__(self, storage_client):
        self._client = storage_client

    def __enter__(self) -> '_TestClientProvider':
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        return None

    def bind(self, storage_profile: str) -> '_TestClientProvider':
        del storage_profile
        return self

    def close(self) -> None:
        pass

    @contextlib.contextmanager
    def get(self):
        yield self._client

    def as_provider(self) -> provider.StorageClientProvider:
        """Return self typed as the StorageClientProvider protocol."""
        return cast(provider.StorageClientProvider, self)


class _TestClientFactory:
    """Minimal StorageClientFactory whose provider yields a mock client."""

    def __init__(self, storage_client):
        self._client = storage_client

    def create(self):
        return self._client

    def to_provider(self, pool: bool = False) -> provider.StorageClientProvider:
        del pool
        return cast(provider.StorageClientProvider, _TestClientProvider(self._client))


def _make_exists_response(exists: bool, retries: int = 0) -> client.APIResponse:
    return client.APIResponse(
        result=client.ObjectExistsResponse(exists=exists),
        context=client.APIContext(retries=retries),
    )


def _make_copy_response(size: int = 64, retries: int = 0) -> client.APIResponse:
    return client.APIResponse(
        result=client.CopyResponse(size=size),
        context=client.APIContext(retries=retries),
    )


def _make_list_objects_response(objects) -> client.APIResponse:
    return client.APIResponse(
        result=client.ListObjectsIteratorResponse(objects=objects),
        context=client.APIContext(retries=0),
    )


class TestCopyWorkerInput(unittest.TestCase):
    """Tests for ``CopyWorkerInput`` schema helpers."""

    def test_error_key_joins_source_bucket_and_source_key(self):
        """error_key returns '<source_bucket>/<source_key>' for error messages."""
        worker_input = copying.CopyWorkerInput(
            size=100,
            source_bucket='source-bucket',
            source_key='data/file.txt',
            source_checksum='abc',
            destination_bucket='destination-bucket',
            destination_key='backup/data/file.txt',
        )

        self.assertEqual(worker_input.error_key(), 'source-bucket/data/file.txt')


class TestCopyWorkerSkipped(unittest.TestCase):
    """Tests for the resumable-copy skip branch of ``copy_worker``."""

    def setUp(self):
        self.storage_client = mock.MagicMock()
        self.provider = _TestClientProvider(self.storage_client)
        self.progress_updater = progress.NoOpProgressUpdater()
        self.storage_client.object_exists.return_value = _make_exists_response(
            exists=True,
            retries=2,
        )

    @staticmethod
    def _make_worker_input(callback=None) -> copying.CopyWorkerInput:
        return copying.CopyWorkerInput(
            size=512,
            source_bucket='source-bucket',
            source_key='data/file.txt',
            source_checksum='deadbeef',
            destination_bucket='destination-bucket',
            destination_key='backup/data/file.txt',
            callback=callback,
        )

    def test_existing_destination_skips_copy_and_reports_nothing_transferred(self):
        """Destination already present with the source checksum -> copy skipped."""
        result = copying.copy_worker(
            self._make_worker_input(),
            self.provider,
            self.progress_updater,
        )

        self.assertEqual(result.size, 512)
        self.assertEqual(result.size_transferred, 0)
        self.assertEqual(result.count, 1)
        self.assertEqual(result.count_transferred, 0)
        self.assertEqual(result.retries, 2)
        self.storage_client.copy.assert_not_called()

    def test_object_exists_probes_destination_with_source_checksum(self):
        """The existence probe uses the destination coordinates and source checksum."""
        copying.copy_worker(
            self._make_worker_input(),
            self.provider,
            self.progress_updater,
        )

        call_kwargs = self.storage_client.object_exists.call_args.kwargs
        self.assertEqual(call_kwargs['bucket'], 'destination-bucket')
        self.assertEqual(call_kwargs['key'], 'backup/data/file.txt')
        self.assertEqual(call_kwargs['checksum'], 'deadbeef')

    def test_skipped_copy_credits_full_object_size_to_progress(self):
        """A skipped copy still advances progress by the whole object size."""
        progress_updater = mock.MagicMock()

        copying.copy_worker(
            self._make_worker_input(),
            self.provider,
            progress_updater,
        )

        progress_updater.update.assert_called_once_with(
            name='data/file.txt',
            amount_change=512,
        )

    def test_skipped_copy_invokes_callback_with_exists_result(self):
        """A skipped copy reports the ObjectExistsResponse to the callback."""
        callback = mock.MagicMock()
        worker_input = self._make_worker_input(callback=callback)

        copying.copy_worker(worker_input, self.provider, self.progress_updater)

        callback.assert_called_once_with(
            worker_input,
            client.ObjectExistsResponse(exists=True),
        )


class TestCopyWorkerTransfer(unittest.TestCase):
    """Tests for the transfer branch of ``copy_worker``."""

    def setUp(self):
        self.storage_client = mock.MagicMock()
        self.provider = _TestClientProvider(self.storage_client)
        self.progress_updater = progress.NoOpProgressUpdater()
        self.storage_client.object_exists.return_value = _make_exists_response(exists=False)
        self.storage_client.copy.return_value = _make_copy_response(size=1024, retries=3)

    @staticmethod
    def _make_worker_input(callback=None) -> copying.CopyWorkerInput:
        return copying.CopyWorkerInput(
            size=999,
            source_bucket='source-bucket',
            source_key='data/file.txt',
            source_checksum='deadbeef',
            destination_bucket='destination-bucket',
            destination_key='backup/data/file.txt',
            callback=callback,
        )

    def test_missing_destination_copies_and_reports_transferred_size(self):
        """Missing destination -> copy performed and accounted from the copy response."""
        result = copying.copy_worker(
            self._make_worker_input(),
            self.provider,
            self.progress_updater,
        )

        self.assertEqual(result.size, 1024)
        self.assertEqual(result.size_transferred, 1024)
        self.assertEqual(result.count, 1)
        self.assertEqual(result.count_transferred, 1)
        self.assertEqual(result.retries, 3)

    def test_copy_forwards_source_and_destination_coordinates(self):
        """The worker input coordinates are forwarded to the storage client verbatim."""
        copying.copy_worker(
            self._make_worker_input(),
            self.provider,
            self.progress_updater,
        )

        call_kwargs = self.storage_client.copy.call_args.kwargs
        self.assertEqual(call_kwargs['source_bucket'], 'source-bucket')
        self.assertEqual(call_kwargs['source_key'], 'data/file.txt')
        self.assertEqual(call_kwargs['destination_bucket'], 'destination-bucket')
        self.assertEqual(call_kwargs['destination_key'], 'backup/data/file.txt')

    def test_transferred_copy_starts_progress_entry_without_amount(self):
        """A real transfer registers the object name before any bytes are counted."""
        progress_updater = mock.MagicMock()

        copying.copy_worker(
            self._make_worker_input(),
            self.provider,
            progress_updater,
        )

        progress_updater.update.assert_any_call(name='data/file.txt')

    def test_progress_hook_forwards_bytes_to_progress_updater(self):
        """The progress_hook closure forwards transferred bytes to the updater."""
        progress_updater = mock.MagicMock()

        copying.copy_worker(
            self._make_worker_input(),
            self.provider,
            progress_updater,
        )

        progress_hook = self.storage_client.copy.call_args.kwargs['progress_hook']
        progress_hook(256)

        progress_updater.update.assert_any_call(amount_change=256)

    def test_transferred_copy_invokes_callback_with_copy_result(self):
        """A performed copy reports the CopyResponse to the callback."""
        callback = mock.MagicMock()
        worker_input = self._make_worker_input(callback=callback)

        copying.copy_worker(worker_input, self.provider, self.progress_updater)

        callback.assert_called_once_with(worker_input, client.CopyResponse(size=1024))


class TestCopyWorkerInputGenerator(unittest.TestCase):
    """Tests for ``_copy_worker_input_generator`` destination key computation."""

    def setUp(self):
        self.storage_client = mock.MagicMock()
        self.client_factory = cast(
            provider.StorageClientFactory,
            _TestClientFactory(self.storage_client),
        )

    def test_generator_keeps_source_prefix_last_segment_in_destination_key(self):
        """Listed keys stay relative to the parent of the source prefix."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([
            client.GetObjectInfoResponse(key='data/a.txt', size=10, checksum='aaa'),
            client.GetObjectInfoResponse(key='data/sub/b.txt', size=20, checksum='bbb'),
        ])

        results = list(copying._copy_worker_input_generator(
            self.client_factory,
            [common.RemotePath(container='source-bucket', prefix='data/')],
            common.RemotePath(container='destination-bucket', prefix='backup'),
        ))

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].destination_key, os.path.join('backup', 'data', 'a.txt'))
        self.assertEqual(
            results[1].destination_key,
            os.path.join('backup', 'data', 'sub', 'b.txt'),
        )

    def test_generator_propagates_buckets_size_and_checksum(self):
        """Each yielded input carries both buckets, the object size, and its checksum."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([
            client.GetObjectInfoResponse(key='data/a.txt', size=10, checksum='aaa'),
        ])

        results = list(copying._copy_worker_input_generator(
            self.client_factory,
            [common.RemotePath(container='source-bucket', prefix='data/')],
            common.RemotePath(container='destination-bucket', prefix='backup'),
        ))

        self.assertEqual(results[0].source_bucket, 'source-bucket')
        self.assertEqual(results[0].source_key, 'data/a.txt')
        self.assertEqual(results[0].source_checksum, 'aaa')
        self.assertEqual(results[0].destination_bucket, 'destination-bucket')
        self.assertEqual(results[0].size, 10)

    def test_generator_without_destination_prefix_yields_bare_relative_key(self):
        """No destination prefix -> the relative source path becomes the destination key."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([
            client.GetObjectInfoResponse(key='data/a.txt', size=10),
        ])

        results = list(copying._copy_worker_input_generator(
            self.client_factory,
            [common.RemotePath(container='source-bucket', prefix='data/')],
            common.RemotePath(container='destination-bucket'),
        ))

        self.assertEqual(results[0].destination_key, os.path.join('data', 'a.txt'))

    def test_generator_forwards_regex_and_source_location_to_list_objects(self):
        """The regex filter and source location are delegated to list_objects."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([])

        results = list(copying._copy_worker_input_generator(
            self.client_factory,
            [common.RemotePath(container='source-bucket', prefix='data/')],
            common.RemotePath(container='destination-bucket', prefix='backup'),
            r'.*\.txt$',
        ))

        self.assertEqual(results, [])
        call_kwargs = self.storage_client.list_objects.call_args.kwargs
        self.assertEqual(call_kwargs['bucket'], 'source-bucket')
        self.assertEqual(call_kwargs['prefix'], 'data/')
        self.assertEqual(call_kwargs['regex'], r'.*\.txt$')

    def test_generator_lists_every_source_location(self):
        """Two source locations -> list_objects called once per location."""
        self.storage_client.list_objects.side_effect = [
            _make_list_objects_response([
                client.GetObjectInfoResponse(key='first/a.txt', size=1),
            ]),
            _make_list_objects_response([
                client.GetObjectInfoResponse(key='second/b.txt', size=2),
            ]),
        ]

        results = list(copying._copy_worker_input_generator(
            self.client_factory,
            [
                common.RemotePath(container='source-bucket', prefix='first/'),
                common.RemotePath(container='other-bucket', prefix='second/'),
            ],
            common.RemotePath(container='destination-bucket', prefix='backup'),
        ))

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].source_bucket, 'source-bucket')
        self.assertEqual(results[1].source_bucket, 'other-bucket')
        self.assertEqual(results[1].destination_key, os.path.join('backup', 'second', 'b.txt'))

    def test_generator_directory_source_with_destination_name_replaces_first_segment(self):
        """A directory source plus destination.name renames the top-level directory."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([
            client.GetObjectInfoResponse(key='data/sub/b.txt', size=20),
        ])

        results = list(copying._copy_worker_input_generator(
            self.client_factory,
            [common.RemotePath(container='source-bucket', prefix='data/')],
            common.RemotePath(
                container='destination-bucket',
                prefix='backup',
                name='renamed',
            ),
        ))

        self.assertEqual(
            results[0].destination_key,
            os.path.join('backup', 'renamed', 'sub', 'b.txt'),
        )

    def test_generator_single_object_source_with_destination_name_replaces_basename(self):
        """A single-object source plus destination.name renames the object itself."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([
            client.GetObjectInfoResponse(key='data/file.txt', size=20),
        ])

        results = list(copying._copy_worker_input_generator(
            self.client_factory,
            [common.RemotePath(container='source-bucket', prefix='data/file.txt')],
            common.RemotePath(
                container='destination-bucket',
                prefix='backup',
                name='renamed.txt',
            ),
        ))

        self.assertEqual(results[0].destination_key, os.path.join('backup', 'renamed.txt'))

    def test_generator_trailing_separator_source_prefix_still_detects_single_object(self):
        """A trailing separator on the source prefix does not turn a file into a directory."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([
            client.GetObjectInfoResponse(key='data/file.txt', size=20),
        ])

        results = list(copying._copy_worker_input_generator(
            self.client_factory,
            [common.RemotePath(container='source-bucket', prefix='data/file.txt/')],
            common.RemotePath(
                container='destination-bucket',
                prefix='backup',
                name='renamed.txt',
            ),
        ))

        self.assertEqual(results[0].destination_key, os.path.join('backup', 'renamed.txt'))


class TestCopyObjects(unittest.TestCase):
    """Tests for the ``copy_objects`` public API."""

    def setUp(self):
        self.storage_client = mock.MagicMock()
        self.client_factory = cast(
            provider.StorageClientFactory,
            _TestClientFactory(self.storage_client),
        )
        self.storage_client.list_objects.return_value = _make_list_objects_response([])

    def _make_params(self) -> copying.CopyParams:
        return copying.CopyParams(
            executor_params=executor.ExecutorParameters(num_processes=1, num_threads=1),
            source=[common.RemotePath(container='source-bucket', prefix='data/')],
            destination=common.RemotePath(container='destination-bucket', prefix='backup'),
        )

    @staticmethod
    def _make_completed_job_context() -> executor.JobContext:
        job_context: executor.JobContext
        with executor.JobContext() as job_context:
            pass
        return job_context

    def test_copy_objects_returns_summary_from_job_context(self):
        """A successful run -> run_job invoked once and a CopySummary returned."""
        with mock.patch.object(
            copying.executor,
            'run_job',
            return_value=self._make_completed_job_context(),
        ) as mock_run:
            summary = copying.copy_objects(self.client_factory, self._make_params())

        mock_run.assert_called_once()
        self.assertIsInstance(summary, copying.CopySummary)

    def test_copy_objects_forwards_generated_worker_inputs_to_run_job(self):
        """The generator handed to run_job yields inputs built from the copy params."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([
            client.GetObjectInfoResponse(key='data/a.txt', size=10, checksum='aaa'),
        ])

        with mock.patch.object(
            copying.executor,
            'run_job',
            return_value=self._make_completed_job_context(),
        ) as mock_run:
            copying.copy_objects(self.client_factory, self._make_params())

        forwarded_inputs = list(mock_run.call_args.args[1])
        self.assertEqual(len(forwarded_inputs), 1)
        self.assertEqual(forwarded_inputs[0].source_key, 'data/a.txt')
        self.assertEqual(
            forwarded_inputs[0].destination_key,
            os.path.join('backup', 'data', 'a.txt'),
        )

    def test_executor_error_wrapped_as_operation_error_with_job_summary(self):
        """ExecutorError from run_job -> OperationError carrying the failed job's summary."""
        executor_error = executor.ExecutorError(
            'boom',
            job_context=self._make_completed_job_context(),
        )

        with mock.patch.object(copying.executor, 'run_job', side_effect=executor_error):
            with self.assertRaises(common.OperationError) as raised:
                copying.copy_objects(self.client_factory, self._make_params())

        self.assertIn('Error copying data', str(raised.exception))
        self.assertIsInstance(raised.exception.summary, copying.CopySummary)
        self.assertIs(raised.exception.__cause__, executor_error)

    def test_generic_exception_wrapped_as_operation_error_with_failure_summary(self):
        """Non-ExecutorError from run_job -> OperationError with the failure recorded."""
        runtime_error = RuntimeError('unexpected')

        with mock.patch.object(copying.executor, 'run_job', side_effect=runtime_error):
            with self.assertRaises(common.OperationError) as raised:
                copying.copy_objects(self.client_factory, self._make_params())

        self.assertIsInstance(raised.exception.summary, copying.CopySummary)
        self.assertIn('unexpected', raised.exception.summary.failures[0])
        self.assertIs(raised.exception.__cause__, runtime_error)


if __name__ == '__main__':
    unittest.main()
