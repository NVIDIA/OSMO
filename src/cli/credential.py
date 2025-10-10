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
import os
import re
import stat
import sys
import yaml

import shtab

from src.lib.utils import client, client_configs, common, credentials, osmo_errors

CRED_TYPES = ['REGISTRY', 'DATA', 'GENERIC']


def _save_config(data_cred: credentials.DataCredential):
    """
    Sets default config information
    """
    osmo_directory = client_configs.get_client_config_dir()
    password_file = osmo_directory + '/config.yaml'
    try:
        with open(password_file, 'r', encoding='utf-8') as file:
            config = yaml.safe_load(file.read())
    except FileNotFoundError:
        config = {'auth': {'data': {}}}

    config['auth']['data'][data_cred.endpoint] = {
        'access_key_id': data_cred.access_key_id,
        'access_key': data_cred.access_key.get_secret_value(),
        'region': data_cred.region}
    with open(password_file, 'w', encoding='utf-8') as file:
        yaml.dump(config, file)
    os.chmod(password_file, stat.S_IREAD | stat.S_IWRITE)


def _delete_config(endpoint_url: str):
    """
    Delete a data credential
    """
    osmo_directory = client_configs.get_client_config_dir()
    password_file = osmo_directory + '/config.yaml'
    try:
        with open(password_file, 'r', encoding='utf-8') as file:
            config = yaml.safe_load(file.read())
    except FileNotFoundError:
        return

    config['auth']['data'].pop(endpoint_url)
    with open(password_file, 'w', encoding='utf-8') as file:
        yaml.dump(config, file)
    os.chmod(password_file, stat.S_IREAD | stat.S_IWRITE)


def _run_set_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Post credential Version tags
    Args:
        args: Parsed command line arguments.
    """
    cred_payload = {}
    payload = args.payload if args.payload else args.payload_file
    for item in payload:
        if '=' not in item:
            print('Error: Invalid payload format. Please use key=value pairs.')
            sys.exit(1)
        key, value = item.split('=', 1)
        if not key or not value:
            print('Error: Please provide non-empty keys and values.')
            sys.exit(1)
        if args.payload:
            cred_payload[key] = value
        else:
            try:
                with open(value, 'r', encoding='utf-8') as file:
                    contents = file.read()
                    cred_payload[key] = contents
            except FileNotFoundError:
                print(f'File {value} cannot be found.')
                sys.exit(1)

    if args.type == 'GENERIC':
        cred_payload = {'credential': cred_payload}

    result = service_client.request(client.RequestMethod.POST,
                                    f'api/credentials/{args.name}',
                                    payload={args.type.lower() + '_credential': cred_payload})
    if args.format_type == 'json':
        print(json.dumps(result, indent=2))
    else:
        print(f'Set {args.type} credential {args.name}.')

    if args.type == 'DATA':
        if 'endpoint' not in cred_payload:
            raise osmo_errors.OSMOUserError('Endpoint is required for DATA credentials.')
        _save_config(credentials.DataCredential(**cred_payload))


def _run_list_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    list credentials
    Args:
        args: Parsed command line arguments.
    """
    # pylint: disable=unused-argument
    result = service_client.request(client.RequestMethod.GET,
                                    'api/credentials')
    if args.format_type == 'json':
        print(json.dumps(result, indent=2))
    else:
        cred_header = ['Name', 'Type', 'Profile', 'Local']
        table = common.osmo_table(header=cred_header)
        columns = ['cred_name', 'cred_type', 'profile', 'local']
        for cred in result['credentials']:
            cred['local'] = 'N/A'
            if cred.get('cred_type', '') == 'DATA':
                try:
                    client_configs.get_credentials(cred.get('profile', ''))
                    cred['local'] = 'Yes'
                except osmo_errors.OSMOError:
                    cred['local'] = 'No'
            table.add_row([cred.get(column, '-') for column in columns])
        print(f'{table.draw()}\n')


