"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

# pylint: disable=protected-access

import argparse
import base64
import json
import os
import tempfile
import unittest
from unittest import mock

from jwcrypto import jwk
from kubernetes import client
from kubernetes.client.exceptions import ApiException
import yaml

from src.lib.utils import osmo_errors
from src.service.core import service_auth_bootstrap
from src.utils import auth
from src.utils.secret_manager import SecretManager


def _authentication_config() -> auth.AuthenticationConfig:
    key_name = 'installation-key'
    key = jwk.JWK.generate(kty='RSA', kid=key_name, size=2048)
    return auth.AuthenticationConfig(
        keys={
            key_name: auth.AsymmetricKeyPair(
                public_key=key.export_public(),
                private_key=key.export_private(),
            ),
        },
        active_key=key_name,
        issuer='osmo',
        audience='osmo',
    )


def _write_mek_file(path: str, current_key: jwk.JWK, keys: list[jwk.JWK]) -> None:
    with open(path, 'w', encoding='utf-8') as mek_file:
        yaml.safe_dump({
            'currentMek': current_key.key_id,
            'meks': {
                key.key_id: base64.b64encode(
                    key.export().encode('utf-8')).decode('ascii')
                for key in keys
            },
        }, mek_file)


def _secret_manager(path: str) -> SecretManager:
    unexpected = mock.Mock(side_effect=RuntimeError('unexpected user key access'))
    return SecretManager(path, unexpected, unexpected, unexpected, unexpected)


