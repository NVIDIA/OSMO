"""Unit tests for the in-cluster backend token bootstrap command."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import base64
import secrets
import unittest
from unittest import mock

from kubernetes import client
from kubernetes.client import exceptions as kubernetes_exceptions

from src.service.core.auth import backend_token_bootstrap


class BackendTokenBootstrapTest(unittest.TestCase):
    """Tests idempotent creation and upgrade safety."""

    @staticmethod
    def _secret(token: str) -> client.V1Secret:
        return client.V1Secret(data={
            'token': base64.b64encode(token.encode('utf-8')).decode('ascii'),
        })

    def test_preserves_valid_existing_secret(self) -> None:
        core_api = mock.Mock()
        core_api.read_namespaced_secret.return_value = self._secret(
            secrets.token_urlsafe(32))

        backend_token_bootstrap.ensure_secret(
            core_api, 'osmo', 'backend-token', 'osmo-release', fail_if_missing=False)

        core_api.create_namespaced_secret.assert_not_called()

    def test_creates_secret_without_logging_token(self) -> None:
        core_api = mock.Mock()
        core_api.read_namespaced_secret.side_effect = kubernetes_exceptions.ApiException(
            status=404)

        with self.assertLogs(backend_token_bootstrap.logger, level='INFO') as logs:
            backend_token_bootstrap.ensure_secret(
                core_api, 'osmo', 'backend-token', 'osmo-release',
                fail_if_missing=False)

        core_api.create_namespaced_secret.assert_called_once()
        namespace, secret = core_api.create_namespaced_secret.call_args.args
        self.assertEqual(namespace, 'osmo')
        self.assertEqual(len(secret.string_data['token']), 43)
        self.assertEqual(secret.metadata.labels['app.kubernetes.io/instance'],
                         'osmo-release')
        self.assertNotIn(secret.string_data['token'], '\n'.join(logs.output))

    def test_upgrade_fails_instead_of_replacing_missing_secret(self) -> None:
        core_api = mock.Mock()
        core_api.read_namespaced_secret.side_effect = kubernetes_exceptions.ApiException(
            status=404)

        with self.assertRaisesRegex(RuntimeError, 'missing during upgrade'):
            backend_token_bootstrap.ensure_secret(
                core_api, 'osmo', 'backend-token', 'osmo-release',
                fail_if_missing=True)

        core_api.create_namespaced_secret.assert_not_called()

    def test_rejects_invalid_existing_secret(self) -> None:
        core_api = mock.Mock()
        core_api.read_namespaced_secret.return_value = self._secret('too-short')

        with self.assertRaisesRegex(ValueError, 'invalid length'):
            backend_token_bootstrap.ensure_secret(
                core_api, 'osmo', 'backend-token', 'osmo-release',
                fail_if_missing=False)

        core_api.create_namespaced_secret.assert_not_called()

    def test_create_race_preserves_winner(self) -> None:
        core_api = mock.Mock()
        core_api.read_namespaced_secret.side_effect = [
            kubernetes_exceptions.ApiException(status=404),
            self._secret(secrets.token_urlsafe(32)),
        ]
        core_api.create_namespaced_secret.side_effect = \
            kubernetes_exceptions.ApiException(status=409)

        backend_token_bootstrap.ensure_secret(
            core_api, 'osmo', 'backend-token', 'osmo-release', fail_if_missing=False)

        self.assertEqual(core_api.read_namespaced_secret.call_count, 2)


if __name__ == '__main__':
    unittest.main()
