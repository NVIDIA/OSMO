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
import os
import time
import requests

from run.check_tools import check_required_tools
from run.host_ip import get_host_ip
from run.localstack import (
    LOCALSTACK_S3_ENDPOINT_BAZEL_HOST,
    LOCALSTACK_REGION,
    LOCALSTACK_ACCESS_KEY_ID,
    LOCALSTACK_SECRET_ACCESS_KEY,
    LOCALSTACK_FORCE_PATH_STYLE
)
from run.print_next_steps import print_next_steps
from run.run_command import run_command_with_logging, cleanup_registered_processes, wait_for_all_processes


logger = logging.getLogger()


def _get_env():
    """
    Get environment variables for OSMO services.

    Returns:
        dict: Environment variables dictionary
    """
    env = os.environ.copy()
    env['OSMO_POSTGRES_PASSWORD'] = 'osmo'
    env['OSMO_SKIP_DATA_AUTH'] = '1'
    env['AWS_ENDPOINT_URL'] = LOCALSTACK_S3_ENDPOINT_BAZEL_HOST
    env['AWS_DEFAULT_REGION'] = LOCALSTACK_REGION
    env['AWS_S3_FORCE_PATH_STYLE'] = LOCALSTACK_FORCE_PATH_STYLE
    return env


def _wait_for_http_service(url: str, service_name: str, timeout: int = 60) -> bool:
    """
    Wait for an HTTP service to become ready.

    Args:
        url: The URL to check
        service_name: Name of the service for logging
        timeout: Maximum time to wait in seconds

    Returns:
        True if service is ready, False if timeout
    """
    logger.info('⏳ Waiting for %s to be ready at %s...', service_name, url)
    start_time = time.time()

    while time.time() - start_time < timeout:
        try:
            response = requests.get(url, timeout=5)
            if response.status_code == 200:
                logger.info('✅ %s is ready!', service_name)
                return True
        except requests.exceptions.RequestException:
            pass

        time.sleep(2)

    logger.error('❌ %s failed to become ready within %d seconds', service_name, timeout)
    return False


def _handle_existing_container(container_name: str, display_name: str) -> bool:
    """
    Handle existing containers (running, paused, exited, or created).

    Returns:
        True if container was handled (already running or successfully started/unpaused)
        False if no container exists (caller should create new one)
    """
    process = run_command_with_logging([
        'docker', 'ps', '-a', '--filter', f'name={container_name}', '--format',
        '{{.Names}} {{.Status}}'
    ])
    if process.has_failed():
        return False

    with open(process.stdout_file, 'r', encoding='utf-8') as f:
        output = f.read().strip()

    if container_name not in output:
        return False

    if '(Paused)' in output:
        logger.info('🔄 %s container is paused, unpausing it...', display_name)
        process = run_command_with_logging([
            'docker', 'unpause', container_name
        ], f'Unpausing {display_name} container')
        if process.has_failed():
            with open(process.stderr_file, 'r', encoding='utf-8') as f:
                logger.error('❌ Failed to unpause %s container: %s', display_name, f.read())
            raise RuntimeError(f'Failed to unpause {display_name} container')
        logger.info('✅ %s container unpaused successfully', display_name)
        return True

    elif 'Up ' in output and '(Paused)' not in output:
        logger.info('✅ %s container is already running', display_name)
        return True

    elif 'Exited' in output:
        logger.info('🔄 %s container has exited, restarting it...', display_name)
        process = run_command_with_logging([
            'docker', 'start', container_name
        ], f'Restarting existing {display_name} container')
        if process.has_failed():
            with open(process.stderr_file, 'r', encoding='utf-8') as f:
                logger.error('❌ Failed to restart existing %s container: %s',
                             display_name, f.read())
            raise RuntimeError(f'Failed to restart {display_name} container')
        logger.info('✅ %s container restarted successfully', display_name)
        return True

    elif 'Created' in output:
        logger.info('🔄 %s container was created but never started, starting it...', display_name)
        process = run_command_with_logging([
            'docker', 'start', container_name
        ], f'Starting created {display_name} container')
        if process.has_failed():
            with open(process.stderr_file, 'r', encoding='utf-8') as f:
                logger.error('❌ Failed to start created %s container: %s', display_name, f.read())
            raise RuntimeError(f'Failed to start created {display_name} container')
        logger.info('✅ %s container started successfully', display_name)
        return True

    # Container exists but in unknown state, let caller handle it
    logger.debug('Container %s in unknown state: %s', container_name, output)
    return False


