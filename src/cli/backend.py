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

from src.lib.utils import client, common, osmo_errors


def setup_parser(parser: argparse._SubParsersAction):
    """
    Configures parser to show basic backend information.

    Args:
        parser: The parser to be configured.
    """
    backend_parser = parser.add_parser('backend',
        help='Command to show backend information.')
    subparsers = backend_parser.add_subparsers(dest='command')
    subparsers.required = True

    list_parser = subparsers.add_parser('list',
                                        help='List all available backends in the service.')
    list_parser.set_defaults(func=_list_backend)


def _list_backend(service_client: client.ServiceClient, args: argparse.Namespace):
    # pylint: disable=unused-argument
    result = service_client.request(client.RequestMethod.GET, 'api/configs/backend')
    if 'backends' not in result:
        raise osmo_errors.OSMOServerError('Backend response is not properly formatted.')

    backends = result['backends']
    keys = ['Name', 'Description', 'Status']
    table = common.osmo_table(header=keys)
    for backend in backends:
        if not all(field in backend for field in ['name', 'description', 'online']):
            raise osmo_errors.OSMOServerError('Backend response is not properly formatted.')
        status = 'ONLINE' if backend['online'] else 'OFFLINE'
        row = [backend['name'], backend['description'], status]
        table.add_row(row)
    print(table.draw())
