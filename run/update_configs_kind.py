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
import json
import logging
import os
import posixpath
import tempfile

from run.run_command import run_command_with_logging
from run.cluster_utils import detect_platform


logger = logging.getLogger()


LOCALSTACK_S3_ENDPOINT = 'http://localstack-s3.osmo.svc.cluster.local:4566'
LOCALSTACK_S3_REGION = 'us-east-1'


def _update_workflow_config(
    container_registry: str,
    container_registry_username: str,
    container_registry_password: str,
    object_storage_endpoint: str,
    object_storage_access_key_id: str,
    object_storage_access_key: str,
    object_storage_region: str,
    image_location: str,
    image_tag: str
) -> None:
    """Update workflow config with local development settings."""
    logger.info('⚙️  Updating workflow config...')

    try:
        workflow_config = {
            'workflow_data': {
                'credential': {
                    'endpoint': posixpath.join(object_storage_endpoint, 'workflows'),
                    'access_key_id': object_storage_access_key_id,
                    'access_key': object_storage_access_key,
                    'region': object_storage_region
                }
            },
            'workflow_log': {
                'credential': {
                    'endpoint': posixpath.join(object_storage_endpoint, 'workflows'),
                    'access_key_id': object_storage_access_key_id,
                    'access_key': object_storage_access_key,
                    'region': object_storage_region
                }
            },
            'workflow_app': {
                'credential': {
                    'endpoint': posixpath.join(object_storage_endpoint, 'apps'),
                    'access_key_id': object_storage_access_key_id,
                    'access_key': object_storage_access_key,
                    'region': object_storage_region
                }
            },
            'backend_images': {
                'init': {
                    'amd64': f'{image_location}/init-container:{image_tag}',
                    'arm64': f'{image_location}/init-container:{image_tag}'
                },
                'client': {
                    'amd64': f'{image_location}/client:{image_tag}',
                    'arm64': f'{image_location}/client:{image_tag}'
                },
                'credential': {
                    'registry': container_registry,
                    'username': container_registry_username,
                    'auth': container_registry_password
                }
            },
            'credential_config': {
                'disable_data_validation': ['s3'],
            }
        }

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(workflow_config, f, indent=2)
            temp_file = f.name

        process = run_command_with_logging([
            'bazel', 'run', '@osmo_workspace//src/cli', '--', 'config', 'update', 'WORKFLOW',
            '--file', temp_file,
            '--description', 'Set up workflow config for local development'
        ], 'Updating workflow config')

        try:
            os.unlink(temp_file)
        except OSError:
            pass

        if not process.has_failed():
            logger.info('✅ Workflow config updated successfully in %.2fs',
                        process.get_elapsed_time())
        else:
            logger.error('❌ Error: Failed to update workflow config')
            logger.error('   Check stderr: %s', process.stderr_file)
            logger.error('   Make sure you\'re logged into OSMO CLI')
            raise SystemExit(1)

    except OSError as e:
        logger.error('❌ Unexpected error updating workflow config: %s', e)
        raise SystemExit(1) from e


def _update_pod_template_config(detected_platform: str) -> None:
    """Update pod template configuration for platform-specific settings."""
    logger.info('🏷️  Updating pod template configuration...')

    try:
        logger.info('   Adding compute pod template...')

        pod_template_config = {
            'default_compute': {
                'spec': {
                    'containers': [
                        {
                            'env': [
                                {
                                    'name': 'AWS_ENDPOINT_URL_S3',
                                    'value': LOCALSTACK_S3_ENDPOINT
                                },
                                {
                                    'name': 'AWS_S3_FORCE_PATH_STYLE',
                                    'value': 'true'
                                },
                                {
                                    'name': 'AWS_DEFAULT_REGION',
                                    'value': LOCALSTACK_S3_REGION
                                },
                                {
                                    'name': 'OSMO_LOGIN_DEV',
                                    'value': 'true'
                                }
                            ],
                            'name': '{{USER_CONTAINER_NAME}}'
                        },
                        {
                            'env': [
                                {
                                    'name': 'AWS_ENDPOINT_URL_S3',
                                    'value': LOCALSTACK_S3_ENDPOINT
                                },
                                {
                                    'name': 'AWS_S3_FORCE_PATH_STYLE',
                                    'value': 'true'
                                },
                                {
                                    'name': 'AWS_DEFAULT_REGION',
                                    'value': LOCALSTACK_S3_REGION
                                },
                                {
                                    'name': 'OSMO_LOGIN_DEV',
                                    'value': 'true'
                                }
                            ],
                            'name': 'osmo-ctrl'
                        },
                    ],
                    'nodeSelector': {
                        'node_group': 'compute',
                        'kubernetes.io/arch': detected_platform
                    }
                }
            }
        }

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(pod_template_config, f, indent=2)
            pod_template_file = f.name

        process = run_command_with_logging([
            'bazel', 'run', '@osmo_workspace//src/cli', '--', 'config', 'update', 'POD_TEMPLATE',
            '--file', pod_template_file,
            '--description', 'Add compute pod template'
        ], 'Adding compute pod template')

        try:
            os.unlink(pod_template_file)
        except OSError:
            pass

        if process.has_failed():
            logger.warning('⚠️  Warning: Failed to add compute pod template')
            logger.debug('   Check stderr: %s', process.stderr_file)

        logger.info('   Updating pool with compute template...')

        pool_config = {
            'common_pod_template': [
                'default_ctrl',
                'default_user',
                'default_compute'
            ]
        }

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(pool_config, f, indent=2)
            pool_file = f.name

        process = run_command_with_logging([
            'bazel', 'run', '@osmo_workspace//src/cli', '--', 'config', 'update', 'POOL', 'default',
            '--file', pool_file,
            '--description', 'Add compute pod template'
        ], 'Updating pool with compute template')

        try:
            os.unlink(pool_file)
        except OSError:
            pass

        if process.has_failed():
            logger.warning('⚠️  Warning: Failed to update pool with compute template')
            logger.debug('   Check stderr: %s', process.stderr_file)

    except OSError as e:
        logger.error('❌ Unexpected error updating pod template configuration: %s', e)
        raise SystemExit(1) from e