def _start_redis():
    """Start Redis container."""
    logger.info('🔴 Starting Redis container...')

    # Handle existing container if any
    if _handle_existing_container('redis', 'Redis'):
        return

    # Start new Redis container
    cmd = [
        'docker', 'run', '-it', '--rm', '-d',
        '-p', '6379:6379',
        '--name', 'redis',
        'redis'
    ]

    process = run_command_with_logging(cmd, 'Starting Redis')
    if process.has_failed():
        with open(process.stderr_file, 'r', encoding='utf-8') as f:
            logger.error('❌ Failed to start Redis: %s', f.read())
        raise SystemExit(1)
    logger.info('✅ Redis started successfully in %.2fs', process.get_elapsed_time())


def _start_postgres():
    """Start PostgreSQL container."""
    logger.info('🐘 Starting PostgreSQL container...')

    # Handle existing container if any
    if _handle_existing_container('postgres', 'PostgreSQL'):
        return

    # Set environment variables
    postgres_password = 'osmo'
    database_location = os.path.expanduser('~/osmo_db_data')

    # Create database directory if it doesn't exist
    os.makedirs(database_location, exist_ok=True)

    # Create postgres network if it doesn't exist
    run_command_with_logging(['docker', 'network', 'create', 'postgres'], async_mode=False)

    # Start new PostgreSQL container
    cmd = [
        'docker', 'run', '--rm', '-d',
        '--name', 'postgres',
        '--network', 'postgres',
        '-p', '5432:5432',
        '-v', f'{database_location}:/var/lib/postgresql/data',
        '-e', f'POSTGRES_PASSWORD={postgres_password}',
        '-e', 'POSTGRES_DB=osmo_db',
        'postgres:15.1'
    ]

    process = run_command_with_logging(cmd, 'Starting PostgreSQL')
    if process.has_failed():
        with open(process.stderr_file, 'r', encoding='utf-8') as f:
            logger.error('❌ Failed to start PostgreSQL: %s', f.read())
        raise SystemExit(1)

    logger.info('✅ PostgreSQL started successfully in %.2fs', process.get_elapsed_time())


def _start_localstack_s3():
    """Start LocalStack S3 container."""
    logger.info('☁️ Starting LocalStack S3 container...')

    if _handle_existing_container('localstack', 'LocalStack S3'):
        return

    # Create kind network if it doesn't exist
    run_command_with_logging(['docker', 'network', 'create', 'kind'], async_mode=False)

    # Start new LocalStack container for S3 on the kind network
    cmd = [
        'docker', 'run', '--rm', '-d',
        '--name', 'localstack',
        '--network', 'kind',
        '-p', '4566:4566',
        '-e', 'SERVICES=s3',
        '-e', 'DEBUG=1',
        'localstack/localstack@'
        'sha256:f15913b1d8f3b62d62e8673326712bf3e952c51761fc7dccc7a8c83d829ffecc'
    ]

    process = run_command_with_logging(cmd, 'Starting LocalStack S3')
    if process.has_failed():
        with open(process.stderr_file, 'r', encoding='utf-8') as f:
            logger.error('❌ Failed to start LocalStack S3: %s', f.read())
        raise SystemExit(1)

    logger.info('✅ LocalStack S3 started successfully in %.2fs', process.get_elapsed_time())


