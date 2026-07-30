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
Unit tests for the storage uploading module.

Targets the public upload contract (``upload_objects``, ``upload_worker``,
``_upload_worker_input_generator``) that decides whether bytes are written to
object storage. The tests exercise:

- ``UploadWorkerInput.error_key`` (identity for error reporting)
- ``UploadParams`` model validator (exactly one source required)
- ``upload_worker`` resume/skip vs upload paths, callback dispatch, and
  read-error propagation
- ``_upload_worker_input_generator`` path remapping for files, directories,
  asterisks, regex filtering, and destination-name remapping
- ``upload_objects`` dispatch across all three input variants,
  ``OSMOUsageError`` for empty inputs, and error wrapping into
  ``OperationError`` for both ``ExecutorError`` and generic exceptions
"""

# pylint: disable=protected-access

import contextlib
import os
import tempfile
import unittest
from typing import cast
from unittest import mock

import pydantic

from src.lib.data.storage import common, uploading
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


def _make_upload_response(size: int = 42, retries: int = 0) -> client.APIResponse:
    ctx = client.APIContext(retries=retries)
    return client.APIResponse(
        result=client.UploadResponse(size=size),
        context=ctx,
    )


def _make_exists_response(exists: bool = True, retries: int = 0) -> client.APIResponse:
    ctx = client.APIContext(retries=retries)
    return client.APIResponse(
        result=client.ObjectExistsResponse(exists=exists),
        context=ctx,
    )


class TestUploadWorkerInput(unittest.TestCase):
    """Tests for ``UploadWorkerInput`` schema helpers."""

    def test_error_key_returns_source(self):
        """error_key returns the source path (used in error messages)."""
        worker_input = uploading.UploadWorkerInput(
            size=100,
            source='/local/path/file.txt',
            container='bucket',
            destination='key',
        )
        self.assertEqual(worker_input.error_key(), '/local/path/file.txt')


class TestUploadParamsValidator(unittest.TestCase):
    """Tests for the UploadParams ``validate_upload_sources`` wrap validator."""

    def test_no_source_raises_validation_error(self):
        """None of the three source fields provided -> validation error."""
        with self.assertRaises(pydantic.ValidationError) as raised:
            uploading.UploadParams(
                executor_params=executor.ExecutorParameters(),
            )
        self.assertIn('Exactly one of', str(raised.exception))

    def test_multiple_sources_raises_validation_error(self):
        """Two source fields provided -> validation error."""
        upload_path = uploading.UploadPath(
            source='/tmp/a',
            destination=common.RemotePath(container='bucket'),
        )
        with self.assertRaises(pydantic.ValidationError) as raised:
            uploading.UploadParams(
                executor_params=executor.ExecutorParameters(),
                upload_paths=[upload_path],
                upload_worker_inputs=[],
            )
        self.assertIn('Exactly one of', str(raised.exception))


class TestUploadWorkerNoResume(unittest.TestCase):
    """Tests for ``upload_worker`` in the non-resume path."""

    def setUp(self):
        self.storage_client = mock.MagicMock()
        self.provider = _TestClientProvider(self.storage_client)
        self.progress_updater = progress.NoOpProgressUpdater()

    def test_upload_worker_no_resume_success_returns_transfer_output(self):
        """Successful upload -> TransferWorkerOutput has size and count transferred."""
        self.storage_client.upload.return_value = _make_upload_response(size=42, retries=2)
        worker_input = uploading.UploadWorkerInput(
            size=42,
            source='/tmp/file',
            container='bucket',
            destination='key',
        )

        result = uploading.upload_worker(worker_input, self.provider, self.progress_updater)

        self.assertEqual(result.size, 42)
        self.assertEqual(result.size_transferred, 42)
        self.assertEqual(result.count, 1)
        self.assertEqual(result.count_transferred, 1)
        self.assertEqual(result.retries, 2)

        # Verify upload kwargs and exercise the closure-based progress_hook so
        # both the def line and its body are covered.
        call_kwargs = self.storage_client.upload.call_args.kwargs
        self.assertEqual(call_kwargs['bucket'], 'bucket')
        self.assertEqual(call_kwargs['key'], 'key')
        self.assertIn('progress_hook', call_kwargs)
        # Invoking the hook should not raise; it just forwards to progress_updater.
        call_kwargs['progress_hook'](128)

    def test_upload_worker_no_resume_invokes_callback_with_response(self):
        """Callback is invoked with the worker input and the upload response."""
        upload_response = _make_upload_response(size=42)
        self.storage_client.upload.return_value = upload_response
        callback = mock.MagicMock()
        worker_input = uploading.UploadWorkerInput(
            size=42,
            source='/tmp/file',
            container='bucket',
            destination='key',
            callback=callback,
        )

        uploading.upload_worker(worker_input, self.provider, self.progress_updater)

        callback.assert_called_once_with(worker_input, upload_response.result)

    def test_upload_worker_no_resume_file_not_found_raises_upload_worker_error(self):
        """FileNotFoundError from client.upload -> UploadWorkerError."""
        self.storage_client.upload.side_effect = FileNotFoundError('no such file')
        worker_input = uploading.UploadWorkerInput(
            size=1,
            source='/tmp/missing',
            container='bucket',
            destination='key',
        )

        with self.assertRaises(uploading.UploadWorkerError) as raised:
            uploading.upload_worker(worker_input, self.provider, self.progress_updater)

        self.assertIn('/tmp/missing', str(raised.exception))
        self.assertIn('Unable to read file to upload', str(raised.exception))

    def test_upload_worker_no_resume_permission_error_raises_upload_worker_error(self):
        """PermissionError from client.upload -> UploadWorkerError."""
        self.storage_client.upload.side_effect = PermissionError('denied')
        worker_input = uploading.UploadWorkerInput(
            size=1,
            source='/tmp/protected',
            container='bucket',
            destination='key',
        )

        with self.assertRaises(uploading.UploadWorkerError):
            uploading.upload_worker(worker_input, self.provider, self.progress_updater)


class TestUploadWorkerResume(unittest.TestCase):
    """Tests for ``upload_worker`` in the resume path (checksum + object_exists)."""

    def setUp(self):
        self.storage_client = mock.MagicMock()
        self.provider = _TestClientProvider(self.storage_client)
        self.progress_updater = progress.NoOpProgressUpdater()

    def test_upload_worker_resume_with_checksum_and_exists_skips_upload(self):
        """Resume + provided checksum + exists=True -> upload skipped, count_transferred=0."""
        self.storage_client.object_exists.return_value = _make_exists_response(exists=True)
        callback = mock.MagicMock()
        worker_input = uploading.UploadWorkerInput(
            size=100,
            source='/tmp/file',
            container='bucket',
            destination='key',
            checksum='deadbeef',
            resume=True,
            callback=callback,
        )

        result = uploading.upload_worker(worker_input, self.provider, self.progress_updater)

        self.assertEqual(result.size, 100)
        self.assertEqual(result.size_transferred, 0)
        self.assertEqual(result.count, 1)
        self.assertEqual(result.count_transferred, 0)
        self.storage_client.upload.assert_not_called()
        callback.assert_called_once()
        # The caller-provided checksum should be forwarded verbatim.
        self.assertEqual(
            self.storage_client.object_exists.call_args.kwargs['checksum'],
            'deadbeef',
        )

    def test_upload_worker_resume_no_checksum_computes_and_skips_upload(self):
        """Resume + no checksum + check_checksum=True -> compute checksum then skip if exists."""
        self.storage_client.object_exists.return_value = _make_exists_response(exists=True)

        with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
            tmp_file.write(b'contents-for-checksum')
            file_path = tmp_file.name
        try:
            worker_input = uploading.UploadWorkerInput(
                size=len(b'contents-for-checksum'),
                source=file_path,
                container='bucket',
                destination='key',
                resume=True,
            )

            result = uploading.upload_worker(worker_input, self.provider, self.progress_updater)

            self.assertEqual(result.count_transferred, 0)
            self.storage_client.upload.assert_not_called()
            # A non-None checksum was computed and passed to object_exists.
            checksum_arg = self.storage_client.object_exists.call_args.kwargs['checksum']
            self.assertIsNotNone(checksum_arg)
            self.assertGreater(len(checksum_arg), 0)
        finally:
            os.unlink(file_path)

    def test_upload_worker_resume_checksum_file_not_found_raises_worker_error(self):
        """Resume + no checksum + file missing -> UploadWorkerError (from checksum step)."""
        worker_input = uploading.UploadWorkerInput(
            size=1,
            source='/no/such/file',
            container='bucket',
            destination='key',
            resume=True,
        )

        with self.assertRaises(uploading.UploadWorkerError) as raised:
            uploading.upload_worker(worker_input, self.provider, self.progress_updater)

        self.assertIn('Unable to read file to calculate checksum', str(raised.exception))
        # Upload should never have been attempted.
        self.storage_client.upload.assert_not_called()

    def test_upload_worker_resume_exists_false_falls_through_to_upload(self):
        """Resume + exists=False -> upload proceeds normally."""
        self.storage_client.object_exists.return_value = _make_exists_response(exists=False)
        self.storage_client.upload.return_value = _make_upload_response(size=99)
        worker_input = uploading.UploadWorkerInput(
            size=99,
            source='/tmp/file',
            container='bucket',
            destination='key',
            checksum='abc',
            resume=True,
        )

        result = uploading.upload_worker(worker_input, self.provider, self.progress_updater)

        self.assertEqual(result.count_transferred, 1)
        self.assertEqual(result.size_transferred, 99)
        self.storage_client.upload.assert_called_once()


class TestUploadWorkerInputGenerator(unittest.TestCase):
    """Tests for ``_upload_worker_input_generator``."""

    def test_generator_yields_single_file_input(self):
        """A single-file source yields one UploadWorkerInput with the expected destination."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            file_path = os.path.join(tmp_dir, 'a.txt')
            with open(file_path, 'w', encoding='utf-8') as file_obj:
                file_obj.write('data')

            upload_paths = [uploading.UploadPath(
                source=file_path,
                destination=common.RemotePath(container='bucket', prefix='prefix'),
            )]

            results = list(uploading._upload_worker_input_generator(
                upload_paths=upload_paths,
                regex=None,
                resume=False,
                callback=None,
            ))

            self.assertEqual(len(results), 1)
            self.assertEqual(results[0].container, 'bucket')
            self.assertEqual(results[0].source, file_path)
            self.assertEqual(results[0].destination, os.path.join('prefix', 'a.txt'))
            self.assertFalse(results[0].resume)

    def test_generator_yields_directory_contents_with_resume_propagated(self):
        """A directory source yields inputs for each file with resume forwarded."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            for name in ('a.txt', 'b.txt'):
                with open(os.path.join(tmp_dir, name), 'w', encoding='utf-8') as file_obj:
                    file_obj.write('data')

            upload_paths = [uploading.UploadPath(
                source=tmp_dir,
                destination=common.RemotePath(container='bucket'),
            )]

            results = list(uploading._upload_worker_input_generator(
                upload_paths=upload_paths,
                regex=None,
                resume=True,
                callback=None,
            ))

            self.assertEqual(len(results), 2)
            for worker_input in results:
                self.assertTrue(worker_input.resume)

    def test_generator_regex_filters_non_matching_files(self):
        """A regex only yields inputs for files whose rel_path matches."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            for name in ('keep.txt', 'skip.log'):
                with open(os.path.join(tmp_dir, name), 'w', encoding='utf-8') as file_obj:
                    file_obj.write('data')

            upload_paths = [uploading.UploadPath(
                source=tmp_dir,
                destination=common.RemotePath(container='bucket'),
            )]

            results = list(uploading._upload_worker_input_generator(
                upload_paths=upload_paths,
                regex=r'.*\.txt$',
                resume=False,
                callback=None,
            ))

            basenames = sorted(os.path.basename(r.source) for r in results)
            self.assertEqual(basenames, ['keep.txt'])

    def test_generator_asterisk_source_strips_top_directory(self):
        """source ending in '/*' strips the top-level directory from the rel_path."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            sub_dir = os.path.join(tmp_dir, 'sub')
            os.makedirs(sub_dir)
            file_path = os.path.join(sub_dir, 'a.txt')
            with open(file_path, 'w', encoding='utf-8') as file_obj:
                file_obj.write('data')

            upload_paths = [uploading.UploadPath(
                source=tmp_dir + '/*',
                destination=common.RemotePath(container='bucket', prefix='root'),
            )]

            results = list(uploading._upload_worker_input_generator(
                upload_paths=upload_paths,
                regex=None,
                resume=False,
                callback=None,
            ))

            self.assertEqual(len(results), 1)
            # With asterisk, only 'sub/a.txt' is preserved (the tmp basename is stripped).
            self.assertEqual(results[0].destination, os.path.join('root', 'sub', 'a.txt'))

    def test_generator_destination_name_remaps_directory_first_segment(self):
        """Directory source + destination.name -> first path segment replaced."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            with open(os.path.join(tmp_dir, 'a.txt'), 'w', encoding='utf-8') as file_obj:
                file_obj.write('data')

            upload_paths = [uploading.UploadPath(
                source=tmp_dir,
                destination=common.RemotePath(
                    container='bucket',
                    prefix='p',
                    name='renamed',
                ),
            )]

            results = list(uploading._upload_worker_input_generator(
                upload_paths=upload_paths,
                regex=None,
                resume=False,
                callback=None,
            ))

            self.assertEqual(len(results), 1)
            self.assertEqual(results[0].destination, os.path.join('p', 'renamed', 'a.txt'))

    def test_generator_destination_name_remaps_file_basename(self):
        """File source + destination.name -> basename replaced with the new name."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            file_path = os.path.join(tmp_dir, 'orig.txt')
            with open(file_path, 'w', encoding='utf-8') as file_obj:
                file_obj.write('data')

            upload_paths = [uploading.UploadPath(
                source=file_path,
                destination=common.RemotePath(
                    container='bucket',
                    prefix='p',
                    name='renamed.txt',
                ),
            )]

            results = list(uploading._upload_worker_input_generator(
                upload_paths=upload_paths,
                regex=None,
                resume=False,
                callback=None,
            ))

            self.assertEqual(len(results), 1)
            self.assertEqual(results[0].destination, os.path.join('p', 'renamed.txt'))

    def test_generator_forwards_callback_to_worker_input(self):
        """The generator threads the caller-supplied callback through each UploadWorkerInput."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            file_path = os.path.join(tmp_dir, 'a.txt')
            with open(file_path, 'w', encoding='utf-8') as file_obj:
                file_obj.write('data')

            callback = mock.MagicMock()
            upload_paths = [uploading.UploadPath(
                source=file_path,
                destination=common.RemotePath(container='bucket'),
            )]

            results = list(uploading._upload_worker_input_generator(
                upload_paths=upload_paths,
                regex=None,
                resume=False,
                callback=callback,
            ))

            self.assertEqual(len(results), 1)
            self.assertIs(results[0].callback, callback)

    def test_generator_captures_list_local_files_errors_in_return_value(self):
        """When list_local_files errors, the generator drains and returns the errors list."""
        upload_paths = [uploading.UploadPath(
            source='/definitely/does/not/exist',
            destination=common.RemotePath(container='bucket'),
        )]

        gen = uploading._upload_worker_input_generator(
            upload_paths=upload_paths,
            regex=None,
            resume=False,
            callback=None,
        )

        yielded = []
        errors = None
        try:
            while True:
                yielded.append(next(gen))
        except StopIteration as stop_err:
            errors = stop_err.value

        self.assertEqual(yielded, [])
        self.assertIsNotNone(errors)
        self.assertGreater(len(errors), 0)


