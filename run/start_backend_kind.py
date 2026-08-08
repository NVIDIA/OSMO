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
import logging
import os

from bazel_tools.tools.python.runfiles import runfiles  # type: ignore

from run.check_tools import check_required_tools
from run.print_next_steps import print_next_steps
from run.run_command import run_command_with_logging

from run.kind_utils import (
    check_cluster_exists,
    create_cluster,
    setup_osmo_namespace,
    detect_platform,
    setup_kai_scheduler,
)

logger = logging.getLogger()
RUNFILES = runfiles.Create()


def check_backend_token_exists() -> bool:
    """Check if the backend credential Secret is provisioned."""
    process = run_command_with_logging([
        'kubectl', 'get', 'secret', 'agent-token', '-n', 'osmo',
        '--ignore-not-found=true',
        '-o', 'go-template={{if index .data "token"}}present{{end}}'
    ], 'Checking backend token Secret')
    if process.has_failed():
        with open(process.stderr_file, 'r', encoding='utf-8') as error_file:
            error_message = error_file.read().strip()
        raise RuntimeError(
            f'Failed to check backend token Secret osmo/agent-token: {error_message}')
    with open(process.stdout_file, 'r', encoding='utf-8') as output_file:
        return output_file.read().strip() == 'present'


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

        logger.info('   Checking for backend operator Secret...')

        token_exists = check_backend_token_exists()

        if not token_exists:
            raise RuntimeError(
                'Backend token Secret osmo/agent-token is missing. Install the OSMO '
                'service first so its managed backend credential is provisioned.')
        logger.info('   ✅ Backend operator Secret is present')

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

        _setup_backend_operators(args.image_location, args.image_tag, detected_platform)

        logger.info('\n🎉 OSMO backend setup complete!')
        print_next_steps(mode='kind', show_start_backend=False, show_update_configs=True)
    except Exception as e:
        logger.error('❌ Error setting up backend: %s', e)
        raise SystemExit(1) from e
