"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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
import sys

import shtab

from src.utils import compose_executor


def setup_parser(parser: argparse._SubParsersAction):
    """Register the 'docker-compose' subcommand for parallel workflow execution."""
    dc_parser = parser.add_parser(
        'docker-compose',
        help='Run workflows using Docker Compose for parallel execution '
             '(no Kubernetes cluster required).')
    subparsers = dc_parser.add_subparsers(dest='command')
    subparsers.required = True

    run_parser = subparsers.add_parser(
        'run',
        help='Execute a workflow spec using Docker Compose for parallel task execution.')
    run_parser.add_argument(
        '-f', '--file',
        required=True,
        dest='workflow_file',
        help='Path to the workflow YAML spec file.').complete = shtab.FILE
    run_parser.add_argument(
        '--work-dir',
        dest='work_dir',
        default=None,
        help='Directory for task inputs/outputs and the generated docker-compose.yml. '
             'Defaults to a temporary directory.')
    run_parser.add_argument(
        '--keep',
        action='store_true',
        default=False,
        help='Keep the work directory after execution (always kept on failure).')
    run_parser.add_argument(
        '--compose-cmd',
        dest='compose_cmd',
        default='docker compose',
        help='Docker Compose command to use (e.g. "docker-compose" for V1). '
             'Default: "docker compose".')
    run_parser.add_argument(
        '--shm-size',
        dest='shm_size',
        default=None,
        help='Shared memory size for GPU containers (e.g. 16g, 32g). '
             'Defaults to 16g for tasks that request GPUs.')
    run_parser.set_defaults(func=_run_compose)


def _run_compose(service_client, args: argparse.Namespace):
    """Execute a workflow via Docker Compose using the parsed CLI arguments."""
    try:
        success = compose_executor.run_workflow_compose(
            spec_path=args.workflow_file,
            work_dir=args.work_dir,
            keep_work_dir=args.keep,
            compose_cmd=args.compose_cmd,
            shm_size=args.shm_size,
        )
    except (ValueError, FileNotFoundError, PermissionError) as error:
        print(f'Error: {error}', file=sys.stderr)
        sys.exit(1)

    if not success:
        sys.exit(1)
