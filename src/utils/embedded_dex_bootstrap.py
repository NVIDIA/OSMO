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
import dataclasses
import hashlib
import logging
import secrets
import time

import bcrypt
from kubernetes import client as kubernetes_client  # type: ignore
from kubernetes import config as kubernetes_config  # type: ignore
from kubernetes.client import exceptions as kubernetes_exceptions  # type: ignore


_MANAGED_BY = 'osmo-embedded-dex-bootstrap'
_MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by'
_INSTANCE_LABEL = 'app.kubernetes.io/instance'
_PASSWORD_GENERATION = 'osmo.nvidia.com/password-generation'
_CLIENT_GENERATION = 'osmo.nvidia.com/browser-client-secret-generation'
_COOKIE_GENERATION = 'osmo.nvidia.com/cookie-secret-generation'
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
        or labels.get(_MANAGED_BY_LABEL) != _MANAGED_BY
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


def _parse_arguments(arguments: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Reconcile retained embedded Dex credentials.')
    parser.add_argument('--namespace', required=True)
    parser.add_argument('--release-name', required=True)
    parser.add_argument('--admin-secret-name', required=True)
    parser.add_argument('--oauth-secret-name', required=True)
    parser.add_argument(
        '--allow-initial-generation', action=argparse.BooleanOptionalAction,
        default=False)
    parser.add_argument(
        '--password-generation', type=_positive_integer, required=True)
    parser.add_argument(
        '--client-generation', type=_positive_integer, required=True)
    parser.add_argument(
        '--cookie-generation', type=_positive_integer, required=True)
    parser.add_argument('--dex-pod-selector', required=True)
    parser.add_argument('--config-rollout-identity')
    parser.add_argument('--oauth-pod-selector', required=True)
    parser.add_argument(
        '--restart-timeout-seconds', type=_positive_integer, default=120)
    return parser.parse_args(arguments)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    arguments = _parse_arguments()
    kubernetes_config.load_incluster_config()
    try:
        api = kubernetes_client.CoreV1Api()
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
        restart_pods_if_needed(
            api,
            namespace=arguments.namespace,
            release_name=arguments.release_name,
            tracking_secret_names=(
                arguments.admin_secret_name, arguments.oauth_secret_name),
            rollout_annotation=(
                'osmo.nvidia.com/embedded-dex-credential-rollout'),
            rollout_identity=result.dex_credential_identity,
            pod_label_selector=arguments.dex_pod_selector,
            restart_timeout_seconds=max(
                0, restart_deadline - time.monotonic()),
        )
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
        if arguments.config_rollout_identity is not None:
            restart_pods_if_needed(
                api,
                namespace=arguments.namespace,
                release_name=arguments.release_name,
                tracking_secret_names=(arguments.admin_secret_name,),
                rollout_annotation=(
                    'osmo.nvidia.com/embedded-dex-config-rollout'),
                rollout_identity=arguments.config_rollout_identity,
                pod_label_selector=arguments.dex_pod_selector,
                restart_timeout_seconds=max(
                    0, restart_deadline - time.monotonic()),
            )
    except BootstrapError as error:
        logging.error('%s', error)
        raise SystemExit(1) from None
    logging.info('Embedded Dex credential reconciliation completed')


if __name__ == '__main__':
    main()
