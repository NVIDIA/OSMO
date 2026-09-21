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
from collections.abc import Callable
import dataclasses
import hashlib
import logging
import secrets
import sys
import time

import bcrypt
from kubernetes import client as kubernetes_client  # type: ignore
from kubernetes import config as kubernetes_config  # type: ignore
from kubernetes.client import exceptions as kubernetes_exceptions  # type: ignore

from src.utils.bootstrap import BoundedApiClient, record_issuance_if_configured


_MANAGED_BY = 'osmo-embedded-dex-bootstrap'
_IDENTITY_MANAGED_BY = 'osmo-identity-bootstrap'
_LEGACY_MANAGERS = frozenset({
    _MANAGED_BY,
    'osmo-backend-token-bootstrap',
})
_MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by'
_INSTANCE_LABEL = 'app.kubernetes.io/instance'
_PASSWORD_GENERATION = 'osmo.nvidia.com/password-generation'
_CLIENT_GENERATION = 'osmo.nvidia.com/browser-client-secret-generation'
_COOKIE_GENERATION = 'osmo.nvidia.com/cookie-secret-generation'
_CREDENTIAL_SOURCE = 'osmo.nvidia.com/credential-source'
_BCRYPT_COST = 12
_MAX_RECONCILE_ATTEMPTS = 5


class BootstrapError(RuntimeError):
    """An embedded Dex credential lifecycle contract violation."""


@dataclasses.dataclass(frozen=True, slots=True)
class CredentialState:
    data: dict[str, bytes]
    generations: dict[str, int]


@dataclasses.dataclass(frozen=True, slots=True)
class BootstrapResult:
    dex_credential_identity: str
    oauth_credential_identity: str
    mcp_credential_identity: str = ''


@dataclasses.dataclass(frozen=True, slots=True)
class PasswordSpec:
    identity_id: str
    secret_name: str
    hash_env_name: str


@dataclasses.dataclass(frozen=True, slots=True)
class TokenSpec:
    identity_id: str
    token_name: str
    secret_name: str


def credential_identity(domain: str, *values: bytes) -> str:
    """Return a domain-separated identity for high-entropy credential bytes."""
    digest = hashlib.sha256()
    digest.update(b'osmo-embedded-dex-credential-v1\0')
    digest.update(domain.encode('ascii'))
    digest.update(b'\0')
    for value in values:
        digest.update(len(value).to_bytes(8, byteorder='big'))
        digest.update(value)
    return digest.hexdigest()


def _encode(data: dict[str, bytes]) -> dict[str, str]:
    return {
        key: base64.b64encode(value).decode('ascii')
        for key, value in data.items()
    }


def _decode(secret: kubernetes_client.V1Secret) -> dict[str, bytes]:
    try:
        return {
            key: base64.b64decode(value, validate=True)
            for key, value in (secret.data or {}).items()
        }
    except (binascii.Error, TypeError, ValueError) as error:
        raise BootstrapError(
            f'{secret.metadata.name} contains invalid credentials') from error


def _read_secret(
    api: kubernetes_client.CoreV1Api,
    namespace: str,
    name: str,
) -> kubernetes_client.V1Secret | None:
    try:
        return api.read_namespaced_secret(name=name, namespace=namespace)
    except kubernetes_exceptions.ApiException as error:
        if error.status == 404:
            return None
        raise BootstrapError(f'Unable to read credential Secret {name}') from error


def _require_owned(
    secret: kubernetes_client.V1Secret,
    release_name: str,
) -> None:
    metadata = secret.metadata
    labels = metadata.labels if metadata else None
    name = metadata.name if metadata and metadata.name else 'credential Secret'
    if (
        secret.type != 'Opaque'
        or not labels
        or labels.get(_MANAGED_BY_LABEL) not in {_MANAGED_BY, _IDENTITY_MANAGED_BY}
        or labels.get(_INSTANCE_LABEL) != release_name
    ):
        raise BootstrapError(f'{name} is not owned by this release')


def _generation(
    secret: kubernetes_client.V1Secret,
    annotation: str,
    requested: int,
) -> int:
    name = secret.metadata.name
    raw_value = (secret.metadata.annotations or {}).get(annotation)
    try:
        stored = int(raw_value or '')
    except ValueError as error:
        raise BootstrapError(f'{name} contains invalid generation metadata') from error
    if stored < 1:
        raise BootstrapError(f'{name} contains invalid generation metadata')
    if requested < stored:
        raise BootstrapError(f'{name} generation cannot decrease')
    return stored


