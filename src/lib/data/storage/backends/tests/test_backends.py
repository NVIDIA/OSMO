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
from src.lib.data.storage.credentials import credentials
from src.lib.data.storage.core import header
from src.lib.utils import osmo_errors
from src.utils.connectors import postgres


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

        data_cred = credentials.StaticDataCredential(
            endpoint='s3://test-bucket/test-key',
            access_key_id='test-access-key-id',
            access_key='test-access-key',
            region='us-east-1',
        )

        # Act
        s3_client_factory = s3_backend.client_factory(
            data_cred=data_cred,
            request_headers=request_headers,
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
        data_cred = credentials.StaticDataCredential(
            endpoint='s3://test-bucket/test-key',
            access_key_id='test-access-key-id',
            access_key='test-access-key',
            region='us-east-1',
        )

        # Act
        s3.create_client(
            data_cred=data_cred,
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

    @mock.patch(
        'src.lib.data.storage.credentials.credentials.get_static_data_credential_from_config',
        return_value=None,
    )
    def test_environment_auth_support(self, mock_get_config):
        """
        Test that S3/Azure support environment authentication while other backends do not.
        When no static credential is found in config:
        - S3 and Azure should return DefaultDataCredential
        - Other backends (Swift, GS, TOS) should raise OSMOCredentialError
        """
        # pylint: disable=unused-argument
        test_cases = [
            # Backends that support environment auth
            (
                's3://test-bucket/test-key',
                's3://test-bucket',
                True,
            ),
            (
                'azure://testaccount/testcontainer/testpath',
                'azure://testaccount',
                True,
            ),
            # Backends that do NOT support environment auth
            (
                'swift://test.example.com/AUTH_namespace/testcontainer/testpath',
                'swift://test.example.com/AUTH_namespace',
                False,
            ),
            (
                'gs://test-bucket/test-key',
                'gs://test-bucket',
                False,
            ),
            (
                'tos://tos-cn-beijing.volces.com/test-bucket/test-key',
                'tos://tos-cn-beijing.volces.com/test-bucket',
                False,
            ),
        ]

        for uri, expected_profile, supports_env_auth in test_cases:
            with self.subTest(uri=uri, supports_env_auth=supports_env_auth):
                # Arrange
                backend = backends.construct_storage_backend(uri=uri)

                if supports_env_auth:
                    # Act
                    data_cred = backend.resolved_data_credential

                    # Assert
                    self.assertIsInstance(
                        data_cred,
                        credentials.DefaultDataCredential,
                        f'{uri} should support environment auth'
                    )
                    self.assertEqual(data_cred.endpoint, expected_profile)
                else:
                    # Act & Assert
                    with self.assertRaises(osmo_errors.OSMOCredentialError) as context:
                        _ = backend.resolved_data_credential

                    self.assertIn('Data credential not found', str(context.exception))
                    self.assertIn(expected_profile, str(context.exception))


class AzureDefaultDataCredentialTest(unittest.TestCase):
    """Tests for Azure DefaultDataCredential support."""

    @mock.patch('src.lib.data.storage.backends.azure.DefaultAzureCredential')
    @mock.patch('src.lib.data.storage.backends.azure.blob.BlobServiceClient')
    def test_create_client_with_default_credential(
        self,
        mock_blob_client,
        mock_azure_cred,
    ):
        """Test create_client uses DefaultAzureCredential."""
        # Arrange
        mock_credential_instance = mock.Mock()
        mock_azure_cred.return_value = mock_credential_instance

        data_cred = credentials.DefaultDataCredential(
            endpoint='azure://mystorageaccount',
            region=None,
        )

        # Act
        azure.create_client(data_cred)

        # Assert
        mock_azure_cred.assert_called_once()
        mock_blob_client.assert_called_once_with(
            account_url='https://mystorageaccount.blob.core.windows.net',
            credential=mock_credential_instance,
        )


class ExtractStorageAccountTest(unittest.TestCase):
    """Tests for storage account extraction from endpoints."""

    def test_azure_scheme_simple(self):
        """Test extraction from simple azure:// scheme."""
        result = azure._extract_storage_account_from_endpoint('azure://mystorageaccount')
        self.assertEqual(result, 'mystorageaccount')

    def test_azure_scheme_with_container(self):
        """Test extraction from azure:// scheme with container path."""
        result = azure._extract_storage_account_from_endpoint('azure://mystorageaccount/container/path')
        self.assertEqual(result, 'mystorageaccount')

    def test_https_blob_url(self):
        """Test extraction from https blob.core.windows.net URL."""
        result = azure._extract_storage_account_from_endpoint('https://mystorageaccount.blob.core.windows.net')
        self.assertEqual(result, 'mystorageaccount')

    def test_https_blob_url_with_path(self):
        """Test extraction from https blob URL with path."""
        result = azure._extract_storage_account_from_endpoint(
            'https://mystorageaccount.blob.core.windows.net/container/blob'
        )
        self.assertEqual(result, 'mystorageaccount')

    def test_invalid_endpoint_raises(self):
        """Test that invalid endpoints raise ValueError."""
        with self.assertRaises(ValueError) as context:
            azure._extract_storage_account_from_endpoint('invalid://endpoint')
        self.assertIn('Cannot extract storage account', str(context.exception))


class ExtractAccountKeyFromConnectionStringTest(unittest.TestCase):
    """Tests for account key extraction from Azure connection strings."""

    def test_standard_connection_string(self):
        """Test extraction from standard Azure Storage connection string."""
        conn_str = (
            'DefaultEndpointsProtocol=https;'
            'AccountName=mystorageaccount;'
            'AccountKey=abc123def456ghi789;'
            'EndpointSuffix=core.windows.net'
        )
        result = azure._extract_account_key_from_connection_string(conn_str)
        self.assertEqual(result, 'abc123def456ghi789')

    def test_connection_string_with_base64_key(self):
        """Test extraction when key contains base64 characters including equals."""
        conn_str = (
            'DefaultEndpointsProtocol=https;'
            'AccountName=mystorageaccount;'
            'AccountKey=abc123+def/456==;'
            'EndpointSuffix=core.windows.net'
        )
        result = azure._extract_account_key_from_connection_string(conn_str)
        self.assertEqual(result, 'abc123+def/456==')

    def test_missing_account_key_raises(self):
        """Test that missing AccountKey raises ValueError."""
        conn_str = 'DefaultEndpointsProtocol=https;AccountName=mystorageaccount'
        with self.assertRaises(ValueError) as context:
            azure._extract_account_key_from_connection_string(conn_str)
        self.assertIn('AccountKey not found', str(context.exception))


class WorkflowConfigCredentialTest(unittest.TestCase):
    """Tests for WorkflowConfig credential type support."""

    def test_workflow_config_with_static_credential(self):
        """Test WorkflowConfig accepts StaticDataCredential."""
        static_cred = credentials.StaticDataCredential(
            endpoint='s3://bucket.io/workflows',
            access_key_id='mykey',
            access_key='mysecret',
            region='us-east-1',
        )

        # Act
        config = postgres.WorkflowConfig(
            workflow_data=postgres.DataConfig(credential=static_cred),
        )

        # Assert
        self.assertIsInstance(
            config.workflow_data.credential,
            credentials.StaticDataCredential,
        )

    def test_workflow_config_with_default_credential(self):
        """Test WorkflowConfig accepts DefaultDataCredential."""
        default_cred = credentials.DefaultDataCredential(
            endpoint='azure://mystorageaccount',
        )

        # Act
        config = postgres.WorkflowConfig(
            workflow_data=postgres.DataConfig(credential=default_cred),
            workflow_log=postgres.LogConfig(credential=default_cred),
        )

        # Assert
        self.assertIsInstance(
            config.workflow_data.credential,
            credentials.DefaultDataCredential,
        )
        self.assertIsInstance(
            config.workflow_log.credential,
            credentials.DefaultDataCredential,
        )

    def test_workflow_config_with_null_credential(self):
        """Test WorkflowConfig accepts None credential."""
        config = postgres.WorkflowConfig(
            workflow_data=postgres.DataConfig(credential=None),
        )

        # Assert
        self.assertIsNone(config.workflow_data.credential)


if __name__ == '__main__':
    unittest.main()
