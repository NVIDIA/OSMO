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
Unit tests for the storage client module.

Targets the argument-validation paths in ``Client.create``, the
``validate_data_credential_endpoint`` model validator, and the branches of
``_validate_remote_path`` (exercised through ``Client.delete_objects``).
"""

import unittest
from unittest import mock

from src.lib.data.storage import client as client_module
from src.lib.data.storage import deleting
from src.lib.data.storage.backends import backends
from src.lib.data.storage.credentials import credentials
from src.lib.utils import osmo_errors


def _make_static_credential(endpoint: str) -> credentials.StaticDataCredential:
    """Helper that constructs a deterministic static data credential for tests."""
    return credentials.StaticDataCredential(
        endpoint=endpoint,
        access_key_id='test-access-key-id',
        access_key='test-access-key',
        region='us-east-1',
    )


class TestClientCreate(unittest.TestCase):
    """
    Tests the argument-validation paths and model validator on ``Client.create``.
    """

    def test_create_no_inputs_raises_usage_error(self):
        """All three optional inputs are None -> OSMOUsageError."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            client_module.Client.create()  # type: ignore[call-overload]

        self.assertIn(
            'One of (data_credential, storage_uri, storage_backend) must be provided',
            str(raised.exception),
        )

    def test_create_storage_uri_and_storage_backend_raises_usage_error(self):
        """Providing both storage_uri and storage_backend -> OSMOUsageError."""
        storage_backend = backends.construct_storage_backend(uri='s3://bucket/key')

        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            client_module.Client.create(  # type: ignore[call-overload]
                storage_uri='s3://bucket/key',
                storage_backend=storage_backend,
                data_credential=_make_static_credential('s3://bucket'),
            )

        self.assertIn(
            'Either storage_backend or storage_uri can be provided, not both',
            str(raised.exception),
        )

    def test_create_with_storage_uri_succeeds(self):
        """storage_uri provided -> client uses it verbatim."""
        client = client_module.Client.create(
            storage_uri='s3://bucket/path',
            data_credential=_make_static_credential('s3://bucket'),
        )

        self.assertEqual(client.storage_uri, 's3://bucket/path')

    def test_create_with_storage_backend_uses_backend_uri(self):
        """storage_backend without storage_uri -> client uses backend.uri."""
        storage_backend = backends.construct_storage_backend(uri='s3://bucket/key')

        client = client_module.Client.create(
            storage_backend=storage_backend,
            data_credential=_make_static_credential('s3://bucket'),
        )

        self.assertEqual(client.storage_uri, 's3://bucket/key')

    def test_create_with_only_data_credential_uses_credential_endpoint(self):
        """Only data_credential provided -> client uses credential.endpoint."""
        cred = _make_static_credential('s3://bucket/path')

        client = client_module.Client.create(data_credential=cred)

        self.assertEqual(client.storage_uri, 's3://bucket/path')

    def test_create_scope_to_container_uses_container_uri(self):
        """scope_to_container=True -> client uses backend.container_uri."""
        client = client_module.Client.create(
            storage_uri='s3://bucket/sub/prefix',
            data_credential=_make_static_credential('s3://bucket'),
            scope_to_container=True,
        )

        self.assertEqual(client.storage_uri, 's3://bucket')

    def test_create_credential_profile_mismatch_raises_credential_error(self):
        """Credential endpoint profile != storage URI profile -> OSMOCredentialError."""
        cred = _make_static_credential('s3://other-bucket')

        with self.assertRaises(osmo_errors.OSMOCredentialError) as raised:
            client_module.Client.create(
                storage_uri='s3://my-bucket/key',
                data_credential=cred,
            )

        self.assertIn(
            'Credential endpoint must match the storage backend profile',
            str(raised.exception),
        )

    def test_create_credential_profile_match_succeeds(self):
        """Credential endpoint profile == storage URI profile -> no validation error."""
        cred = _make_static_credential('s3://bucket')

        client = client_module.Client.create(
            storage_uri='s3://bucket/key',
            data_credential=cred,
        )

        self.assertIs(client.data_credential, cred)

    def test_create_returns_client_with_executor_params_kwarg(self):
        """Optional kwargs (e.g., metrics_dir) are forwarded to the client."""
        client = client_module.Client.create(
            storage_uri='s3://bucket/key',
            data_credential=_make_static_credential('s3://bucket'),
            metrics_dir='/tmp/metrics',
        )

        self.assertEqual(client.metrics_dir, '/tmp/metrics')


