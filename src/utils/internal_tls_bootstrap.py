"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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
import dataclasses
import datetime
import sys
from typing import Iterable

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from kubernetes import client as kubernetes_client  # type: ignore
from kubernetes import config as kubernetes_config  # type: ignore
from kubernetes.client import exceptions as kubernetes_exceptions  # type: ignore

_MANAGED_BY = 'osmo-internal-tls-bootstrap'
_MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by'
_INSTANCE_LABEL = 'app.kubernetes.io/instance'


class BootstrapError(RuntimeError):
    """An actionable generated-TLS contract violation."""


@dataclasses.dataclass(frozen=True, slots=True)
class LeafSpec:
    secret_name: str
    dns_name: str


@dataclasses.dataclass(slots=True)
class KeyPair:
    certificate: bytes
    private_key: bytes


def _active_pod(pod: object) -> bool:
    metadata = getattr(pod, 'metadata', None)
    phase = getattr(getattr(pod, 'status', None), 'phase', None)
    return (
        getattr(metadata, 'deletion_timestamp', None) is None
        and phase not in {'Succeeded', 'Failed'}
    )


def verify_rollout(
    core_api: kubernetes_client.CoreV1Api,
    apps_api: kubernetes_client.AppsV1Api,
    autoscaling_api: kubernetes_client.AutoscalingV2Api,
    *,
    namespace: str,
    deployment_names: Iterable[str],
    allowed_annotations: set[str] | None,
    allowed_annotation_suffixes: set[str] | None = None,
    require_complete: bool = True,
) -> None:
    """Prove every TLS consumer is on one complete, HPA-frozen rollout."""
    names = set(deployment_names)
    try:
        hpas = autoscaling_api.list_namespaced_horizontal_pod_autoscaler(
            namespace=namespace
        ).items
        for hpa in hpas:
            target = getattr(getattr(hpa, 'spec', None), 'scale_target_ref', None)
            if (
                getattr(target, 'kind', None) == 'Deployment'
                and getattr(target, 'name', None) in names
                and getattr(hpa.spec, 'min_replicas', None)
                != getattr(hpa.spec, 'max_replicas', None)
            ):
                raise BootstrapError(
                    'Internal TLS CA rotation requires every consumer HPA to be frozen'
                )

        for name in names:
            deployment = apps_api.read_namespaced_deployment(
                name=name,
                namespace=namespace,
            )
            metadata = deployment.metadata
            spec = deployment.spec
            status = deployment.status
            desired = spec.replicas if spec.replicas is not None else 1
            counts = (
                status.replicas,
                status.updated_replicas,
                status.ready_replicas,
                status.available_replicas,
            )
            if require_complete and (
                status.observed_generation != metadata.generation
                or any((count or 0) != desired for count in counts)
                or (status.unavailable_replicas or 0) != 0
            ):
                raise BootstrapError(
                    'Internal TLS CA rotation requires a complete consumer rollout'
                )
            match_labels = getattr(spec.selector, 'match_labels', None) or {}
            if not match_labels:
                raise BootstrapError('Internal TLS consumer selector is invalid')
            selector = ','.join(
                f'{key}={value}' for key, value in sorted(match_labels.items())
            )
            pods = core_api.list_namespaced_pod(
                namespace=namespace,
                label_selector=selector,
            ).items
            active_pods = [pod for pod in pods if _active_pod(pod)]
            if require_complete and len(active_pods) != desired:
                raise BootstrapError(
                    'Internal TLS CA rotation found mixed consumer pod generations'
                )
            if not active_pods:
                raise BootstrapError(
                    'Internal TLS CA rotation found no active consumer pods'
                )
            observed_annotations = {
                (getattr(pod.metadata, 'annotations', None) or {}).get(
                    'checksum/internal-tls-ca-phase'
                )
                for pod in active_pods
            }
            if allowed_annotations and any(
                value not in allowed_annotations
                and not (
                    value
                    and allowed_annotation_suffixes
                    and any(
                        value.endswith(suffix)
                        for suffix in allowed_annotation_suffixes
                    )
                )
                for value in observed_annotations
            ):
                raise BootstrapError(
                    'Internal TLS CA rotation found a consumer on the wrong phase'
                )
    except kubernetes_exceptions.ApiException as error:
        raise BootstrapError('Unable to verify internal TLS consumer rollout') from error


