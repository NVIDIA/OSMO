#!/usr/bin/env python3
"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import json
import logging
import os
import re
import secrets
import subprocess
import tempfile
import time

from bazel_tools.tools.python.runfiles import runfiles  # type: ignore

from run.check_tools import check_required_tools
from run.kind_utils import (
    detect_platform,
    check_cluster_exists,
    create_cluster,
    setup_osmo_namespace,
)
from run.run_command import run_command_with_logging
from run.print_next_steps import print_next_steps

logging.basicConfig(format='%(message)s')
logger = logging.getLogger()
RUNFILES = runfiles.Create()
_BACKEND_TOKEN_PATTERN = re.compile(r'^[A-Za-z0-9_-]+$')
_VALID_BACKEND_TOKEN_LENGTHS = frozenset((43, 64))


def _decode_backend_token(secret: dict, key: str, required: bool) -> str | None:
    """Decode and validate one backend token without including it in errors."""
    secret_data = secret.get('data')
    encoded_token = secret_data.get(key) if isinstance(secret_data, dict) else None
    if encoded_token is None:
        if required:
            raise RuntimeError(f'Backend token Secret osmo/agent-token is missing key {key}')
        return None
    if not isinstance(encoded_token, str):
        raise RuntimeError(
            f'Backend token Secret osmo/agent-token key {key} is not valid base64')
    try:
        token = base64.b64decode(encoded_token, validate=True).decode('ascii')
    except (UnicodeError, ValueError) as error:
        raise RuntimeError(
            f'Backend token Secret osmo/agent-token key {key} is unreadable') from error
    if token.endswith('\r\n'):
        token = token[:-2]
    elif token.endswith('\n'):
        token = token[:-1]
    if len(token) not in _VALID_BACKEND_TOKEN_LENGTHS:
        raise RuntimeError(
            f'Backend token Secret osmo/agent-token key {key} has invalid length')
    if not _BACKEND_TOKEN_PATTERN.fullmatch(token):
        raise RuntimeError(
            f'Backend token Secret osmo/agent-token key {key} has invalid format')
    return token


def _backend_token_exists() -> bool:
    """Read and validate the backend token Secret without printing its values."""
    process = subprocess.run([
        'kubectl', 'get', 'secret', 'agent-token', '--namespace', 'osmo',
        '--ignore-not-found=true',
        '-o', 'json',
    ], check=False, capture_output=True, text=True)
    if process.returncode != 0:
        raise RuntimeError(
            'Failed to check backend token Secret osmo/agent-token: '
            f'{process.stderr.strip()}')
    if not process.stdout.strip():
        return False
    try:
        secret = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            'Failed to parse backend token Secret osmo/agent-token') from error
    current_token = _decode_backend_token(secret, 'token', required=True)
    previous_token = _decode_backend_token(secret, 'previous-token', required=False)
    if current_token is None:
        raise RuntimeError('Backend token Secret osmo/agent-token is missing key token')
    if previous_token is not None and secrets.compare_digest(current_token, previous_token):
        raise RuntimeError(
            'Backend token Secret osmo/agent-token contains duplicate token values')
    return True


def _bootstrap_backend_token() -> None:
    """Create the local backend credential with kubectl when it is missing."""
    logger.info('🔑 Checking the backend credential Secret...')
    if _backend_token_exists():
        logger.info('✅ Backend credential Secret osmo/agent-token already exists')
        return

    token_file_path = ''
    try:
        with tempfile.NamedTemporaryFile(
                mode='w', encoding='ascii', delete=False) as token_file:
            token_file_path = token_file.name
            token_file.write(secrets.token_urlsafe(32))
        os.chmod(token_file_path, 0o600)

        process = run_command_with_logging([
            'kubectl', 'create', 'secret', 'generic', 'agent-token',
            '--namespace', 'osmo',
            f'--from-file=token={token_file_path}',
        ], 'Creating backend credential Secret')
        if process.has_failed():
            if _backend_token_exists():
                logger.info(
                    '✅ Backend credential Secret osmo/agent-token was created concurrently')
                return
            with open(process.stderr_file, 'r', encoding='utf-8') as error_file:
                error_message = error_file.read().strip()
            raise RuntimeError(
                f'Failed to create backend token Secret osmo/agent-token: {error_message}')
    finally:
        if token_file_path:
            os.unlink(token_file_path)

    logger.info('✅ Created backend credential Secret osmo/agent-token')


