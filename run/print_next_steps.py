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
from typing import Optional


logger = logging.getLogger()


def print_next_steps(
    mode: str = 'kind',
    show_start_backend: bool = True,
    show_update_configs: bool = True,
    host_ip: Optional[str] = None,
    port: Optional[int] = None
) -> None:
    """Print the next steps for OSMO setup.

    Args:
        mode: The mode being used ("kind" or "bazel")
        show_start_backend: Whether to show the start_backend step (default: True)
        show_update_configs: Whether to show the update_configs step (default: True)
        host_ip: The host IP to use for bazel mode (default: None)
        port: The port to use for bazel mode (default: None)
    """
    logger.info('Next steps:\n')

    step_number = 1
    is_bazel_mode = mode == 'bazel'

    if show_start_backend:
        # Only show /etc/hosts step for kind mode
        if not is_bazel_mode:
            logger.info(
                '%d. Add the following line to your /etc/hosts file. '
                'If you are SSH-ing into a remote workstation you must add this line to '
                '/etc/hosts on both your local and remote hosts.',
                step_number
            )
            logger.info('   127.0.0.1 ingress-nginx-controller.ingress-nginx.svc.cluster.local\n')
            step_number += 1

        logger.info('%d. Log into OSMO using the CLI:', step_number)
        if is_bazel_mode:
            # Use provided host_ip and port, or fallback to localhost:8080
            login_host = f'http://{host_ip}:{port}' if host_ip and port else 'http://localhost:8080'
            logger.info(
                '   bazel run @osmo_workspace//src/cli -- login %s '
                '--method=dev --username=testuser\n', login_host
            )
        else:
            logger.info(
                '   bazel run @osmo_workspace//src/cli -- login '
                'http://ingress-nginx-controller.ingress-nginx.svc.cluster.local '
                '--method=dev --username=testuser\n'
            )
        step_number += 1

        terminal_prefix = 'in another terminal, ' if is_bazel_mode else ''
        mode_arg = ' --mode bazel' if is_bazel_mode else ''

        logger.info('%d. Start the backend %s:', step_number, terminal_prefix.rstrip(', '))
        if is_bazel_mode:
            logger.info(
                '   bazel run @osmo_workspace//run:start_backend -- '
                '--mode bazel\n'
            )
        else:
            logger.info(
                '   bazel run @osmo_workspace//run:start_backend -- '
                '--container-registry-password="$CONTAINER_REGISTRY_PASSWORD"\n'
            )
        step_number += 1

    if show_update_configs:
        terminal_prefix = 'in another terminal, ' if is_bazel_mode else ''
        mode_arg = ' --mode bazel' if is_bazel_mode else ''

        logger.info('%d. Update OSMO configurations %s:', step_number, terminal_prefix.rstrip(', '))
        logger.info(
            '   bazel run @osmo_workspace//run:update_configs -- '
            '--container-registry-password="$CONTAINER_REGISTRY_PASSWORD"'
            ' %s\n',
            mode_arg
        )
        step_number += 1

    workspace_root = os.environ.get('BUILD_WORKSPACE_DIRECTORY', os.getcwd())

    # Check if we're running from the repo root (which contains external/)
    # or from external/ directly
    docs_path = workspace_root
    if os.path.exists(os.path.join(workspace_root, 'external')):
        # We're running from repo root, docs are in external/docs/
        docs_path = os.path.join(workspace_root, 'external')

    logger.info('%d. Test your setup with:', step_number)
    logger.info(
        '   bazel run @osmo_workspace//src/cli -- '
        'workflow submit %s/workflow_examples/basics/hello_world/hello_world.yaml\n',
        docs_path,
    )
    logger.info('   The workflow should successfully submit and run to a "completed" state.')