def _read_rotation_state(
    api: kubernetes_client.CoreV1Api,
    *,
    namespace: str,
    release_name: str,
    ca_secret_name: str,
) -> tuple[str, str]:
    secret = _read_secret(api, namespace, ca_secret_name)
    _require_owned(secret, release_name)
    try:
        rotation_id = (_decode_secret_data(secret, 'rotation-id') or b'').decode(
            'utf-8'
        )
        phase = (_decode_secret_data(secret, 'rotation-phase') or b'stable').decode(
            'utf-8'
        )
    except UnicodeDecodeError as error:
        raise BootstrapError('Generated TLS CA rotation metadata is invalid') from error
    if phase not in {'stable', 'prepare', 'activate', 'retire'}:
        raise BootstrapError('Generated TLS CA rotation metadata is invalid')
    return rotation_id, phase


def verify_transition_rollout(
    core_api: kubernetes_client.CoreV1Api,
    apps_api: kubernetes_client.AppsV1Api,
    autoscaling_api: kubernetes_client.AutoscalingV2Api,
    *,
    namespace: str,
    release_name: str,
    ca_secret_name: str,
    deployment_names: Iterable[str],
    requested_rotation_id: str,
    requested_phase: str,
) -> None:
    """Gate a new phase strictly, but let an already-applied phase converge."""
    stored_rotation_id, stored_phase = _read_rotation_state(
        core_api,
        namespace=namespace,
        release_name=release_name,
        ca_secret_name=ca_secret_name,
    )
    predecessor = {
        'prepare': 'stable',
        'activate': 'prepare',
        'retire': 'activate',
    }[requested_phase]
    target_annotation = f'{requested_rotation_id}:{requested_phase}'
    if stored_phase == requested_phase and stored_rotation_id == requested_rotation_id:
        predecessor_annotation = f'{requested_rotation_id}:{predecessor}'
        allowed_annotations = {target_annotation, predecessor_annotation}
        verify_rollout(
            core_api,
            apps_api,
            autoscaling_api,
            namespace=namespace,
            deployment_names=deployment_names,
            allowed_annotations=allowed_annotations,
            allowed_annotation_suffixes=(
                {':stable'} if requested_phase == 'prepare' else None
            ),
            require_complete=False,
        )
        return
    if stored_phase != predecessor:
        raise BootstrapError(
            f'CA {requested_phase} requires the durable {predecessor} phase'
        )
    if requested_phase != 'prepare' and stored_rotation_id != requested_rotation_id:
        raise BootstrapError(
            f'CA {requested_phase} requires the matching rotation id'
        )
    verify_rollout(
        core_api,
        apps_api,
        autoscaling_api,
        namespace=namespace,
        deployment_names=deployment_names,
        allowed_annotations={f'{stored_rotation_id}:{stored_phase}'},
    )


def _decode_secret_data(secret: object, key: str) -> bytes | None:
    encoded = getattr(secret, 'data', None) or {}
    value = encoded.get(key)
    if not value:
        return None
    try:
        return base64.b64decode(value, validate=True)
    except ValueError as error:
        raise BootstrapError(f'Generated TLS Secret has invalid key {key}') from error


def _encode_secret_data(values: dict[str, bytes]) -> dict[str, str]:
    return {
        key: base64.b64encode(value).decode('ascii')
        for key, value in values.items()
    }


def _read_secret(
    api: kubernetes_client.CoreV1Api,
    namespace: str,
    name: str,
) -> object:
    try:
        return api.read_namespaced_secret(name=name, namespace=namespace)
    except kubernetes_exceptions.ApiException as error:
        if error.status == 404:
            raise BootstrapError(
                f'Generated TLS Secret {name} is missing; restore the retained Secret'
            ) from error
        raise BootstrapError(f'Unable to read generated TLS Secret {name}') from error


def _require_owned(secret: object, release_name: str) -> None:
    metadata = getattr(secret, 'metadata', None)
    labels = getattr(metadata, 'labels', None) or {}
    if (
        labels.get(_MANAGED_BY_LABEL) != _MANAGED_BY
        or labels.get(_INSTANCE_LABEL) != release_name
    ):
        name = getattr(metadata, 'name', '<unknown>')
        raise BootstrapError(
            f'Generated TLS Secret {name} is not owned by release {release_name}'
        )


def _replace_secret(
    api: kubernetes_client.CoreV1Api,
    namespace: str,
    secret: object,
    secret_type: str,
    values: dict[str, bytes],
) -> None:
    setattr(secret, 'data', _encode_secret_data(values))
    setattr(secret, 'type', secret_type)
    try:
        api.replace_namespaced_secret(
            name=getattr(getattr(secret, 'metadata'), 'name'),
            namespace=namespace,
            body=secret,
        )
    except kubernetes_exceptions.ApiException as error:
        raise BootstrapError('Unable to update generated TLS Secret') from error


