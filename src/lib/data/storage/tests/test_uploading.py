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

Targets the branches of ``upload_worker`` (resume-skip, resume-fallthrough,
non-resume happy path, callback invocation on both response types, error
paths), ``_upload_worker_input_generator`` (regex, ``/*`` semantics,
destination remap vs. rel-path fallback), ``UploadParams.validate_upload_sources``
(the "exactly one input source" invariant), and ``upload_objects``
(dispatch across the three input variants and the two error branches).
"""

import contextlib
import os
import tempfile
import unittest
from typing import Any, cast
from unittest import mock

import pydantic

from src.lib.data.storage import common as storage_common
from src.lib.data.storage import uploading
from src.lib.data.storage.core import client, executor, progress, provider
from src.lib.utils import osmo_errors


class _FakeClientProvider:
    """Fake ``StorageClientProvider`` that yields a fixed storage client."""

    def __init__(self, storage_client: client.StorageClient):
        self._storage_client = storage_client

    @contextlib.contextmanager
    def get(self):
        yield self._storage_client


def _as_provider(storage_client: client.StorageClient) -> provider.StorageClientProvider:
    """Wrap a client in a fake provider and cast to satisfy the protocol type."""
    return cast(provider.StorageClientProvider, _FakeClientProvider(storage_client))


def _make_upload_input(
    *,
    size: int = 100,
    source: str = '/local/file',
    container: str = 'bucket',
    destination: str = 'dest/key',
    checksum: str | None = None,
    check_checksum: bool = True,
    resume: bool = False,
    callback: uploading.UploadCallbackLike | None = None,
) -> uploading.UploadWorkerInput:
    """Build an ``UploadWorkerInput`` with sensible defaults for testing."""
    return uploading.UploadWorkerInput(
        size=size,
        source=source,
        container=container,
        destination=destination,
        checksum=checksum,
        check_checksum=check_checksum,
        resume=resume,
        callback=callback,
    )


def _make_exists_response(
    exists: bool,
    retries: int = 0,
) -> client.APIResponse[client.ObjectExistsResponse]:
    return client.APIResponse(
        result=client.ObjectExistsResponse(exists=exists),
        context=client.APIContext(retries=retries),
    )


def _make_upload_response(
    size: int = 100,
    retries: int = 0,
) -> client.APIResponse[client.UploadResponse]:
    return client.APIResponse(
        result=client.UploadResponse(size=size),
        context=client.APIContext(retries=retries),
    )


def _finalized_job_context() -> executor.JobContext[Any, Any]:
    """Return a ``JobContext`` that has been entered and exited (start/end times set)."""
    job_context: executor.JobContext[Any, Any] = executor.JobContext()
    with job_context:
        pass
    return job_context


class TestUploadWorkerInputErrorKey(unittest.TestCase):
    """``UploadWorkerInput.error_key`` returns the source path."""

    def test_error_key_returns_source_path(self):
        upload_input = _make_upload_input(source='/tmp/abc.txt')

        self.assertEqual(upload_input.error_key(), '/tmp/abc.txt')


class TestValidateUploadSources(unittest.TestCase):
    """``UploadParams.validate_upload_sources`` enforces exactly-one-input."""

    def test_no_input_source_raises_validation_error(self):
        """None of the three input fields provided -> ValidationError."""
        with self.assertRaises(pydantic.ValidationError) as raised:
            uploading.UploadParams(
                executor_params=executor.ExecutorParameters(),
            )

        self.assertIn('Exactly one of', str(raised.exception))

    def test_multiple_input_sources_raises_validation_error(self):
        """Two input fields provided -> ValidationError."""
        with self.assertRaises(pydantic.ValidationError) as raised:
            uploading.UploadParams(
                executor_params=executor.ExecutorParameters(),
                upload_paths=[],
                upload_worker_inputs=[],
            )

        self.assertIn('Exactly one of', str(raised.exception))

    def test_single_input_source_succeeds(self):
        """Exactly one input field provided -> no error."""
        params = uploading.UploadParams(
            executor_params=executor.ExecutorParameters(),
            upload_worker_inputs=[],
        )

        self.assertEqual(params.upload_worker_inputs, [])


class TestUploadWorkerNonResumePath(unittest.TestCase):
    """Non-resume upload path: normal upload + optional callback + errors."""

    def setUp(self):
        self.progress_updater = progress.NoOpProgressUpdater()

    def test_non_resume_success_returns_transferred_output(self):
        """resume=False + upload success -> size/count fully transferred."""
        upload_input = _make_upload_input(resume=False)
        storage_client = mock.MagicMock(spec=client.StorageClient)
        storage_client.upload.return_value = _make_upload_response(
            size=100,
            retries=2,
        )

        output = uploading.upload_worker(
            upload_input,
            _as_provider(storage_client),
            self.progress_updater,
        )

        self.assertEqual(output.retries, 2)
        self.assertEqual(output.size, 100)
        self.assertEqual(output.size_transferred, 100)
        self.assertEqual(output.count, 1)
        self.assertEqual(output.count_transferred, 1)
        storage_client.upload.assert_called_once()
        storage_client.object_exists.assert_not_called()

    def test_non_resume_success_invokes_callback_with_upload_response(self):
        """resume=False + callback -> callback is invoked with UploadResponse result."""
        recorded = []

        def _callback(worker_input, response):
            recorded.append((worker_input, response))

        upload_input = _make_upload_input(resume=False, callback=_callback)
        storage_client = mock.MagicMock(spec=client.StorageClient)
        storage_client.upload.return_value = _make_upload_response(size=42)

        uploading.upload_worker(
            upload_input,
            _as_provider(storage_client),
            self.progress_updater,
        )

        self.assertEqual(len(recorded), 1)
        self.assertIs(recorded[0][0], upload_input)
        self.assertIsInstance(recorded[0][1], client.UploadResponse)
        self.assertEqual(recorded[0][1].size, 42)

    def test_non_resume_success_invokes_progress_hook_with_bytes_transferred(self):
        """The progress_hook passed to storage_client.upload updates the progress updater."""
        upload_input = _make_upload_input(resume=False)
        progress_updater = mock.MagicMock(spec=progress.ProgressUpdater)
        storage_client = mock.MagicMock(spec=client.StorageClient)

        def _fake_upload(**kwargs):
            kwargs['progress_hook'](50)
            return _make_upload_response(size=100)

        storage_client.upload.side_effect = _fake_upload

        uploading.upload_worker(
            upload_input,
            _as_provider(storage_client),
            progress_updater,
        )

        progress_updater.update.assert_any_call(name=upload_input.source)
        progress_updater.update.assert_any_call(amount_change=50)

    def test_upload_file_not_found_raises_upload_worker_error(self):
        """storage_client.upload FileNotFoundError -> UploadWorkerError (chained)."""
        upload_input = _make_upload_input(resume=False)
        storage_client = mock.MagicMock(spec=client.StorageClient)
        storage_client.upload.side_effect = FileNotFoundError('missing')

        with self.assertRaises(uploading.UploadWorkerError) as raised:
            uploading.upload_worker(
                upload_input,
                _as_provider(storage_client),
                self.progress_updater,
            )

        self.assertIn(upload_input.source, str(raised.exception))
        self.assertIsInstance(raised.exception.__cause__, FileNotFoundError)

    def test_upload_permission_error_raises_upload_worker_error(self):
        """storage_client.upload PermissionError -> UploadWorkerError (chained)."""
        upload_input = _make_upload_input(resume=False)
        storage_client = mock.MagicMock(spec=client.StorageClient)
        storage_client.upload.side_effect = PermissionError('denied')

        with self.assertRaises(uploading.UploadWorkerError) as raised:
            uploading.upload_worker(
                upload_input,
                _as_provider(storage_client),
                self.progress_updater,
            )

        self.assertIsInstance(raised.exception.__cause__, PermissionError)


class TestUploadWorkerResumePath(unittest.TestCase):
    """Resume path: checksum handling, skip-when-exists, and fallthrough."""

    def setUp(self):
        self.progress_updater = progress.NoOpProgressUpdater()

    def test_resume_skip_when_object_exists_returns_skipped_output(self):
        """resume + object_exists=True -> upload is skipped, size_transferred=0."""
        upload_input = _make_upload_input(
            resume=True,
            checksum='provided-checksum',
        )
        storage_client = mock.MagicMock(spec=client.StorageClient)
        storage_client.object_exists.return_value = _make_exists_response(
            exists=True,
            retries=3,
        )

        output = uploading.upload_worker(
            upload_input,
            _as_provider(storage_client),
            self.progress_updater,
        )

        self.assertEqual(output.retries, 3)
        self.assertEqual(output.size, upload_input.size)
        self.assertEqual(output.size_transferred, 0)
        self.assertEqual(output.count, 1)
        self.assertEqual(output.count_transferred, 0)
        storage_client.upload.assert_not_called()

    def test_resume_skip_uses_provided_checksum_in_object_exists_call(self):
        """A pre-computed checksum is forwarded to storage_client.object_exists."""
        upload_input = _make_upload_input(
            resume=True,
            checksum='provided-checksum',
        )
        storage_client = mock.MagicMock(spec=client.StorageClient)
        storage_client.object_exists.return_value = _make_exists_response(exists=True)

        uploading.upload_worker(
            upload_input,
            _as_provider(storage_client),
            self.progress_updater,
        )

        storage_client.object_exists.assert_called_once_with(
            bucket=upload_input.container,
            key=upload_input.destination,
            checksum='provided-checksum',
        )

    def test_resume_skip_invokes_callback_with_object_exists_response(self):
        """Skipped-upload callback receives the ObjectExistsResponse result."""
        recorded = []

        def _callback(worker_input, response):
            recorded.append((worker_input, response))

        upload_input = _make_upload_input(
            resume=True,
            checksum='c',
            callback=_callback,
        )
        storage_client = mock.MagicMock(spec=client.StorageClient)
        storage_client.object_exists.return_value = _make_exists_response(exists=True)

        uploading.upload_worker(
            upload_input,
            _as_provider(storage_client),
            self.progress_updater,
        )

        self.assertEqual(len(recorded), 1)
        self.assertIsInstance(recorded[0][1], client.ObjectExistsResponse)
        self.assertTrue(recorded[0][1].exists)

    def test_resume_recomputes_checksum_when_not_provided(self):
        """check_checksum=True + no provided checksum -> etag_checksum is called."""
        upload_input = _make_upload_input(
            resume=True,
            check_checksum=True,
            checksum=None,
        )
        storage_client = mock.MagicMock(spec=client.StorageClient)
        storage_client.object_exists.return_value = _make_exists_response(exists=True)

        with mock.patch.object(
            uploading.utils_common,
            'etag_checksum',
            return_value='computed-checksum',
        ) as mock_etag:
            uploading.upload_worker(
                upload_input,
                _as_provider(storage_client),
                self.progress_updater,
            )

        mock_etag.assert_called_once_with(upload_input.source)
        storage_client.object_exists.assert_called_once_with(
            bucket=upload_input.container,
            key=upload_input.destination,
            checksum='computed-checksum',
        )

    def test_resume_checksum_calculation_file_not_found_raises_upload_worker_error(self):
        """etag_checksum FileNotFoundError -> UploadWorkerError (chained)."""
        upload_input = _make_upload_input(
            resume=True,
            check_checksum=True,
            checksum=None,
        )
        storage_client = mock.MagicMock(spec=client.StorageClient)

        with mock.patch.object(
            uploading.utils_common,
            'etag_checksum',
            side_effect=FileNotFoundError('nope'),
        ):
            with self.assertRaises(uploading.UploadWorkerError) as raised:
                uploading.upload_worker(
                    upload_input,
                    _as_provider(storage_client),
                    self.progress_updater,
                )

        self.assertIn(upload_input.source, str(raised.exception))
        self.assertIsInstance(raised.exception.__cause__, FileNotFoundError)
        storage_client.object_exists.assert_not_called()

    def test_resume_falls_through_to_upload_when_object_does_not_exist(self):
        """resume + object_exists=False -> proceeds to normal upload path."""
        upload_input = _make_upload_input(
            resume=True,
            checksum='provided-checksum',
        )
        storage_client = mock.MagicMock(spec=client.StorageClient)
        storage_client.object_exists.return_value = _make_exists_response(exists=False)
        storage_client.upload.return_value = _make_upload_response(size=100)

        output = uploading.upload_worker(
            upload_input,
            _as_provider(storage_client),
            self.progress_updater,
        )

        self.assertEqual(output.count_transferred, 1)
        self.assertEqual(output.size_transferred, 100)
        storage_client.object_exists.assert_called_once()
        storage_client.upload.assert_called_once()


class TestUploadWorkerInputGenerator(unittest.TestCase):
    """``_upload_worker_input_generator`` maps ``UploadPath`` to worker inputs."""

    def test_generator_yields_worker_input_using_rel_path_when_no_name(self):
        """No remote_path.name -> destination = prefix + rel_path (from list_local_files)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, 'file.txt')
            with open(file_path, 'wb') as handle:
                handle.write(b'hello')

            upload_paths = [
                uploading.UploadPath(
                    source=file_path,
                    destination=storage_common.RemotePath(
                        container='bucket',
                        prefix='dest',
                    ),
                ),
            ]

            results = list(
                uploading._upload_worker_input_generator(  # pylint: disable=protected-access
                    upload_paths=upload_paths,
                    regex=None,
                    resume=False,
                    callback=None,
                ),
            )

            self.assertEqual(len(results), 1)
            self.assertEqual(results[0].source, file_path)
            self.assertEqual(results[0].container, 'bucket')
            self.assertEqual(results[0].destination, 'dest/file.txt')
            self.assertFalse(results[0].resume)

    def test_generator_applies_remap_destination_name_when_name_set(self):
        """remote_path.name set -> destination basename is remapped via remap_destination_name."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, 'orig.txt')
            with open(file_path, 'wb') as handle:
                handle.write(b'x')

            upload_paths = [
                uploading.UploadPath(
                    source=file_path,
                    destination=storage_common.RemotePath(
                        container='bucket',
                        prefix='dest',
                        name='renamed.txt',
                    ),
                ),
            ]

            results = list(
                uploading._upload_worker_input_generator(  # pylint: disable=protected-access
                    upload_paths=upload_paths,
                    regex=None,
                    resume=False,
                    callback=None,
                ),
            )

            self.assertEqual(len(results), 1)
            self.assertEqual(results[0].destination, 'dest/renamed.txt')

    def test_generator_strips_trailing_asterisk_from_source(self):
        """source ending in '/*' -> local_path has '/*' stripped before listing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, 'sub')
            os.makedirs(subdir)
            file_path = os.path.join(subdir, 'file.txt')
            with open(file_path, 'wb') as handle:
                handle.write(b'x')

            upload_paths = [
                uploading.UploadPath(
                    source=f'{subdir}/*',
                    destination=storage_common.RemotePath(
                        container='bucket',
                        prefix='dest',
                    ),
                ),
            ]

            results = list(
                uploading._upload_worker_input_generator(  # pylint: disable=protected-access
                    upload_paths=upload_paths,
                    regex=None,
                    resume=False,
                    callback=None,
                ),
            )

            self.assertEqual(len(results), 1)
            self.assertEqual(results[0].source, file_path)
            self.assertEqual(results[0].destination, 'dest/file.txt')

    def test_generator_forwards_resume_and_callback_to_each_input(self):
        """The generator's resume/callback params are propagated onto every yielded input."""
        recorded = []

        def _callback(worker_input, response):
            recorded.append((worker_input, response))

        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, 'file.txt')
            with open(file_path, 'wb') as handle:
                handle.write(b'x')

            upload_paths = [
                uploading.UploadPath(
                    source=file_path,
                    destination=storage_common.RemotePath(container='bucket'),
                ),
            ]

            results = list(
                uploading._upload_worker_input_generator(  # pylint: disable=protected-access
                    upload_paths=upload_paths,
                    regex=None,
                    resume=True,
                    callback=_callback,
                ),
            )

            self.assertEqual(len(results), 1)
            self.assertTrue(results[0].resume)
            self.assertIs(results[0].callback, _callback)

    def test_generator_regex_filters_files(self):
        """A regex filters out files whose relative path does not match the pattern."""
        with tempfile.TemporaryDirectory() as tmpdir:
            keep_path = os.path.join(tmpdir, 'match.txt')
            skip_path = os.path.join(tmpdir, 'skip.log')
            with open(keep_path, 'wb') as handle:
                handle.write(b'x')
            with open(skip_path, 'wb') as handle:
                handle.write(b'x')

            upload_paths = [
                uploading.UploadPath(
                    source=tmpdir,
                    destination=storage_common.RemotePath(container='bucket'),
                ),
            ]

            results = list(
                uploading._upload_worker_input_generator(  # pylint: disable=protected-access
                    upload_paths=upload_paths,
                    regex=r'.*\.txt$',
                    resume=False,
                    callback=None,
                ),
            )

            sources = [result.source for result in results]
            self.assertIn(keep_path, sources)
            self.assertNotIn(skip_path, sources)


class TestUploadObjectsDispatch(unittest.TestCase):
    """
    ``upload_objects`` dispatches across upload_paths / upload_worker_inputs /
    upload_worker_inputs_generator and propagates errors as ``OperationError``.
    """

    def setUp(self):
        self.client_factory = mock.MagicMock()

    def test_upload_objects_with_upload_paths_invokes_run_job(self):
        """upload_paths branch -> executor.run_job is called with a worker-input generator."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, 'file.txt')
            with open(file_path, 'wb') as handle:
                handle.write(b'x')

            upload_params = uploading.UploadParams(
                executor_params=executor.ExecutorParameters(),
                upload_paths=[
                    uploading.UploadPath(
                        source=file_path,
                        destination=storage_common.RemotePath(container='bucket'),
                    ),
                ],
            )

            with mock.patch.object(
                uploading.executor,
                'run_job',
                return_value=_finalized_job_context(),
            ) as mock_run_job:
                result = uploading.upload_objects(self.client_factory, upload_params)

            self.assertEqual(mock_run_job.call_count, 1)
            self.assertIsInstance(result, uploading.UploadSummary)

    def test_upload_objects_with_worker_inputs_generator_forwards_generator(self):
        """upload_worker_inputs_generator branch -> generator field is forwarded to run_job."""
        def _gen():
            yield _make_upload_input()

        upload_params = uploading.UploadParams(
            executor_params=executor.ExecutorParameters(),
            upload_worker_inputs_generator=_gen(),
        )

        with mock.patch.object(
            uploading.executor,
            'run_job',
            return_value=_finalized_job_context(),
        ) as mock_run_job:
            result = uploading.upload_objects(self.client_factory, upload_params)

        forwarded_generator = mock_run_job.call_args.args[1]
        self.assertIs(forwarded_generator, upload_params.upload_worker_inputs_generator)
        self.assertIsInstance(result, uploading.UploadSummary)

    def test_upload_objects_with_worker_inputs_list_forwards_generator_expression(self):
        """upload_worker_inputs (list) branch -> a generator over the list is passed to run_job."""
        worker_input = _make_upload_input()
        upload_params = uploading.UploadParams(
            executor_params=executor.ExecutorParameters(),
            upload_worker_inputs=[worker_input],
        )

        with mock.patch.object(
            uploading.executor,
            'run_job',
            return_value=_finalized_job_context(),
        ) as mock_run_job:
            uploading.upload_objects(self.client_factory, upload_params)

        forwarded = list(mock_run_job.call_args.args[1])
        self.assertEqual(forwarded, [worker_input])

    def test_upload_objects_with_empty_upload_paths_raises_usage_error(self):
        """Empty upload_paths (falsy but not None) falls through to the else branch."""
        upload_params = uploading.UploadParams(
            executor_params=executor.ExecutorParameters(),
            upload_paths=[],
        )

        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            uploading.upload_objects(self.client_factory, upload_params)

        self.assertIn('No upload worker inputs provided', str(raised.exception))

    def test_upload_objects_executor_error_raises_operation_error(self):
        """ExecutorError from run_job -> OperationError with summary from the job context."""
        upload_params = uploading.UploadParams(
            executor_params=executor.ExecutorParameters(),
            upload_worker_inputs=[_make_upload_input()],
        )
        job_context = _finalized_job_context()
        executor_error = executor.ExecutorError(
            'boom',
            job_context=job_context,
        )

        with mock.patch.object(
            uploading.executor,
            'run_job',
            side_effect=executor_error,
        ):
            with self.assertRaises(storage_common.OperationError) as raised:
                uploading.upload_objects(self.client_factory, upload_params)

        self.assertIn('Error uploading data', str(raised.exception))
        self.assertIsInstance(raised.exception.summary, uploading.UploadSummary)

    def test_upload_objects_unexpected_error_raises_operation_error(self):
        """A non-ExecutorError -> OperationError with a freshly-built summary."""
        upload_params = uploading.UploadParams(
            executor_params=executor.ExecutorParameters(),
            upload_worker_inputs=[_make_upload_input()],
        )

        with mock.patch.object(
            uploading.executor,
            'run_job',
            side_effect=RuntimeError('unexpected'),
        ):
            with self.assertRaises(storage_common.OperationError) as raised:
                uploading.upload_objects(self.client_factory, upload_params)

        self.assertIn('Error uploading data', str(raised.exception))
        self.assertIn('unexpected', str(raised.exception.summary.failures[0]))


if __name__ == '__main__':
    unittest.main()
