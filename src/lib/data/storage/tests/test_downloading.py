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
Unit tests for the storage downloading module.

Targets the public download contract (``download_objects``,
``download_worker``, ``_download_worker_input_generator``) that decides
whether a local file is accepted as an already-complete download or refetched.
The tests exercise:

- ``DownloadWorkerInput.error_key`` (identity for error reporting)
- ``DownloadParams`` model validator (exactly one source required)
- ``download_worker`` resumable-download decision: size check, etag checksum
  comparison, delete-and-refetch on mismatch, skipped-vs-transferred
  accounting, and the ``FileNotFoundError`` / ``OSError`` guards
- ``download_worker`` destination directory creation and progress hook
- ``_download_worker_input_generator`` remote-to-local path mapping, regex
  forwarding, and checksum/resume propagation
- ``download_objects`` dispatch across all three input variants,
  ``OSMOUsageError`` for empty inputs, and error wrapping into
  ``OperationError`` for both ``ExecutorError`` and generic exceptions
"""

# pylint: disable=protected-access

import contextlib
import hashlib
import os
import tempfile
import unittest
from typing import cast
from unittest import mock

import pydantic

from src.lib.data.storage import common, downloading
from src.lib.data.storage.core import client, executor, progress, provider
from src.lib.utils import osmo_errors


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


def _make_download_response(size: int = 42, retries: int = 0) -> client.APIResponse:
    return client.APIResponse(
        result=client.DownloadResponse(size=size),
        context=client.APIContext(retries=retries),
    )


def _make_list_objects_response(objects) -> client.APIResponse:
    return client.APIResponse(
        result=client.ListObjectsIteratorResponse(objects=objects),
        context=client.APIContext(retries=0),
    )


class TestDownloadWorkerInput(unittest.TestCase):
    """Tests for ``DownloadWorkerInput`` schema helpers."""

    def test_error_key_joins_container_and_source(self):
        """error_key returns '<container>/<source>' for error messages."""
        worker_input = downloading.DownloadWorkerInput(
            size=100,
            container='my-bucket',
            source='data/file.txt',
            destination='/local/file.txt',
        )

        self.assertEqual(worker_input.error_key(), 'my-bucket/data/file.txt')


class TestDownloadParamsValidator(unittest.TestCase):
    """Tests for the DownloadParams ``validate_download_sources`` wrap validator."""

    def test_no_source_raises_validation_error(self):
        """None of the three source fields provided -> validation error."""
        with self.assertRaises(pydantic.ValidationError) as raised:
            downloading.DownloadParams(
                executor_params=executor.ExecutorParameters(),
            )

        self.assertIn('Exactly one of', str(raised.exception))

    def test_multiple_sources_raises_validation_error(self):
        """Two source fields provided -> validation error."""
        download_path = downloading.DownloadPath(
            source=common.RemotePath(container='bucket', prefix='data/'),
            destination='/local',
        )

        with self.assertRaises(pydantic.ValidationError) as raised:
            downloading.DownloadParams(
                executor_params=executor.ExecutorParameters(),
                download_paths=[download_path],
                download_worker_inputs=[],
            )

        self.assertIn('Exactly one of', str(raised.exception))


class TestDownloadWorkerResume(unittest.TestCase):
    """Tests for the resumable-download decision in ``download_worker``."""

    def setUp(self):
        self.storage_client = mock.MagicMock()
        self.provider = _TestClientProvider(self.storage_client)
        self.progress_updater = progress.NoOpProgressUpdater()
        self.storage_client.download.return_value = _make_download_response(size=11)

        self.temp_dir = tempfile.TemporaryDirectory()  # pylint: disable=consider-using-with
        self.addCleanup(self.temp_dir.cleanup)

        self.contents = b'download-me'
        self.destination = os.path.join(self.temp_dir.name, 'file.txt')
        with open(self.destination, 'wb') as file_obj:
            file_obj.write(self.contents)

        # A small single-chunk file's etag is the plain md5 hexdigest.
        self.matching_checksum = hashlib.md5(self.contents).hexdigest()

    def test_resume_matching_size_and_checksum_skips_download(self):
        """Resume + size match + checksum match -> download skipped, nothing transferred."""
        worker_input = downloading.DownloadWorkerInput(
            size=len(self.contents),
            container='bucket',
            source='data/file.txt',
            destination=self.destination,
            checksum=self.matching_checksum,
            resume=True,
        )

        result = downloading.download_worker(
            worker_input,
            self.provider,
            self.progress_updater,
        )

        self.assertEqual(result.size, len(self.contents))
        self.assertEqual(result.size_transferred, 0)
        self.assertEqual(result.count, 1)
        self.assertEqual(result.count_transferred, 0)
        self.assertEqual(result.retries, 0)
        self.storage_client.download.assert_not_called()
        self.assertTrue(os.path.exists(self.destination))

    def test_resume_checksum_mismatch_deletes_local_file_and_downloads(self):
        """Resume + size match + checksum mismatch -> stale file removed and refetched."""
        worker_input = downloading.DownloadWorkerInput(
            size=len(self.contents),
            container='bucket',
            source='data/file.txt',
            destination=self.destination,
            checksum='0000000000000000000000000000dead',
            resume=True,
        )

        result = downloading.download_worker(
            worker_input,
            self.provider,
            self.progress_updater,
        )

        self.storage_client.download.assert_called_once()
        self.assertEqual(result.count_transferred, 1)
        self.assertEqual(result.size_transferred, 11)

    def test_resume_size_mismatch_deletes_truncated_file_and_downloads(self):
        """Resume + size mismatch -> truncated file removed without checksum validation."""
        worker_input = downloading.DownloadWorkerInput(
            size=len(self.contents) + 500,
            container='bucket',
            source='data/file.txt',
            destination=self.destination,
            checksum=self.matching_checksum,
            resume=True,
        )

        with mock.patch.object(downloading.utils_common, 'etag_checksum') as mock_checksum:
            downloading.download_worker(
                worker_input,
                self.provider,
                self.progress_updater,
            )

        # The size check short-circuits, so the checksum is never computed.
        mock_checksum.assert_not_called()
        self.storage_client.download.assert_called_once()

    def test_resume_missing_file_during_validation_falls_through_to_download(self):
        """Resume + file disappears after the exists check -> FileNotFoundError swallowed."""
        missing_destination = os.path.join(self.temp_dir.name, 'vanished.txt')
        worker_input = downloading.DownloadWorkerInput(
            size=len(self.contents),
            container='bucket',
            source='data/file.txt',
            destination=missing_destination,
            checksum=self.matching_checksum,
            resume=True,
        )

        with mock.patch.object(downloading.os.path, 'exists', return_value=True):
            result = downloading.download_worker(
                worker_input,
                self.provider,
                self.progress_updater,
            )

        self.storage_client.download.assert_called_once()
        self.assertEqual(result.count_transferred, 1)

    def test_resume_undeletable_file_logs_warning_and_downloads(self):
        """Resume + checksum mismatch + unremovable file -> OSError logged, download proceeds."""
        worker_input = downloading.DownloadWorkerInput(
            size=len(self.contents),
            container='bucket',
            source='data/file.txt',
            destination=self.destination,
            checksum='0000000000000000000000000000dead',
            resume=True,
        )

        with mock.patch.object(
            downloading.os,
            'remove',
            side_effect=PermissionError('read-only file system'),
        ):
            with self.assertLogs(downloading.logger, level='WARNING') as log_capture:
                result = downloading.download_worker(
                    worker_input,
                    self.provider,
                    self.progress_updater,
                )

        self.assertIn('read-only file system', '\n'.join(log_capture.output))
        self.storage_client.download.assert_called_once()
        self.assertEqual(result.count_transferred, 1)

    def test_no_resume_with_existing_file_downloads_without_validation(self):
        """resume=False + existing file -> checksum validation skipped entirely."""
        worker_input = downloading.DownloadWorkerInput(
            size=len(self.contents),
            container='bucket',
            source='data/file.txt',
            destination=self.destination,
            checksum=self.matching_checksum,
        )

        with mock.patch.object(downloading.utils_common, 'etag_checksum') as mock_checksum:
            result = downloading.download_worker(
                worker_input,
                self.provider,
                self.progress_updater,
            )

        mock_checksum.assert_not_called()
        self.assertEqual(result.count_transferred, 1)


class TestDownloadWorkerTransfer(unittest.TestCase):
    """Tests for the transfer path of ``download_worker``."""

    def setUp(self):
        self.storage_client = mock.MagicMock()
        self.provider = _TestClientProvider(self.storage_client)
        self.progress_updater = progress.NoOpProgressUpdater()

        self.temp_dir = tempfile.TemporaryDirectory()  # pylint: disable=consider-using-with
        self.addCleanup(self.temp_dir.cleanup)

    def test_missing_destination_directory_is_created(self):
        """A destination in a non-existent directory tree -> parent directories created."""
        destination = os.path.join(self.temp_dir.name, 'nested', 'deeper', 'file.txt')
        self.storage_client.download.return_value = _make_download_response(size=7)
        worker_input = downloading.DownloadWorkerInput(
            size=7,
            container='bucket',
            source='data/file.txt',
            destination=destination,
        )

        downloading.download_worker(worker_input, self.provider, self.progress_updater)

        self.assertTrue(os.path.isdir(os.path.dirname(destination)))

    def test_successful_download_returns_transfer_output(self):
        """Successful download -> retries and sizes reported from the API response."""
        destination = os.path.join(self.temp_dir.name, 'out.txt')
        self.storage_client.download.return_value = _make_download_response(size=1024, retries=3)
        worker_input = downloading.DownloadWorkerInput(
            size=1024,
            container='bucket',
            source='data/out.txt',
            destination=destination,
        )

        result = downloading.download_worker(worker_input, self.provider, self.progress_updater)

        self.assertEqual(result.retries, 3)
        self.assertEqual(result.size, 1024)
        self.assertEqual(result.size_transferred, 1024)
        self.assertEqual(result.count, 1)
        self.assertEqual(result.count_transferred, 1)

    def test_download_forwards_container_key_and_filename(self):
        """The worker input fields are forwarded to the storage client verbatim."""
        destination = os.path.join(self.temp_dir.name, 'out.txt')
        self.storage_client.download.return_value = _make_download_response(size=5)
        worker_input = downloading.DownloadWorkerInput(
            size=5,
            container='my-bucket',
            source='data/out.txt',
            destination=destination,
        )

        downloading.download_worker(worker_input, self.provider, self.progress_updater)

        call_kwargs = self.storage_client.download.call_args.kwargs
        self.assertEqual(call_kwargs['bucket'], 'my-bucket')
        self.assertEqual(call_kwargs['key'], 'data/out.txt')
        self.assertEqual(call_kwargs['filename'], destination)

    def test_progress_hook_forwards_bytes_to_progress_updater(self):
        """The progress_hook closure forwards transferred bytes to the updater."""
        destination = os.path.join(self.temp_dir.name, 'out.txt')
        self.storage_client.download.return_value = _make_download_response(size=5)
        progress_updater = mock.MagicMock()
        worker_input = downloading.DownloadWorkerInput(
            size=5,
            container='bucket',
            source='data/out.txt',
            destination=destination,
        )

        downloading.download_worker(worker_input, self.provider, progress_updater)

        progress_hook = self.storage_client.download.call_args.kwargs['progress_hook']
        progress_hook(256)

        progress_updater.update.assert_any_call(amount_change=256)


class TestDownloadWorkerInputGenerator(unittest.TestCase):
    """Tests for ``_download_worker_input_generator``."""

    def setUp(self):
        self.storage_client = mock.MagicMock()
        self.client_factory = cast(
            provider.StorageClientFactory,
            _TestClientFactory(self.storage_client),
        )

    def test_generator_maps_remote_keys_to_local_destinations(self):
        """Listed object keys are made relative to the prefix and joined to the destination."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([
            client.GetObjectInfoResponse(key='data/a.txt', size=10, checksum='aaa'),
            client.GetObjectInfoResponse(key='data/sub/b.txt', size=20, checksum='bbb'),
        ])
        download_paths = [downloading.DownloadPath(
            source=common.RemotePath(container='bucket', prefix='data/'),
            destination='/local',
        )]

        results = list(downloading._download_worker_input_generator(
            self.client_factory,
            download_paths,
            None,
            False,
        ))

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].destination, os.path.join('/local', 'a.txt'))
        self.assertEqual(results[1].destination, os.path.join('/local', 'sub', 'b.txt'))

    def test_generator_propagates_container_size_and_checksum(self):
        """Each yielded input carries the container, object size, and remote checksum."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([
            client.GetObjectInfoResponse(key='data/a.txt', size=10, checksum='aaa'),
        ])
        download_paths = [downloading.DownloadPath(
            source=common.RemotePath(container='my-bucket', prefix='data/'),
            destination='/local',
        )]

        results = list(downloading._download_worker_input_generator(
            self.client_factory,
            download_paths,
            None,
            False,
        ))

        self.assertEqual(results[0].container, 'my-bucket')
        self.assertEqual(results[0].source, 'data/a.txt')
        self.assertEqual(results[0].size, 10)
        self.assertEqual(results[0].checksum, 'aaa')

    def test_generator_propagates_resume_flag(self):
        """resume=True is threaded through to each generated worker input."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([
            client.GetObjectInfoResponse(key='data/a.txt', size=10, checksum='aaa'),
        ])
        download_paths = [downloading.DownloadPath(
            source=common.RemotePath(container='bucket', prefix='data/'),
            destination='/local',
        )]

        results = list(downloading._download_worker_input_generator(
            self.client_factory,
            download_paths,
            None,
            True,
        ))

        self.assertTrue(results[0].resume)

    def test_generator_forwards_regex_to_list_objects(self):
        """The regex filter is delegated to the storage client's list_objects call."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([])
        download_paths = [downloading.DownloadPath(
            source=common.RemotePath(container='bucket', prefix='data/'),
            destination='/local',
        )]

        results = list(downloading._download_worker_input_generator(
            self.client_factory,
            download_paths,
            r'.*\.txt$',
            False,
        ))

        self.assertEqual(results, [])
        call_kwargs = self.storage_client.list_objects.call_args.kwargs
        self.assertEqual(call_kwargs['regex'], r'.*\.txt$')
        self.assertEqual(call_kwargs['prefix'], 'data/')
        self.assertEqual(call_kwargs['bucket'], 'bucket')

    def test_generator_without_prefix_keeps_full_object_key(self):
        """No prefix -> the object key is used verbatim as the relative path."""
        self.storage_client.list_objects.return_value = _make_list_objects_response([
            client.GetObjectInfoResponse(key='data/a.txt', size=10),
        ])
        download_paths = [downloading.DownloadPath(
            source=common.RemotePath(container='bucket'),
            destination='/local',
        )]

        results = list(downloading._download_worker_input_generator(
            self.client_factory,
            download_paths,
            None,
            False,
        ))

        self.assertEqual(results[0].destination, os.path.join('/local', 'data', 'a.txt'))


class TestDownloadObjects(unittest.TestCase):
    """Tests for the ``download_objects`` public API."""

    def setUp(self):
        self.storage_client = mock.MagicMock()
        self.client_factory = cast(
            provider.StorageClientFactory,
            _TestClientFactory(self.storage_client),
        )

    def _make_params(self, **kwargs):
        return downloading.DownloadParams(
            executor_params=executor.ExecutorParameters(num_processes=1, num_threads=1),
            **kwargs,
        )

    @staticmethod
    def _make_completed_job_context() -> executor.JobContext:
        job_context: executor.JobContext
        with executor.JobContext() as job_context:
            pass
        return job_context

    @staticmethod
    def _make_worker_input() -> downloading.DownloadWorkerInput:
        return downloading.DownloadWorkerInput(
            size=1,
            container='bucket',
            source='data/a.txt',
            destination='/local/a.txt',
        )

    def test_download_paths_variant_returns_summary(self):
        """download_paths -> generator built, run_job called, DownloadSummary returned."""
        params = self._make_params(download_paths=[downloading.DownloadPath(
            source=common.RemotePath(container='bucket', prefix='data/'),
            destination='/local',
        )])

        with mock.patch.object(
            downloading.executor,
            'run_job',
            return_value=self._make_completed_job_context(),
        ) as mock_run:
            summary = downloading.download_objects(self.client_factory, params)

        mock_run.assert_called_once()
        self.assertIsInstance(summary, downloading.DownloadSummary)

    def test_worker_inputs_variant_returns_summary(self):
        """download_worker_inputs -> wrapped in a generator expression and forwarded."""
        params = self._make_params(download_worker_inputs=[self._make_worker_input()])

        with mock.patch.object(
            downloading.executor,
            'run_job',
            return_value=self._make_completed_job_context(),
        ) as mock_run:
            summary = downloading.download_objects(self.client_factory, params)

        mock_run.assert_called_once()
        self.assertIsInstance(summary, downloading.DownloadSummary)

    def test_worker_inputs_generator_variant_forwards_generator(self):
        """download_worker_inputs_generator -> its items reach run_job unchanged."""
        def _gen():
            yield self._make_worker_input()

        params = self._make_params(
            download_worker_inputs_generator=_gen(),
        )

        with mock.patch.object(
            downloading.executor,
            'run_job',
            return_value=self._make_completed_job_context(),
        ) as mock_run:
            summary = downloading.download_objects(self.client_factory, params)

        forwarded_inputs = list(mock_run.call_args.args[1])
        self.assertEqual(len(forwarded_inputs), 1)
        self.assertEqual(forwarded_inputs[0].source, 'data/a.txt')
        self.assertIsInstance(summary, downloading.DownloadSummary)

    def test_empty_download_paths_raises_osmo_usage_error(self):
        """Empty download_paths satisfies the validator but reaches the else branch."""
        params = self._make_params(download_paths=[])

        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            downloading.download_objects(self.client_factory, params)

        self.assertIn('No download worker inputs provided', str(raised.exception))

    def test_executor_error_wrapped_as_operation_error_with_job_summary(self):
        """ExecutorError from run_job -> OperationError carrying the failed job's summary."""
        params = self._make_params(download_worker_inputs=[self._make_worker_input()])
        executor_error = executor.ExecutorError(
            'boom',
            job_context=self._make_completed_job_context(),
        )

        with mock.patch.object(
            downloading.executor,
            'run_job',
            side_effect=executor_error,
        ):
            with self.assertRaises(common.OperationError) as raised:
                downloading.download_objects(self.client_factory, params)

        self.assertIn('Error downloading data', str(raised.exception))
        self.assertIsInstance(raised.exception.summary, downloading.DownloadSummary)
        self.assertIs(raised.exception.__cause__, executor_error)

    def test_generic_exception_wrapped_as_operation_error_with_failure_summary(self):
        """Non-ExecutorError from run_job -> OperationError with the failure recorded."""
        params = self._make_params(download_worker_inputs=[self._make_worker_input()])
        runtime_error = RuntimeError('unexpected')

        with mock.patch.object(
            downloading.executor,
            'run_job',
            side_effect=runtime_error,
        ):
            with self.assertRaises(common.OperationError) as raised:
                downloading.download_objects(self.client_factory, params)

        self.assertIsInstance(raised.exception.summary, downloading.DownloadSummary)
        self.assertIn('unexpected', raised.exception.summary.failures[0])
        self.assertIs(raised.exception.__cause__, runtime_error)


if __name__ == '__main__':
    unittest.main()
