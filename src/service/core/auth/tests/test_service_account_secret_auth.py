"""Unit tests for Kubernetes Secret-backed service-account authentication."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import datetime
import hashlib
import os
from pathlib import Path
import secrets
import shutil
import tempfile
import types
import unittest
from unittest import mock

from src.service.core.auth import auth_service, service_account_secret_auth
from src.utils.job import task as task_lib


class ServiceAccountSecretAuthenticatorTest(unittest.TestCase):
    """Tests projected Secret loading, validation, and rotation."""

    def setUp(self) -> None:
        self.token_directory = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.token_directory)

    def tearDown(self) -> None:
        service_account_secret_auth.configure(None)

    @staticmethod
    def _new_token() -> str:
        return secrets.token_urlsafe(task_lib.REFRESH_TOKEN_LENGTH)

    def _write_credential(self, name: str, token: str,
                          previous_token: str | None = None,
                          username: str = 'service-account@example.com',
                          roles: tuple[str, ...] = ('osmo-default',)) -> Path:
        credential_directory = self.token_directory / name
        credential_directory.mkdir()
        (credential_directory / 'token').write_text(token, encoding='utf-8')
        (credential_directory / 'username').write_text(username, encoding='utf-8')
        (credential_directory / 'roles').write_text('\n'.join(roles), encoding='utf-8')
        if previous_token is not None:
            (credential_directory / 'previous-token').write_text(
                previous_token, encoding='utf-8')
        return credential_directory

    def test_authenticates_current_and_previous_tokens_with_fixed_claims(self) -> None:
        current_token = self._new_token()
        previous_token = self._new_token()
        self._write_credential(
            'default', current_token, previous_token,
            username='backend-operator-default', roles=('osmo-backend', 'pool-reader'))

        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))

        expected_identity = service_account_secret_auth.ServiceAccountTokenIdentity(
            username='backend-operator-default',
            roles=('osmo-backend', 'pool-reader'),
            token_name='service-account-default')
        self.assertEqual(authenticator.authenticate(current_token), expected_identity)
        self.assertEqual(authenticator.authenticate(previous_token), expected_identity)
        self.assertIsNone(authenticator.authenticate(self._new_token()))

    def test_accepts_one_terminal_newline(self) -> None:
        token = self._new_token()
        self._write_credential('default', f'{token}\n')

        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))

        self.assertIsNotNone(authenticator.authenticate(token))

    def test_non_ascii_request_token_does_not_raise(self) -> None:
        token = self._new_token()
        self._write_credential('default', token)
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))
        non_ascii_token = f'\N{LATIN SMALL LETTER E WITH ACUTE}{token[1:]}'

        self.assertIsNone(authenticator.authenticate(non_ascii_token))

    def test_ignores_missing_token_without_disabling_valid_credential(self) -> None:
        valid_token = self._new_token()
        self._write_credential('valid', valid_token)
        missing_token_directory = self.token_directory / 'default'
        missing_token_directory.mkdir()
        (missing_token_directory / 'username').write_text('admin', encoding='utf-8')
        (missing_token_directory / 'roles').write_text('osmo-admin', encoding='utf-8')
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))

        with self.assertLogs(service_account_secret_auth.logger, level='WARNING') as logs:
            authenticator.validate()

        self.assertIsNotNone(authenticator.authenticate(valid_token))
        self.assertIn('missing key token', '\n'.join(logs.output))

    def test_ignores_invalid_token_length(self) -> None:
        self._write_credential('default', 'too-short')
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))

        with self.assertLogs(service_account_secret_auth.logger, level='WARNING') as logs:
            authenticator.validate()

        self.assertIsNone(authenticator.authenticate(self._new_token()))
        self.assertIn('invalid length', '\n'.join(logs.output))

    def test_ignores_invalid_token_characters_without_logging_value(self) -> None:
        invalid_token = ('a' * 42) + '!'
        self._write_credential('default', invalid_token)
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))

        with self.assertLogs(service_account_secret_auth.logger, level='WARNING') as logs:
            authenticator.validate()

        joined_logs = '\n'.join(logs.output)
        self.assertIsNone(authenticator.authenticate(invalid_token))
        self.assertIn('invalid format', joined_logs)
        self.assertNotIn(invalid_token, joined_logs)

    def test_ignores_credential_with_duplicate_values(self) -> None:
        token = self._new_token()
        self._write_credential('default', token, token)
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))

        with self.assertLogs(service_account_secret_auth.logger, level='WARNING') as logs:
            authenticator.validate()

        self.assertIsNone(authenticator.authenticate(token))
        self.assertIn('Duplicate service account token', '\n'.join(logs.output))

    def test_ignores_invalid_credential_name(self) -> None:
        self._write_credential('INVALID_NAME', self._new_token())
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))

        with self.assertLogs(service_account_secret_auth.logger, level='WARNING') as logs:
            authenticator.validate()

        self.assertIn('Invalid service account credential name', '\n'.join(logs.output))

    def test_ignores_missing_identity_metadata(self) -> None:
        token = self._new_token()
        credential_directory = self._write_credential('default', token)
        (credential_directory / 'username').unlink()
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))

        with self.assertLogs(service_account_secret_auth.logger, level='WARNING') as logs:
            authenticator.validate()

        self.assertIsNone(authenticator.authenticate(token))
        self.assertIn('missing key username', '\n'.join(logs.output))

    def test_deprecated_backend_mode_accepts_token_only_secret(self) -> None:
        token = self._new_token()
        credential_directory = self._write_credential('default', token)
        (credential_directory / 'username').unlink()
        (credential_directory / 'roles').unlink()
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory), allow_legacy_backend_credentials=True)

        self.assertEqual(
            authenticator.authenticate(token),
            service_account_secret_auth.ServiceAccountTokenIdentity(
                username='backend-operator-default',
                roles=('osmo-backend',),
                token_name='backend-bootstrap-default'))

    def test_ignores_invalid_or_duplicate_roles(self) -> None:
        first_token = self._new_token()
        second_token = self._new_token()
        self._write_credential('invalid', first_token, roles=('osmo-default', 'bad,role'))
        self._write_credential('duplicate', second_token, roles=('osmo-admin', 'osmo-admin'))
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))

        with self.assertLogs(service_account_secret_auth.logger, level='WARNING') as logs:
            authenticator.validate()

        self.assertIsNone(authenticator.authenticate(first_token))
        self.assertIsNone(authenticator.authenticate(second_token))
        self.assertIn('invalid roles', '\n'.join(logs.output))

    def test_resolves_current_identity_by_token_digest(self) -> None:
        token = self._new_token()
        self._write_credential(
            'admin', token, username='admin', roles=('osmo-admin', 'osmo-default'))
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))
        token_digest = hashlib.sha256(token.encode('utf-8')).hexdigest()

        identity = authenticator.resolve_identity(
            token_digest, 'admin', 'service-account-admin')

        self.assertEqual(identity, service_account_secret_auth.ServiceAccountTokenIdentity(
            username='admin', roles=('osmo-admin', 'osmo-default'),
            token_name='service-account-admin'))
        self.assertIsNone(authenticator.resolve_identity(
            token_digest, 'other', 'service-account-admin'))

    def test_ignores_broken_projection_without_disabling_valid_credential(self) -> None:
        valid_token = self._new_token()
        self._write_credential('valid', valid_token)
        broken_directory = self.token_directory / 'broken'
        broken_directory.mkdir()
        os.symlink('missing-generation', broken_directory / '..data')
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))

        with self.assertLogs(service_account_secret_auth.logger, level='WARNING') as logs:
            authenticator.validate()

        self.assertIsNotNone(authenticator.authenticate(valid_token))
        self.assertIn('invalid projection', '\n'.join(logs.output))

    def test_omits_all_credentials_sharing_a_token(self) -> None:
        duplicate_token = self._new_token()
        unique_token = self._new_token()
        self._write_credential('one', duplicate_token)
        self._write_credential('two', duplicate_token)
        self._write_credential('three', unique_token)
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))

        with self.assertLogs(service_account_secret_auth.logger, level='WARNING'):
            authenticator.validate()

        self.assertIsNone(authenticator.authenticate(duplicate_token))
        self.assertIsNotNone(authenticator.authenticate(unique_token))

    def test_caches_candidates_until_projection_changes(self) -> None:
        token = self._new_token()
        self._write_credential('default', token)
        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))

        with mock.patch.object(
                authenticator, '_parse_candidates',
                wraps=authenticator._parse_candidates) as parse_candidates:  # pylint: disable=protected-access
            self.assertIsNotNone(authenticator.authenticate(token))
            self.assertIsNotNone(authenticator.authenticate(token))

        parse_candidates.assert_called_once()

    def test_observes_atomic_projected_secret_rotation(self) -> None:
        old_token = self._new_token()
        new_token = self._new_token()
        credential_directory = self.token_directory / 'default'
        credential_directory.mkdir()
        first_generation = credential_directory / '..2026_01'
        first_generation.mkdir()
        (first_generation / 'token').write_text(old_token, encoding='utf-8')
        (first_generation / 'username').write_text('admin', encoding='utf-8')
        (first_generation / 'roles').write_text('osmo-admin', encoding='utf-8')
        os.symlink(first_generation.name, credential_directory / '..data')

        authenticator = service_account_secret_auth.ServiceAccountSecretAuthenticator(
            str(self.token_directory))
        self.assertIsNotNone(authenticator.authenticate(old_token))

        second_generation = credential_directory / '..2026_02'
        second_generation.mkdir()
        (second_generation / 'token').write_text(new_token, encoding='utf-8')
        (second_generation / 'username').write_text('admin', encoding='utf-8')
        (second_generation / 'roles').write_text(
            'osmo-admin\nosmo-default', encoding='utf-8')
        replacement_link = credential_directory / '..data-new'
        os.symlink(second_generation.name, replacement_link)
        os.replace(replacement_link, credential_directory / '..data')

        self.assertIsNone(authenticator.authenticate(old_token))
        self.assertIsNotNone(authenticator.authenticate(new_token))

    def test_global_configuration_can_be_disabled(self) -> None:
        token = self._new_token()
        self._write_credential('default', token)
        service_account_secret_auth.configure(str(self.token_directory))
        self.assertIsNotNone(service_account_secret_auth.authenticate(token))

        service_account_secret_auth.configure(None)

        self.assertIsNone(service_account_secret_auth.authenticate(token))


class ServiceAccountSecretAuthServiceTest(unittest.TestCase):
    """Tests integration with the existing access-token JWT exchange."""

    def tearDown(self) -> None:
        service_account_secret_auth.configure(None)

    def test_service_account_match_issues_secret_claims_without_database_lookup(self) -> None:
        token = secrets.token_urlsafe(task_lib.REFRESH_TOKEN_LENGTH)
        identity = service_account_secret_auth.ServiceAccountTokenIdentity(
            username='admin',
            roles=('osmo-admin', 'osmo-default'),
            token_name='service-account-admin')
        service_auth = mock.Mock()
        service_auth.create_idtoken_jwt.return_value = 'jwt'
        postgres = mock.Mock()
        postgres.get_service_configs.return_value = types.SimpleNamespace(
            service_auth=service_auth)

        with mock.patch.object(
                auth_service.connectors.PostgresConnector, 'get_instance',
                return_value=postgres), \
             mock.patch.object(
                 auth_service.service_account_secret_auth, 'authenticate', return_value=identity), \
             mock.patch.object(
                 auth_service.objects.AccessToken, 'validate_access_token') as validate_token:
            result = auth_service._create_jwt_from_access_token(  # pylint: disable=protected-access
                token)

        self.assertEqual(result['token'], 'jwt')
        validate_token.assert_not_called()
        service_auth.create_idtoken_jwt.assert_called_once()
        call_args = service_auth.create_idtoken_jwt.call_args
        self.assertEqual(call_args.args[1], 'admin')
        self.assertEqual(call_args.kwargs['roles'], ['osmo-admin', 'osmo-default'])
        self.assertEqual(call_args.kwargs['token_name'], 'service-account-admin')

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
                 auth_service.service_account_secret_auth, 'authenticate',
                 side_effect=service_account_secret_auth.ServiceAccountTokenConfigurationError(
                     'projection unavailable')), \
             mock.patch.object(
                 auth_service.objects.AccessToken, 'validate_access_token',
                 return_value=access_token) as validate_token, \
             mock.patch.object(
                 auth_service.objects.AccessToken, 'get_roles_for_token',
                 return_value=['osmo-default']):
            with self.assertLogs(auth_service.logger, level='WARNING') as logs:
                result = auth_service._create_jwt_from_access_token(  # pylint: disable=protected-access
                    token)

        self.assertEqual(result['token'], 'jwt')
        self.assertIn('projection unavailable', '\n'.join(logs.output))
        validate_token.assert_called_once_with(postgres, token)
        service_auth.create_idtoken_jwt.assert_called_once()


if __name__ == '__main__':
    unittest.main()