def _create_localstack_buckets(
                               ) -> None:
    """Create LocalStack S3 buckets if they don't already exist."""
    logger.info('🪣 Creating LocalStack S3 buckets...')

    buckets = ['osmo']

    env = os.environ.copy()
    env.update({
        'AWS_ENDPOINT_URL': LOCALSTACK_S3_ENDPOINT_BAZEL_HOST,
        'AWS_ACCESS_KEY_ID': LOCALSTACK_ACCESS_KEY_ID,
        'AWS_SECRET_ACCESS_KEY': LOCALSTACK_SECRET_ACCESS_KEY,
        'AWS_DEFAULT_REGION': LOCALSTACK_REGION,
        'AWS_S3_FORCE_PATH_STYLE': LOCALSTACK_FORCE_PATH_STYLE
    })

    try:
        start_time = time.time()

        logger.info('   Creating buckets...')

        for bucket in buckets:
            logger.info('   Creating bucket "%s"...', bucket)
            process = run_command_with_logging(
                ['aws', 's3', 'mb', f's3://{bucket}'],
                f'Creating bucket {bucket}',
                env=env
            )

            if not process.has_failed():
                logger.info('   ✅ Bucket "%s" created successfully', bucket)
            else:
                logger.info('   ❌ Bucket "%s" could not be created', bucket)
                raise RuntimeError(f'Bucket "{bucket}" could not be created')

        logger.info('✅ LocalStack S3 bucket setup complete in %.2fs',
                    time.time() - start_time)

    except OSError as e:
        logger.error('❌ Unexpected error creating LocalStack buckets: %s', e)
        raise RuntimeError(f'Unexpected error creating LocalStack buckets: {e}') from e


def _start_core_service():
    """Start OSMO core service."""
    logger.info('🚀 Starting OSMO core service...')

    host_ip = get_host_ip()
    cmd = [
        'bazel', 'run', '@osmo_workspace//src/service/core:service_binary',
        '--',
        '--host', f'http://{host_ip}:8000',
        '--method=dev',
        '--progress_file', '/tmp/osmo/service/last_progress_core'
    ]

    run_command_with_logging(
        cmd,
        'Starting OSMO core service',
        async_mode=True,
        name='core',
        env=_get_env())
    if not _wait_for_http_service(f'http://{host_ip}:8000/api/version', 'Core service'):
        raise RuntimeError('Core service failed to become ready')


def _start_service_worker():
    """Start OSMO service worker."""
    logger.info('👷 Starting OSMO service worker...')

    cmd = [
        'bazel', 'run', '@osmo_workspace//src/service/worker:worker_binary',
        '--',
        '--method=dev',
        '--progress_file', '/tmp/osmo/service/last_progress_worker'
    ]

    process = run_command_with_logging(
        cmd,
        'Starting OSMO service worker',
        async_mode=True,
        name='worker',
        env=_get_env())
    time.sleep(5)
    if process.has_failed():
        logger.error('❌ Worker process failed during startup')
        raise RuntimeError('Worker service failed to become ready')
    logger.info('✅ Worker service appears to be ready (process running for 5+ seconds)')


