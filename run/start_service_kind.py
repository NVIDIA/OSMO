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
import secrets
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


def _add_ingress_nginx_repo() -> None:
    """Add the ingress-nginx repository to Helm."""
    process = run_command_with_logging([
        'helm', 'repo', 'add', 'ingress-nginx', 'https://kubernetes.github.io/ingress-nginx'
    ], 'Adding ingress-nginx repository')

    if not process.has_failed():
        logger.info('✅ Ingress-nginx repository added successfully in %.2fs',
                    process.get_elapsed_time())

        process = run_command_with_logging([
            'helm', 'repo', 'update'
        ], 'Updating Helm repositories')

        if not process.has_failed():
            logger.info('✅ Helm repositories updated successfully in %.2fs',
                        process.get_elapsed_time())
        else:
            logger.warning('⚠️  Warning: Failed to update Helm repositories')
            logger.debug('   Check stderr: %s', process.stderr_file)
    else:
        logger.error('❌ Error adding ingress-nginx repository')
        logger.error('   Check output files for details:')
        logger.error('   - stdout: %s', process.stdout_file)
        logger.error('   - stderr: %s', process.stderr_file)
        raise RuntimeError('Error adding ingress-nginx repository')


def _wait_for_ingress_controller() -> None:
    """Wait for the ingress-nginx controller to be ready using kubectl wait.

    Cannot use helm --wait because an IP address is never assigned.
    """
    process = run_command_with_logging([
        'kubectl', 'wait', '--for=condition=available', '--timeout=300s',
        'deployment/ingress-nginx-controller', '-n', 'ingress-nginx'
    ], 'Waiting for ingress-nginx controller')

    if not process.has_failed():
        logger.info('✅ Ingress-nginx controller is ready in %.2fs', process.get_elapsed_time())
    else:
        logger.error(
            '❌ Error: Ingress-nginx controller failed to become ready within timeout')
        logger.error('   Check stderr: %s', process.stderr_file)
        raise RuntimeError('Ingress-nginx controller failed to become ready within timeout')


def _install_ingress_nginx() -> None:
    """Install the ingress-nginx controller."""
    logger.info('📦 Installing ingress-nginx...')

    _add_ingress_nginx_repo()

    process = run_command_with_logging([
        'helm', 'upgrade', '--install', 'ingress-nginx', 'ingress-nginx/ingress-nginx',
        '--create-namespace', '--namespace', 'ingress-nginx',
        '--set', 'controller.nodeSelector.node_group=service',
        '--set', 'controller.service.type=NodePort',
        '--set', 'controller.service.nodePorts.http=30080'
    ], 'Installing ingress-nginx')

    if not process.has_failed():
        logger.info('✅ Ingress-nginx installed successfully in %.2fs', process.get_elapsed_time())
        _wait_for_ingress_controller()
    else:
        logger.error('❌ Error installing ingress-nginx')
        logger.error('   Check output files for details:')
        logger.error('   - stdout: %s', process.stdout_file)
        logger.error('   - stderr: %s', process.stderr_file)
        raise RuntimeError('Error installing ingress-nginx')


def _generate_mek() -> None:
    """Generate the Master Encryption Key (MEK) directly in Python if it doesn't exist."""
    logger.info('🔑 Checking for existing Master Encryption Key (MEK)...')

    try:
        process = run_command_with_logging([
            'kubectl', 'get', 'configmap', 'mek-config', '-n', 'osmo'
        ], 'Checking for existing MEK ConfigMap')

        if not process.has_failed():
            logger.info('✅ MEK ConfigMap already exists, skipping generation')
            return

        logger.info('🔑 Generating new Master Encryption Key (MEK)...')

        random_key = base64.b64encode(secrets.token_bytes(32)).decode('utf-8')

        jwk_json = {
            'k': random_key,
            'kid': 'key1',
            'kty': 'oct'
        }

        encoded_jwk = base64.b64encode(
            json.dumps(jwk_json).encode('utf-8')).decode('utf-8')

        configmap_yaml = f"""apiVersion: v1
kind: ConfigMap
metadata:
  name: mek-config
  namespace: osmo
data:
  mek.yaml: |
    # MEK generated {time.strftime('%Y-%m-%d %H:%M:%S')}
    currentMek: key1
    meks:
      key1: {encoded_jwk}
"""

        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
            temp_file.write(configmap_yaml)
            temp_file_path = temp_file.name

        try:
            process = run_command_with_logging([
                'kubectl', 'apply', '-f', temp_file_path
            ], 'Creating MEK ConfigMap')

            if not process.has_failed():
                logger.info(
                    '✅ MEK generated and ConfigMap created successfully in %.2fs',
                    process.get_elapsed_time())
            else:
                logger.error('❌ Error creating MEK ConfigMap')
                logger.error('   Check output files for details:')
                logger.error('   - stdout: %s', process.stdout_file)
                logger.error('   - stderr: %s', process.stderr_file)
                raise RuntimeError('Error creating MEK ConfigMap')
        finally:
            try:
                os.unlink(temp_file_path)
            except OSError:
                pass

    except OSError as e:
        logger.error('❌ Unexpected error generating MEK: %s', e)
        raise RuntimeError(f'Unexpected error generating MEK: {e}') from e


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
         'deployments/charts/osmo/Chart.yaml',
         'build/minimal/osmo_values.yaml'),
        ('ui',
         'deployments/charts/ui/Chart.yaml',
         'build/minimal/ui_values.yaml'),
        ('router',
         'deployments/charts/router/Chart.yaml',
         'build/minimal/router_values.yaml')
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

        setup_osmo_namespace(args.container_registry_username, args.container_registry_password)
        _install_ingress_nginx()
        _generate_mek()
        _install_osmo_services(args.image_location, args.image_tag, detected_platform)

        total_time = time.time() - start_time
        logger.info('\n🎉 OSMO service setup complete in %.2fs!', total_time)
        logger.info('=' * 50)

        print_next_steps(mode='kind', show_start_backend=True, show_update_configs=True)
    except Exception as e:
        logger.error('❌ Error setting up services: %s', e)
        raise SystemExit(1) from e
