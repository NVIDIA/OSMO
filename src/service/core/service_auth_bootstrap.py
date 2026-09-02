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

import argparse
import base64
import binascii
import hashlib
import json
import logging
import os
from typing import Any, NoReturn

from jwcrypto import jwe  # type: ignore
from jwcrypto.common import JWException  # type: ignore
from kubernetes import client, config as kube_config  # type: ignore
from kubernetes.client.exceptions import ApiException  # type: ignore
import psycopg2  # type: ignore
import pydantic

from src.lib.utils import osmo_errors
from src.utils import auth
from src.utils.secret_manager import Encrypted, SecretManager


_PLACEHOLDER_ANNOTATION = 'osmo.nvidia.com/service-auth-db-migration-placeholder'
_CREDENTIAL_SOURCE_ANNOTATION = 'osmo.nvidia.com/credential-source'
_BOOTSTRAP_INSTALLATION_ANNOTATION = (
    'osmo.nvidia.com/service-auth-bootstrap-installation')
_BOOTSTRAP_DIGEST_ANNOTATION = 'osmo.nvidia.com/service-auth-bootstrap-digest'
_BOOTSTRAP_MANAGED_BY = 'osmo-service-auth-bootstrap'


def _unexpected_user_key_access(*_args: Any) -> NoReturn:
    raise RuntimeError('Service auth must use the master encryption key directly')


def _decrypt_legacy_service_auth(
    payload: str, secret_manager: SecretManager,
) -> auth.AuthenticationConfig:
    """Decode the legacy DB representation without modifying PostgreSQL."""
    try:
        raw_config = json.loads(payload)
        keys = raw_config['keys']
        if not isinstance(keys, dict) or not keys:
            raise ValueError('missing keys')
        for key_pair in keys.values():
            private_key = key_pair['private_key']
            if not isinstance(private_key, str):
                raise ValueError('invalid private key')
            token = jwe.JWE()
            try:
                token.deserialize(private_key)
            except JWException:
                continue
            key_pair['private_key'] = secret_manager.decrypt(
                Encrypted(private_key), '', lambda _value: None).value

        service_auth = auth.AuthenticationConfig.model_validate(raw_config)
        service_auth.validate_key_pairs()
        return service_auth
    except Exception:
        raise osmo_errors.OSMOError(
            'Legacy service_auth is missing, malformed, or cannot be decrypted.') from None


def _read_legacy_service_auth(arguments: argparse.Namespace) -> auth.AuthenticationConfig:
    password = os.environ.get('OSMO_POSTGRES_PASSWORD')
    if password is None:
        raise osmo_errors.OSMOError('OSMO_POSTGRES_PASSWORD is required.')

    try:
        with psycopg2.connect(
            host=arguments.postgres_host,
            port=arguments.postgres_port,
            dbname=arguments.postgres_database,
            user=arguments.postgres_user,
            password=password,
        ) as connection:
            connection.set_session(readonly=True)
            with connection.cursor() as cursor:
                cursor.execute(
                    'SELECT value FROM configs '
                    "WHERE key = 'service_auth' AND type = 'SERVICE'")
                row = cursor.fetchone()
    except psycopg2.Error:
        raise osmo_errors.OSMOError(
            'Unable to read legacy service_auth from PostgreSQL.') from None

    if row is None or not isinstance(row[0], str) or not row[0]:
        raise osmo_errors.OSMOError(
            'Legacy service_auth is missing from PostgreSQL.')

    secret_manager = SecretManager(
        arguments.mek_file,
        _unexpected_user_key_access,
        _unexpected_user_key_access,
        _unexpected_user_key_access,
        _unexpected_user_key_access,
    )
    return _decrypt_legacy_service_auth(row[0], secret_manager)


def _decode_existing_secret(
    secret: client.V1Secret,
    secret_key: str,
) -> auth.AuthenticationConfig:
    encoded_payload = (secret.data or {}).get(secret_key)
    if not encoded_payload:
        raise osmo_errors.OSMOError(
            f'Existing service auth Secret is missing key {secret_key}.')
    try:
        payload = base64.b64decode(encoded_payload, validate=True).decode('utf-8')
        parsed_payload = json.loads(payload)
        service_auth = auth.AuthenticationConfig.model_validate(parsed_payload)
        service_auth.validate_key_pairs()
        return service_auth
    except (JWException, binascii.Error, UnicodeError, json.JSONDecodeError,
            TypeError, ValueError, pydantic.ValidationError):
        raise osmo_errors.OSMOError(
            'Existing service auth Secret is invalid.') from None


def _same_stable_authority(
    first: auth.AuthenticationConfig,
    second: auth.AuthenticationConfig,
) -> bool:
    return first.canonical_json(include_login_info=False) == second.canonical_json(
        include_login_info=False)


