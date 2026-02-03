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
import posixpath
import time
from typing import Any, Dict

import yaml

from run.check_tools import check_required_tools
from run.host_ip import get_host_ip
from run.kind_utils import detect_platform
from run.print_next_steps import print_next_steps
from run.run_command import cleanup_registered_processes, login_osmo, logout_osmo, wait_for_all_processes
from run.start_backend_bazel import start_backend_bazel
from run.start_backend_kind import start_backend_kind
from run.start_service_bazel import start_service_bazel
from run.start_service_kind import start_service_kind
from run.update_configs import (
    set_default_pool,
    update_backend_config,
    update_dataset_config,
    update_pod_template_config,
    update_service_config,
    update_workflow_config,
)
from src.lib.utils import logging as logging_utils

logging.basicConfig(format='%(message)s')
logger = logging.getLogger()


def _merge_config(args: argparse.Namespace, config_file: str) -> None:
    """Merge YAML configuration with command line arguments.

    Args:
        args: Command line arguments
        config_file: Path to YAML configuration file
    """
    if not config_file or not os.path.exists(config_file):
        return

    logger.info('📂 Loading configuration from %s...', config_file)
    try:
        with open(config_file, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)

        if not config:
            return

        # Map config keys to argument names
        # Keys in YAML should match argument names (snake_case)
        # We only override args that were NOT set on the command line
        # Note: argparse doesn't easily tell us what was explicitly set vs default.
        # However, we can use the convention that we prioritize CLI args over YAML.
        # BUT, standard argparse pattern with defaults already populated in `args` makes
        # it hard to know if user provided it.
        #
        # Better approach: Update args with config values if valid key exists.
        # Since this is a specialized script, we'll assume CLI args override YAML config
        # only if we parsed them manually or check sys.argv, but for simplicity here:
        # We will apply YAML config to args, effectively overwriting defaults.
        # If the user passed specific flags, they will be parsed by argparse.
        # WAIT. argparse parsing happens BEFORE this function.
        # So `args` already has defaults or user values.
        # We should define defaults as NONE in parser, so we know if they are missing.
        # Or, simpler: We trust the user to put "defaults" in YAML if they use it.

        # Let's iterate over config and set attributes on args
        for key, value in config.items():
            if hasattr(args, key) and value is not None:
                # In a real rigorous impl we might check if user passed arg.
                # Here we will assume YAML provides defaults/presets.
                # If we want CLI to override YAML, we should check what user passed.
                # A common pattern:
                # 1. Parse args with defaults=None
                # 2. Load YAML
                # 3. Fill missing args from YAML
                # 4. Fill remaining missing args from hardcoded defaults
                #
                # Given we are refactoring existing scripts that rely on extensive defaults
                # in argparse, duplicating them in YAML or Python dict is messy.
                #
                # Compromise: We will update `args` with `config` values.
                # This implies YAML overrides CLI defaults.
                # CLI explicit args > YAML > CLI defaults is ideal but hard.
                # So here: YAML > CLI (effectively).
                #
                # Use Case: User has `osmo-config.yaml` with their preferred settings.
                # They run `./start.py --config osmo-config.yaml`.
                # They expect those settings to apply.
                setattr(args, key, value)

    except yaml.YAMLError as e:
        logger.error('❌ Error parsing config file: %s', e)
        raise RuntimeError(f'Error parsing config file: {e}') from e


