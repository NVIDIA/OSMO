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
import datetime
import json
import re

from src.lib.utils import client, common, osmo_errors, validation


def setup_parser(parser: argparse._SubParsersAction):
    """
    Configures parser to show basic pool information.

    Args:
        parser: The parser to be configured.
    """
    token_parser = parser.add_parser('token',
        help='Set and delete access tokens.')
    subparsers = token_parser.add_subparsers(dest='command')
    subparsers.required = True

    set_parser = subparsers.add_parser(
        'set',
        help='Set a token for the current user.',
        description=(''),
        epilog='Ex. osmo token set my-token --expires-at 2026-05-01 '
               '--description "My token description"',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    set_parser.add_argument('name',
                            help='Name of the token.')
    set_parser.add_argument('--expires-at', '-e',
                            default=(datetime.datetime.utcnow() + datetime.timedelta(days=31))\
                                .strftime('%Y-%m-%d'),
                            type=validation.date_str,
                            help='Expiration date of the token. The date is based on UTC time. '
                                 'Format: YYYY-MM-DD')
    set_parser.add_argument('--description', '-d',
                            help='Description of the token.')
    set_parser.add_argument('--service', '-s', action='store_true',
                            help='Create a service token.')
    set_parser.add_argument('--roles', '-r', nargs='+',
                            help='Roles for the token. Only applicable for service tokens.')
    set_parser.add_argument('--format-type', '-t',
                            choices=('json', 'text'), default='text',
                            help='Specify the output format type (Default text).')
    set_parser.set_defaults(func=_set_token)

    delete_parser = subparsers.add_parser(
        'delete',
        help='Delete a token for the current user.',
        description=(''),
        epilog='Ex. osmo token delete my-token',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    delete_parser.add_argument('name',
                               help='Name of the token.')
    delete_parser.add_argument('--service', '-s', action='store_true',
                               help='Delete a service token.')
    delete_parser.set_defaults(func=_delete_token)

    list_parser = subparsers.add_parser(
        'list',
        help='List all tokens for the current user.',
        description=(''),
        epilog='Ex. osmo token list',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    list_parser.add_argument('--service', '-s', action='store_true',
                             help='List all service tokens.')
    list_parser.add_argument('--format-type', '-t',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    list_parser.set_defaults(func=_list_tokens)


def _set_token(service_client: client.ServiceClient, args: argparse.Namespace):
    if not re.fullmatch(common.TOKEN_NAME_REGEX, args.name):
        raise osmo_errors.OSMOUserError(
            f'Token name {args.name} must match regex {common.TOKEN_NAME_REGEX}')

    params = {'expires_at': args.expires_at}
    if args.description:
        params['description'] = args.description

    path = f'api/auth/access_token/user/{args.name}'
    if args.service:
        path = f'api/auth/access_token/service/{args.name}'

        if not args.roles:
            raise osmo_errors.OSMOUserError('Roles are required for service tokens.')
        params['roles'] = args.roles
    elif args.roles:
        raise osmo_errors.OSMOUserError('Roles are not supported for personal tokens.')

    result = service_client.request(client.RequestMethod.POST, path,
                                    payload=None, params=params)
    if args.format_type == 'json':
        print(json.dumps({'token': result}))
    else:
        print('Note: Save the token in a secure location as it will not be shown again')
        print(f'Access token: {result}')


def _delete_token(service_client: client.ServiceClient, args: argparse.Namespace):
    path = f'api/auth/access_token/user/{args.name}'
    if args.service:
        path = f'api/auth/access_token/service/{args.name}'

    service_client.request(client.RequestMethod.DELETE, path,
                           payload=None, params=None)
    print(f'Access token {args.name} deleted')


def _list_tokens(service_client: client.ServiceClient, args: argparse.Namespace):
    path = 'api/auth/access_token/user'
    if args.service:
        path = 'api/auth/access_token/service'

    result = service_client.request(client.RequestMethod.GET, path)
    if not result:
        print('No tokens found')
        return

    if args.format_type == 'json':
        print(json.dumps(result, indent=2))
    else:
        collection_header = ['Name', 'Description', 'Roles', 'Active', 'Expires At (UTC)']
        table = common.osmo_table(header=collection_header)
        columns = ['token_name', 'description', 'roles', 'active', 'expires_at']
        for token in result:
            expire_date = common.convert_str_to_time(
                token['expires_at'].split('T')[0], '%Y-%m-%d').date()
            token['expires_at'] = expire_date
            token['active'] = 'Expired' if expire_date <= datetime.datetime.utcnow().date() \
                else 'Active'
            token['roles'] = ', '.join(token['roles'])
            table.add_row([token.get(column, '-') for column in columns])
        print(f'{table.draw()}\n')
