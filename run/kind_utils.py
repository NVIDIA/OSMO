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

import base64
import json
import logging
import os
import platform
import tempfile

from bazel_tools.tools.python.runfiles import runfiles  # type: ignore
from run.run_command import run_command_with_logging
from src.lib.utils import client_configs
import yaml


logger = logging.getLogger()
RUNFILES = runfiles.Create()


def detect_platform() -> str:
    """Detect the platform for node labeling."""
    machine = platform.machine().lower()

    if 'arm' in machine or 'aarch64' in machine:
        return 'arm64'
    else:
        return 'amd64'


def check_cluster_exists(cluster_name: str) -> bool:
    """Check if a KIND cluster with the given name exists."""
    process = run_command_with_logging(['kind', 'get', 'clusters'])
    if not process.has_failed():
        try:
            with open(process.stdout_file, 'r', encoding='utf-8') as f:
                clusters = f.read().strip().split('\n')
            return cluster_name in clusters
        except OSError:
            return False
    return False


def create_cluster(cluster_name: str) -> None:
    """Create a new KIND cluster."""
    logger.info('🚀 Creating KIND cluster \'%s\'...', cluster_name)

    runfile_repo = RUNFILES.CurrentRepository() or '_main'
    repo_path = os.path.join(runfile_repo, 'build/kind-osmo-cluster-config.yaml')
    config_file = RUNFILES.Rlocation(repo_path)

    if not os.path.exists(config_file):
        logger.error('❌ Error: Could not locate config file: %s', config_file)
        raise RuntimeError(f'Could not locate config file: {config_file}')

    try:
        with open(config_file, 'r', encoding='utf-8') as file:
            yaml_content = yaml.safe_load(file)
    except yaml.YAMLError as e:
        logger.error('❌ Error parsing Kind cluster configuration: %s', e)
        raise RuntimeError(f'Error parsing Kind cluster configuration: {e}') from e

    # Create localstack-s3 directory locally for persistence
    local_stack_host_path = os.path.join(
        client_configs.get_client_state_dir(), 'run', 'localstack-s3',
    )

    for i, node in enumerate(yaml_content.get('nodes', [])):
        if 'extraMounts' in node:
            for extra_mount in node['extraMounts']:
                if 'hostPath' in extra_mount and extra_mount['hostPath'] == '/tmp/localstack-s3':
                    host_path = os.path.join(local_stack_host_path, str(i))
                    os.makedirs(host_path, exist_ok=True)
                    extra_mount['hostPath'] = host_path

    process = run_command_with_logging(
        cmd=[
            'kind', 'create', 'cluster', '--config', '/dev/stdin', '--name', cluster_name,
        ],
        description='Creating cluster',
        process_input=yaml.dump(yaml_content),
    )

    if not process.has_failed():
        logger.info('✅ Cluster \'%s\' created successfully in %.2fs',
                    cluster_name, process.get_elapsed_time())
    else:
        logger.error('❌ Error creating cluster \'%s\'', cluster_name)
        logger.error('   Check output files for details:')
        logger.error('   - stdout: %s', process.stdout_file)
        logger.error('   - stderr: %s', process.stderr_file)
        raise RuntimeError(f'Error creating cluster \'{cluster_name}\'')


def setup_osmo_namespace(
        container_registry_username: str,
        container_registry_password: str
    ) -> None:
    """Set up the OSMO namespace and image pull secret."""
    logger.info('🔧 Setting up OSMO namespace...')

    try:
        # Create namespace
        process = run_command_with_logging(
            ['kubectl', 'create', 'namespace', 'osmo'])
        if process.has_failed():
            logger.warning('⚠️  Warning: Failed to create namespace (may already exist)')
            logger.debug('   Check stderr: %s', process.stderr_file)

        auth_str = f'{container_registry_username}:{container_registry_password}'
        auth_b64 = base64.b64encode(auth_str.encode()).decode()

        docker_config = {
            'auths': {
                'nvcr.io': {
                    'username': container_registry_username,
                    'password': container_registry_password,
                    'auth': auth_b64
                }
            }
        }

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as config_file:
            json.dump(docker_config, config_file)
            config_file_path = config_file.name

        # Create image pull secret
        process = run_command_with_logging([
            'kubectl', 'create', 'secret', 'docker-registry', 'imagepullsecret',
            '--from-file=.dockerconfigjson=' + config_file_path,
            '-n', 'osmo'
        ])

        os.unlink(config_file_path)
        if process.has_failed():
            logger.warning(
                '⚠️  Warning: Failed to create image pull secret (may already exist)')
            logger.debug('   Check stderr: %s', process.stderr_file)

        # We need to track the total elapsed time across all operations
        # For simplicity, we'll just note completion
        logger.info('✅ OSMO namespace setup complete')
    except OSError as e:
        logger.error('❌ Unexpected error setting up namespace: %s', e)
        raise RuntimeError(f'Unexpected error setting up namespace: {e}') from e


