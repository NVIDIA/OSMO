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

from src.lib.data.storage.backends import azure, backends, s3
from src.lib.data.storage.core import client, header
from src.lib.utils import osmo_errors


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

    def test_s3_backend_requires_access_key_id(self):
        """Test that S3 backend raises error when access_key_id is None."""
        # Arrange
        s3_backend = cast(
            backends.S3Backend,
            backends.construct_storage_backend(uri='s3://test-bucket/path'),
        )

        # Act & Assert
        with self.assertRaises(osmo_errors.OSMOCredentialError) as context:
            s3_backend.client_factory(
                access_key_id=None,
                access_key='test-secret',
            )
        self.assertIn('Access key ID', str(context.exception))

    def test_s3_backend_requires_access_key(self):
        """Test that S3 backend raises error when access_key is None."""
        # Arrange
        s3_backend = cast(
            backends.S3Backend,
            backends.construct_storage_backend(uri='s3://test-bucket/path'),
        )

        # Act & Assert
        with self.assertRaises(osmo_errors.OSMOCredentialError) as context:
            s3_backend.client_factory(
                access_key_id='test-key-id',
                access_key=None,
            )
        self.assertIn('secret access key', str(context.exception))

    def test_swift_backend_requires_credentials(self):
        """Test that Swift backend raises error when credentials are None."""
        # Arrange
        swift_backend = cast(
            backends.SwiftBackend,
            backends.construct_storage_backend(
                uri='swift://swift.example.com/AUTH_namespace/container/path'
            ),
        )

        # Act & Assert
        with self.assertRaises(osmo_errors.OSMOCredentialError) as context:
            swift_backend.client_factory(
                access_key_id=None,
                access_key=None,
            )
        self.assertIn('Access key ID', str(context.exception))

    def test_gs_backend_requires_credentials(self):
        """Test that GS backend raises error when credentials are None."""
        # Arrange
        gs_backend = cast(
            backends.GSBackend,
            backends.construct_storage_backend(uri='gs://test-bucket/path'),
        )

        # Act & Assert
        with self.assertRaises(osmo_errors.OSMOCredentialError) as context:
            gs_backend.client_factory(
                access_key_id=None,
                access_key=None,
            )
        self.assertIn('Access key ID', str(context.exception))

    def test_tos_backend_requires_credentials(self):
        """Test that TOS backend raises error when credentials are None."""
        # Arrange
        tos_backend = cast(
            backends.TOSBackend,
            backends.construct_storage_backend(uri='tos://tos-s3-us-east-1.example.com/bucket/path'),
        )

        # Act & Assert
        with self.assertRaises(osmo_errors.OSMOCredentialError) as context:
            tos_backend.client_factory(
                access_key_id=None,
                access_key=None,
            )
        self.assertIn('Access key ID', str(context.exception))


class TestAzureBackend(unittest.TestCase):
    """
    Tests for Azure Blob Storage backend.
    """

    @mock.patch('src.lib.data.storage.backends.azure.blob.BlobServiceClient')
    def test_azure_create_client_with_connection_string(self, mock_blob_client):
        """Test that create_client uses from_connection_string when connection_string provided."""
        # Arrange
        connection_string = 'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=key'

        # Act
        azure.create_client(connection_string=connection_string)

        # Assert
        mock_blob_client.from_connection_string.assert_called_once_with(
            conn_str=connection_string
        )

    @mock.patch('src.lib.data.storage.backends.azure.DefaultAzureCredential')
    @mock.patch('src.lib.data.storage.backends.azure.blob.BlobServiceClient')
    def test_azure_create_client_with_workload_identity(self, mock_blob_client, mock_credential):
        """Test that create_client uses DefaultAzureCredential when only account_url provided."""
        # Arrange
        mock_cred_instance = mock.Mock()
        mock_credential.return_value = mock_cred_instance
        account_url = 'https://myaccount.blob.core.windows.net'

        # Act
        azure.create_client(account_url=account_url)

        # Assert
        mock_credential.assert_called_once()
        mock_blob_client.assert_called_once_with(
            account_url=account_url,
            credential=mock_cred_instance,
        )

    def test_azure_create_client_no_credentials_raises_error(self):
        """Test that create_client raises error when no credentials provided."""
        # Act & Assert
        with self.assertRaises(client.OSMODataStorageClientError):
            azure.create_client()

    def test_azure_backend_client_factory_with_connection_string(self):
        """Test that Azure backend client_factory passes connection string."""
        # Arrange
        azure_backend = cast(
            backends.AzureBlobStorageBackend,
            backends.construct_storage_backend(uri='azure://mystorageaccount/mycontainer/path'),
        )
        connection_string = 'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=key'

        # Act
        factory = azure_backend.client_factory(
            access_key_id=None,
            access_key=connection_string,
        )

        # Assert
        self.assertEqual(factory.connection_string, connection_string)
        self.assertEqual(factory.account_url, azure_backend.endpoint)

    def test_azure_backend_client_factory_with_workload_identity(self):
        """Test that Azure backend client_factory works without credentials (workload identity)."""
        # Arrange
        azure_backend = cast(
            backends.AzureBlobStorageBackend,
            backends.construct_storage_backend(uri='azure://mystorageaccount/mycontainer/path'),
        )

        # Act
        factory = azure_backend.client_factory(
            access_key_id=None,
            access_key=None,
        )

        # Assert
        self.assertIsNone(factory.connection_string)
        self.assertEqual(factory.account_url, azure_backend.endpoint)

    @mock.patch('src.lib.data.storage.backends.azure.create_client')
    def test_azure_backend_data_auth_with_workload_identity(self, mock_create_client):
        """Test that Azure data_auth works with workload identity (no connection string)."""
        # Arrange
        mock_service_client = mock.Mock()
        mock_create_client.return_value.__enter__ = mock.Mock(return_value=mock_service_client)
        mock_create_client.return_value.__exit__ = mock.Mock(return_value=False)

        mock_container_client = mock.Mock()
        mock_service_client.get_container_client.return_value.__enter__ = mock.Mock(
            return_value=mock_container_client
        )
        mock_service_client.get_container_client.return_value.__exit__ = mock.Mock(
            return_value=False
        )

        azure_backend = cast(
            backends.AzureBlobStorageBackend,
            backends.construct_storage_backend(uri='azure://mystorageaccount/mycontainer/path'),
        )

        # Act
        azure_backend.data_auth(
            access_key_id=None,
            access_key=None,
        )

        # Assert
        mock_create_client.assert_called_once_with(
            connection_string=None,
            account_url=azure_backend.endpoint,
        )


if __name__ == '__main__':
    unittest.main()