def _update_dataset_config(dataset_path: str) -> None:
    """Update dataset configuration."""
    logger.info('📁 Updating dataset configuration...')

    try:
        dataset_config = {
            'buckets': {
                'osmo': {
                    'dataset_path': dataset_path
                }
            },
            'default_bucket': 'osmo'
        }

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(dataset_config, f, indent=2)
            dataset_file = f.name

        process = run_command_with_logging([
            'bazel', 'run', '@osmo_workspace//src/cli', '--', 'config', 'update', 'DATASET',
            '--file', dataset_file,
            '--description', 'Add dataset bucket'
        ], 'Adding dataset configuration')

        try:
            os.unlink(dataset_file)
        except OSError:
            pass

        if not process.has_failed():
            logger.info('✅ Dataset configuration updated successfully in %.2fs',
                        process.get_elapsed_time())
        else:
            logger.warning('⚠️  Warning: Failed to add dataset configuration')
            logger.debug('   Check stderr: %s', process.stderr_file)

    except OSError as e:
        logger.error('❌ Unexpected error updating dataset configuration: %s', e)
        raise SystemExit(1) from e


def _update_service_config() -> None:
    """Update service configuration."""
    logger.info('🔧 Updating service configuration...')

    try:
        service_config = {
            'service_base_url': 'http://ingress-nginx-controller.ingress-nginx.svc.cluster.local'
        }

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(service_config, f, indent=2)
            service_file = f.name

        process = run_command_with_logging([
            'bazel', 'run', '@osmo_workspace//src/cli', '--', 'config', 'update', 'SERVICE',
            '--file', service_file,
            '--description', 'Update service base url'
        ], 'Updating service base URL')

        try:
            os.unlink(service_file)
        except OSError:
            pass

        if not process.has_failed():
            logger.info('✅ Service configuration updated successfully in %.2fs',
                        process.get_elapsed_time())
        else:
            logger.warning('⚠️  Warning: Failed to update service base URL')
            logger.debug('   Check stderr: %s', process.stderr_file)

    except OSError as e:
        logger.error('❌ Unexpected error updating service configuration: %s', e)
        raise SystemExit(1) from e


def _update_backend_config() -> None:
    """Update backend configuration."""
    logger.info('🔧 Updating backend configuration...')

    try:
        backend_config = {
            'router_address': 'ws://ingress-nginx-controller.ingress-nginx.svc.cluster.local'
        }

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(backend_config, f, indent=2)
            backend_file = f.name

        process = run_command_with_logging([
            'bazel', 'run', '@osmo_workspace//src/cli', '--', 'config', 'update', 'BACKEND',
            'default', '--file', backend_file,
            '--description', 'Update backend router address'
        ], 'Updating backend router address')

        try:
            os.unlink(backend_file)
        except OSError:
            pass

        if not process.has_failed():
            logger.info('✅ Backend configuration updated successfully in %.2fs',
                        process.get_elapsed_time())
        else:
            logger.warning('⚠️  Warning: Failed to update backend router address')
            logger.debug('   Check stderr: %s', process.stderr_file)

    except OSError as e:
        logger.error('❌ Unexpected error updating backend configuration: %s', e)
        raise SystemExit(1) from e


def _set_default_pool() -> None:
    """Set the default pool for the user profile."""
    logger.info('🎯 Setting default pool...')

    try:
        process = run_command_with_logging([
            'bazel', 'run', '@osmo_workspace//src/cli', '--', 'profile', 'set', 'pool', 'default'
        ], 'Setting default pool')

        if not process.has_failed():
            logger.info('✅ Default pool set successfully in %.2fs', process.get_elapsed_time())
        else:
            logger.warning('⚠️  Warning: Failed to set default pool')
            logger.debug('   Check stderr: %s', process.stderr_file)

    except OSError as e:
        logger.error('❌ Unexpected error setting default pool: %s', e)
        raise SystemExit(1) from e


def update_configs_kind(args: argparse.Namespace) -> None:
    """Update the OSMO configuration for KIND."""
    detected_platform = detect_platform()
    logger.info('📱 Detected platform: %s', detected_platform)

    _update_workflow_config(
        args.container_registry,
        args.container_registry_username,
        args.container_registry_password,
        args.object_storage_endpoint,
        args.object_storage_access_key_id,
        args.object_storage_access_key,
        args.object_storage_region,
        args.image_location,
        args.image_tag)

    _update_pod_template_config(detected_platform)
    dataset_path = args.dataset_path \
        if args.dataset_path else posixpath.join(args.object_storage_endpoint, 'datasets')
    _update_dataset_config(dataset_path)
    _update_service_config()
    _update_backend_config()
    _set_default_pool()