def _generate_admin() -> dict[str, bytes]:
    password = secrets.token_urlsafe(32).encode('ascii')
    return {
        'password': password,
        'password-hash': bcrypt.hashpw(password, bcrypt.gensalt(_BCRYPT_COST)),
    }


def _generate_client_secret() -> bytes:
    return secrets.token_urlsafe(32).encode('ascii')


def _generate_cookie_secret() -> bytes:
    return base64.urlsafe_b64encode(secrets.token_bytes(32))


def _validate_admin(name: str, data: dict[str, bytes]) -> None:
    if set(data) != {'password', 'password-hash'}:
        raise BootstrapError(f'{name} contains invalid credentials')
    try:
        cost = int(data['password-hash'].split(b'$')[2])
        if (
            len(data['password']) < 43
            or cost < 10
            or not bcrypt.checkpw(data['password'], data['password-hash'])
        ):
            raise BootstrapError(f'{name} contains invalid credentials')
    except (IndexError, ValueError) as error:
        raise BootstrapError(f'{name} contains invalid credentials') from error


def _validate_oauth(name: str, data: dict[str, bytes]) -> None:
    if set(data) != {'browser-client-secret', 'cookie-secret'}:
        raise BootstrapError(f'{name} contains invalid credentials')
    try:
        cookie = base64.b64decode(
            data['cookie-secret'], altchars=b'-_', validate=True)
    except (binascii.Error, ValueError) as error:
        raise BootstrapError(f'{name} contains invalid credentials') from error
    if len(data['browser-client-secret']) < 43 or len(cookie) != 32:
        raise BootstrapError(f'{name} contains invalid credentials')


def _validate_mcp(name: str, data: dict[str, bytes]) -> None:
    if set(data) != {'client-secret'}:
        raise BootstrapError(f'{name} contains invalid credentials')
    client_secret = data['client-secret']
    if len(client_secret) < 43 or any(
            character not in b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
            for character in client_secret):
        raise BootstrapError(f'{name} contains invalid credentials')


def _validate_token(name: str, data: dict[str, bytes]) -> None:
    if set(data) not in ({'token'}, {'token', 'previous-token'}):
        raise BootstrapError(f'{name} contains invalid credentials')
    for token in data.values():
        if len(token) != 43 or any(
                character not in b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
                for character in token):
            raise BootstrapError(f'{name} contains invalid credentials')
    if len(set(data.values())) != len(data):
        raise BootstrapError(f'{name} contains invalid credentials')


def _identity_secret(
    name: str,
    release_name: str,
    data: dict[str, bytes],
    resource_version: str | None = None,
    annotations: dict[str, str] | None = None,
) -> kubernetes_client.V1Secret:
    merged_annotations = dict(annotations or {})
    merged_annotations[_CREDENTIAL_SOURCE] = _IDENTITY_MANAGED_BY
    return kubernetes_client.V1Secret(
        metadata=kubernetes_client.V1ObjectMeta(
            name=name,
            resource_version=resource_version,
            labels={
                _MANAGED_BY_LABEL: _IDENTITY_MANAGED_BY,
                _INSTANCE_LABEL: release_name,
            },
            annotations=merged_annotations,
        ),
        type='Opaque',
        data=_encode(data),
    )


def _require_identity_owned(
    secret: kubernetes_client.V1Secret,
    release_name: str,
    allow_unlabeled_backend: bool = False,
) -> bool:
    metadata = secret.metadata
    labels = metadata.labels if metadata else None
    name = metadata.name if metadata and metadata.name else 'credential Secret'
    manager = labels.get(_MANAGED_BY_LABEL) if labels else None
    annotations = metadata.annotations if metadata else None
    if (
        allow_unlabeled_backend
        and name == f'{release_name}-backend-token'
        and secret.type == 'Opaque'
        and not labels
        and set(annotations or {}) <= {'kubectl.kubernetes.io/last-applied-configuration'}
        and not metadata.owner_references
        and set(secret.data or {}) == {'token'}
    ):
        return True
    if (
        secret.type != 'Opaque'
        or not labels
        or labels.get(_INSTANCE_LABEL) != release_name
        or manager not in _LEGACY_MANAGERS | {_IDENTITY_MANAGED_BY}
    ):
        raise BootstrapError(f'{name} is not owned by this release')
    return manager != _IDENTITY_MANAGED_BY


