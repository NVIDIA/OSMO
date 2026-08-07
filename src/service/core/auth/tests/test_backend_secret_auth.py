"""Unit tests for Kubernetes Secret-backed backend authentication."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import datetime
import os
from pathlib import Path
import secrets
import shutil
import tempfile
import types
import unittest
from unittest import mock

from src.service.core.auth import auth_service, backend_secret_auth
from src.utils.job import task as task_lib


class BackendSecretAuthenticatorTest(unittest.TestCase):
    """Tests projected Secret loading, validation, and rotation."""

    def setUp(self) -> None:
        self.token_directory = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.token_directory)

    def tearDown(self) -> None:
        backend_secret_auth.configure(None)

    @staticmethod
    def _new_token() -> str:
        return secrets.token_urlsafe(task_lib.REFRESH_TOKEN_LENGTH)

    def _write_credential(self, name: str, token: str,
                          previous_token: str | None = None) -> Path:
        credential_directory = self.token_directory / name
        credential_directory.mkdir()
        (credential_directory / 'token').write_text(token, encoding='utf-8')
        if previous_token is not None:
            (credential_directory / 'previous-token').write_text(
                previous_token, encoding='utf-8')
        return credential_directory

    def test_authenticates_current_and_previous_tokens_with_fixed_claims(self) -> None:
        current_token = self._new_token()
        previous_token = self._new_token()
        self._write_credential('default', current_token, previous_token)

        authenticator = backend_secret_auth.BackendSecretAuthenticator(
            str(self.token_directory))

        expected_identity = backend_secret_auth.BackendTokenIdentity(
            username='backend-operator-default',
            roles=('osmo-backend',),
            token_name='backend-bootstrap-default')
        self.assertEqual(authenticator.authenticate(current_token), expected_identity)
        self.assertEqual(authenticator.authenticate(previous_token), expected_identity)
        self.assertIsNone(authenticator.authenticate(self._new_token()))

    def test_accepts_one_terminal_newline(self) -> None:
        token = self._new_token()
        self._write_credential('default', f'{token}\n')

        authenticator = backend_secret_auth.BackendSecretAuthenticator(
            str(self.token_directory))

        self.assertIsNotNone(authenticator.authenticate(token))

    def test_non_ascii_request_token_does_not_raise(self) -> None:
        token = self._new_token()
        self._write_credential('default', token)
        authenticator = backend_secret_auth.BackendSecretAuthenticator(
            str(self.token_directory))
        non_ascii_token = f'\N{LATIN SMALL LETTER E WITH ACUTE}{token[1:]}'

        self.assertIsNone(authenticator.authenticate(non_ascii_token))

    def test_rejects_missing_current_token(self) -> None:
        (self.token_directory / 'default').mkdir()
        authenticator = backend_secret_auth.BackendSecretAuthenticator(
            str(self.token_directory))

        with self.assertRaisesRegex(
                backend_secret_auth.BackendTokenConfigurationError, 'missing key token'):
            authenticator.validate()

    def test_rejects_invalid_token_length(self) -> None:
        self._write_credential('default', 'too-short')
        authenticator = backend_secret_auth.BackendSecretAuthenticator(
            str(self.token_directory))

        with self.assertRaisesRegex(
                backend_secret_auth.BackendTokenConfigurationError, 'invalid length'):
            authenticator.validate()

    def test_rejects_duplicate_values(self) -> None:
        token = self._new_token()
        self._write_credential('default', token, token)
        authenticator = backend_secret_auth.BackendSecretAuthenticator(
            str(self.token_directory))

        with self.assertRaisesRegex(
                backend_secret_auth.BackendTokenConfigurationError, 'Duplicate backend token'):
            authenticator.validate()

    def test_rejects_invalid_credential_name(self) -> None:
        self._write_credential('INVALID_NAME', self._new_token())
        authenticator = backend_secret_auth.BackendSecretAuthenticator(
            str(self.token_directory))

        with self.assertRaisesRegex(
                backend_secret_auth.BackendTokenConfigurationError,
                'Invalid backend credential name'):
            authenticator.validate()

    def test_observes_atomic_projected_secret_rotation(self) -> None:
        old_token = self._new_token()
        new_token = self._new_token()
        credential_directory = self.token_directory / 'default'
        credential_directory.mkdir()
        first_generation = credential_directory / '..2026_01'
        first_generation.mkdir()
        (first_generation / 'token').write_text(old_token, encoding='utf-8')
        os.symlink(first_generation.name, credential_directory / '..data')

        authenticator = backend_secret_auth.BackendSecretAuthenticator(
            str(self.token_directory))
        self.assertIsNotNone(authenticator.authenticate(old_token))

        second_generation = credential_directory / '..2026_02'
        second_generation.mkdir()
        (second_generation / 'token').write_text(new_token, encoding='utf-8')
        replacement_link = credential_directory / '..data-new'
        os.symlink(second_generation.name, replacement_link)
        os.replace(replacement_link, credential_directory / '..data')

        self.assertIsNone(authenticator.authenticate(old_token))
        self.assertIsNotNone(authenticator.authenticate(new_token))

    def test_global_configuration_can_be_disabled(self) -> None:
        token = self._new_token()
        self._write_credential('default', token)
        backend_secret_auth.configure(str(self.token_directory))
        self.assertIsNotNone(backend_secret_auth.authenticate(token))

        backend_secret_auth.configure(None)

        self.assertIsNone(backend_secret_auth.authenticate(token))


class BackendSecretAuthServiceTest(unittest.TestCase):
    """Tests integration with the existing access-token JWT exchange."""

    def tearDown(self) -> None:
        backend_secret_auth.configure(None)

    def test_backend_match_issues_fixed_claims_without_database_lookup(self) -> None:
        token = secrets.token_urlsafe(task_lib.REFRESH_TOKEN_LENGTH)
        identity = backend_secret_auth.BackendTokenIdentity(
            username='backend-operator-default',
            roles=('osmo-backend',),
            token_name='backend-bootstrap-default')
        service_auth = mock.Mock()
        service_auth.create_idtoken_jwt.return_value = 'jwt'
        postgres = mock.Mock()
        postgres.get_service_configs.return_value = types.SimpleNamespace(
            service_auth=service_auth)

        with mock.patch.object(
                auth_service.connectors.PostgresConnector, 'get_instance',
                return_value=postgres), \
             mock.patch.object(
                 auth_service.backend_secret_auth, 'authenticate', return_value=identity), \
             mock.patch.object(
                 auth_service.objects.AccessToken, 'validate_access_token') as validate_token:
            result = auth_service._create_jwt_from_access_token(token)  # pylint: disable=protected-access

        self.assertEqual(result['token'], 'jwt')
        validate_token.assert_not_called()
        service_auth.create_idtoken_jwt.assert_called_once()
        call_args = service_auth.create_idtoken_jwt.call_args
        self.assertEqual(call_args.args[1], 'backend-operator-default')
        self.assertEqual(call_args.kwargs['roles'], ['osmo-backend'])
        self.assertEqual(call_args.kwargs['token_name'], 'backend-bootstrap-default')

    def test_projection_error_preserves_database_access_token_login(self) -> None:
        token = secrets.token_urlsafe(task_lib.REFRESH_TOKEN_LENGTH)
        access_token = types.SimpleNamespace(
            user_name='automation',
            token_name='existing-token',
            expires_at=datetime.datetime.utcnow() + datetime.timedelta(days=1))
        service_auth = mock.Mock()
        service_auth.create_idtoken_jwt.return_value = 'jwt'
        postgres = mock.Mock()
        postgres.get_service_configs.return_value = types.SimpleNamespace(
            service_auth=service_auth)

        with mock.patch.object(
                auth_service.connectors.PostgresConnector, 'get_instance',
                return_value=postgres), \
             mock.patch.object(
                 auth_service.backend_secret_auth, 'authenticate',
                 side_effect=backend_secret_auth.BackendTokenConfigurationError(
                     'projection unavailable')), \
             mock.patch.object(
                 auth_service.objects.AccessToken, 'validate_access_token',
                 return_value=access_token) as validate_token, \
             mock.patch.object(
                 auth_service.objects.AccessToken, 'get_roles_for_token',
                 return_value=['osmo-default']):
            result = auth_service._create_jwt_from_access_token(token)  # pylint: disable=protected-access

        self.assertEqual(result['token'], 'jwt')
        validate_token.assert_called_once_with(postgres, token)
        service_auth.create_idtoken_jwt.assert_called_once()


if __name__ == '__main__':
    unittest.main()
