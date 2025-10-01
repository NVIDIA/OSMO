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

import requests  # type: ignore

from src.lib.utils import client, common, osmo_errors, version


def setup_parser(parser: argparse._SubParsersAction):
    """
    Configures parser to show current client version.

    Args:
        parser: The parser to be configured.
    """
    version_parser = parser.add_parser('version',
        help='Command to show client version.')
    version_parser.add_argument('--format-type', '-t',
                                dest='format_type',
                                help='Specify the output format type (Default text).',
                                choices=('json', 'text'), default='text')
    version_parser.set_defaults(func=_client_version)


def _client_version(service_client: client.ServiceClient, args: argparse.Namespace):
    result = {}
    try:
        result = service_client.request(client.RequestMethod.GET,
                                        'api/version',
                                        version_header=False)
    except (requests.exceptions.ConnectionError, ConnectionRefusedError, osmo_errors.OSMOUserError):
        pass
    client_version = version.VERSION
    if args.format_type == 'json':
        output = {'client': client_version.dict()}
        if result:
            output['service'] = result
        print(json.dumps(output, indent=common.JSON_INDENT_SIZE))
    else:
        print(f'OSMO client version:  {client_version}')
        if result:
            service_version = version.Version.from_dict(result)
            print(f'OSMO service version: {service_version}')
