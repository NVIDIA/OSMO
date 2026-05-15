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

import logging
import time
from typing import Literal

from run.check_tools import check_required_tools
from run.host_ip import get_host_ip
from run.kind_utils import check_cluster_exists, create_cluster, setup_kai_scheduler
from run.print_next_steps import print_next_steps
from run.run_command import run_command_with_logging, cleanup_registered_processes, wait_for_all_processes

logger = logging.getLogger()


def _check_or_create_kind_backend(cluster_name: str = 'osmo'):
    """Check if there are compute nodes available, or create a KIND cluster if needed."""
    logger.info('🔍 Checking for Kubernetes compute nodes...')

    # Check if KIND cluster already exists
    if check_cluster_exists(cluster_name):
        logger.info('✅ KIND cluster \'%s\' already exists, switching context...', cluster_name)
        process = run_command_with_logging([
            'kubectl', 'config', 'use-context', f'kind-{cluster_name}'
        ], 'Switching to KIND cluster context')
        if process.has_failed():
            logger.error('❌ Failed to switch to KIND cluster context')
            raise RuntimeError('Failed to switch to KIND cluster context')
    else:
        # Create new KIND cluster
        create_cluster(cluster_name)

        # Re-check connectivity after creating/switching to KIND cluster
        process = run_command_with_logging([
            'kubectl', 'get', 'nodes', '--no-headers'
        ], 'Checking KIND cluster connectivity')

        if process.has_failed():
            logger.error('❌ Failed to connect to KIND cluster after creation')
            with open(process.stderr_file, 'r', encoding='utf-8') as f:
                logger.error('   Error: %s', f.read().strip())
            raise RuntimeError('Failed to connect to KIND cluster after creation')

    setup_kai_scheduler()

    # Check for nodes labeled with node_group=compute
    process = run_command_with_logging([
        'kubectl', 'get', 'nodes', '-l', 'node_group=compute', '--no-headers'
    ], 'Checking for compute nodes')

    if process.has_failed():
        logger.error('❌ Failed to check for compute nodes')
        with open(process.stderr_file, 'r', encoding='utf-8') as f:
            logger.error('   Error: %s', f.read().strip())
        raise RuntimeError('Failed to check for compute nodes')

    with open(process.stdout_file, 'r', encoding='utf-8') as f:
        output = f.read().strip()

    if not output:
        logger.warning('⚠️  No compute nodes found in the current cluster.')
        logger.info('   Using all available worker nodes for workloads.')

        # Get all worker nodes (non-control-plane nodes)
        process = run_command_with_logging([
        'kubectl', 'get', 'nodes', '--no-headers', '-o',
        r'custom-columns=NAME:.metadata.name,'
        r'ROLE:.metadata.labels.node-role\.kubernetes\.io/control-plane'
        ], 'Getting worker nodes')

        if process.has_failed():
            logger.error('❌ Failed to get worker nodes')
            raise RuntimeError('Failed to get worker nodes')

        with open(process.stdout_file, 'r', encoding='utf-8') as f:
            nodes_output = f.read().strip()

        worker_nodes = []
        for line in nodes_output.split('\n'):
            if line and '<none>' in line:  # Nodes without control-plane role
                node_name = line.split()[0]
                worker_nodes.append(node_name)

        if not worker_nodes:
            logger.error('❌ No worker nodes available for workloads.')
            raise RuntimeError('No worker nodes available for workloads')

        node_count = len(worker_nodes)
        logger.info('✅ Found %d worker node(s) available for workloads', node_count)
    else:
        node_count = len(output.split('\n'))
        logger.info('✅ Found %d compute node(s) available for workloads', node_count)


def _start_backend_operator(service_type: Literal['listener', 'worker'], emoji: str) -> None:
    """Start an OSMO backend service.

    Args:
        service_type: Either 'listener' or 'worker'
        emoji: Emoji to use in log messages
    """
    service_name = f'backend_{service_type}_binary'
    display_name = f'Backend {service_type}'

    logger.info('%s Starting OSMO %s...', emoji, display_name.lower())

    host_ip = get_host_ip()

    cmd = [
        'bazel', 'run', f'@osmo_workspace//src/operator:{service_name}',
        '--',
        '--method=dev',
        f'--host=http://{host_ip}:8000',
        '--backend', 'default',
        '--namespace', 'default',
        '--username', 'testuser',
        '--progress_folder_path', '/tmp/osmo/operator'
    ]

    process = run_command_with_logging(
        cmd,
        f'Starting OSMO {display_name.lower()}',
        async_mode=True,
        name=f'backend-{service_type}')

    time.sleep(5)
    if process.has_failed():
        logger.error('❌ %s process failed during startup', display_name)
        raise RuntimeError(f'{display_name} failed to become ready')
    logger.info('✅ %s appears to be ready (process running for 5+ seconds)', display_name)


def _start_backend_listener():
    """Start OSMO backend listener."""
    _start_backend_operator('listener', '👂')


def _start_backend_worker():
    """Start OSMO backend worker."""
    _start_backend_operator('worker', '👷')


def start_backend_bazel(cluster_name: str = 'osmo'):
    """Start the OSMO backend using bazel."""
    check_required_tools(['bazel', 'kubectl', 'kind'])

    try:
        _check_or_create_kind_backend(cluster_name)

        _start_backend_listener()
        _start_backend_worker()

        logger.info('=' * 50)
        logger.info('\n🎉 OSMO backend services started successfully!\n')
        logger.info('💡 Press Ctrl+C to stop all backend services\n')

        host_ip = get_host_ip()
        print_next_steps(mode='bazel', show_start_backend=False, show_update_configs=True,
                         host_ip=host_ip, port=8000)

        logger.info('\n%s', '=' * 50)

        # Keep the script running while services are running
        wait_for_all_processes()

    except KeyboardInterrupt:
        logger.info('\n🛑 Ctrl+C pressed, shutting down...')
        cleanup_registered_processes('backend services')
    except Exception as e:
        logger.error('❌ Error starting backend services: %s', e)
        cleanup_registered_processes('backend services')
        raise SystemExit(1) from e