class TestValidateRemotePath(unittest.TestCase):
    """
    Exercises the branches of ``_validate_remote_path`` through the public
    ``Client.delete_objects`` API. ``delete_objects`` invokes the validation
    helper, then forwards the resolved prefix into ``deleting.delete_objects``;
    by patching that downstream call we can both observe the resolved prefix
    on the happy paths and trigger the error paths without making any real
    network/storage calls.
    """

    def setUp(self):
        # Storage URI 's3://bucket/sub' -> backend.container = 'bucket', backend.path = 'sub'.
        self.client = client_module.Client.create(
            storage_uri='s3://bucket/sub',
            data_credential=_make_static_credential('s3://bucket'),
        )

    @staticmethod
    def _build_summary_mock() -> mock.MagicMock:
        summary = mock.MagicMock(spec=deleting.DeleteSummary)
        summary.success_count = 0
        summary.failures = []
        return summary

    def test_delete_objects_with_none_prefix_uses_backend_path(self):
        """remote_path=None -> returns storage_backend.path."""
        with mock.patch.object(
            client_module.deleting,
            'delete_objects',
            return_value=self._build_summary_mock(),
        ) as mock_delete:
            self.client.delete_objects(prefix=None)

        delete_params = mock_delete.call_args[0][1]
        self.assertEqual(delete_params.prefix, 'sub')

    def test_delete_objects_with_empty_prefix_uses_backend_path(self):
        """Falsy ('' empty string) remote_path -> returns storage_backend.path."""
        with mock.patch.object(
            client_module.deleting,
            'delete_objects',
            return_value=self._build_summary_mock(),
        ) as mock_delete:
            self.client.delete_objects(prefix='')

        delete_params = mock_delete.call_args[0][1]
        self.assertEqual(delete_params.prefix, 'sub')

    def test_delete_objects_with_storage_uri_prefix_uses_backend_path(self):
        """remote_path == self.storage_uri -> returns storage_backend.path."""
        with mock.patch.object(
            client_module.deleting,
            'delete_objects',
            return_value=self._build_summary_mock(),
        ) as mock_delete:
            self.client.delete_objects(prefix='s3://bucket/sub')

        delete_params = mock_delete.call_args[0][1]
        self.assertEqual(delete_params.prefix, 'sub')

    def test_delete_objects_with_backend_path_prefix_returns_path(self):
        """remote_path == storage_backend.path -> returns the same value."""
        with mock.patch.object(
            client_module.deleting,
            'delete_objects',
            return_value=self._build_summary_mock(),
        ) as mock_delete:
            self.client.delete_objects(prefix='sub')

        delete_params = mock_delete.call_args[0][1]
        self.assertEqual(delete_params.prefix, 'sub')

    def test_delete_objects_with_relative_prefix_joins_with_backend_path(self):
        """relative remote_path -> os.path.join(backend.path, remote_path)."""
        with mock.patch.object(
            client_module.deleting,
            'delete_objects',
            return_value=self._build_summary_mock(),
        ) as mock_delete:
            self.client.delete_objects(prefix='inner')

        delete_params = mock_delete.call_args[0][1]
        self.assertEqual(delete_params.prefix, 'sub/inner')

    def test_delete_objects_with_absolute_prefix_inside_backend_returns_path(self):
        """Absolute remote_path with '://' contained in backend -> returns its path."""
        with mock.patch.object(
            client_module.deleting,
            'delete_objects',
            return_value=self._build_summary_mock(),
        ) as mock_delete:
            self.client.delete_objects(prefix='s3://bucket/sub/inner')

        delete_params = mock_delete.call_args[0][1]
        self.assertEqual(delete_params.prefix, 'sub/inner')

    def test_delete_objects_with_leading_slash_prefix_raises_usage_error(self):
        """Leading '/' in remote_path -> OSMOUsageError before any API call."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            self.client.delete_objects(prefix='/abs/path')

        self.assertIn(
            'Remote path cannot start with leading slash',
            str(raised.exception),
        )

    def test_delete_objects_with_absolute_prefix_outside_backend_raises_usage_error(self):
        """Absolute remote_path pointing to a different backend -> OSMOUsageError."""
        with self.assertRaises(osmo_errors.OSMOUsageError) as raised:
            self.client.delete_objects(prefix='s3://other-bucket/key')

        self.assertIn(
            'does not contain remote path',
            str(raised.exception),
        )


if __name__ == '__main__':
    unittest.main()
