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
import datetime
import json
import logging
import os

from bazel_tools.tools.python.runfiles import runfiles  # type: ignore

from run.check_tools import check_required_tools
from run.print_next_steps import print_next_steps
from run.run_command import login_osmo, logout_osmo, run_command_with_logging

from run.kind_utils import (
    check_cluster_exists,
    create_cluster,
    setup_osmo_namespace,
    detect_platform,
    setup_kai_scheduler,
)

logger = logging.getLogger()
RUNFILES = runfiles.Create()


def _check_backend_token_exists() -> bool:
    """Check if backend operator token already exists."""
    process = run_command_with_logging([
        'bazel', 'run', '@osmo_workspace//src/cli', '--', 'token', 'list',
        '-s', '--format-type', 'json'
    ], 'Checking existing tokens')

    if process.has_failed():
        logger.error('❌ Error: Failed to list existing tokens')
        logger.error('   Check stderr: %s', process.stderr_file)
        logger.error('   Make sure you\'re logged into OSMO CLI')
        raise RuntimeError('Failed to list existing tokens')

    try:
        with open(process.stdout_file, 'r', encoding='utf-8') as f:
            content = f.read().strip()

        if content == 'No tokens found':
            return False

        tokens = json.loads(content)
        return any(token.get('token_name') == 'backend-operator-token' for token in tokens)
    except (json.JSONDecodeError, OSError) as e:
        logger.error('❌ Error: Failed to parse token list: %s', e)
        raise RuntimeError(f'Failed to parse token list: {e}') from e


def _create_backend_token() -> str:
    """Create backend operator token and return the token value."""
    expires_at = (datetime.datetime.now() + datetime.timedelta(days=365)).strftime('%Y-%m-%d')

    process = run_command_with_logging([
        'bazel', 'run', '@osmo_workspace//src/cli', '--', 'token', 'set', 'backend-operator-token',
        '--expires-at', expires_at,
        '--description', 'Access token for default backend',
        '--service', '--roles', 'osmo-backend', '-t', 'json'
    ], 'Generating backend operator token')

    if process.has_failed():
        logger.error('❌ Error: Failed to generate backend operator token')
        logger.error('   Check stderr: %s', process.stderr_file)
        raise RuntimeError('Failed to generate backend operator token')

    try:
        with open(process.stdout_file, 'r', encoding='utf-8') as f:
            token_data = json.load(f)
            backend_token = token_data.get('token')
            if not backend_token:
                logger.error('❌ Error: Could not extract token from osmo CLI output')
                raise RuntimeError('Could not extract token from osmo CLI output')
            return backend_token
    except (json.JSONDecodeError, OSError) as e:
        logger.error('❌ Error: Failed to parse token output: %s', e)
        raise RuntimeError(f'Failed to parse token output: {e}') from e


def _setup_backend_operators(image_location: str, image_tag: str, detected_platform: str) -> None:
    """Set up backend operators and create test namespace."""
    logger.info('🔧 Setting up backend operators...')

    try:
        process = run_command_with_logging(
            ['kubectl', 'create', 'namespace', 'osmo-test'])
        if process.has_failed():
            logger.warning(
                '⚠️  Warning: Failed to create test namespace (may already exist)')
            logger.debug('   Check stderr: %s', process.stderr_file)

        logger.info('   Checking for existing backend operator token...')

        token_exists = _check_backend_token_exists()

        if token_exists:
            logger.info(
                '   ✅ Backend operator token already exists, '
                'skipping token and secret creation')
        else:
            logger.info('   Generating backend operator token...')

            backend_token = _create_backend_token()

            secret_yaml = f"""
apiVersion: v1
kind: Secret
metadata:
  name: agent-token
  namespace: osmo
type: Opaque
stringData:
  token: {backend_token}
"""
            process = run_command_with_logging(
                ['kubectl', 'apply', '-f', '-'],
                process_input=secret_yaml
            )
            if process.has_failed():
                logger.warning(
                    '⚠️  Warning: Failed to create agent token secret '
                    '(may already exist)')
                logger.debug('   Check stderr: %s', process.stderr_file)

        logger.info('   Installing backend operator...')

        runfile_repo = RUNFILES.CurrentRepository() or '_main'

        chart_path = os.path.dirname(RUNFILES.Rlocation(
            os.path.join(runfile_repo, 'deployments/charts/backend-operator/Chart.yaml')))
        values_path = RUNFILES.Rlocation(
            os.path.join(runfile_repo, 'run/minimal/backend_operator_values.yaml'))

        process = run_command_with_logging([
            'helm', 'dependency', 'build', chart_path
        ], 'Building backend operator dependencies')

        if process.has_failed():
            logger.error('❌ Error: Failed to build backend operator dependencies')
            logger.error('   Check stderr: %s', process.stderr_file)
            raise RuntimeError('Failed to build backend operator dependencies')

        process = run_command_with_logging([
            'helm', 'upgrade', '--install', 'osmo-backend-operator',
            chart_path,
            '-f', values_path,
            '--set', f'global.osmoImageLocation={image_location}',
            '--set', f'global.osmoImageTag={image_tag}',
            '--set', rf'global.nodeSelector.kubernetes\.io\/arch={detected_platform}',
            '-n', 'osmo', '--wait'
        ], 'Installing backend operator')

        if not process.has_failed():
            logger.info('✅ Backend operator installed successfully in %.2fs',
                        process.get_elapsed_time())
        else:
            logger.error('❌ Error: Failed to install backend operator')
            logger.error('   Check output files for details:')
            logger.error('   - stdout: %s', process.stdout_file)
            logger.error('   - stderr: %s', process.stderr_file)
            raise RuntimeError('Failed to install backend operator')

    except OSError as e:
        logger.error('❌ Unexpected error setting up backend operators: %s', e)
        raise RuntimeError(f'Unexpected error setting up backend operators: {e}') from e


def start_backend_kind(args: argparse.Namespace) -> None:
    """Start the OSMO backend using KIND."""
    check_required_tools(['docker', 'kind', 'kubectl', 'helm'])

    try:
        if check_cluster_exists(args.cluster_name):
            logger.info('✅ Cluster \'%s\' already exists, skipping creation', args.cluster_name)
        else:
            create_cluster(args.cluster_name)

        setup_osmo_namespace(
            args.container_registry,
            args.container_registry_username,
            args.container_registry_password)

        detected_platform = detect_platform()
        logger.info('📱 Detected platform: %s', detected_platform)

        setup_kai_scheduler()

        login_osmo('kind')
        try:
            _setup_backend_operators(args.image_location, args.image_tag, detected_platform)
        finally:
            logout_osmo()

        logger.info('\n🎉 OSMO backend setup complete!')
        print_next_steps(mode='kind', show_start_backend=False, show_update_configs=True)
    except Exception as e:
        logger.error('❌ Error setting up backend: %s', e)
        raise SystemExit(1) from e
