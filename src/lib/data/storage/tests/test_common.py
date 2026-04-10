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
Unit tests for the storage common module.
"""

import dataclasses
import unittest
from typing import cast

from src.lib.data.storage import common
from src.lib.data.storage.core import client, executor, progress, provider


@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class _TestWorkerInput(executor.ThreadWorkerInput):
    size: int
    value: int

    def error_key(self) -> str:
        return str(self.value)


@dataclasses.dataclass(slots=True)
class _TestWorkerOutput(executor.ThreadWorkerOutput['_TestWorkerOutput']):
    total: int = 0

    def __add__(self, other: '_TestWorkerOutput' | None) -> '_TestWorkerOutput':
        return _TestWorkerOutput(total=self.total + (0 if other is None else other.total))

    def __iadd__(self, other: '_TestWorkerOutput' | None) -> '_TestWorkerOutput':
        self.total += 0 if other is None else other.total
        return self


class _TestStorageClient:
    def close(self) -> None:
        pass


@dataclasses.dataclass(frozen=True)
class _TestStorageClientFactory(provider.StorageClientFactory):
    def create(self) -> client.StorageClient:
        return cast(client.StorageClient, _TestStorageClient())


def _test_thread_worker(
    worker_input: _TestWorkerInput,
    storage_client_provider: provider.StorageClientProvider,
    progress_updater: progress.ProgressUpdater,
) -> _TestWorkerOutput:
    del storage_client_provider
    progress_updater.update(amount_change=1)
    return _TestWorkerOutput(total=worker_input.value)


def _test_worker_inputs():
    for value in [1, 2, 3]:
        yield _TestWorkerInput(size=1, value=value)


class TestCommon(unittest.TestCase):
    """
    Tests the storage common module.
    """

    def test_get_download_relative_path_no_base_path(self):
        """
        Test that the relative path is the same as the object key when no base path is provided.
        """
        self.assertEqual(
            common.get_download_relative_path('a/b/c/d/1.txt', None),
            'a/b/c/d/1.txt',
        )

    def test_get_download_relative_path_with_base_path(self):
        """
        Test that the relative path is the same as the object key when a base path is provided.
        """
        self.assertEqual(
            common.get_download_relative_path('a/b/c/d/1.txt', 'a/b/c'),
            'd/1.txt',
        )

    def test_get_download_relative_path_with_base_path_trailing_slash(self):
        """
        Test that the relative path is the same as the object key when a base path is provided
        with a trailing slash.
        """
        self.assertEqual(
            common.get_download_relative_path('a/b/c/d/1.txt', 'a/b/c/'),
            'd/1.txt',
        )

    def test_get_download_relative_path_with_base_path_same_as_object_key(self):
        """
        Test that the relative path is the base name of the object key when the base path
        is the same as the object key.
        """
        self.assertEqual(
            common.get_download_relative_path('a/b/c/d/1.txt', 'a/b/c/d/1.txt'),
            '1.txt',
        )

    def test_get_upload_relative_path_local_path(self):
        """
        Test that the relative path contains last directory of the base path when uploading locally.
        """
        self.assertEqual(
            common.get_upload_relative_path('/a/b/c/d/1.txt', '/a/b/c'),
            'c/d/1.txt',
        )

    def test_get_upload_relative_path_local_path_trailing_slash(self):
        """
        Test that the relative path contains last directory of the base path when uploading locally
        with a trailing slash.
        """
        self.assertEqual(
            common.get_upload_relative_path('/a/b/c/d/1.txt', '/a/b/c/'),
            'c/d/1.txt',
        )

    def test_get_upload_relative_path_local_path_asterisk(self):
        """
        Test that the relative path does not contain last directory of the base path when
        uploading locally with an asterisk.
        """
        self.assertEqual(
            common.get_upload_relative_path('/a/b/c/d/1.txt', '/a/b/c/*'),
            'd/1.txt',
        )

    def test_get_upload_relative_path_remote_path(self):
        """
        Test that the relative path contains last directory of the base path when
        uploading remotely.
        """
        self.assertEqual(
            common.get_upload_relative_path('a/b/c/d/1.txt', 'a/b/c'),
            'c/d/1.txt',
        )

    def test_get_upload_relative_path_remote_path_trailing_slash(self):
        """
        Test that the relative path contains last directory of the base path when
        uploading remotely with a trailing slash.
        """
        self.assertEqual(
            common.get_upload_relative_path('a/b/c/d/1.txt', 'a/b/c/'),
            'c/d/1.txt',
        )

    def test_get_upload_relative_path_remote_path_same_as_object_key(self):
        """
        Test that the relative path is the base name of the object key when the base path
        is the same as the object key.
        """
        self.assertEqual(
            common.get_upload_relative_path('a/b/c/d/1.txt', 'a/b/c/d/1.txt'),
            '1.txt',
        )

    def test_remap_destination_name_source_is_dir(self):
        """
        Test destination name remapping when the source is a directory.
        """
        self.assertEqual(
            common.remap_destination_name('a/b/c/d/1.txt', True, 'new_name'),
            'new_name/b/c/d/1.txt',
        )

    def test_remap_destination_name_source_is_file(self):
        """
        Test destination name remapping when the source is a file.
        """
        self.assertEqual(
            common.remap_destination_name('a/b/c/d/1.txt', False, 'new_name'),
            'a/b/c/d/new_name',
        )

    def test_multi_process_executor_runs_job_with_explicit_context(self):
        job_context = executor.run_job(
            thread_worker=_test_thread_worker,
            thread_worker_input_gen=_test_worker_inputs(),
            client_factory=_TestStorageClientFactory(),
            enable_progress_tracker=False,
            executor_params=executor.ExecutorParameters(
                num_processes=2,
                num_threads=1,
                num_threads_inflight_multiplier=1,
                chunk_queue_size_multiplier=1,
            ),
        )

        self.assertEqual(job_context.output.total if job_context.output else None, 6)
        self.assertEqual(job_context.errors, [])


if __name__ == '__main__':
    unittest.main()