def main():
    """Main function to orchestrate the unified OSMO start."""
    parser = argparse.ArgumentParser(
        description='Start OSMO services and backend (unified)')

    parser.add_argument(
        '--config', help='Path to YAML configuration file')

    parser.add_argument(
        '--log-level', type=logging_utils.LoggingLevel.parse,
        default=logging_utils.LoggingLevel.INFO)
    parser.add_argument(
        '--mode',
        choices=['kind', 'bazel'],
        default='kind',
        help='Mode to run in (default: kind)')
    parser.add_argument(
        '--cluster-name', default='osmo',
        help='Name of the cluster (default: osmo)')

    # Backend / Service common args
    parser.add_argument(
        '--container-registry', default='nvcr.io',
        help='Container registry (default: nvcr.io)')
    parser.add_argument(
        '--container-registry-username', default='$oauthtoken',
        help='Container registry username (default: $oauthtoken)')
    parser.add_argument(
        '--container-registry-password',
        help='Container registry password')
    parser.add_argument(
        '--image-location', default='nvcr.io/nvidia/osmo',
        help='OSMO image location (default: nvcr.io/nvidia/osmo)')
    parser.add_argument(
        '--image-tag', default='latest',
        help='OSMO image tag (default: latest)')
    parser.add_argument(
        '--load-local-images', action='store_true',
        help='Build and load images directly into KIND cluster')

    # Config update args
    parser.add_argument(
        '--object-storage-endpoint', default='s3://osmo',
        help='Object storage endpoint')
    parser.add_argument(
        '--object-storage-access-key-id', default='test',
        help='Object storage access key ID')
    parser.add_argument(
        '--object-storage-access-key', default='test',
        help='Object storage access key')
    parser.add_argument(
        '--object-storage-region', default='us-east-1',
        help='Object storage region')
    parser.add_argument(
        '--dataset-path',
        default='s3://osmo/datasets',
        help='Dataset path')

    # Toggle what to start
    parser.add_argument(
        '--skip-services', action='store_true',
        help='Skip starting OSMO services')
    parser.add_argument(
        '--skip-backend', action='store_true',
        help='Skip starting OSMO backend')
    parser.add_argument(
        '--skip-configs', action='store_true',
        help='Skip updating configurations')

    args = parser.parse_args()

    logger.setLevel(args.log_level)

    # 1. Merge config if present
    if args.config:
        _merge_config(args, args.config)

    check_required_tools(['bazel'])
    if args.mode == 'kind':
        check_required_tools(['kind', 'kubectl', 'helm', 'docker'])
    else:
        check_required_tools(['docker', 'npm', 'aws'])

    try:
        logger.info('🚀 OSMO Unified Start')
        logger.info('   Mode: %s', args.mode)
        logger.info('=' * 50)

        # 2. Start Services
        if not args.skip_services:
            if args.mode == 'kind':
                start_service_kind(args, print_next_steps_action=False)
            else:
                start_service_bazel(wait=False, print_next_steps_action=False)

        # 3. Start Backend
        if not args.skip_backend:
            if args.mode == 'kind':
                start_backend_kind(args, print_next_steps_action=False)
            else:
                start_backend_bazel(args.cluster_name, wait=False, print_next_steps_action=False)

        # 4. Update Configs
        if not args.skip_configs:
            logger.info('⚙️  Updating configurations...')
            detected_platform = detect_platform()
            login_osmo(args.mode)

            try:
                update_workflow_config(
                    args.container_registry,
                    args.container_registry_username,
                    args.container_registry_password,
                    args.object_storage_endpoint,
                    args.object_storage_access_key_id,
                    args.object_storage_access_key,
                    args.object_storage_region,
                    args.image_location,
                    args.image_tag)

                update_pod_template_config(detected_platform, args.mode)
                dataset_path = args.dataset_path \
                    if args.dataset_path else posixpath.join(args.object_storage_endpoint, 'datasets')
                update_dataset_config(dataset_path)
                update_service_config(args.mode)
                update_backend_config(args.mode)
                set_default_pool()
            finally:
                logout_osmo()

        # 5. Finalize
        logger.info('=' * 50)
        logger.info('\n🎉 usage: unified start complete!\n')

        host_ip = None
        port = None
        if args.mode == 'bazel':
            host_ip = get_host_ip()
            port = 8000

        print_next_steps(mode=args.mode, show_start_backend=False, show_update_configs=False,
                         host_ip=host_ip, port=port)

        if args.mode == 'bazel' and not args.skip_services:
            logger.info('\n💡 Press Ctrl+C to stop all services')
            logging.info('=' * 50)
            wait_for_all_processes()

    except KeyboardInterrupt:
        logger.info('\n🛑 Ctrl+C pressed, shutting down...')
        cleanup_registered_processes()
    except Exception as e:
        logger.error('❌ Error during startup: %s', e)
        cleanup_registered_processes()
        raise SystemExit(1) from e


if __name__ == '__main__':
    main()
