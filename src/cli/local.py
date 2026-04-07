# pylint: disable=line-too-long
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
import os
import re
import sys

import shtab
import yaml

from src.utils import local_executor, spec_includes


def setup_parser(parser: argparse._SubParsersAction):
    """Register the 'local' subcommand and its nested actions with the CLI argument parser."""
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
    run_parser.add_argument(
        '--shm-size',
        dest='shm_size',
        default=None,
        help='Shared memory size for GPU containers (e.g. 16g, 32g). '
             'Defaults to 16g for tasks that request GPUs. '
             'PyTorch DataLoader workers require large shared memory.')
    run_parser.set_defaults(func=_run_local)

    compose_parser = subparsers.add_parser(
        'compose',
        help='Flatten includes and expand task refs into a single spec with a '
             'default-values variable map (no variable substitution).')
    compose_parser.add_argument(
        '-f', '--file',
        required=True,
        dest='workflow_file',
        help='Path to the workflow YAML spec file.').complete = shtab.FILE
    compose_parser.add_argument(
        '-o', '--output',
        dest='output_file',
        default=None,
        help='Write the composed spec to a file instead of stdout.').complete = shtab.FILE
    compose_parser.set_defaults(func=_compose)


def _run_local(service_client, args: argparse.Namespace):  # pylint: disable=unused-argument
    """Execute a workflow locally via Docker using the parsed CLI arguments."""
    try:
        success = local_executor.run_workflow_locally(
            spec_path=args.workflow_file,
            work_dir=args.work_dir,
            keep_work_dir=args.keep,
            resume=args.resume,
            from_step=args.from_step,
            docker_cmd=args.docker_cmd,
            shm_size=args.shm_size,
        )
    except (ValueError, FileNotFoundError, PermissionError) as error:
        print(f'Error: {error}', file=sys.stderr)
        sys.exit(1)

    if not success:
        sys.exit(1)


_ENV_REF_RE = re.compile(r'\$\{env:([^}]+)\}')


def _resolve_set_env_refs(value: str) -> str:
    """Replace ``${env:VAR}`` patterns only when VAR is present in ``os.environ``."""
    def _replacer(match: re.Match) -> str:
        env_var = match.group(1)
        if env_var in os.environ:
            return os.environ[env_var]
        return match.group(0)
    return _ENV_REF_RE.sub(_replacer, value)


def _compose(service_client, args: argparse.Namespace):  # pylint: disable=unused-argument
    """Flatten includes, resolve variables, and output a submittable spec.

    When all ``${env:VAR}`` references can be resolved the output is fully
    flat: no ``default-values`` section, no ``{variable}`` references —
    ready to submit to the OSMO server or run locally.

    When environment variables are missing the output keeps a
    ``default-values`` section with the unresolvable entries so the user
    can fill them in and re-compose.
    """
    unresolved_env: dict = {}
    try:
        abs_path = os.path.abspath(args.workflow_file)
        with open(abs_path, encoding='utf-8') as f:
            spec_text = f.read()

        spec_text = spec_includes.resolve_includes(
            spec_text, os.path.dirname(abs_path), source_path=abs_path)

        unresolved_env = spec_includes.find_unresolved_env_variables(spec_text)

        if unresolved_env:
            spec_text = _compose_with_unresolved(spec_text, unresolved_env)
        else:
            spec_text = _compose_fully_resolved(spec_text)
    except (ValueError, FileNotFoundError, PermissionError) as error:
        print(f'Error: {error}', file=sys.stderr)
        sys.exit(1)

    if unresolved_env:
        env_list = ', '.join(
            f'${v}' for v in sorted(set(unresolved_env.values())))
        print(
            f'Warning: environment variables not set: {env_list}\n'
            'Set them and re-compose, or edit the default-values section '
            'in the output.',
            file=sys.stderr)

    if args.output_file:
        with open(args.output_file, 'w', encoding='utf-8') as f:
            f.write(spec_text)
        print(f'Composed spec written to {args.output_file}', file=sys.stderr)
    else:
        print(spec_text, end='')


def _compose_fully_resolved(spec_text: str) -> str:
    """Resolve all variables and produce a submittable spec."""
    return spec_includes.resolve_default_values(spec_text)


def _compose_with_unresolved(spec_text: str,
                             unresolved_env: dict) -> str:
    """Keep a ``default-values`` map for variables that cannot be resolved."""
    parsed = yaml.safe_load(spec_text)
    raw_defaults = parsed.pop('default-values', None) or {}

    scalar_defaults: dict = {}
    for key in sorted(raw_defaults):
        value = raw_defaults[key]
        if isinstance(value, (str, int, float, bool)):
            scalar_defaults[key] = value
        elif value is None:
            scalar_defaults[key] = value

    for key, value in scalar_defaults.items():
        if isinstance(value, str):
            scalar_defaults[key] = _resolve_set_env_refs(value)

    output: dict = {}
    if scalar_defaults:
        output['default-values'] = scalar_defaults
    output.update(parsed)

    return yaml.safe_dump(output, default_flow_style=False, sort_keys=False)