def _stable_authority_digest(service_auth: auth.AuthenticationConfig) -> str:
    payload = service_auth.canonical_json(include_login_info=False).encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def _read_secret(
    core_api: client.CoreV1Api,
    namespace: str,
    secret_name: str,
) -> client.V1Secret | None:
    try:
        return core_api.read_namespaced_secret(secret_name, namespace)
    except ApiException as error:
        if error.status == 404:
            return None
        raise osmo_errors.OSMOError(
            f'Unable to read service auth Secret {secret_name}.') from None


def _verify_existing_secret(
    secret: client.V1Secret,
    secret_key: str,
    legacy_auth: auth.AuthenticationConfig,
) -> None:
    existing_auth = _decode_existing_secret(secret, secret_key)
    if not _same_stable_authority(existing_auth, legacy_auth):
        raise osmo_errors.OSMOError(
            'Existing service auth Secret does not match the legacy identity.')


def _populate_or_verify_secret(
    arguments: argparse.Namespace,
    legacy_auth: auth.AuthenticationConfig,
) -> None:
    kube_config.load_incluster_config()
    core_api = client.CoreV1Api()
    existing = _read_secret(core_api, arguments.namespace, arguments.target_secret)
    if existing is None:
        raise osmo_errors.OSMOError(
            f'Pre-provisioned service auth Secret {arguments.target_secret} is not found.')

    if (existing.data or {}).get(arguments.target_key):
        _verify_existing_secret(existing, arguments.target_key, legacy_auth)
        logging.info('Existing service auth Secret is valid; preserving it')
        return

    metadata = existing.metadata
    annotations = dict(metadata.annotations or {}) if metadata is not None else {}
    if (existing.data or metadata is None
            or annotations.get(_PLACEHOLDER_ANNOTATION) != arguments.release_name):
        raise osmo_errors.OSMOError(
            'Existing service auth Secret is neither a complete matching identity '
            'nor an authorized empty migration placeholder.')

    canonical_payload = legacy_auth.canonical_json(include_login_info=False)
    existing.data = {
        arguments.target_key: base64.b64encode(
            canonical_payload.encode('utf-8')).decode('ascii'),
    }
    annotations.pop(_PLACEHOLDER_ANNOTATION)
    annotations[_CREDENTIAL_SOURCE_ANNOTATION] = 'legacy-db-migration'
    metadata.annotations = annotations
    labels = dict(metadata.labels or {})
    labels['app.kubernetes.io/managed-by'] = 'osmo-service-auth-db-migration'
    labels['app.kubernetes.io/instance'] = arguments.release_name
    metadata.labels = labels
    try:
        core_api.replace_namespaced_secret(
            arguments.target_secret, arguments.namespace, existing)
        logging.info('Populated service auth Secret %s', arguments.target_secret)
    except ApiException as error:
        if error.status != 409:
            raise osmo_errors.OSMOError(
                f'Unable to update service auth Secret {arguments.target_secret}.') from None
        existing = _read_secret(core_api, arguments.namespace, arguments.target_secret)
        if existing is None:
            raise osmo_errors.OSMOError(
                f'Unable to verify service auth Secret {arguments.target_secret}.')
        _verify_existing_secret(existing, arguments.target_key, legacy_auth)
        logging.info('Service auth Secret was updated concurrently; preserving it')


def _generate_service_auth_file(output_path: str) -> None:
    """Generate a fresh canonical identity without writing secret material to stdout."""
    service_auth = auth.AuthenticationConfig.generate_default()
    service_auth.validate_key_pairs()
    payload = service_auth.canonical_json(include_login_info=False)
    try:
        descriptor = os.open(
            output_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o600,
        )
    except FileExistsError:
        raise osmo_errors.OSMOError(
            f'Refusing to overwrite existing service auth file {output_path}.') from None
    except OSError:
        raise osmo_errors.OSMOError(
            f'Unable to create service auth file {output_path}.') from None

    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output_file:
            output_file.write(payload)
            output_file.write('\n')
    except OSError:
        raise osmo_errors.OSMOError(
            f'Unable to write service auth file {output_path}.') from None
    logging.info('Generated service auth file %s', output_path)


def _verify_bootstrap_retry(
    arguments: argparse.Namespace,
    secret: client.V1Secret,
) -> None:
    metadata = secret.metadata
    annotations = dict(metadata.annotations or {}) if metadata is not None else {}
    labels = dict(metadata.labels or {}) if metadata is not None else {}
    installation = f'{arguments.namespace}/{arguments.release_name}'
    if (
        annotations.get(_BOOTSTRAP_INSTALLATION_ANNOTATION) != installation
        or labels.get('app.kubernetes.io/managed-by') != _BOOTSTRAP_MANAGED_BY
    ):
        raise osmo_errors.OSMOError(
            'Existing service auth Secret is not an exact bootstrap retry for '
            'this installation.')
    service_auth = _decode_existing_secret(secret, arguments.target_key)
    if annotations.get(_BOOTSTRAP_DIGEST_ANNOTATION) != _stable_authority_digest(
            service_auth):
        raise osmo_errors.OSMOError(
            'Existing bootstrap service auth Secret identity does not match its data.')
    logging.info('Validated existing bootstrap service auth Secret %s',
                 arguments.target_secret)


