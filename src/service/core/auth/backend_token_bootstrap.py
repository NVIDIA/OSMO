"""Create backend bootstrap Secrets from inside a Kubernetes cluster."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import argparse
import base64
import binascii
import logging
import secrets

from kubernetes import client, config
from kubernetes.client import exceptions as kubernetes_exceptions


_VALID_TOKEN_LENGTHS = (43, 64)
logger = logging.getLogger(__name__)


def _validate_secret(secret: client.V1Secret, secret_name: str) -> None:
    """Validate token fields without logging their values."""
    secret_data = secret.data or {}
    observed_tokens: set[str] = set()
    for key, required in (('token', True), ('previous-token', False)):
        encoded_token = secret_data.get(key)
        if encoded_token is None:
            if required:
                raise ValueError(f'Backend token Secret {secret_name} is missing key {key}')
            continue
        try:
            token = base64.b64decode(encoded_token, validate=True).decode('utf-8')
        except (binascii.Error, UnicodeError) as error:
            raise ValueError(
                f'Backend token Secret {secret_name} key {key} is invalid') from error
        if token.endswith('\r\n'):
            token = token[:-2]
        elif token.endswith('\n'):
            token = token[:-1]
        if len(token) not in _VALID_TOKEN_LENGTHS:
            raise ValueError(
                f'Backend token Secret {secret_name} key {key} has invalid length')
        if token in observed_tokens:
            raise ValueError(f'Backend token Secret {secret_name} contains duplicate tokens')
        observed_tokens.add(token)


def ensure_secret(core_api: client.CoreV1Api, namespace: str, secret_name: str,
                  release_name: str, fail_if_missing: bool) -> None:
    """Preserve an existing token or create it when explicitly allowed."""
    try:
        existing_secret = core_api.read_namespaced_secret(secret_name, namespace)
    except kubernetes_exceptions.ApiException as error:
        if error.status != 404:
            raise RuntimeError(
                f'Unable to read backend token Secret {secret_name}: '
                f'Kubernetes API returned {error.status}') from error
    else:
        _validate_secret(existing_secret, secret_name)
        logger.info('Backend token Secret %s already exists; preserving it', secret_name)
        return

    if fail_if_missing:
        raise RuntimeError(
            f'Backend token Secret {secret_name} is missing during upgrade; restore it '
            'instead of generating a new credential')

    secret = client.V1Secret(
        metadata=client.V1ObjectMeta(
            name=secret_name,
            labels={
                'app.kubernetes.io/managed-by': 'osmo-backend-token-bootstrap',
                'app.kubernetes.io/instance': release_name,
            },
            annotations={
                'osmo.nvidia.com/credential-source': 'service-chart-bootstrap',
            }),
        string_data={'token': secrets.token_urlsafe(32)},
        type='Opaque')
    try:
        core_api.create_namespaced_secret(namespace, secret)
    except kubernetes_exceptions.ApiException as error:
        if error.status != 409:
            raise RuntimeError(
                f'Unable to create backend token Secret {secret_name}: '
                f'Kubernetes API returned {error.status}') from error
        existing_secret = core_api.read_namespaced_secret(secret_name, namespace)
        _validate_secret(existing_secret, secret_name)
        logger.info('Backend token Secret %s was created concurrently; preserving it',
                    secret_name)
        return
    logger.info('Created backend token Secret %s', secret_name)


def main() -> None:
    """Run the in-cluster Secret bootstrap command."""
    parser = argparse.ArgumentParser()
    parser.add_argument('--namespace', required=True)
    parser.add_argument('--release_name', required=True)
    parser.add_argument('--secret_name', action='append', required=True)
    parser.add_argument('--fail_if_missing', action='store_true')
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    config.load_incluster_config()
    core_api = client.CoreV1Api()
    for secret_name in args.secret_name:
        ensure_secret(core_api, args.namespace, secret_name, args.release_name,
                      args.fail_if_missing)


if __name__ == '__main__':
    main()
