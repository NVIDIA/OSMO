"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

from src.utils import local_executor


def setup_parser(parser: argparse._SubParsersAction):
    local_parser = parser.add_parser(
        'local',
        help='Run workflows locally using Docker (no Kubernetes cluster required).')
    subparsers = local_parser.add_subparsers(dest='command')
    subparsers.required = True

    run_parser = subparsers.add_parser(
        'run',
        help='Execute a workflow spec locally using Docker containers.')
    run_parser.add_argument(
        '-f', '--file',
        required=True,
        dest='workflow_file',
        help='Path to the workflow YAML spec file.').complete = shtab.FILE
    run_parser.add_argument(
        '--work-dir',
        dest='work_dir',
        default=None,
        help='Directory for task inputs/outputs. Defaults to a temporary directory.')
    run_parser.add_argument(
        '--keep',
        action='store_true',
        default=False,
        help='Keep the work directory after execution (always kept on failure).')
    run_parser.add_argument(
        '--docker',
        dest='docker_cmd',
        default='docker',
        help='Docker-compatible command to use (e.g. podman). Default: docker.')
    run_parser.add_argument(
        '--resume',
        action='store_true',
        default=False,
        help='Resume a previous run, skipping tasks that already completed successfully. '
             'Requires --work-dir pointing to the previous run directory.')
    run_parser.add_argument(
        '--from-step',
        dest='from_step',
        default=None,
        help='Resume from a specific task, re-running it and all downstream tasks. '
             'Tasks upstream of the specified step are skipped if they completed '
             'successfully. Requires --work-dir pointing to the previous run directory.')
    run_parser.set_defaults(func=_run_local)


def _run_local(service_client, args: argparse.Namespace):
    try:
        success = local_executor.run_workflow_locally(
            spec_path=args.workflow_file,
            work_dir=args.work_dir,
            keep_work_dir=args.keep,
            resume=args.resume,
            from_step=args.from_step,
            docker_cmd=args.docker_cmd,
        )
    except ValueError as error:
        print(f'Error: {error}', file=sys.stderr)
        sys.exit(1)

    if not success:
        sys.exit(1)
