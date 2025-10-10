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

from src.lib.utils import client, common, osmo_errors
from typing import Dict, List


def setup_parser(parser: argparse._SubParsersAction):
    """
    Configures parser to show basic pool information.

    Args:
        parser: The parser to be configured.
    """
    pool_parser = parser.add_parser('pool',
        help='Command to show pool information.')
    subparsers = pool_parser.add_subparsers(dest='command')
    subparsers.required = True

    list_parser = subparsers.add_parser(
        'list',
        help='List resources for all available pools in the service.',
        description=(
            'Pool resource display formats::\n\n'
            '  Mode           | Description\n'
            '  ---------------|----------------------------------------------------\n'
            '  Used (default) | Shows the number of GPUs used and total GPUs\n'
            '  Free           | Shows the number of GPUs available for use\n'
            '\n'
            'Display table columns::\n\n'
            '  Column          | Description\n'
            '  ----------------|----------------------------------------------------\n'
            '  Quota Limit     | Max GPUs for HIGH/NORMAL priority workflows\n'
            '  Quota Used      | GPUs used by HIGH/NORMAL priority workflows\n'
            '  Quota Free      | Available GPUs for HIGH/NORMAL priority workflows\n'
            '  Total Capacity  | Total GPUs available on nodes in the pool\n'
            '  Total Usage     | Total GPUs used by all workflows in pool\n'
            '  Total Free      | Free GPUs on nodes in the pool\n'
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter)
    list_parser.add_argument('--pool', '-p',
                             nargs='+',
                             default=[],
                             help='Display resources for specified pool.')
    list_parser.add_argument('--format-type', '-t',
                             dest='format_type',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    list_parser.add_argument('--mode', '-m',
                            dest='mode',
                            choices=('free', 'used'),
                            default='used',
                            help='Show free or used resources (Default used).')
    list_parser.set_defaults(func=_list_pool)


def fetch_default_pool(service_client: client.ServiceClient) -> str:
    profile_result = service_client.request(client.RequestMethod.GET, 'api/profile/settings')
    default_pool = profile_result.get('profile', {}).get('pool', None)
    if not default_pool:
        raise osmo_errors.OSMOUserError('No default pool set. Set a default pool using '
                                        '"osmo profile set pool <profile_name>" '
                                        'or specify a pool using --pool or -p.')
    return default_pool


def list_pools(service_client: client.ServiceClient,
               pools: List[str] | None = None,
               quota: bool = False) -> Dict[str, Dict]:
    params = {} if pools is None else {'pools': pools}
    endpoint = '/api/pool' if not quota else '/api/pool_quota'
    pool_response = service_client.request(
        client.RequestMethod.GET,
        endpoint,
        params=params)
    return pool_response


def _list_pool(service_client: client.ServiceClient, args: argparse.Namespace):
    # List pools. If the user provided a list of pools, filter those out.
    availability_mode = args.mode == 'free'
    pool_response = list_pools(service_client, args.pool, quota=True)

    if args.format_type == 'json':
        print(json.dumps(pool_response, indent=common.JSON_INDENT_SIZE))
        return

    # Initialize the table
    keys = ['Pool', 'Description', 'Status']
    if availability_mode:
        keys += ['GPU [#]\nQuota Free', '\nTotal Free']
    else:
        keys += ['GPU [#]\nQuota Used', '\nQuota Limit', '\nTotal Usage', '\nTotal Capacity']
    table = common.osmo_table(header=keys)
    table.set_cols_dtype(['t' for _ in range(len(keys))])


    if len(pool_response['node_sets']) == 0:
        if args.pool:
            print(f'Pools {", ".join(args.pool)} not found')
        else:
            print('No pools available')
        return

    for nodeset in pool_response['node_sets']:
        for i, pool in enumerate(nodeset['pools']):

            # Build row and add it to the table
            row = [pool['name'], pool['description'], pool['status']]

            if availability_mode:
                free_str = str(pool['resource_usage']['total_free'])
                # Capacity and total free are only printed for the first pool in the nodeset
                if i != 0:
                    free_str += ' (shared)'
                row += [pool['resource_usage']['quota_free'],
                        free_str]
            else:
                capacity_str = str(pool['resource_usage']['total_capacity'])
                if i != 0:
                    capacity_str += ' (shared)'
                row += [pool['resource_usage']['quota_used'],
                        pool['resource_usage']['quota_limit'],
                        pool['resource_usage']['total_usage'],
                        capacity_str]
            table.add_row(row)

    # Print table with sum row
    if availability_mode:
        sum_row = ['']*3 + [
            str(pool_response['resource_sum']['quota_free']),
            str(pool_response['resource_sum']['total_free']),
        ]
    else:
        sum_row = ['']*3 + [
            str(pool_response['resource_sum']['quota_used']),
            str(pool_response['resource_sum']['quota_limit']),
            str(pool_response['resource_sum']['total_usage']),
            str(pool_response['resource_sum']['total_capacity']),
        ]
    print(common.create_table_with_sum_row(table, sum_row))
