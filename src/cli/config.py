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
import json
from typing import Any

from src.lib.utils import client, osmo_errors

CONFIG_TYPES = (
    'BACKEND',
    'BACKEND_TEST',
    'GROUP_TEMPLATE',
    'POD_TEMPLATE',
    'POOL',
    'RESOURCE_VALIDATION',
    'ROLE',
    'SERVICE',
    'WORKFLOW',
)
CONFIG_TYPES_STRING = ', '.join(CONFIG_TYPES)


def _fetch_data_from_config(config_info: Any) -> Any:
    """
    Fetch data from a config
    """
    # Check if this is a backends config, which makes
    # `osmo config show BACKEND my-backend` nice
    if isinstance(config_info, dict) and 'backends' in config_info:
        config_info = config_info['backends']

    # Check if this is a pools config, which makes
    # `osmo config show POOL my-pool` nice
    if isinstance(config_info, dict) and 'pools' in config_info:
        config_info = config_info['pools']

    # Check if this is a list of objects with 'name' field
    # which makes `osmo config show BACKEND my-backend` and
    # `osmo config show ROLE my-role` nice
    if (
        isinstance(config_info, list)
        and config_info
        and isinstance(config_info[0], dict)
        and 'name' in config_info[0]
    ):
        config_info = {item['name']: item for item in config_info}

    return config_info


def _get_current_config(
    service_client: client.ServiceClient,
    config_type: str,
    params: dict[str, Any] | None = None,
) -> Any:
    """
    Get the current config
    Args:
        service_client: The service client instance
        config_type: The string config type from parsed arguments
        params: Optional query parameters to include in the request
    """
    if config_type not in CONFIG_TYPES:
        raise osmo_errors.OSMOUserError(
            f'Invalid config type "{config_type}". '
            f'Available types: {CONFIG_TYPES_STRING}'
        )
    return service_client.request(
        client.RequestMethod.GET, f'api/configs/{config_type.lower()}', params=params
    )


def _run_show_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """Show the current configuration, optionally selecting a nested value."""
    if args.verbose and args.config != 'POOL':
        raise osmo_errors.OSMOUserError(
            f'--verbose is only supported for POOL configs, not {args.config}'
        )
    request_params: dict[str, Any] | None = {'verbose': True} if args.verbose else None
    data = _get_current_config(service_client, args.config, params=request_params)

    # Handle multiple name arguments for indexing
    if args.names:
        data = _fetch_data_from_config(data)
        for name in args.names:
            if isinstance(data, dict) and name in data:
                data = data[name]
            elif isinstance(data, list):
                try:
                    index = int(name)
                    if 0 <= index < len(data):
                        data = data[index]
                    else:
                        raise osmo_errors.OSMOUserError(
                            f'Index {index} out of range for list of length {len(data)}')
                except ValueError as e:
                    raise osmo_errors.OSMOUserError(
                        f'Expected integer index for list, got "{name}"') from e
            else:
                raise osmo_errors.OSMOUserError(
                    f'Cannot index into {type(data).__name__} with "{name}"')

    print(json.dumps(data, indent=2))


def setup_parser(parser: argparse._SubParsersAction):
    """
    Configures parser for config commands
    Args:
        parser: The parser to be configured
    """
    config_parser = parser.add_parser('config',
                                      help='Inspect the current service configuration',
                                      description='Show the current configuration. To change it, '
                                                  'update Helm values and redeploy through GitOps.')
    config_subparsers = config_parser.add_subparsers(dest='subcommand')
    config_subparsers.required = True

    # Handle 'show' command
    show_parser = config_subparsers.add_parser(
        'show',
        help='Show the current GitOps-managed configuration',
        description='Show the current GitOps-managed configuration',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f'''
Available config types (CONFIG_TYPE): {CONFIG_TYPES_STRING}

Examples
========

Show a service configuration in JSON format::

    osmo config show SERVICE

Show the ``default_cpu`` resource validation rule::

    osmo config show RESOURCE_VALIDATION default_cpu

Show a pool configuration with parsed pod templates, group templates, and resource validations::

    osmo config show POOL --verbose

    osmo config show POOL my-pool --verbose
'''
    )
    show_parser.add_argument(
        'config',
        choices=CONFIG_TYPES,
        metavar='config_type',
        help='Current config to show in format <CONFIG_TYPE>; revisions are retired in 6.4',
    )
    show_parser.add_argument(
        'names',
        nargs='*',
        help='Optional names/indices to index into the config. Can be used to show a named config.'
    )
    show_parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Show verbose output including parsed pod templates, group templates, and resource '
             'validations. Only applicable when CONFIG_TYPE is POOL.',
    )

    show_parser.set_defaults(func=_run_show_command)