def migrate_tokens(
    api: kubernetes_client.CoreV1Api,
    *,
    namespace: str,
    release_name: str,
    token_specs: tuple[TokenSpec, ...],
) -> None:
    """Normalize legacy token ownership without creating or replacing credentials."""
    snapshots = {}
    for specification in token_specs:
        name = specification.secret_name
        secret = _read_secret(api, namespace, name)
        if secret is None:
            continue
        _require_identity_owned(secret, release_name, allow_unlabeled_backend=True)
        _validate_token(name, _decode(secret))
        if not secret.metadata.uid or not secret.metadata.resource_version:
            raise BootstrapError(f'{name} has no Kubernetes object identity')
        snapshots[name] = secret.metadata.uid

    # Validate the complete inventory before writing; interruption during the
    # per-object CAS loop is safe to retry because canonical objects are no-ops.
    for name, expected_uid in snapshots.items():
        for _ in range(_MAX_RECONCILE_ATTEMPTS):
            secret = _read_secret(api, namespace, name)
            if secret is None or secret.metadata.uid != expected_uid:
                raise BootstrapError(f'{name} was removed or replaced during token migration')
            legacy = _require_identity_owned(
                secret, release_name, allow_unlabeled_backend=True)
            _validate_token(name, _decode(secret))
            if not legacy:
                break
            patch = [
                {'op': 'test', 'path': '/metadata/uid', 'value': expected_uid},
                {'op': 'test', 'path': '/metadata/resourceVersion',
                 'value': secret.metadata.resource_version},
            ]
            if secret.metadata.labels:
                patch.append({
                    'op': 'replace',
                    'path': '/metadata/labels/app.kubernetes.io~1managed-by',
                    'value': _IDENTITY_MANAGED_BY,
                })
            else:
                annotations = dict(secret.metadata.annotations or {})
                annotations[_CREDENTIAL_SOURCE] = _IDENTITY_MANAGED_BY
                patch.extend([
                    {
                        'op': 'add',
                        'path': '/metadata/labels',
                        'value': {
                            _INSTANCE_LABEL: release_name,
                            _MANAGED_BY_LABEL: _IDENTITY_MANAGED_BY,
                        },
                    },
                    {
                        'op': 'add',
                        'path': '/metadata/annotations',
                        'value': annotations,
                    },
                ])
            try:
                api.patch_namespaced_secret(name, namespace, patch)
                break
            except kubernetes_exceptions.ApiException as error:
                if error.status in (409, 422):
                    continue
                raise BootstrapError(f'Unable to migrate token Secret {name}') from error
        else:
            raise BootstrapError(f'Unable to migrate token Secret {name} after concurrent updates')


def _reconcile_identity_secret(
    api: kubernetes_client.CoreV1Api,
    *,
    namespace: str,
    release_name: str,
    name: str,
    generate: Callable[[], dict[str, bytes]],
    validate: Callable[[str, dict[str, bytes]], None],
) -> dict[str, bytes]:
    for _ in range(_MAX_RECONCILE_ATTEMPTS):
        existing = _read_secret(api, namespace, name)
        if existing is None:
            data = generate()
            validate(name, data)
            if _write_secret(
                api, namespace,
                _identity_secret(name, release_name, data), False,
            ):
                return data
            continue
        adopt = _require_identity_owned(existing, release_name)
        data = _decode(existing)
        validate(name, data)
        if not adopt:
            return data
        if _write_secret(
            api,
            namespace,
            _identity_secret(
                name,
                release_name,
                data,
                existing.metadata.resource_version,
                existing.metadata.annotations,
            ),
            True,
        ):
            return data
    raise BootstrapError(
        f'Unable to reconcile credential Secret {name} after concurrent updates')


def _reconcile_hash_secret(
    api: kubernetes_client.CoreV1Api,
    *,
    namespace: str,
    release_name: str,
    name: str,
    hashes: dict[str, bytes],
) -> None:
    for _ in range(_MAX_RECONCILE_ATTEMPTS):
        existing = _read_secret(api, namespace, name)
        if existing is None:
            if _write_secret(
                api, namespace,
                _identity_secret(name, release_name, hashes), False,
            ):
                return
            continue
        adopt = _require_identity_owned(existing, release_name)
        existing_data = _decode(existing)
        # A failed upgrade can restore a Dex config that still references a
        # removed identity. Retain its hash so that rollback remains startable;
        # desired hashes win when a credential is rotated.
        hashes = existing_data | hashes
        if not adopt and existing_data == hashes:
            return
        if _write_secret(
            api,
            namespace,
            _identity_secret(
                name,
                release_name,
                hashes,
                existing.metadata.resource_version,
                existing.metadata.annotations,
            ),
            True,
        ):
            return
    raise BootstrapError(
        f'Unable to reconcile credential Secret {name} after concurrent updates')


