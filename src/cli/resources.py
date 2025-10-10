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
import math

from typing import Any, Dict, List, Optional, Tuple

from src.cli import pool
from src.lib.utils import client, common, osmo_errors


def setup_parser(parser: argparse._SubParsersAction):
    '''
    Workflow parser setup and run command based on parsing.

    Args:
        parser: The parser to be configured.
    '''
    resources_parser = parser.add_parser('resource',
        help='Get information about resource nodes available for use.')
    subparsers = resources_parser.add_subparsers(dest='command')
    subparsers.required = True

    list_parser = subparsers.add_parser('list',
        help='List service resources.',
        description=(
            'Resource display formats::\n\n'
            '  Mode           | Description\n'
            '  ---------------|----------------------------------------------------\n'
            '  Used (default) | Shows "used/total" (e.g., 40/100 means 40 Gi used\n'
            '                 | out of 100 Gi total memory)\n'
            '  Free           | Shows available resources as a single number\n'
            '                 | (e.g., 60 means 60 Gi of memory is available for use)\n'
            '\n'
            'This applies to all allocatable resources: CPU, memory, storage, and GPU.'),
        formatter_class=argparse.RawDescriptionHelpFormatter)
    list_parser.add_argument('--pool', '-p',
                             nargs='+',
                             default=[],
                             help='Display resources for specified pool.')
    list_parser.add_argument('--platform',
                             nargs='+',
                             default=[],
                             help='Display resources for specified platform.')
    list_parser.add_argument('--all', '-a',
                             action='store_true',
                             help='Show all resources from all pools.')
    list_parser.add_argument('--format-type', '-t',
                             dest='format_type',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    list_parser.add_argument('--mode', '-m',
                             dest='mode',
                             choices=('free', 'used'),
                             default='used',
                             help='Show free or used resources (Default used).')
    list_parser.set_defaults(func=_cluster_resources)

    info_parser = subparsers.add_parser(
        'info', help='Get resource allocatable and configurations of a node.')
    info_parser.add_argument('node_name',
                             type=str,
                             help='Name of node.')
    info_parser.add_argument(
        '--pool', '-p',
        help='Specify the pool to see specific allocatable and configurations.')
    info_parser.add_argument(
        '--platform', '-pl',
        help='Specify the platform to see specific allocatable and configurations.')
    info_parser.set_defaults(func=_info_resource)


def round_resources(total_request: float, allocatable: float) -> Tuple[int, int]:
    """
    Given total_request and allocatable, round those two values, and add them
    to the aggregated_request dict by using 'key' to index.

    Return the rounded total_request and allocatable values.
    """
    rounded_total_request = math.ceil(total_request)
    rounded_allocatable = math.floor(allocatable)
    # Since we are rounding up total request and rounding down allocatables,
    # make sure the column value below will not have a numerator bigger than
    # a denominator.
    final_total_request = min(rounded_total_request, rounded_allocatable)

    return final_total_request, rounded_allocatable


def fetch_resources(service_client: client.ServiceClient, pools: List[str],
                    platform: Optional[List[str]] = None, all_pools: bool = False) -> Dict:
    logging.debug('Getting cluster resources')
    params = {'pools': pools, 'all_pools': all_pools}
    if platform:
        params['platforms'] = platform

    response = service_client.request(client.RequestMethod.GET, 'api/resources', params=params)
    return response


def _cluster_resources(service_client: client.ServiceClient, args: argparse.Namespace):
    if not args.pool:
        args.pool = [pool.fetch_default_pool(service_client)]

    # Validate that the pools are valid
    pool_configs = pool.list_pools(service_client)
    for pool_name in args.pool:
        if pool_name not in pool_configs['pools'].keys():
            raise osmo_errors.OSMOUserError(f'Pool {pool_name} does not exist!')

    response = fetch_resources(service_client, args.pool, args.platform, args.all)

    if args.format_type == 'json':
        print(json.dumps(response, indent=common.JSON_INDENT_SIZE))
        return

    if 'resources' not in response or len(response['resources']) == 0:
        print('There are no available resources.')
        return

    def check_exposed_fields(resource: Dict):
        if 'exposed_fields' not in resource:
            print('Resource response from server is malformed.')
            return

    keys = ['Node', 'Pool', 'Platform', 'Type']
    allocatable_keys = \
        [resource.resource_label_with_unit \
         for resource in common.ALLOCATABLE_RESOURCES_LABELS]
    keys.extend(allocatable_keys)
    allocatable_labels_lookup = {resource.resource_label_with_unit: resource.name \
                                 for resource in common.ALLOCATABLE_RESOURCES_LABELS}
    occupancy_aggregated_request = {resource.name: (0, 0) \
                          for resource in common.ALLOCATABLE_RESOURCES_LABELS}
    available_aggregated_request = {resource.name: 0 \
                          for resource in common.ALLOCATABLE_RESOURCES_LABELS}
    check_exposed_fields(response['resources'][0])
    table = common.osmo_table(header=keys)
    table.set_cols_dtype(['t' for _ in range(len(keys))])
    availability_mode = args.mode == 'free'
    for resource in response['resources']:
        check_exposed_fields(resource)
        pool_platform_map = {}
        for pool_platform in resource['exposed_fields'].get('pool/platform', []):
            pool_name = pool_platform.split('/')[0]
            platform_name = pool_platform.split('/')[1]
            if pool_name not in pool_platform_map:
                pool_platform_map[pool_name] = [platform_name]
            else:
                pool_platform_map[pool_name].append(platform_name)

        for pool_idx, pool_name in enumerate(pool_platform_map.keys()):
            for plat_idx, platform in enumerate(pool_platform_map[pool_name]):
                row = []
                for key in keys:
                    # If printing usage for a kubernetes allocatable
                    value = '0'
                    if key in allocatable_labels_lookup:
                        resource_key = allocatable_labels_lookup[key]
                        allocatable, total_request = \
                            common.convert_allocatable_request_fields(
                                resource_key,
                                resource,
                                pool_name,
                                platform)
                        value = '0'
                        if allocatable > 0:
                            final_total_request, rounded_allocatable = \
                                round_resources(total_request, allocatable)
                            if availability_mode:
                                available = rounded_allocatable - final_total_request
                                value = f'{available}'
                                if pool_idx == 0 and plat_idx == 0:
                                    available_aggregated_request[resource_key] = \
                                        available_aggregated_request[resource_key] + available
                            else:
                                value = f'{final_total_request}/{rounded_allocatable}'
                                if pool_idx == 0 and plat_idx == 0:
                                    current_sum_request, current_sum_alloc = \
                                        occupancy_aggregated_request[resource_key]
                                    occupancy_aggregated_request[resource_key] = \
                                        (current_sum_request + final_total_request,
                                        current_sum_alloc + rounded_allocatable)
                    elif key == 'Node':
                        value = str(resource['exposed_fields'].get('node', '-')) \
                            if pool_idx == 0 and plat_idx == 0 else ''
                    elif key == 'Pool':
                        value = pool_name
                    elif key == 'Platform':
                        value = platform
                    elif key == 'Type':
                        value = resource['resource_type'] if pool_idx == 0 \
                            and plat_idx == 0 else ''
                    row.append(value)
                table.add_row(row)

    alloc_start_index = len(keys) - len(common.ALLOCATABLE_RESOURCES_LABELS)

    # The order of iteration in aggregated_request is the same as the order of the allocatable
    # categories in the response because in Python 3.8+, the order of iteration is the order
    # of key/value pairs added to a dictionary
    aggregated_values = [str(value) for value in available_aggregated_request.values()] \
        if availability_mode else \
            [f'{value[0]}/{value[1]}' for value in occupancy_aggregated_request.values()]

    total_row: List[Any] = ['']  * alloc_start_index + \
        aggregated_values + \
        [''] * (len(keys) - alloc_start_index - len(common.ALLOCATABLE_RESOURCES_LABELS))

    print(common.create_table_with_sum_row(table, total_row))


def _info_resource(service_client: client.ServiceClient, args: argparse.Namespace):
    if (args.pool and not args.platform) or (not args.pool and args.platform):
        print('Pool and platform must be specified at the same time.')
        return

    response = service_client.request(client.RequestMethod.GET, f'api/resources/{args.node_name}')
    if 'resources' not in response or len(response['resources']) == 0:
        print(f'{args.node_name} is not a resource.')
        return
    resource = response['resources'][0]
    keys = resource['exposed_fields'].keys()
    allocatable_labels_lookup = \
        {resource_label.name: (resource_label.name, resource_label.unit) \
         for resource_label in common.ALLOCATABLE_RESOURCES_LABELS}
    allocatables = {}

    selected_pool, selected_platform = args.pool, args.platform
    try:
        if not args.pool:
            selected_pool = list(resource['pool_platform_labels'].keys())[0]
            selected_platform = resource['pool_platform_labels'][selected_pool][0]
        for key in keys:
            # If printing usage for a kubernetes allocatable
            if key in allocatable_labels_lookup:
                allocatable, _ = common.convert_allocatable_request_fields(
                    key, resource, selected_pool, selected_platform)
                rounded_allocatable = math.floor(allocatable)
                capacity = max(0, rounded_allocatable)
                allocatable_name = allocatable_labels_lookup[key][0]
                unit = allocatable_labels_lookup[key][1] \
                    if allocatable_labels_lookup[key][1] else ''
                allocatables[allocatable_name] = f'{capacity}{unit}'
        print(f'\nResource Name: {args.node_name}')

        print('\nPool Specification:')
        table = common.osmo_table(header=['Pool', 'Platform'])
        for pool_name, platform_list in resource['pool_platform_labels'].items():
            for i, platform in enumerate(platform_list):
                table.add_row([pool_name if i == 0 else '', platform])

        print(f'\n{table.draw()}')
        print(f'\n* (Using configuration for {selected_pool}/{selected_platform}):')
        print('Resource Capacity')
        print('-----------------')
        for key, value in allocatables.items():
            print(f'{key}: {value}')

        platform_config = resource['config_fields'][selected_pool][selected_platform]
        default_mount_str = '\n'.join([f'- {mount}' for mount in platform_config['default_mounts']])
        allowed_mount_str = '\n'.join([f'- {mount}' for mount in platform_config['allowed_mounts']])
        print('\nTask Configurations\n'
            '-------------------\n'
            f'Host Network Allowed: {platform_config["host_network"]}\n'
            f'Privileged Mode Allowed: {platform_config["privileged"]}\n'
            f'Default Mounts:\n{default_mount_str}\n'
            f'Allowed Mounts:\n{allowed_mount_str}\n')
    except KeyError:
        print(f'Node {args.node_name} is not in pool {selected_pool} and platform '
              f'{selected_platform}')