class TestUploadObjects(unittest.TestCase):
    """Tests for the ``upload_objects`` public API."""

    def _make_params(self, **kwargs):
        return uploading.UploadParams(
            executor_params=executor.ExecutorParameters(num_processes=1, num_threads=1),
            **kwargs,
        )

    def _make_client_factory(self):
        return mock.MagicMock(spec=provider.StorageClientFactory)

    @staticmethod
    def _make_completed_job_context() -> executor.JobContext:
        job_context: executor.JobContext
        with executor.JobContext() as job_context:
            pass
        return job_context

    def test_upload_objects_upload_paths_variant_returns_summary(self):
        """upload_paths -> generator built, run_job called, UploadSummary returned."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            file_path = os.path.join(tmp_dir, 'f')
            with open(file_path, 'w', encoding='utf-8') as file_obj:
                file_obj.write('x')

            params = self._make_params(
                upload_paths=[uploading.UploadPath(
                    source=file_path,
                    destination=common.RemotePath(container='bucket'),
                )],
            )

            job_context = self._make_completed_job_context()
            with mock.patch.object(
                uploading.executor,
                'run_job',
                return_value=job_context,
            ) as mock_run:
                summary = uploading.upload_objects(self._make_client_factory(), params)

            mock_run.assert_called_once()
            self.assertIsInstance(summary, uploading.UploadSummary)

    def test_upload_objects_worker_inputs_variant_returns_summary(self):
        """upload_worker_inputs -> wrapped in a generator expression and forwarded."""
        worker_input = uploading.UploadWorkerInput(
            size=1,
            source='/a',
            container='bucket',
            destination='k',
        )
        params = self._make_params(upload_worker_inputs=[worker_input])

        job_context = self._make_completed_job_context()
        with mock.patch.object(
            uploading.executor,
            'run_job',
            return_value=job_context,
        ) as mock_run:
            summary = uploading.upload_objects(self._make_client_factory(), params)

        mock_run.assert_called_once()
        self.assertIsInstance(summary, uploading.UploadSummary)

    def test_upload_objects_worker_inputs_generator_variant_returns_summary(self):
        """upload_worker_inputs_generator -> passed directly to run_job."""
        def _gen():
            yield uploading.UploadWorkerInput(
                size=1,
                source='/a',
                container='bucket',
                destination='k',
            )

        params = self._make_params(upload_worker_inputs_generator=_gen())

        job_context = self._make_completed_job_context()
        with mock.patch.object(
            uploading.executor,
            'run_job',
            return_value=job_context,
        ) as mock_run:
            summary = uploading.upload_objects(self._make_client_factory(), params)

        mock_run.assert_called_once()
        self.assertIsInstance(summary, uploading.UploadSummary)

    def test_upload_objects_empty_upload_paths_raises_osmo_usage_error(self):
        """Empty upload_paths (falsy but not None) satisfies the validator but
        reaches the else branch that raises OSMOUsageError."""
        params = self._make_params(upload_paths=[])

        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            uploading.upload_objects(self._make_client_factory(), params)

        self.assertIn('No upload worker inputs provided', str(raised.exception))

    def test_upload_objects_executor_error_wrapped_as_operation_error(self):
        """ExecutorError from run_job -> OperationError with the failed job's summary."""
        worker_input = uploading.UploadWorkerInput(
            size=1,
            source='/a',
            container='bucket',
            destination='k',
        )
        params = self._make_params(upload_worker_inputs=[worker_input])

        job_context = self._make_completed_job_context()
        exec_error = executor.ExecutorError('boom', job_context=job_context)

        with mock.patch.object(
            uploading.executor,
            'run_job',
            side_effect=exec_error,
        ):
            with self.assertRaises(common.OperationError) as raised:
                uploading.upload_objects(self._make_client_factory(), params)

        self.assertIsInstance(raised.exception.summary, uploading.UploadSummary)
        self.assertIs(raised.exception.__cause__, exec_error)

    def test_upload_objects_generic_exception_wrapped_as_operation_error(self):
        """Non-ExecutorError from run_job -> OperationError with a fresh summary containing
        the failure string."""
        worker_input = uploading.UploadWorkerInput(
            size=1,
            source='/a',
            container='bucket',
            destination='k',
        )
        params = self._make_params(upload_worker_inputs=[worker_input])

        runtime_error = RuntimeError('unexpected')
        with mock.patch.object(
            uploading.executor,
            'run_job',
            side_effect=runtime_error,
        ):
            with self.assertRaises(common.OperationError) as raised:
                uploading.upload_objects(self._make_client_factory(), params)

        self.assertIsInstance(raised.exception.summary, uploading.UploadSummary)
        self.assertIn('unexpected', raised.exception.summary.failures[0])
        self.assertIs(raised.exception.__cause__, runtime_error)


if __name__ == '__main__':
    unittest.main()