def _install_osmo_service(
    service_name: str,
    chart_path: str,
    values_path: str,
    image_location: str,
    image_tag: str,
    detected_platform: str
) -> None:
    """Install a single OSMO service using Helm."""
    logger.info('   Installing %s', service_name)

    try:
        if service_name != 'ui':
            process = run_command_with_logging(
                ['helm', 'dependency', 'build', chart_path],
                f'Building dependencies for {service_name}')

            if process.has_failed():
                logger.error('   ❌ Error building dependencies for %s', service_name)
                logger.error('      Check stderr: %s', process.stderr_file)
                raise RuntimeError(f'Error building dependencies for {service_name}')

        image_location_override = f'global.osmoImageLocation={image_location}'

        process = run_command_with_logging([
            'helm', 'upgrade', '--install', service_name, chart_path,
            '-f', values_path,
            '--set', image_location_override,
            '--set', f'global.osmoImageTag={image_tag}',
            '--set', 'services.masterEncryptionKey.bootstrap.enabled=true',
            '--set', rf'global.nodeSelector.kubernetes\.io\/arch={detected_platform}',
            '-n', 'osmo', '--wait'
        ], f'Installing {service_name}')

        if not process.has_failed():
            logger.info('   ✅ %s installed successfully in %.2fs',
                        service_name, process.get_elapsed_time())
        else:
            logger.error('   ❌ Error installing %s', service_name)
            logger.error('      Check output files for details:')
            logger.error('      - stdout: %s', process.stdout_file)
            logger.error('      - stderr: %s', process.stderr_file)
            raise RuntimeError(f'Error installing {service_name}')
    except OSError as e:
        logger.error('   ❌ Unexpected error installing %s: %s', service_name, e)
        raise RuntimeError(f'Unexpected error installing {service_name}: {e}') from e


def _install_osmo_services(image_location: str, image_tag: str, detected_platform: str) -> None:
    """Install the core OSMO services using Helm."""
    logger.info('🚀 Installing OSMO services...')

    runfile_repo = RUNFILES.CurrentRepository() or '_main'

    services = [
        ('osmo',
         'deployments/charts/service/Chart.yaml',
         'run/minimal/osmo_values.yaml'),
    ]

    services_with_paths = []
    for service_name, chart_path, values_path in services:
        abs_chart_path = os.path.dirname(
            RUNFILES.Rlocation(os.path.join(runfile_repo, chart_path)))
        abs_values_path = RUNFILES.Rlocation(os.path.join(runfile_repo, values_path))

        if not (abs_chart_path and os.path.exists(abs_chart_path)):
            logger.error('❌ Error: Could not locate chart path: %s', abs_chart_path)
            raise RuntimeError(f'Could not locate chart path: {abs_chart_path}')
        if not (abs_values_path and os.path.exists(abs_values_path)):
            logger.error('❌ Error: Could not locate values file: %s', abs_values_path)
            raise RuntimeError(f'Could not locate values file: {abs_values_path}')

        services_with_paths.append((service_name, abs_chart_path, abs_values_path))

    for service_name, chart_path, values_path in services_with_paths:
        _install_osmo_service(
            service_name, chart_path, values_path,
            image_location, image_tag, detected_platform
        )

    logger.info('✅ All OSMO services installed successfully')


def start_service_kind(args: argparse.Namespace) -> None:
    """Start the OSMO service using KIND."""
    start_time = time.time()

    check_required_tools(['docker', 'kind', 'kubectl', 'helm'])

    try:
        if check_cluster_exists(args.cluster_name):
            logger.info('✅ Cluster \'%s\' already exists, skipping creation', args.cluster_name)
        else:
            create_cluster(args.cluster_name)

        detected_platform = detect_platform()
        logger.info('📱 Detected platform: %s', detected_platform)

        setup_osmo_namespace(
            args.container_registry,
            args.container_registry_username,
            args.container_registry_password)
        _bootstrap_backend_token()
        _install_osmo_services(args.image_location, args.image_tag, detected_platform)

        total_time = time.time() - start_time
        logger.info('\n🎉 OSMO service setup complete in %.2fs!', total_time)
        logger.info('=' * 50)

        print_next_steps(mode='kind', show_start_backend=True, show_update_configs=True)
    except Exception as e:
        logger.error('❌ Error setting up services: %s', e)
        raise SystemExit(1) from e