def _serialize_key(private_key: rsa.RSAPrivateKey) -> bytes:
    return private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )


def _generate_ca(now: datetime.datetime) -> KeyPair:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'OSMO internal CA')])
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=825))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(private_key, hashes.SHA256())
    )
    return KeyPair(
        certificate.public_bytes(serialization.Encoding.PEM),
        _serialize_key(private_key),
    )


def _load_key_pair(certificate: bytes | None, private_key: bytes | None) -> KeyPair:
    if not certificate or not private_key:
        raise BootstrapError('Generated TLS certificate and private key are required')
    try:
        loaded_certificate = x509.load_pem_x509_certificate(certificate)
        loaded_private_key = serialization.load_pem_private_key(
            private_key,
            password=None,
        )
    except ValueError as error:
        raise BootstrapError('Generated TLS certificate or key is invalid') from error
    if not isinstance(loaded_private_key, rsa.RSAPrivateKey):
        raise BootstrapError('Generated TLS private key must be RSA')
    certificate_public_key = loaded_certificate.public_key()
    if not isinstance(certificate_public_key, rsa.RSAPublicKey):
        raise BootstrapError('Generated TLS certificate key must be RSA')
    if (
        certificate_public_key.public_numbers()
        != loaded_private_key.public_key().public_numbers()
    ):
        raise BootstrapError('Generated TLS certificate and private key do not match')
    return KeyPair(certificate, private_key)


def _load_ca(
    certificate: bytes | None,
    private_key: bytes | None,
    now: datetime.datetime,
    *,
    validate_time: bool = True,
) -> KeyPair:
    pair = _load_key_pair(certificate, private_key)
    loaded_certificate = x509.load_pem_x509_certificate(pair.certificate)
    public_key = loaded_certificate.public_key()
    if not isinstance(public_key, rsa.RSAPublicKey):
        raise BootstrapError('Generated TLS CA certificate key must be RSA')
    signature_hash_algorithm = loaded_certificate.signature_hash_algorithm
    if signature_hash_algorithm is None:
        raise BootstrapError('Generated TLS CA certificate signature is unsupported')
    try:
        constraints = loaded_certificate.extensions.get_extension_for_class(
            x509.BasicConstraints
        ).value
        if not constraints.ca or loaded_certificate.issuer != loaded_certificate.subject:
            raise BootstrapError('Generated TLS CA certificate is not a self-signed CA')
        public_key.verify(
            loaded_certificate.signature,
            loaded_certificate.tbs_certificate_bytes,
            padding.PKCS1v15(),
            signature_hash_algorithm,
        )
    except (InvalidSignature, x509.ExtensionNotFound) as error:
        raise BootstrapError('Generated TLS CA certificate is not a self-signed CA') from error
    if validate_time and not (
        loaded_certificate.not_valid_before_utc <= now
        < loaded_certificate.not_valid_after_utc
    ):
        raise BootstrapError('Generated TLS CA certificate is not currently valid')
    return pair


def _leaf_matches_contract(
    certificate: bytes | None,
    private_key: bytes | None,
    ca: KeyPair,
    dns_name: str,
    namespace: str,
    now: datetime.datetime,
) -> bool:
    try:
        pair = _load_key_pair(certificate, private_key)
        leaf_certificate = x509.load_pem_x509_certificate(pair.certificate)
        ca_certificate = x509.load_pem_x509_certificate(ca.certificate)
        ca_public_key = ca_certificate.public_key()
        if not isinstance(ca_public_key, rsa.RSAPublicKey):
            return False
        signature_hash_algorithm = leaf_certificate.signature_hash_algorithm
        if signature_hash_algorithm is None:
            return False
        ca_public_key.verify(
            leaf_certificate.signature,
            leaf_certificate.tbs_certificate_bytes,
            padding.PKCS1v15(),
            signature_hash_algorithm,
        )
        expected_names = {
            dns_name,
            f'{dns_name}.{namespace}',
            f'{dns_name}.{namespace}.svc',
        }
        actual_names = set(
            leaf_certificate.extensions.get_extension_for_class(
                x509.SubjectAlternativeName
            ).value.get_values_for_type(x509.DNSName)
        )
        minimum_expiry = now + datetime.timedelta(days=30)
        return (
            leaf_certificate.issuer == ca_certificate.subject
            and leaf_certificate.not_valid_before_utc <= now
            and leaf_certificate.not_valid_after_utc > minimum_expiry
            and actual_names == expected_names
        )
    except (BootstrapError, InvalidSignature, ValueError, x509.ExtensionNotFound):
        return False