class ServiceAuthBootstrapTest(unittest.TestCase):

    def test_legacy_database_read_uses_read_only_session(self):
        arguments = argparse.Namespace(
            postgres_host='postgres',
            postgres_port=5432,
            postgres_database='osmo',
            postgres_user='osmo',
            mek_file='/mek.yaml',
        )
        connection = mock.MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = ('legacy-payload',)
        connect = mock.MagicMock()
        connect.return_value.__enter__.return_value = connection
        expected = _authentication_config()

        with mock.patch.dict(
            os.environ, {'OSMO_POSTGRES_PASSWORD': 'password'}, clear=False,
        ), mock.patch.object(
            service_auth_bootstrap.psycopg2, 'connect', connect,
        ), mock.patch.object(
            service_auth_bootstrap, 'SecretManager', return_value=mock.MagicMock(),
        ), mock.patch.object(
            service_auth_bootstrap, '_decrypt_legacy_service_auth',
            return_value=expected,
        ):
            actual = service_auth_bootstrap._read_legacy_service_auth(arguments)

        self.assertIs(actual, expected)
        connection.set_session.assert_called_once_with(readonly=True)
        cursor.execute.assert_called_once()

    def test_generate_writes_valid_canonical_identity_with_private_permissions(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = os.path.join(
                temporary_directory, 'authentication-config.json')

            service_auth_bootstrap._generate_service_auth_file(output_path)

            generated = auth.load_authentication_config_file(output_path)
            generated.validate_key_pairs()
            with open(output_path, encoding='utf-8') as output_file:
                self.assertEqual(
                    output_file.read().strip(),
                    generated.canonical_json(include_login_info=False),
                )
            self.assertEqual(os.stat(output_path).st_mode & 0o777, 0o600)

    def test_generate_refuses_to_overwrite_existing_file(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = os.path.join(
                temporary_directory, 'authentication-config.json')
            with open(output_path, 'w', encoding='utf-8') as output_file:
                output_file.write('sentinel')

            with self.assertRaisesRegex(osmo_errors.OSMOError, 'Refusing to overwrite'):
                service_auth_bootstrap._generate_service_auth_file(output_path)

            with open(output_path, encoding='utf-8') as output_file:
                self.assertEqual(output_file.read(), 'sentinel')

    def test_migration_rechecks_legacy_identity_after_populating_secret(self):
        service_auth = _authentication_config()
        changed_auth = _authentication_config()
        arguments = argparse.Namespace()

        with mock.patch.object(
            service_auth_bootstrap,
            '_read_legacy_service_auth',
            side_effect=[service_auth, changed_auth],
        ), mock.patch.object(
            service_auth_bootstrap, '_populate_or_verify_secret',
        ) as populate, self.assertRaisesRegex(
            osmo_errors.OSMOError, 'changed during migration',
        ):
            service_auth_bootstrap._migrate_service_auth(arguments)

        populate.assert_called_once_with(arguments, service_auth)

    def test_plaintext_legacy_identity_is_validated_without_decryption(self):
        service_auth = _authentication_config()
        secret_manager = mock.MagicMock()

        migrated = service_auth_bootstrap._decrypt_legacy_service_auth(
            service_auth.canonical_json(), secret_manager)

        self.assertEqual(
            migrated.canonical_json(include_login_info=False),
            service_auth.canonical_json(include_login_info=False),
        )
        secret_manager.decrypt.assert_not_called()

    def test_old_mek_ciphertext_is_decrypted_to_canonical_plaintext(self):
        service_auth = _authentication_config()
        old_mek = jwk.JWK.generate(kty='oct', kid='old-mek', size=256)
        current_mek = jwk.JWK.generate(kty='oct', kid='current-mek', size=256)

        with tempfile.TemporaryDirectory() as temporary_directory:
            old_path = os.path.join(temporary_directory, 'old-mek.yaml')
            current_path = os.path.join(temporary_directory, 'current-mek.yaml')
            _write_mek_file(old_path, old_mek, [old_mek])
            _write_mek_file(current_path, current_mek, [current_mek, old_mek])

            encrypted_payload = service_auth.plaintext_dict()
            active_key = encrypted_payload['active_key']
            encrypted_payload['keys'][active_key]['private_key'] = (
                _secret_manager(old_path).encrypt(
                    encrypted_payload['keys'][active_key]['private_key'], '').value)

            migrated = service_auth_bootstrap._decrypt_legacy_service_auth(
                json.dumps(encrypted_payload), _secret_manager(current_path))

        self.assertEqual(
            migrated.canonical_json(include_login_info=False),
            service_auth.canonical_json(include_login_info=False),
        )
        self.assertNotIn('old-mek', migrated.canonical_json())

    def test_invalid_legacy_payload_does_not_leak_private_value(self):
        sentinel = 'private-key-sentinel'
        payload = json.dumps({
            'keys': {'bad': {'public_key': '{}', 'private_key': sentinel}},
            'active_key': 'bad',
            'issuer': 'osmo',
            'audience': 'osmo',
        })

        with self.assertRaises(osmo_errors.OSMOError) as context:
            service_auth_bootstrap._decrypt_legacy_service_auth(
                payload, mock.MagicMock())

        self.assertNotIn(sentinel, str(context.exception))

    def test_existing_secret_compares_full_stable_identity(self):
        service_auth = _authentication_config()
        existing = client.V1Secret(data={
            'authentication-config.json': base64.b64encode(
                service_auth.canonical_json(
                    include_login_info=False).encode('utf-8')).decode('ascii'),
        })

        service_auth_bootstrap._verify_existing_secret(
            existing, 'authentication-config.json', service_auth)

        different_identity = service_auth.model_copy(
            deep=True, update={'audience': 'different-audience'})
        with self.assertRaises(osmo_errors.OSMOError):
            service_auth_bootstrap._verify_existing_secret(
                existing, 'authentication-config.json', different_identity)

    def test_preprovisioned_secret_is_populated_with_canonical_stable_identity(self):
        service_auth = _authentication_config().model_copy(
            deep=True,
            update={'login_info': auth.LoginInfo(device_client_id='runtime-only')},
        )
        core_api = mock.MagicMock()
        core_api.read_namespaced_secret.return_value = client.V1Secret(
            metadata=client.V1ObjectMeta(
                name='osmo-service-auth',
                namespace='osmo',
                resource_version='1',
                annotations={
                    'osmo.nvidia.com/service-auth-db-migration-placeholder': 'prod',
                },
            ),
            type='Opaque',
        )
        arguments = argparse.Namespace(
            namespace='osmo',
            target_secret='osmo-service-auth',
            target_key='authentication-config.json',
            release_name='prod',
        )

        with mock.patch.object(service_auth_bootstrap.kube_config,
                               'load_incluster_config'), mock.patch.object(
                service_auth_bootstrap.client, 'CoreV1Api', return_value=core_api):
            service_auth_bootstrap._populate_or_verify_secret(arguments, service_auth)

        updated_secret = core_api.replace_namespaced_secret.call_args.args[2]
        encoded_payload = updated_secret.data['authentication-config.json']
        payload = base64.b64decode(encoded_payload).decode('utf-8')
        self.assertEqual(
            payload,
            service_auth.canonical_json(include_login_info=False),
        )
        self.assertNotIn('runtime-only', payload)
        self.assertNotIn(
            'osmo.nvidia.com/service-auth-db-migration-placeholder',
            updated_secret.metadata.annotations,
        )
        self.assertNotIn(
            'osmo.nvidia.com/service-auth-bootstrap-placeholder',
            updated_secret.metadata.annotations,
        )
        self.assertEqual(
            updated_secret.metadata.annotations['osmo.nvidia.com/credential-source'],
            'legacy-db-migration',
        )
        self.assertEqual(
            updated_secret.metadata.labels['app.kubernetes.io/managed-by'],
            'osmo-service-auth-db-migration',
        )
        self.assertNotIn(
            'osmo-service-auth-bootstrap',
            updated_secret.metadata.labels.values(),
        )
        core_api.create_namespaced_secret.assert_not_called()

    def test_missing_preprovisioned_secret_fails_closed(self):
        core_api = mock.MagicMock()
        core_api.read_namespaced_secret.side_effect = ApiException(status=404)
        arguments = argparse.Namespace(
            namespace='osmo',
            target_secret='osmo-service-auth',
            target_key='authentication-config.json',
            release_name='prod',
        )

        with mock.patch.object(service_auth_bootstrap.kube_config,
                               'load_incluster_config'), mock.patch.object(
                service_auth_bootstrap.client, 'CoreV1Api', return_value=core_api), \
                self.assertRaisesRegex(osmo_errors.OSMOError, 'is not found'):
            service_auth_bootstrap._populate_or_verify_secret(
                arguments, _authentication_config())

        core_api.replace_namespaced_secret.assert_not_called()

    def test_unmarked_empty_secret_fails_closed(self):
        core_api = mock.MagicMock()
        core_api.read_namespaced_secret.return_value = client.V1Secret(
            metadata=client.V1ObjectMeta(name='osmo-service-auth'),
            type='Opaque',
        )
        arguments = argparse.Namespace(
            namespace='osmo',
            target_secret='osmo-service-auth',
            target_key='authentication-config.json',
            release_name='prod',
        )

        with mock.patch.object(service_auth_bootstrap.kube_config,
                               'load_incluster_config'), mock.patch.object(
                service_auth_bootstrap.client, 'CoreV1Api', return_value=core_api), \
                self.assertRaisesRegex(osmo_errors.OSMOError, 'authorized empty'):
            service_auth_bootstrap._populate_or_verify_secret(
                arguments, _authentication_config())

        core_api.replace_namespaced_secret.assert_not_called()


if __name__ == '__main__':
    unittest.main()