def _create_bootstrap_secret(
    core_api: client.CoreV1Api,
    arguments: argparse.Namespace,
    service_auth: auth.AuthenticationConfig,
) -> None:
    installation = f'{arguments.namespace}/{arguments.release_name}'
    canonical_payload = service_auth.canonical_json(include_login_info=False)
    body = client.V1Secret(
        metadata=client.V1ObjectMeta(
            name=arguments.target_secret,
            namespace=arguments.namespace,
            labels={
                'app.kubernetes.io/name': 'osmo',
                'app.kubernetes.io/instance': arguments.release_name,
                'app.kubernetes.io/component': 'service-auth',
                'app.kubernetes.io/managed-by': _BOOTSTRAP_MANAGED_BY,
            },
            annotations={
                _BOOTSTRAP_INSTALLATION_ANNOTATION: installation,
                _BOOTSTRAP_DIGEST_ANNOTATION: _stable_authority_digest(service_auth),
                _CREDENTIAL_SOURCE_ANNOTATION: 'osmo-chart-bootstrap',
            },
        ),
        string_data={arguments.target_key: canonical_payload},
        type='Opaque',
    )
    try:
        core_api.create_namespaced_secret(arguments.namespace, body)
    except ApiException as error:
        if error.status != 409:
            raise osmo_errors.OSMOError(
                f'Unable to create service auth Secret {arguments.target_secret}.') from None
        existing = _read_secret(
            core_api, arguments.namespace, arguments.target_secret)
        if existing is None:
            raise osmo_errors.OSMOError(
                f'Unable to verify service auth Secret {arguments.target_secret}.')
        _verify_bootstrap_retry(arguments, existing)
        logging.info('Service auth Secret was created concurrently; preserving it')


def _bootstrap_service_auth(arguments: argparse.Namespace) -> None:
    """Create a Kubernetes-only identity without overwriting existing state."""
    kube_config.load_incluster_config()
    core_api = client.CoreV1Api()
    existing = _read_secret(core_api, arguments.namespace, arguments.target_secret)
    if existing is not None:
        _verify_bootstrap_retry(arguments, existing)
        return

    service_auth = auth.AuthenticationConfig.generate_default()
    service_auth.validate_key_pairs()
    _create_bootstrap_secret(core_api, arguments, service_auth)
    logging.info('Initialized Kubernetes service auth Secret %s',
                 arguments.target_secret)


def _migrate_service_auth(arguments: argparse.Namespace) -> None:
    """Copy and then recheck the stable legacy identity before cutover."""
    legacy_auth = _read_legacy_service_auth(arguments)
    _populate_or_verify_secret(arguments, legacy_auth)
    confirmed_auth = _read_legacy_service_auth(arguments)
    if not _same_stable_authority(legacy_auth, confirmed_auth):
        raise osmo_errors.OSMOError(
            'Legacy service_auth changed during migration; refusing cutover.')


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Provision the stable OSMO service auth identity.')
    commands = parser.add_subparsers(dest='command', required=True)

    generate = commands.add_parser(
        'generate', description='Generate a fresh offline service auth file.')
    generate.add_argument('--output', required=True)

    migrate = commands.add_parser(
        'migrate', description='Copy the legacy DB identity to a Kubernetes Secret.')
    migrate.add_argument('--postgres-host', required=True)
    migrate.add_argument('--postgres-port', type=int, required=True)
    migrate.add_argument('--postgres-database', required=True)
    migrate.add_argument('--postgres-user', required=True)
    migrate.add_argument('--mek-file', required=True)
    migrate.add_argument('--namespace', required=True)
    migrate.add_argument('--release-name', required=True)
    migrate.add_argument('--target-secret', required=True)
    migrate.add_argument('--target-key', required=True)

    bootstrap = commands.add_parser(
        'bootstrap', description='Create service auth for a fresh installation.')
    bootstrap.add_argument('--namespace', required=True)
    bootstrap.add_argument('--release-name', required=True)
    bootstrap.add_argument('--target-secret', required=True)
    bootstrap.add_argument('--target-key', required=True)

    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    try:
        arguments = _parse_arguments()
        if arguments.command == 'generate':
            _generate_service_auth_file(arguments.output)
        elif arguments.command == 'migrate':
            _migrate_service_auth(arguments)
        else:
            _bootstrap_service_auth(arguments)
    except osmo_errors.OSMOError as error:
        logging.error('%s', error)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