def _generate_leaf(
    ca: KeyPair,
    dns_name: str,
    namespace: str,
    now: datetime.datetime,
) -> KeyPair:
    ca_certificate = x509.load_pem_x509_certificate(ca.certificate)
    ca_private_key = serialization.load_pem_private_key(ca.private_key, password=None)
    if not isinstance(ca_private_key, rsa.RSAPrivateKey):
        raise BootstrapError('Generated TLS CA private key must be RSA')
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, dns_name)])
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_certificate.subject)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=397))
        .add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.DNSName(dns_name),
                    x509.DNSName(f'{dns_name}.{namespace}'),
                    x509.DNSName(f'{dns_name}.{namespace}.svc'),
                ]
            ),
            critical=False,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        .sign(ca_private_key, hashes.SHA256())
    )
    return KeyPair(
        certificate.public_bytes(serialization.Encoding.PEM),
        _serialize_key(private_key),
    )


def reconcile(
    api: kubernetes_client.CoreV1Api,
    *,
    namespace: str,
    release_name: str,
    ca_secret_name: str,
    trust_secret_name: str,
    leaf_specs: list[LeafSpec],
    leaf_rotation_nonce: str,
    ca_rotation_id: str,
    ca_rotation_phase: str,
    fail_if_missing: bool,
    now: datetime.datetime,
    rollout_verified: bool = False,
) -> None:
    if ca_rotation_phase != 'stable' and not rollout_verified:
        raise BootstrapError(
            'Internal TLS CA rotation requires verified consumer rollout state'
        )
    ca_secret = _read_secret(api, namespace, ca_secret_name)
    _require_owned(ca_secret, release_name)
    current_certificate = _decode_secret_data(ca_secret, 'ca.crt')
    current_private_key = _decode_secret_data(ca_secret, 'ca.key')
    if not current_certificate or not current_private_key:
        if fail_if_missing:
            raise BootstrapError(
                f'Generated TLS CA Secret {ca_secret_name} is incomplete; restore it'
            )
        current = _generate_ca(now)
    else:
        current = _load_ca(current_certificate, current_private_key, now)

    pending_certificate = _decode_secret_data(ca_secret, 'pending-ca.crt')
    pending_private_key = _decode_secret_data(ca_secret, 'pending-ca.key')
    previous_certificate = _decode_secret_data(ca_secret, 'previous-ca.crt')
    previous_private_key = _decode_secret_data(ca_secret, 'previous-ca.key')
    try:
        rotation_id = (_decode_secret_data(ca_secret, 'rotation-id') or b'').decode(
            'utf-8'
        )
    except UnicodeDecodeError as error:
        raise BootstrapError('Generated TLS CA rotation metadata is invalid') from error
    pending = (
        _load_ca(pending_certificate, pending_private_key, now)
        if pending_certificate or pending_private_key
        else None
    )
    previous = (
        _load_ca(
            previous_certificate,
            previous_private_key,
            now,
            validate_time=False,
        )
        if previous_certificate or previous_private_key
        else None
    )
    force_leaf_rotation = False

    if ca_rotation_phase == 'stable':
        if pending or previous:
            raise BootstrapError(
                'CA rotation is incomplete; use prepare, activate, or retire with its rotation id'
            )
    elif ca_rotation_phase == 'prepare':
        if previous:
            raise BootstrapError('Retire the previous CA before preparing another')
        if pending and rotation_id != ca_rotation_id:
            raise BootstrapError('A different pending CA rotation already exists')
        pending = pending or _generate_ca(now)
        rotation_id = ca_rotation_id
    elif ca_rotation_phase == 'activate':
        if rotation_id != ca_rotation_id:
            raise BootstrapError('CA activate requires the matching prepared rotation')
        if not previous:
            if not pending:
                raise BootstrapError('CA activate requires the matching prepared rotation')
            previous = current
            current = pending
            pending = None
            force_leaf_rotation = True
    elif ca_rotation_phase == 'retire':
        if rotation_id != ca_rotation_id:
            raise BootstrapError('CA retire requires the active rotation id')
        if pending:
            raise BootstrapError('CA retire requires the prepared CA to be activated first')
        for leaf_spec in leaf_specs:
            leaf_secret = _read_secret(api, namespace, leaf_spec.secret_name)
            _require_owned(leaf_secret, release_name)
            if not _leaf_matches_contract(
                _decode_secret_data(leaf_secret, 'tls.crt'),
                _decode_secret_data(leaf_secret, 'tls.key'),
                current,
                leaf_spec.dns_name,
                namespace,
                now,
            ):
                raise BootstrapError(
                    'CA retire requires every leaf Secret to use the active CA'
                )
        previous = None
    else:
        raise BootstrapError(f'Unsupported CA rotation phase {ca_rotation_phase}')

    ca_values = {
        'ca.crt': current.certificate,
        'ca.key': current.private_key,
        'rotation-id': rotation_id.encode('utf-8'),
        'rotation-phase': ca_rotation_phase.encode('utf-8'),
    }
    if pending:
        ca_values['pending-ca.crt'] = pending.certificate
        ca_values['pending-ca.key'] = pending.private_key
    if previous:
        ca_values['previous-ca.crt'] = previous.certificate
        ca_values['previous-ca.key'] = previous.private_key
    _replace_secret(api, namespace, ca_secret, 'Opaque', ca_values)

    trust_secret = _read_secret(api, namespace, trust_secret_name)
    _require_owned(trust_secret, release_name)
    trust_bundle = current.certificate
    if pending:
        trust_bundle += pending.certificate
    elif previous:
        trust_bundle += previous.certificate
    _replace_secret(
        api,
        namespace,
        trust_secret,
        'Opaque',
        {'ca.crt': trust_bundle},
    )

    for leaf_spec in leaf_specs:
        leaf_secret = _read_secret(api, namespace, leaf_spec.secret_name)
        _require_owned(leaf_secret, release_name)
        existing_nonce = _decode_secret_data(leaf_secret, 'rotation-nonce')
        certificate = _decode_secret_data(leaf_secret, 'tls.crt')
        private_key = _decode_secret_data(leaf_secret, 'tls.key')
        valid_key_pair = _leaf_matches_contract(
            certificate,
            private_key,
            current,
            leaf_spec.dns_name,
            namespace,
            now,
        )
        if (
            force_leaf_rotation
            or existing_nonce != leaf_rotation_nonce.encode('utf-8')
            or not valid_key_pair
        ):
            leaf = _generate_leaf(current, leaf_spec.dns_name, namespace, now)
            _replace_secret(
                api,
                namespace,
                leaf_secret,
                'kubernetes.io/tls',
                {
                    'tls.crt': leaf.certificate,
                    'tls.key': leaf.private_key,
                    'rotation-nonce': leaf_rotation_nonce.encode('utf-8'),
                },
            )