def _run_delete_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Delete an existing credential
    Args:
        args: Parsed command line arguments.
    """
    # pylint: disable=unused-argument
    result = service_client.request(client.RequestMethod.DELETE,
                                    f'api/credentials/{args.name}')
    print(f'Deleted credential {args.name}.')
    if result['credentials'][0]['cred_type'] == 'DATA':
        _delete_config(result['credentials'][0]['profile'])


def cred_name_regex(arg_value):
    if not re.fullmatch(credentials.CREDNAMEREGEX, arg_value):
        raise argparse.ArgumentTypeError(f'Invalid name: {arg_value}. Names can only consist of '
                                         'letters, numbers, -, and _. The name must start with a '
                                         'letter.')
    return arg_value


def setup_parser(parser: argparse._SubParsersAction):
    """
    Credential parser setup and run command based on parsing
    Args:
        parser: Reads the CLI to handle which command gets executed.
    """
    credential_parser = parser.add_parser('credential',
                                          help='This CLI is used for the user to set, '
                                          + 'get and delete credentials.')
    credential_parser.add_argument('--format-type',
                                   dest='format_type',
                                   choices=('json', 'text'), default='text',
                                   help='Specify the output format type (Default text).')
    subparsers = credential_parser.add_subparsers(dest='command')
    subparsers.required = True

    # Handle 'set' command
    set_parser = subparsers.add_parser('set', help='Create or update a credential',
        formatter_class=argparse.RawTextHelpFormatter,
        epilog='Ex. osmo credential set registry_cred_name --type REGISTRY ' +
        '--payload registry=your_registry username=your_username auth=xxxxxx \n' +
        'Ex. osmo credential set data_cred_name --type DATA ' +
        '--payload access_key_id=your_s3_username access_key=xxxxxx ' +
        'endpoint=s3://bucket \n' +
        'Ex. osmo credential set generic_cred_name --type GENERIC ' +
        '--payload omni_user=your_omni_username omni_pass=xxxxxx \n' +
        'Ex. osmo credential set generic_cred_name --type GENERIC ' +
        '--payload-file ssh_public_key=<path to file>')
    set_parser.add_argument('name', help='Name of the credential.', type=cred_name_regex)
    set_parser.add_argument('--type', type=str, default='GENERIC', choices=[
                            'REGISTRY', 'DATA', 'GENERIC'], help='Type of the credential.')

    set_group = set_parser.add_mutually_exclusive_group(required=True)
    set_group.add_argument(
        '--payload',
        type=str,
        nargs='+',
        help=(
            'List of key-value pairs.\n'
            'The tabulated information illustrates the mandatory and optional keys for the '
            'payload corresponding to each type of credential:\n'
            '\n'
            # pylint: disable=line-too-long
            '+-----------------+---------------------------+---------------------------------------+\n'
            '| Credential Type | Mandatory keys            | Optional keys                         |\n'
            '+-----------------+---------------------------+---------------------------------------+\n'
            '| REGISTRY        | auth                      | registry, username                    |\n'
            '+-----------------+---------------------------+---------------------------------------+\n'
            '| DATA            | access_key_id, access_key | endpoint, region (default: us-east-1) |\n'
            '+-----------------+---------------------------+---------------------------------------+\n'
            '| GENERIC         |                           |                                       |\n'
            '+-----------------+---------------------------+---------------------------------------+\n'
            # pylint: enable=line-too-long
            '\n'
        ),
    )
    set_group.add_argument('--payload-file', dest='payload_file', type=str, nargs='+',
        help='List of key-value pairs, but the value provided needs to be a path to a file.\n'
             'Retrieves the value of the secret from a file.').complete = shtab.FILE
    set_parser.set_defaults(func=_run_set_command)

    # Handle 'list' command
    list_parser = subparsers.add_parser('list', help='List all credentials',
                                        epilog='Ex. osmo credential list')
    list_parser.set_defaults(func=_run_list_command)

    # Handle 'delete' command
    delete_parser = subparsers.add_parser('delete',
                                          help='Delete an existing credential',
                                          epilog='Ex. osmo credential delete omni_cred')
    delete_parser.add_argument('name', help='Delete credential with name.', type=cred_name_regex)
    delete_parser.set_defaults(func=_run_delete_command)
