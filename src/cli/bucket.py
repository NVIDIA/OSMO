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

from src.lib.utils import client, common


def setup_parser(parser: argparse._SubParsersAction):
    """
    Configures parser to show basic bucket information.

    Args:
        parser: The parser to be configured.
    """
    bucket_parser = parser.add_parser('bucket',
        help='Command to show bucket information.')
    subparsers = bucket_parser.add_subparsers(dest='command')
    subparsers.required = True

    list_parser = subparsers.add_parser('list',
                                        help='List available and default buckets',
                                        epilog='Ex. osmo bucket list')
    list_parser.add_argument('--format-type', '-t',
                             dest='format_type',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    list_parser.set_defaults(func=_list_bucket)


def _list_bucket(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    List default and available buckets
    Args:
        args: Parsed command line arguments.
    """
    # pylint: disable=unused-argument

    bucket_info = service_client.request(client.RequestMethod.GET, 'api/bucket')
    if args.format_type == 'json':
        print(json.dumps(bucket_info, indent=common.JSON_INDENT_SIZE))
    else:
        collection_header = ['Bucket', 'Description', 'Location', 'Mode', 'Default Cred']
        table = common.osmo_table(header=collection_header)
        buckets = list(bucket_info['buckets'].keys())
        buckets.sort()
        for bucket_name in buckets:
            bucket_object = bucket_info['buckets'][bucket_name]
            path = bucket_object['path']
            description = bucket_object['description']
            mode = bucket_object['mode']
            default_cred = 'Yes' if bucket_object.get('default_cred', False) else 'No'
            if bucket_info['default'] and bucket_name == bucket_info['default']:
                bucket_name += ' (default)'
            table.add_row([bucket_name, description, path, mode, default_cred])
        print(f'{table.draw()}\n')
