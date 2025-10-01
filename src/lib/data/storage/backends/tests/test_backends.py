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
Unit tests for the storage backends module.
"""

import unittest
from typing import cast
from unittest import mock

from src.lib.data.storage.backends import backends, s3
from src.lib.data.storage.core import header


class TestBackends(unittest.TestCase):
    """
    Tests the storage backends module.
    """

    def test_s3_extra_headers(self):
        # Arrange
        s3_backend = cast(backends.S3Backend, backends.construct_storage_backend(
            uri='s3://test-bucket/test-key',
        ))

        request_headers = [
            header.ClientHeaders(headers={'x-client-header': 'test-client-header'}),
            header.UploadRequestHeaders(headers={'x-upload-header': 'test-upload-header'}),
            header.DownloadRequestHeaders(headers={'x-download-header': 'test-unsupported-header'}),
        ]

        # Act
        s3_client_factory = s3_backend.client_factory(
            access_key_id='test-access-key-id',
            access_key='test-access-key',
            request_headers=request_headers,
            region='us-east-1',
        )

        # Assert
        self.assertEqual(
            s3_client_factory.extra_headers,
            {
                'before-call.s3': {'x-client-header': 'test-client-header'},
                'before-call.s3.PutObject': {'x-upload-header': 'test-upload-header'},
                'before-call.s3.CreateMultipartUpload': {'x-upload-header': 'test-upload-header'},
                'before-call.s3.UploadPart': {'x-upload-header': 'test-upload-header'},
                'before-call.s3.CompleteMultipartUpload': {'x-upload-header': 'test-upload-header'},
            },
        )

    @mock.patch('src.lib.data.storage.backends.s3.boto3.Session')
    def test_s3_extra_headers_is_registered(self, mock_session_class):
        """
        Test that the extra headers are correctly set for the S3 backend.
        """
        # Arrange
        mock_session_instance = mock.Mock()
        mock_events = mock.Mock()
        mock_session_instance.events = mock_events
        mock_session_class.return_value = mock_session_instance

        # Mock the client creation to return a mock client
        mock_client = mock.Mock()
        mock_session_instance.client.return_value = mock_client

        extra_headers = {
            'before-call.s3': {'x-client-header': 'test-client-header'},
            'before-call.s3.PutObject': {'x-upload-header': 'test-upload-header'},
            'before-call.s3.CreateMultipartUpload': {'x-upload-header': 'test-upload-header'},
            'before-call.s3.UploadPart': {'x-upload-header': 'test-upload-header'},
            'before-call.s3.CompleteMultipartUpload': {'x-upload-header': 'test-upload-header'},
        }

        # Act
        s3.create_client(
            access_key_id='test-access-key-id',
            access_key='test-access-key',
            scheme='s3',
            extra_headers=extra_headers
        )

        # Assert
        self.assertEqual(mock_events.register.call_count, len(extra_headers))

        registered_events = [call[0][0] for call in mock_events.register.call_args_list]
        self.assertIn('before-call.s3', registered_events)
        self.assertIn('before-call.s3.PutObject', registered_events)
        self.assertIn('before-call.s3.CreateMultipartUpload', registered_events)
        self.assertIn('before-call.s3.UploadPart', registered_events)
        self.assertIn('before-call.s3.CompleteMultipartUpload', registered_events)

    def test_mismatched_backends_mutually_not_contain(self):
        """
        Test that a mismatched backend does not contain a sub path.
        """
        storage_uri_1 = 's3://test-bucket-1/test-key'
        storage_uri_2 = 's3://test-bucket-2/test-key/test-subkey'

        storage_backend_1 = backends.construct_storage_backend(storage_uri_1)
        storage_backend_2 = backends.construct_storage_backend(storage_uri_2)

        self.assertTrue(storage_backend_2 not in storage_backend_1)
        self.assertTrue(storage_backend_1 not in storage_backend_2)

    def test_container_backend_contains_sub_path(self):
        """
        Test that a container backend contains a sub path.
        """

        storage_uri_1 = 's3://test-bucket/'
        storage_uri_2 = 's3://test-bucket/test-key'

        storage_backend_1 = backends.construct_storage_backend(storage_uri_1)
        storage_backend_2 = backends.construct_storage_backend(storage_uri_2)

        self.assertTrue(storage_backend_2 in storage_backend_1)
        self.assertTrue(storage_backend_1 not in storage_backend_2)

    def test_path_backend_contains_sub_path(self):
        """
        Test that a path backend contains a sub path.
        """
        storage_uri_1 = 's3://test-bucket/test-key'
        storage_uri_2 = 's3://test-bucket/test-key/test-subkey'

        storage_backend_1 = backends.construct_storage_backend(storage_uri_1)
        storage_backend_2 = backends.construct_storage_backend(storage_uri_2)

        self.assertTrue(storage_backend_2 in storage_backend_1)
        self.assertTrue(storage_backend_1 not in storage_backend_2)


if __name__ == '__main__':
    unittest.main()
