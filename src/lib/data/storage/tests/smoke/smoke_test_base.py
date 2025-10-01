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
Base test class for OSMO Data Storage Client smoke tests.
"""

import collections
import json
import logging
import multiprocessing
from multiprocessing import managers
import os
import random
import shutil
import string
import tempfile
import threading
import time
from typing import List, cast
import unittest
import uuid

from src.lib.data import storage
from src.lib.data.storage import metrics
from src.lib.data.storage.core import client


logger = logging.getLogger(__name__)

TEST_STORAGE_URI_PREFIX = 'client-library/tests'


class SmokeTestBase(unittest.TestCase):
    """
    Base test class for OSMO Data Storage Client.

    In order to run this test for a given storage_uri, data credential must be configured for
    the corresponding storage backend.

    To set up data credential(s), run the following command (per storage backend):
    ```
    osmo credential set <name> \
        --type DATA \
        --payload \
        access_key_id=<access_key_id> \
        access_key=<access_key> \
        endpoint=<storage_endpoint> \
        region=<storage_region>
    ```
    """

    storage_uri: str

    test_storage_client: storage.Client

    @classmethod
    def setUpClass(cls):
        cls.test_storage_client = storage.Client.create(
            storage_uri=cls.storage_uri,
            logging_level=logging.INFO,
            executor_params=storage.ExecutorParameters(
                num_processes=2,
                num_threads=5,
            ),
            enable_progress_tracker=True,
        )

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.remote_test_folder = str(uuid.uuid4())

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def cleanup_remote_test_folder(self):
        try:
            self.test_storage_client.delete_objects(prefix=self.remote_test_folder)
        except Exception as error:  # pylint: disable=broad-except
            logging.error('Error deleting remote test folder: %s', error)

    def test_download_dir(self):
        """
        Tests downloading a directory. Asserts that we download all files in the directory.
        """
        # Arrange / Act
        results = self.test_storage_client.download_objects(self.temp_dir, source='1Mx10')

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(len(os.listdir(self.temp_dir)), 10)

    def test_download_files(self):
        """
        Tests downloading contents of a directory. Asserts that we download all files
        in the directory.
        """
        # Arrange / Act
        results = self.test_storage_client.download_objects(self.temp_dir, source='1Mx10/')

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(len(os.listdir(self.temp_dir)), 10)

    def test_download_single_file(self):
        """
        Tests downloading a single file.
        """
        # Arrange / Act
        results = self.test_storage_client.download_objects(self.temp_dir, source='1Mx10/file1')

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(os.listdir(self.temp_dir), ['file1'])

    def test_download_with_regex(self):
        """
        Tests downloading files with regex.
        """
        # Arrange / Act
        results = self.test_storage_client.download_objects(
            self.temp_dir,
            source='1Mx10/',
            regex=r'file1\d?$',
        )

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(sorted(os.listdir(self.temp_dir)), ['file1', 'file10'])

    def test_download_with_resume(self):
        """
        Tests downloading files with resume.
        """
        # Arrange
        self.test_storage_client.download_objects(
            self.temp_dir,
            source='1Mx10/',
            regex=r'file1\d?$',
        )

        # Act
        results = self.test_storage_client.download_objects(
            self.temp_dir,
            source='1Mx10/',
            regex=r'file1\d?$',
            resume=True,
        )

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(results.size_transferred, 0)
        self.assertEqual(results.count_transferred, 0)

    def test_download_nested_folder(self):
        """
        Tests downloading a nested folder.
        """
        # Arrange / Act
        results = self.test_storage_client.download_objects(self.temp_dir, source='1Mx10-nested')

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(os.listdir(self.temp_dir), ['1Mx10'])
        self.assertEqual(len(os.listdir(os.path.join(self.temp_dir, '1Mx10'))), 10)

    def test_list(self):
        """
        Tests listing the contents of a directory.
        """
        # Arrange / Act
        list_stream = self.test_storage_client.list_objects(prefix='1Mx10')

        # Assert
        self.assertEqual(len(list(list_stream)), 10)
        self.assertIsNotNone(list_stream.summary)
        self.assertEqual(cast(storage.ListSummary, list_stream.summary).count, 10)

    def test_list_non_recursive(self):
        """
        Tests listing the contents of a directory non-recursively.
        """
        # Arrange / Act
        list_stream = self.test_storage_client.list_objects(prefix='1Mx10-nested', recursive=False)
        results = list(list_stream)

        # Assert
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].key,
                         os.path.join(TEST_STORAGE_URI_PREFIX, '1Mx10-nested', '1Mx10/'))
        self.assertEqual(results[0].is_directory, True)
        self.assertIsNotNone(list_stream.summary)
        self.assertEqual(cast(storage.ListSummary, list_stream.summary).count, 1)

    def test_list_with_regex(self):
        """
        Tests listing the contents of a directory with regex.
        """
        # Arrange / Act
        list_stream = self.test_storage_client.list_objects(prefix='1Mx10', regex=r'file1\d?$')

        # Assert
        self.assertEqual(len(list(list_stream)), 2)
        self.assertIsNotNone(list_stream.summary)
        self.assertEqual(cast(storage.ListSummary, list_stream.summary).count, 2)

    def test_stream_as_bytes(self):
        """
        Tests streaming the entire file as bytes.
        """
        # Arrange
        file_name = f'{str(uuid.uuid4())}.txt'
        file_path = os.path.join(self.temp_dir, file_name)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write('test')
        self.test_storage_client.upload_objects(
            file_path,
            destination_prefix=self.remote_test_folder,
        )
        self.addCleanup(self.cleanup_remote_test_folder)

        # Act
        stream = self.test_storage_client.get_object_stream(
            f'{self.remote_test_folder}/{file_name}',
        )

        # Assert
        self.assertEqual(list(stream), [b'test'])
        self.assertIsNotNone(stream.summary)
        self.assertEqual(cast(storage.StreamSummary, stream.summary).size, 4)
        self.assertEqual(cast(storage.StreamSummary, stream.summary).lines, None)

    def test_stream_as_io(self):
        """
        Tests streaming the entire file as a file-like object.
        """
        # Arrange
        file_name = f'{str(uuid.uuid4())}.txt'
        file_path = os.path.join(self.temp_dir, file_name)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write('test')
        self.test_storage_client.upload_objects(
            file_path,
            destination_prefix=self.remote_test_folder,
        )
        self.addCleanup(self.cleanup_remote_test_folder)

        # Act
        with self.test_storage_client.get_object_stream(
            f'{self.remote_test_folder}/{file_name}',
            as_io=True,
        ) as stream_io:
            # Assert
            self.assertEqual(stream_io.read(1), b't')
            self.assertEqual(stream_io.read(), b'est')

        self.assertIsNotNone(stream_io.summary)
        self.assertEqual(cast(storage.StreamSummary, stream_io.summary).size, 4)
        self.assertEqual(cast(storage.StreamSummary, stream_io.summary).lines, None)

    def test_stream_as_lines(self):
        """
        Tests streaming the entire file.
        """
        # Arrange
        file_name = f'{str(uuid.uuid4())}.txt'
        file_path = os.path.join(self.temp_dir, file_name)
        lines = []
        with open(file_path, 'w', encoding='utf-8') as f:
            for _ in range(20):  # Generate a 20 line file
                # Each line is a random string of length between 100-200 characters
                line = ''.join(
                    random.choices(
                        string.ascii_letters + string.digits,
                        k=random.randint(100, 200),
                    ),
                ) + '\n'
                f.write(line)
                lines.append(line)
        self.test_storage_client.upload_objects(
            file_path,
            destination_prefix=self.remote_test_folder,
        )
        self.addCleanup(self.cleanup_remote_test_folder)

        # Act
        stream = self.test_storage_client.get_object_stream(
            f'{self.remote_test_folder}/{file_name}',
            as_lines=True,
        )

        # Assert
        self.assertEqual(list(stream), lines)
        self.assertIsNotNone(stream.summary)
        self.assertEqual(cast(storage.StreamSummary, stream.summary).size,
                         sum(len(line) for line in lines))
        self.assertEqual(cast(storage.StreamSummary, stream.summary).lines, len(lines))

    def test_stream_last_n_lines(self):
        """
        Tests streaming the last n lines of a file.
        """
        # Arrange
        file_name = f'{str(uuid.uuid4())}.txt'
        file_path = os.path.join(self.temp_dir, file_name)
        last_ten_lines: collections.deque[str] = collections.deque(maxlen=10)
        with open(file_path, 'w', encoding='utf-8') as f:
            for _ in range(20):  # Generate a 20 line file
                # Each line is a random string of length between 100-200 characters
                line = ''.join(
                    random.choices(
                        string.ascii_letters + string.digits,
                        k=random.randint(100, 200),
                    ),
                ) + '\n'
                f.write(line)
                last_ten_lines.append(line)
        self.test_storage_client.upload_objects(
            file_path,
            destination_prefix=self.remote_test_folder,
        )
        self.addCleanup(self.cleanup_remote_test_folder)

        # Act
        stream = self.test_storage_client.get_object_stream(
            f'{self.remote_test_folder}/{file_name}',
            last_n_lines=10,
        )
        fetched_lines = list(stream)

        # Assert
        self.assertEqual(fetched_lines, list(last_ten_lines))
        self.assertIsNotNone(stream.summary)
        self.assertEqual(cast(storage.StreamSummary, stream.summary).size,
                         sum(len(line) for line in last_ten_lines))
        self.assertEqual(cast(storage.StreamSummary, stream.summary).lines, 10)

    def test_stream_last_n_lines_greater_than_total_lines(self):
        """
        Tests streaming the last n lines of a file when n is greater than the total lines.
        """
        # Arrange
        file_name = f'{str(uuid.uuid4())}.txt'
        file_path = os.path.join(self.temp_dir, file_name)
        lines: List[str] = []
        with open(file_path, 'w', encoding='utf-8') as f:
            for i in range(20):  # Generate a 20 line file
                line = f'test-{i}\n'
                f.write(line)
                lines.append(line)
        self.test_storage_client.upload_objects(
            file_path,
            destination_prefix=self.remote_test_folder,
        )
        self.addCleanup(self.cleanup_remote_test_folder)

        # Act
        stream = self.test_storage_client.get_object_stream(
            f'{self.remote_test_folder}/{file_name}',
            last_n_lines=25,
        )
        fetched_lines = list(stream)

        # Assert
        self.assertEqual(fetched_lines, lines)
        self.assertIsNotNone(stream.summary)
        self.assertEqual(cast(storage.StreamSummary, stream.summary).size,
                         sum(len(line) for line in lines))
        self.assertEqual(cast(storage.StreamSummary, stream.summary).lines, len(lines))

    def test_delete(self):
        """
        Deletes the remote test folder. Asserts that the folder is empty.
        """
        # Arrange
        self.upload_helper()

        # Act
        self.test_storage_client.delete_objects(prefix=self.remote_test_folder)
        time.sleep(5)  # Wait a bit for deletion to propagate, deletion is not strongly consistent

        # Assert
        self.assertEqual(
            len(list(self.test_storage_client.list_objects(prefix=self.remote_test_folder))),
            0,
        )

    def test_delete_with_regex(self):
        """
        Deletes the remote test folder with regex, leaving the rest of the files intact.
        """
        # Arrange
        self.upload_helper(has_asterisk=True)

        # Act
        self.test_storage_client.delete_objects(regex=r'.*file1\d?\.txt$')

        # Assert
        self.assertEqual(
            [
                result.key
                for result in self.test_storage_client.list_objects(prefix=self.remote_test_folder)
            ],
            [
                os.path.join(TEST_STORAGE_URI_PREFIX, self.remote_test_folder, f'file{i}.txt')
                for i in range(2, 10)   # Exclude file1 and file10
            ],
        )

    def test_upload_single_file(self):
        """
        Uploads a single file to the remote test folder. Asserts that the file is uploaded.
        File path should not contain the name of the local directory.
        """
        # Arrange
        file_name = 'file1.txt'
        file_path = os.path.join(self.temp_dir, file_name)
        with open(file_path, 'w', encoding='utf-8') as file:
            file.write('test')
        self.addCleanup(self.cleanup_remote_test_folder)

        # Act
        results = self.test_storage_client.upload_objects(
            file_path,
            destination_prefix=self.remote_test_folder,
        )

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(
            list(
                result.key
                for result in self.test_storage_client.list_objects(prefix=self.remote_test_folder)
            ),
            [os.path.join(TEST_STORAGE_URI_PREFIX, self.remote_test_folder, 'file1.txt')],
        )

    def test_upload_no_asterisk(self):
        """
        Upload a directory (without asterisk) to the remote test folder.
        Asserts that the files are uploaded.
        File path should also contain the name of the local directory.
        """
        # Arrange / Act
        results = self.upload_helper()

        # Example: If temp dir is /tmp/tmp6mvihrnh, temp_dir_name is tmp6mvihrnh
        temp_dir_name = os.path.basename(self.temp_dir)

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(
            len(
                list(
                    self.test_storage_client.list_objects(
                        prefix=os.path.join(self.remote_test_folder, temp_dir_name),
                    ),
                ),
            ),
            10,
        )

    def test_upload_nested_folder(self):
        """
        Upload a nested folder to the remote test folder.
        Asserts that the files are uploaded.
        """
        # Arrange / Act
        nested_folder_name = 'nested'

        if not os.path.exists(os.path.join(self.temp_dir, nested_folder_name)):
            os.makedirs(os.path.join(self.temp_dir, nested_folder_name))

        results = self.upload_helper(nested_folder=nested_folder_name)

        temp_dir_name = os.path.basename(self.temp_dir)
        nested_remote_test_folder = os.path.join(
            self.remote_test_folder, temp_dir_name, nested_folder_name)
        obj_list = list(self.test_storage_client.list_objects(prefix=nested_remote_test_folder))

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(len(obj_list), 10)

    def test_upload_asterisk(self):
        """
        Upload a directory (with asterisk) to the remote test folder.
        Asserts that the files are uploaded.
        File path should not contain the name of the local directory.
        """
        # Arrange / Act
        results = self.upload_helper(has_asterisk=True)
        temp_dir_name = os.path.basename(self.temp_dir)

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(
            len(list(self.test_storage_client.list_objects(prefix=self.remote_test_folder))),
            10,
        )

        # Test explicitly that remote path does not contain the name of the local directory.
        self.assertEqual(
            len(
                list(
                    self.test_storage_client.list_objects(
                        prefix=os.path.join(self.remote_test_folder, temp_dir_name),
                    ),
                ),
            ),
            0,
        )

    def test_upload_with_regex(self):
        """
        Upload a directory with regex to the remote test folder.
        Asserts that matched files are uploaded.
        """
        # Arrange / Act
        results = self.upload_helper(regex=r'.*file1\d?\.txt$')
        temp_dir_name = os.path.basename(self.temp_dir)

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(
            list(
                result.key
                for result in self.test_storage_client.list_objects(prefix=self.remote_test_folder)
            ),
            [
                os.path.join(
                    TEST_STORAGE_URI_PREFIX,
                    self.remote_test_folder,
                    temp_dir_name,
                    'file1.txt',
                ),
                os.path.join(
                    TEST_STORAGE_URI_PREFIX,
                    self.remote_test_folder,
                    temp_dir_name,
                    'file10.txt',
                ),
            ],
        )

    def test_upload_with_resume(self):
        """
        Upload a directory with resume.
        """
        # Arrange
        self.upload_helper(regex=r'.*file1\d?\.txt$')

        # Act
        results = self.upload_helper(regex=r'.*file1\d?\.txt$', resume=True)

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(results.size_transferred, 0)
        self.assertEqual(results.count_transferred, 0)

    def test_upload_with_callback(self):
        """
        Upload a directory with a callback to the remote test folder.
        Asserts that the callback is called the correct number of times.
        """
        # Arrange
        with multiprocessing.Manager() as manager:
            counter = manager.Value('i', 0)
            lock = manager.Lock()
            callback = SmokeTestBase.CounterCallback(counter, lock)

            # Act
            self.upload_helper(callback=callback)

            # Assert
            self.assertEqual(callback.counter.value, 10)

    def test_upload_non_existent_local_path(self):
        # Arrange / Act
        non_existent_path = '/tmp/non_existent_path'
        results = self.test_storage_client.upload_objects(non_existent_path)

        # Assert
        self.assertEqual(len(results.failures), 1)
        self.assertIn('/tmp/non_existent_path', results.failures[0])

    def test_upload_object_with_destination_name(self):
        """
        Uploads a single file to the remote test folder with a destination name.
        """
        # Arrange
        self.addCleanup(self.cleanup_remote_test_folder)

        with tempfile.NamedTemporaryFile() as temp_file:
            temp_file.write(b'test')
            temp_file.flush()

            # Act
            results = self.test_storage_client.upload_objects(
                temp_file.name,
                destination_prefix=self.remote_test_folder,
                destination_name='new_name',
            )

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(
            [
                result.key
                for result in self.test_storage_client.list_objects(prefix=self.remote_test_folder)
            ],
            [
                os.path.join(TEST_STORAGE_URI_PREFIX, self.remote_test_folder, 'new_name'),
            ],
        )

    def test_upload_dir_with_destination_name(self):
        """
        Uploads a directory to the remote test folder with a destination name.
        """
        # Arrange
        self.addCleanup(self.cleanup_remote_test_folder)

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_file = os.path.join(temp_dir, 'file.txt')
            with open(temp_file, 'w', encoding='utf-8') as f:
                f.write('test')

            # Act
            results = self.test_storage_client.upload_objects(
                temp_dir,
                destination_prefix=self.remote_test_folder,
                destination_name='new_dir',
            )

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(
            [
                result.key
                for result in self.test_storage_client.list_objects(prefix=self.remote_test_folder)
            ],
            [
                os.path.join(
                    TEST_STORAGE_URI_PREFIX,
                    self.remote_test_folder,
                    'new_dir',
                    'file.txt',
                ),
            ],
        )

    def test_copy(self):
        """
        Copies the remote test folder to a new location.
        """
        # Arrange
        self.addCleanup(self.cleanup_remote_test_folder)

        # Act
        results = self.test_storage_client.copy_objects(
            self.remote_test_folder,
            source='1Mx10',
        )

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(
            len(list(self.test_storage_client.list_objects(prefix=self.remote_test_folder))),
            10,
        )

    def test_copy_with_resume(self):
        """
        Copies the remote test folder to a new location with resume.
        """
        # Arrange
        self.test_storage_client.copy_objects(
            self.remote_test_folder,
            source='1Mx10',
        )
        self.addCleanup(self.cleanup_remote_test_folder)

        # Act
        results = self.test_storage_client.copy_objects(
            self.remote_test_folder,
            source='1Mx10',
        )

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(results.size_transferred, 0)
        self.assertEqual(results.count_transferred, 0)

    def test_nested_copy(self):
        """
        Copies the remote test folder to a nested location.
        """
        # Arrange
        self.addCleanup(self.cleanup_remote_test_folder)

        # Act
        results = self.test_storage_client.copy_objects(
            self.remote_test_folder,
            source='1Mx10-nested/1Mx10',
        )

        nested_remote_test_folder = os.path.join(self.remote_test_folder, '1Mx10')
        obj_list = list(self.test_storage_client.list_objects(prefix=nested_remote_test_folder))

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(
            len(obj_list),
            10,
        )

    def test_copy_with_regex(self):
        """
        Copies the remote test folder to a new location with regex, only copying the files that
        match the regex.
        """
        # Arrange
        self.addCleanup(self.cleanup_remote_test_folder)

        # Act
        results = self.test_storage_client.copy_objects(
            self.remote_test_folder,
            source='1Mx10',
            regex=r'.*file1\d?$',
        )

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(
            len(list(self.test_storage_client.list_objects(prefix=self.remote_test_folder))),
            2,
        )

    def test_copy_object_with_destination_name(self):
        """
        Copies a single file to a new location with a destination name.
        """
        # Arrange
        self.addCleanup(self.cleanup_remote_test_folder)

        # Act
        results = self.test_storage_client.copy_objects(
            self.remote_test_folder,
            source='1Mx10/file1',
            destination_name='new_file',
        )

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(
            [
                result.key
                for result in self.test_storage_client.list_objects(prefix=self.remote_test_folder)
            ],
            [
                os.path.join(TEST_STORAGE_URI_PREFIX, self.remote_test_folder, 'new_file'),
            ],
        )

    def test_copy_dir_with_destination_name(self):
        """
        Copies a directory to a new location with a destination name.
        """
        # Arrange
        self.addCleanup(self.cleanup_remote_test_folder)

        # Act
        results = self.test_storage_client.copy_objects(
            self.remote_test_folder,
            source='1Mx10',
            destination_name='new_dir',
        )

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(
            sorted([
                result.key
                for result in self.test_storage_client.list_objects(
                    prefix=os.path.join(self.remote_test_folder, 'new_dir'),
                )
            ]),
            sorted([
                os.path.join(
                    TEST_STORAGE_URI_PREFIX,
                    self.remote_test_folder,
                    'new_dir',   # Dir name is remapped
                    f'file{i}',  # Filenames are not remapped
                )
                for i in range(1, 11)
            ]),
        )

    def test_operation_with_metrics(self):
        """
        Tests downloading a directory with metrics.
        Asserts that the metrics are written to the metrics directory.
        """
        # Arrange
        metrics_dir = os.path.join(self.temp_dir, 'metrics')
        os.makedirs(metrics_dir, exist_ok=True)
        download_client = storage.Client.create(
            storage_uri=self.storage_uri,
            metrics_dir=metrics_dir,
        )

        # Act
        download_client.download_objects(self.temp_dir, source='1Mx10')

        # Assert
        self.assertEqual(len(os.listdir(metrics_dir)), 1)
        for (root, _, files) in os.walk(metrics_dir):
            for file in files:
                with open(os.path.join(root, file), 'r', encoding='utf-8') as f:
                    metrics_json = json.load(f)
                    transfer_metrics = metrics.TransferMetrics(  # Validates JSON data
                        **metrics_json,
                    )
                    print(transfer_metrics)

    def upload_helper(
        self,
        *,
        nested_folder: str | None = None,
        has_asterisk: bool = False,
        regex: str | None = None,
        resume: bool = False,
        callback: storage.UploadCallback | None = None,
    ) -> storage.UploadSummary:
        """
        Uploads 10 files to the remote test folder. Asserts that the files are uploaded.
        """
        for i in range(1, 11):
            file_name = f'file{i}.txt'
            file_path = os.path.join(self.temp_dir, nested_folder or '', file_name)

            if os.path.exists(file_path):
                continue

            with open(file_path, 'w', encoding='utf-8') as f:
                f.write('test')

        self.addCleanup(self.cleanup_remote_test_folder)

        return self.test_storage_client.upload_objects(
            self.temp_dir + ('/*' if has_asterisk else ''),
            destination_prefix=self.remote_test_folder,
            regex=regex,
            resume=resume,
            callback=callback,
        )

    class CounterCallback(storage.UploadCallback):
        """
        A callback that counts the number of times it is called.
        """

        def __init__(
            self,
            counter: managers.ValueProxy[int],
            lock: threading.Lock,
        ):
            self.counter = counter
            self.lock = lock

        def __call__(
            self,
            upload_input: storage.UploadWorkerInput,
            response: client.UploadResponse | client.ObjectExistsResponse,
        ):
            # pylint: disable=unused-argument
            with self.lock:
                self.counter.value += 1


if __name__ == '__main__':
    runner = unittest.TextTestRunner(verbosity=2)
    unittest.main(testRunner=runner)