def reconcile_identities(
    api: kubernetes_client.CoreV1Api,
    *,
    namespace: str,
    release_name: str,
    password_specs: tuple[PasswordSpec, ...],
    token_specs: tuple[TokenSpec, ...],
    oauth_secret_name: str | None,
    dex_hash_secret_name: str | None,
    mcp_secret_name: str | None = None,
) -> BootstrapResult:
    """Create or validate all managed bootstrap identity credentials."""
    password_hashes = {}
    for password_spec in password_specs:
        data = _reconcile_identity_secret(
            api,
            namespace=namespace,
            release_name=release_name,
            name=password_spec.secret_name,
            generate=_generate_admin,
            validate=_validate_admin,
        )
        password_hashes[password_spec.hash_env_name] = data['password-hash']

    observed_tokens = set()
    for token_spec in token_specs:
        data = _reconcile_identity_secret(
            api,
            namespace=namespace,
            release_name=release_name,
            name=token_spec.secret_name,
            generate=lambda: {'token': secrets.token_urlsafe(32).encode('ascii')},
            validate=_validate_token,
        )
        for token in data.values():
            if token in observed_tokens:
                raise BootstrapError('Managed bootstrap token values must be unique')
            observed_tokens.add(token)

    if dex_hash_secret_name is not None:
        _reconcile_hash_secret(
            api,
            namespace=namespace,
            release_name=release_name,
            name=dex_hash_secret_name,
            hashes=password_hashes,
        )

    oauth_data = {}
    if oauth_secret_name is not None:
        oauth_data = _reconcile_identity_secret(
            api,
            namespace=namespace,
            release_name=release_name,
            name=oauth_secret_name,
            generate=lambda: {
                'browser-client-secret': _generate_client_secret(),
                'cookie-secret': _generate_cookie_secret(),
            },
            validate=_validate_oauth,
        )

    dex_credentials = (
        *password_hashes.values(),
        oauth_data.get('browser-client-secret', b''),
    )
    mcp_identity = ''
    if mcp_secret_name is not None:
        mcp_data = _reconcile_identity_secret(
            api,
            namespace=namespace,
            release_name=release_name,
            name=mcp_secret_name,
            generate=lambda: {'client-secret': _generate_client_secret()},
            validate=_validate_mcp,
        )
        dex_credentials += (mcp_data['client-secret'],)
        mcp_identity = credential_identity('mcp', mcp_data['client-secret'])

    return BootstrapResult(
        dex_credential_identity=credential_identity('dex', *dex_credentials),
        oauth_credential_identity=credential_identity(
            'oauth2-proxy',
            oauth_data.get('browser-client-secret', b''),
            oauth_data.get('cookie-secret', b'')),
        mcp_credential_identity=mcp_identity,
    )


def _new_secret(
    name: str,
    release_name: str,
    state: CredentialState,
    resource_version: str | None = None,
    existing_annotations: dict[str, str] | None = None,
) -> kubernetes_client.V1Secret:
    annotations = dict(existing_annotations or {})
    annotations.update({
        annotation: str(generation)
        for annotation, generation in state.generations.items()
    })
    annotations[_CREDENTIAL_SOURCE] = _MANAGED_BY
    return kubernetes_client.V1Secret(
        metadata=kubernetes_client.V1ObjectMeta(
            name=name,
            resource_version=resource_version,
            labels={
                _MANAGED_BY_LABEL: _MANAGED_BY,
                _INSTANCE_LABEL: release_name,
            },
            annotations=annotations,
        ),
        type='Opaque',
        data=_encode(state.data),
    )


def _write_secret(
    api: kubernetes_client.CoreV1Api,
    namespace: str,
    secret: kubernetes_client.V1Secret,
    exists: bool,
) -> bool:
    name = secret.metadata.name
    try:
        if exists:
            api.replace_namespaced_secret(
                name=name, namespace=namespace, body=secret)
        else:
            record_issuance_if_configured(name)
            api.create_namespaced_secret(namespace=namespace, body=secret)
    except kubernetes_exceptions.ApiException as error:
        if error.status == 409 or (exists and error.status == 404):
            return False
        raise BootstrapError(f'Unable to write credential Secret {name}') from error
    return True