def _start_ui_service():
    """Start OSMO UI service."""
    logger.info('🌐 Starting OSMO UI service...')

    workspace_root = os.environ.get('BUILD_WORKSPACE_DIRECTORY', os.getcwd())

    # Check if we're running from the repo root (which contains external/)
    # or from external/ directly
    if os.path.exists(os.path.join(workspace_root, 'external')):
        ui_dir = os.path.join(workspace_root, 'external', 'ui')
    else:
        ui_dir = os.path.join(workspace_root, 'ui')

    if not os.path.exists(ui_dir):
        logger.error('❌ UI directory not found: %s', ui_dir)
        raise RuntimeError(f'UI directory not found: {ui_dir}')

    npm_install_cmd = ['npm', 'install']
    process = run_command_with_logging(
        cmd=npm_install_cmd, cwd=ui_dir, description='Installing npm dependencies')

    if process.has_failed():
        with open(process.stderr_file, 'r', encoding='utf-8') as f:
            logger.error('❌ Failed to install npm dependencies: %s', f.read())
        raise RuntimeError('Failed to install npm dependencies')

    host_ip = get_host_ip()
    npm_dev_cmd = ['npm', 'run', 'dev']

    ui_env = os.environ.copy()
    ui_env['NEXT_PUBLIC_OSMO_API_HOSTNAME'] = f'{host_ip}:8000'
    ui_env['NEXT_PUBLIC_OSMO_SSL_ENABLED'] = 'false'

    process = run_command_with_logging(
        cmd=npm_dev_cmd,
        cwd=ui_dir,
        description='Starting OSMO UI service',
        async_mode=True,
        name='ui',
        env=ui_env
    )
    if not _wait_for_http_service(f'http://{host_ip}:3000', 'UI service'):
        raise RuntimeError('UI service failed to become ready')


def _start_delayed_job_monitor():
    """Start OSMO delayed job monitor."""
    logger.info('⏰ Starting OSMO delayed job monitor...')

    cmd = [
        'bazel', 'run',
        '@osmo_workspace//src/service/delayed_job_monitor:delayed_job_monitor_binary',
        '--',
        '--method=dev',
        '--progress_file', '/tmp/osmo/service/last_progress_delayed_job_monitor'
    ]

    process = run_command_with_logging(
        cmd,
        'Starting OSMO delayed job monitor',
        async_mode=True,
        name='delayed-jobs',
        env=_get_env())

    time.sleep(5)
    if process.has_failed():
        logger.error('❌ Delayed job monitor process failed during startup')
        raise RuntimeError('Delayed job monitor failed to become ready')
    logger.info('✅ Delayed job monitor appears to be ready (process running for 5+ seconds)')


def _start_router_service():
    """Start OSMO router service."""
    logger.info('🌐 Starting OSMO router service...')

    host_ip = get_host_ip()
    cmd = [
        'bazel', 'run', '@osmo_workspace//src/service/router:router_binary',
        '--',
        '--host', f'http://{host_ip}:8001',
        '--method=dev'
    ]

    run_command_with_logging(
        cmd,
        'Starting OSMO router service',
        async_mode=True,
        name='router',
        env=_get_env())
    if not _wait_for_http_service(
            f'http://{host_ip}:8001/api/router/version', 'Router service'):
        raise RuntimeError('Router service failed to become ready')


def start_service_bazel():
    """Start the OSMO service using bazel."""
    check_required_tools(['bazel', 'docker', 'npm', 'aws'])

    try:
        _start_redis()
        _start_postgres()
        _start_localstack_s3()
        _create_localstack_buckets()

        _start_core_service()
        _start_service_worker()
        _start_ui_service()
        _start_delayed_job_monitor()
        _start_router_service()

        logger.info('=' * 50)
        logger.info('\n🎉 All OSMO services started successfully!\n')
        host_ip = get_host_ip()
        logger.info('📊 Core API: http://%s:8000/api/docs', host_ip)
        logger.info('🌐 UI: http://%s:3000', host_ip)
        logger.info('🔀 Router: http://%s:8001/api/router/docs\n', host_ip)
        logger.info('💡 Press Ctrl+C to stop all services\n')

        print_next_steps(mode='bazel', show_start_backend=True, show_update_configs=True,
                         host_ip=host_ip, port=8000)

        logger.info('\n%s', '=' * 50)

        # Keep the script running while services are running
        wait_for_all_processes()

    except KeyboardInterrupt:
        logger.info('\n🛑 Ctrl+C pressed, shutting down...')
        cleanup_registered_processes('services')
    except Exception as e:
        logger.error('❌ Error running services: %s', e)
        cleanup_registered_processes('services')
        raise SystemExit(1) from e