def _parse_leaf(value: str) -> LeafSpec:
    secret_name, separator, dns_name = value.partition('=')
    if not separator or not secret_name or not dns_name:
        raise argparse.ArgumentTypeError('leaf must be SECRET_NAME=DNS_NAME')
    return LeafSpec(secret_name, dns_name)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--namespace', required=True)
    parser.add_argument('--release-name', required=True)
    parser.add_argument('--ca-secret', required=True)
    parser.add_argument('--trust-secret', required=True)
    parser.add_argument('--leaf', action='append', type=_parse_leaf, required=True)
    parser.add_argument('--consumer-deployment', action='append', required=True)
    parser.add_argument('--leaf-rotation-nonce', default='')
    parser.add_argument('--ca-rotation-id', default='')
    parser.add_argument(
        '--ca-rotation-phase',
        choices=('stable', 'prepare', 'activate', 'retire'),
        default='stable',
    )
    parser.add_argument('--fail-if-missing', action='store_true')
    arguments = parser.parse_args()
    try:
        kubernetes_config.load_incluster_config()
        core_api = kubernetes_client.CoreV1Api()
        rollout_verified = False
        if arguments.ca_rotation_phase != 'stable':
            verify_transition_rollout(
                core_api,
                kubernetes_client.AppsV1Api(),
                kubernetes_client.AutoscalingV2Api(),
                namespace=arguments.namespace,
                release_name=arguments.release_name,
                ca_secret_name=arguments.ca_secret,
                deployment_names=arguments.consumer_deployment,
                requested_rotation_id=arguments.ca_rotation_id,
                requested_phase=arguments.ca_rotation_phase,
            )
            rollout_verified = True
        reconcile(
            core_api,
            namespace=arguments.namespace,
            release_name=arguments.release_name,
            ca_secret_name=arguments.ca_secret,
            trust_secret_name=arguments.trust_secret,
            leaf_specs=arguments.leaf,
            leaf_rotation_nonce=arguments.leaf_rotation_nonce,
            ca_rotation_id=arguments.ca_rotation_id,
            ca_rotation_phase=arguments.ca_rotation_phase,
            fail_if_missing=arguments.fail_if_missing,
            now=datetime.datetime.now(datetime.UTC),
            rollout_verified=rollout_verified,
        )
    except BootstrapError as error:
        print(f'ERROR {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