def _reconcile_admin(
    api: kubernetes_client.CoreV1Api,
    *,
    namespace: str,
    release_name: str,
    name: str,
    allow_initial_generation: bool,
    requested_generation: int,
) -> CredentialState:
    for _ in range(_MAX_RECONCILE_ATTEMPTS):
        existing = _read_secret(api, namespace, name)
        if existing is None:
            if not allow_initial_generation:
                raise BootstrapError(
                    f'{name} is missing and initial generation is disabled')
            state = CredentialState(
                data=_generate_admin(),
                generations={_PASSWORD_GENERATION: requested_generation},
            )
            if _write_secret(
                api, namespace, _new_secret(name, release_name, state), False,
            ):
                return state
            continue

        _require_owned(existing, release_name)
        stored_generation = _generation(
            existing, _PASSWORD_GENERATION, requested_generation)
        data = _decode(existing)
        _validate_admin(name, data)
        state = CredentialState(
            data=data,
            generations={_PASSWORD_GENERATION: stored_generation},
        )
        if stored_generation == requested_generation:
            return state
        state = CredentialState(
            data=_generate_admin(),
            generations={_PASSWORD_GENERATION: requested_generation},
        )
        if _write_secret(
            api,
            namespace,
            _new_secret(
                name,
                release_name,
                state,
                existing.metadata.resource_version,
                existing.metadata.annotations,
            ),
            True,
        ):
            return state
    raise BootstrapError(
        f'Unable to reconcile credential Secret {name} after concurrent updates')


def _reconcile_oauth(
    api: kubernetes_client.CoreV1Api,
    *,
    namespace: str,
    release_name: str,
    name: str,
    allow_initial_generation: bool,
    requested_client_generation: int,
    requested_cookie_generation: int,
) -> CredentialState:
    for _ in range(_MAX_RECONCILE_ATTEMPTS):
        existing = _read_secret(api, namespace, name)
        if existing is None:
            if not allow_initial_generation:
                raise BootstrapError(
                    f'{name} is missing and initial generation is disabled')
            state = CredentialState(
                data={
                    'browser-client-secret': _generate_client_secret(),
                    'cookie-secret': _generate_cookie_secret(),
                },
                generations={
                    _CLIENT_GENERATION: requested_client_generation,
                    _COOKIE_GENERATION: requested_cookie_generation,
                },
            )
            if _write_secret(
                api, namespace, _new_secret(name, release_name, state), False,
            ):
                return state
            continue

        _require_owned(existing, release_name)
        stored_client_generation = _generation(
            existing, _CLIENT_GENERATION, requested_client_generation)
        stored_cookie_generation = _generation(
            existing, _COOKIE_GENERATION, requested_cookie_generation)
        data = _decode(existing)
        _validate_oauth(name, data)
        if (
            stored_client_generation == requested_client_generation
            and stored_cookie_generation == requested_cookie_generation
        ):
            return CredentialState(
                data=data,
                generations={
                    _CLIENT_GENERATION: stored_client_generation,
                    _COOKIE_GENERATION: stored_cookie_generation,
                },
            )
        if stored_client_generation != requested_client_generation:
            data['browser-client-secret'] = _generate_client_secret()
        if stored_cookie_generation != requested_cookie_generation:
            data['cookie-secret'] = _generate_cookie_secret()
        state = CredentialState(
            data=data,
            generations={
                _CLIENT_GENERATION: requested_client_generation,
                _COOKIE_GENERATION: requested_cookie_generation,
            },
        )
        if _write_secret(
            api,
            namespace,
            _new_secret(
                name,
                release_name,
                state,
                existing.metadata.resource_version,
                existing.metadata.annotations,
            ),
            True,
        ):
            return state
    raise BootstrapError(
        f'Unable to reconcile credential Secret {name} after concurrent updates')


def reconcile(
    api: kubernetes_client.CoreV1Api,
    *,
    namespace: str,
    release_name: str,
    admin_secret_name: str,
    oauth_secret_name: str,
    allow_initial_generation: bool,
    password_generation: int,
    client_generation: int,
    cookie_generation: int,
) -> BootstrapResult:
    """Create, validate, or explicitly rotate embedded authentication Secrets."""
    if min(password_generation, client_generation, cookie_generation) < 1:
        raise BootstrapError('Credential generations must be positive integers')
    admin = _reconcile_admin(
        api,
        namespace=namespace,
        release_name=release_name,
        name=admin_secret_name,
        allow_initial_generation=allow_initial_generation,
        requested_generation=password_generation,
    )
    oauth = _reconcile_oauth(
        api,
        namespace=namespace,
        release_name=release_name,
        name=oauth_secret_name,
        allow_initial_generation=allow_initial_generation,
        requested_client_generation=client_generation,
        requested_cookie_generation=cookie_generation,
    )
    return BootstrapResult(
        dex_credential_identity=credential_identity(
            'dex', admin.data['password-hash'],
            oauth.data['browser-client-secret']),
        oauth_credential_identity=credential_identity(
            'oauth2-proxy', oauth.data['browser-client-secret'],
            oauth.data['cookie-secret']),
    )


def _record_rollout_identity(
    api: kubernetes_client.CoreV1Api,
    *,
    namespace: str,
    release_name: str,
    secret_name: str,
    rollout_annotation: str,
    rollout_identity: str,
) -> None:
    for _ in range(_MAX_RECONCILE_ATTEMPTS):
        secret = _read_secret(api, namespace, secret_name)
        if secret is None:
            raise BootstrapError(f'Credential Secret {secret_name} disappeared')
        _require_owned(secret, release_name)
        annotations = dict(secret.metadata.annotations or {})
        if annotations.get(rollout_annotation) == rollout_identity:
            return
        annotations[rollout_annotation] = rollout_identity
        secret.metadata.annotations = annotations
        try:
            api.replace_namespaced_secret(
                name=secret_name, namespace=namespace, body=secret)
            return
        except kubernetes_exceptions.ApiException as error:
            if error.status in (404, 409):
                continue
            raise BootstrapError(
                f'Unable to record rollout state on Secret {secret_name}') from error
    raise BootstrapError(
        f'Unable to record rollout state on Secret {secret_name} '
        'after concurrent updates')


def restart_pods_if_needed(
    api: kubernetes_client.CoreV1Api,
    *,
    namespace: str,
    release_name: str,
    tracking_secret_names: tuple[str, ...],
    rollout_annotation: str,
    rollout_identity: str,
    pod_label_selector: str,
    restart_timeout_seconds: float = 120,
) -> None:
    """Restart selected consumers only when their runtime identity changes."""
    tracking_secrets = []
    for secret_name in tracking_secret_names:
        secret = _read_secret(api, namespace, secret_name)
        if secret is None:
            raise BootstrapError(f'Credential Secret {secret_name} disappeared')
        _require_owned(secret, release_name)
        tracking_secrets.append(secret)
    if all(
        (secret.metadata.annotations or {}).get(rollout_annotation)
        == rollout_identity
        for secret in tracking_secrets
    ):
        return

    try:
        pods = api.list_namespaced_pod(
            namespace=namespace, label_selector=pod_label_selector).items
    except kubernetes_exceptions.ApiException as error:
        raise BootstrapError('Unable to list authentication consumer Pods') from error
    original_pod_identities = {
        str(pod.metadata.uid or pod.metadata.name)
        for pod in pods
        if pod.metadata and (pod.metadata.uid or pod.metadata.name)
    }
    for pod in pods:
        name = pod.metadata.name if pod.metadata else None
        if not name:
            raise BootstrapError('Authentication consumer Pod has no name')
        try:
            api.delete_namespaced_pod(
                name=name,
                namespace=namespace,
                body=kubernetes_client.V1DeleteOptions(),
            )
        except kubernetes_exceptions.ApiException as error:
            if error.status != 404:
                raise BootstrapError(
                    f'Unable to restart authentication consumer Pod {name}') from error

    if pods:
        deadline = time.monotonic() + restart_timeout_seconds
        while True:
            try:
                replacements = api.list_namespaced_pod(
                    namespace=namespace,
                    label_selector=pod_label_selector,
                ).items
            except kubernetes_exceptions.ApiException as error:
                raise BootstrapError(
                    'Unable to observe replacement authentication consumer Pods') from error
            ready_replacements = 0
            original_pods_remain = False
            for pod in replacements:
                if not pod.metadata:
                    continue
                identity = str(pod.metadata.uid or pod.metadata.name)
                if identity in original_pod_identities:
                    original_pods_remain = True
                    continue
                conditions = pod.status.conditions if pod.status else None
                if (
                    pod.metadata.deletion_timestamp is None
                    and any(
                        condition.type == 'Ready' and condition.status == 'True'
                        for condition in (conditions or [])
                    )
                ):
                    ready_replacements += 1
            if (
                replacements
                and not original_pods_remain
                and ready_replacements == len(replacements)
            ):
                break
            if time.monotonic() >= deadline:
                raise BootstrapError(
                    'Replacement authentication consumer Pods did not become ready')
            time.sleep(min(1.0, max(0.0, deadline - time.monotonic())))

    for secret_name in tracking_secret_names:
        _record_rollout_identity(
            api,
            namespace=namespace,
            release_name=release_name,
            secret_name=secret_name,
            rollout_annotation=rollout_annotation,
            rollout_identity=rollout_identity,
        )


def _positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError('must be a positive integer')
    return parsed


def _password_spec(value: str) -> PasswordSpec:
    try:
        identity_id, secret_name, hash_env_name = value.split('=', 2)
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            'must be IDENTITY=SECRET=HASH_ENV') from error
    if not all((identity_id, secret_name, hash_env_name)):
        raise argparse.ArgumentTypeError(
            'must be IDENTITY=SECRET=HASH_ENV')
    return PasswordSpec(identity_id, secret_name, hash_env_name)


def _token_spec(value: str) -> TokenSpec:
    try:
        identity_token, secret_name = value.split('=', 1)
        identity_id, token_name = identity_token.split('/', 1)
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            'must be IDENTITY/TOKEN=SECRET') from error
    if not all((identity_id, token_name, secret_name)):
        raise argparse.ArgumentTypeError(
            'must be IDENTITY/TOKEN=SECRET')
    return TokenSpec(identity_id, token_name, secret_name)


def _parse_arguments(arguments: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        allow_abbrev=False,
        description='Reconcile retained bootstrap identity credentials.')
    parser.add_argument('--namespace', required=True)
    parser.add_argument('--release-name', required=True)
    parser.add_argument('--migrate-tokens-only', action='store_true')
    parser.add_argument('--admin-secret-name')
    parser.add_argument('--oauth-secret-name')
    parser.add_argument('--mcp-secret-name')
    parser.add_argument(
        '--password', dest='password_specs', type=_password_spec,
        action='append', default=[])
    parser.add_argument(
        '--token', dest='token_specs', type=_token_spec,
        action='append', default=[])
    parser.add_argument('--dex-hash-secret-name')
    parser.add_argument(
        '--allow-initial-generation', action=argparse.BooleanOptionalAction,
        default=False)
    parser.add_argument(
        '--password-generation', type=_positive_integer, default=1)
    parser.add_argument(
        '--client-generation', type=_positive_integer, default=1)
    parser.add_argument(
        '--cookie-generation', type=_positive_integer, default=1)
    parser.add_argument('--dex-pod-selector')
    parser.add_argument('--config-rollout-identity')
    parser.add_argument('--oauth-pod-selector')
    parser.add_argument('--mcp-pod-selector')
    parser.add_argument(
        '--restart-timeout-seconds', type=_positive_integer, default=120)
    parsed = parser.parse_args(arguments)
    if parsed.migrate_tokens_only:
        allowed = {'--namespace', '--release-name', '--token', '--migrate-tokens-only'}
        supplied = sys.argv[1:] if arguments is None else arguments
        if not parsed.token_specs or any(
            argument.startswith('--') and argument.split('=', 1)[0] not in allowed
            for argument in supplied
        ):
            parser.error('--migrate-tokens-only requires tokens and permits only '
                         '--namespace, --release-name, and --token')
    return parsed


def main() -> None:
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    arguments = _parse_arguments()
    try:
        password_specs = tuple(getattr(arguments, 'password_specs', ()))
        token_specs = tuple(getattr(arguments, 'token_specs', ()))
        mcp_secret_name = getattr(arguments, 'mcp_secret_name', None)
        mcp_pod_selector = getattr(arguments, 'mcp_pod_selector', None)
        unified = bool(
            password_specs
            or token_specs
            or getattr(arguments, 'dex_hash_secret_name', None)
            or mcp_secret_name)
        if mcp_pod_selector and not mcp_secret_name:
            raise BootstrapError('--mcp-secret-name is required for an MCP rollout')
        if not unified and (
            not arguments.admin_secret_name or not arguments.oauth_secret_name
        ):
            raise BootstrapError(
                '--admin-secret-name and --oauth-secret-name are required in legacy mode')
        if (
            unified
            and arguments.config_rollout_identity is not None
            and arguments.dex_pod_selector
            and not arguments.dex_hash_secret_name
        ):
            raise BootstrapError(
                '--dex-hash-secret-name is required for a unified Dex config rollout')
        kubernetes_config.load_incluster_config()
        api = kubernetes_client.CoreV1Api(BoundedApiClient())
        if getattr(arguments, 'migrate_tokens_only', False):
            migrate_tokens(api, namespace=arguments.namespace, release_name=arguments.release_name,
                           token_specs=token_specs)
            logging.info('Managed token ownership migration completed')
            return
        if unified:
            result = reconcile_identities(
                api,
                namespace=arguments.namespace,
                release_name=arguments.release_name,
                password_specs=password_specs,
                token_specs=token_specs,
                oauth_secret_name=arguments.oauth_secret_name,
                dex_hash_secret_name=arguments.dex_hash_secret_name,
                mcp_secret_name=mcp_secret_name,
            )
        else:
            result = reconcile(
                api,
                namespace=arguments.namespace,
                release_name=arguments.release_name,
                admin_secret_name=arguments.admin_secret_name,
                oauth_secret_name=arguments.oauth_secret_name,
                allow_initial_generation=arguments.allow_initial_generation,
                password_generation=arguments.password_generation,
                client_generation=arguments.client_generation,
                cookie_generation=arguments.cookie_generation,
            )
        restart_deadline = (
            time.monotonic() + arguments.restart_timeout_seconds)
        if arguments.dex_pod_selector:
            if unified:
                dex_tracking_names = tuple(
                    spec.secret_name for spec in password_specs)
                if arguments.oauth_secret_name:
                    dex_tracking_names += (arguments.oauth_secret_name,)
                if arguments.dex_hash_secret_name:
                    dex_tracking_names += (arguments.dex_hash_secret_name,)
                if mcp_secret_name:
                    dex_tracking_names += (mcp_secret_name,)
            else:
                dex_tracking_names = (
                    arguments.admin_secret_name, arguments.oauth_secret_name)
            restart_pods_if_needed(
                api,
                namespace=arguments.namespace,
                release_name=arguments.release_name,
                tracking_secret_names=dex_tracking_names,
                rollout_annotation=(
                    'osmo.nvidia.com/embedded-dex-credential-rollout'),
                rollout_identity=result.dex_credential_identity,
                pod_label_selector=arguments.dex_pod_selector,
                restart_timeout_seconds=max(
                    0, restart_deadline - time.monotonic()),
            )
        if arguments.oauth_pod_selector and arguments.oauth_secret_name:
            restart_pods_if_needed(
                api,
                namespace=arguments.namespace,
                release_name=arguments.release_name,
                tracking_secret_names=(arguments.oauth_secret_name,),
                rollout_annotation=(
                    'osmo.nvidia.com/embedded-dex-oauth-credential-rollout'),
                rollout_identity=result.oauth_credential_identity,
                pod_label_selector=arguments.oauth_pod_selector,
                restart_timeout_seconds=max(
                    0, restart_deadline - time.monotonic()),
            )
        if (
            arguments.config_rollout_identity is not None
            and arguments.dex_pod_selector
        ):
            config_tracking_secret = (
                arguments.dex_hash_secret_name
                if unified else arguments.admin_secret_name)
            restart_pods_if_needed(
                api,
                namespace=arguments.namespace,
                release_name=arguments.release_name,
                tracking_secret_names=(config_tracking_secret,),
                rollout_annotation=(
                    'osmo.nvidia.com/embedded-dex-config-rollout'),
                rollout_identity=arguments.config_rollout_identity,
                pod_label_selector=arguments.dex_pod_selector,
                restart_timeout_seconds=max(
                    0, restart_deadline - time.monotonic()),
            )
        if mcp_pod_selector and mcp_secret_name:
            restart_pods_if_needed(
                api,
                namespace=arguments.namespace,
                release_name=arguments.release_name,
                tracking_secret_names=(mcp_secret_name,),
                rollout_annotation=(
                    'osmo.nvidia.com/embedded-dex-mcp-credential-rollout'),
                rollout_identity=result.mcp_credential_identity,
                pod_label_selector=mcp_pod_selector,
                restart_timeout_seconds=max(
                    0, restart_deadline - time.monotonic()),
            )
    except BootstrapError as error:
        logging.error('%s', error)
        raise SystemExit(1) from None
    logging.info('Identity credential reconciliation completed')


if __name__ == '__main__':
    main()
