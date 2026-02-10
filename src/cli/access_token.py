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
import datetime
import json
import re

from src.lib.utils import client, common, osmo_errors, validation


def setup_parser(parser: argparse._SubParsersAction):
    """
    Configures parser to manage access tokens.

    Args:
        parser: The parser to be configured.
    """
    token_parser = parser.add_parser('token',
        help='Manage personal access tokens.')
    subparsers = token_parser.add_subparsers(dest='command')
    subparsers.required = True

    set_parser = subparsers.add_parser(
        'set',
        help='Create a new access token.',
        description='Create a personal access token for yourself or another user (admin only).',
        epilog='Ex. osmo token set my-token --expires-at 2026-05-01\n'
               'Ex. osmo token set my-token -e 2026-05-01 -d "My token description"\n'
               'Ex. osmo token set my-token -r role1 -r role2\n'
               'Ex. osmo token set service-token --user service-account@example.com '
               '--roles osmo-backend',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    set_parser.add_argument('name',
                            help='Name of the token.')
    set_parser.add_argument('--expires-at', '-e',
                            default=(datetime.datetime.utcnow() + datetime.timedelta(days=31))\
                                .strftime('%Y-%m-%d'),
                            type=validation.date_str,
                            help='Expiration date of the token (UTC). Format: YYYY-MM-DD. '
                                 'Default: 31 days from now.')
    set_parser.add_argument('--description', '-d',
                            help='Description of the token.')
    set_parser.add_argument('--user', '-u',
                            help='Create token for a specific user (admin only). '
                                 'By default, creates token for the current user.')
    set_parser.add_argument('--roles', '-r',
                            action='append',
                            help='Role to assign to the token. Can be specified multiple times. '
                                 'If not specified, inherits all of the user\'s current roles.')
    set_parser.add_argument('--format-type', '-t',
                            choices=('json', 'text'), default='text',
                            help='Specify the output format type (Default text).')
    set_parser.set_defaults(func=_set_token)

    delete_parser = subparsers.add_parser(
        'delete',
        help='Delete an access token.',
        description='Delete an access token for yourself or another user (admin only).',
        epilog='Ex. osmo token delete my-token\n'
               'Ex. osmo token delete old-token --user other-user@example.com',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    delete_parser.add_argument('name',
                               help='Name of the token to delete.')
    delete_parser.add_argument('--user', '-u',
                               help='Delete token for a specific user (admin only). '
                                    'By default, deletes token for the current user.')
    delete_parser.set_defaults(func=_delete_token)

    list_parser = subparsers.add_parser(
        'list',
        help='List all access tokens.',
        description='List access tokens for yourself or another user (admin only).',
        epilog='Ex. osmo token list\n'
               'Ex. osmo token list --user service-account@example.com',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    list_parser.add_argument('--user', '-u',
                             help='List tokens for a specific user (admin only). '
                                  'By default, lists tokens for the current user.')
    list_parser.add_argument('--format-type', '-t',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    list_parser.set_defaults(func=_list_tokens)

    roles_parser = subparsers.add_parser(
        'roles',
        help='List roles assigned to a token.',
        description='List all roles assigned to an access token.',
        epilog='Ex. osmo token roles my-token',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    roles_parser.add_argument('name',
                              help='Name of the token.')
    roles_parser.add_argument('--format-type', '-t',
                              choices=('json', 'text'), default='text',
                              help='Specify the output format type (Default text).')
    roles_parser.set_defaults(func=_list_token_roles)


def _set_token(service_client: client.ServiceClient, args: argparse.Namespace):
    """Create an access token."""
    if not re.fullmatch(common.TOKEN_NAME_REGEX, args.name):
        raise osmo_errors.OSMOUserError(
            f'Token name {args.name} must match regex {common.TOKEN_NAME_REGEX}')

    params = {'expires_at': args.expires_at}
    if args.description:
        params['description'] = args.description
    if args.roles:
        params['roles'] = args.roles

    # Determine the API path based on whether a user is specified
    if args.user:
        # Admin API: create token for a specific user
        path = f'api/auth/user/{args.user}/access_token/{args.name}'
    else:
        # Default: create token for the current user
        path = f'api/auth/access_token/{args.name}'

    result = service_client.request(client.RequestMethod.POST, path,
                                    payload=None, params=params)
    if args.format_type == 'json':
        print(json.dumps({'token': result}))
    else:
        print('Note: Save the token in a secure location as it will not be shown again')
        print(f'Access token: {result}')
        if args.user:
            print(f'Created for user: {args.user}')
        if args.roles:
            print(f'Roles: {", ".join(args.roles)}')


def _delete_token(service_client: client.ServiceClient, args: argparse.Namespace):
    """Delete an access token."""
    if args.user:
        # Admin API: delete token for a specific user
        path = f'api/auth/user/{args.user}/access_token/{args.name}'
    else:
        # Default: delete token for the current user
        path = f'api/auth/access_token/{args.name}'

    service_client.request(client.RequestMethod.DELETE, path,
                           payload=None, params=None)
    if args.user:
        print(f'Access token {args.name} deleted for user {args.user}')
    else:
        print(f'Access token {args.name} deleted')


def _list_tokens(service_client: client.ServiceClient, args: argparse.Namespace):
    """List access tokens."""
    if args.user:
        # Admin API: list tokens for a specific user
        path = f'api/auth/user/{args.user}/access_tokens'
    else:
        # Default: list tokens for the current user
        path = 'api/auth/access_token'

    result = service_client.request(client.RequestMethod.GET, path)

    if not result:
        if args.user:
            print(f'No tokens found for user {args.user}')
        else:
            print('No tokens found')
        return

    if args.format_type == 'json':
        print(json.dumps(result, indent=2, default=str))
    else:
        if args.user:
            print(f'Tokens for user: {args.user}\n')
        collection_header = ['Name', 'Description', 'Active', 'Expires At (UTC)', 'Roles']
        table = common.osmo_table(header=collection_header)
        columns = ['token_name', 'description', 'active', 'expires_at', 'roles']
        for token in result:
            expire_date = common.convert_str_to_time(
                token['expires_at'].split('T')[0], '%Y-%m-%d').date()
            token['expires_at'] = expire_date
            token['active'] = 'Expired' if expire_date <= datetime.datetime.utcnow().date() \
                else 'Active'
            # Format roles as comma-separated string
            roles = token.get('roles', [])
            token['roles'] = ', '.join(roles) if roles else '-'
            table.add_row([token.get(column, '-') for column in columns])
        print(f'{table.draw()}\n')


def _list_token_roles(service_client: client.ServiceClient, args: argparse.Namespace):
    """List roles assigned to a token."""
    path = f'api/auth/access_tokens/{args.name}/roles'
    result = service_client.request(client.RequestMethod.GET, path)

    if args.format_type == 'json':
        print(json.dumps(result, indent=2, default=str))
    else:
        print(f'Token: {result.get("token_name", args.name)}')
        print(f'Owner: {result.get("user_name", "-")}')
        roles = result.get('roles', [])
        if roles:
            print('\nRoles:')
            for role in roles:
                assigned_at = role.get('assigned_at', '-')
                if assigned_at and assigned_at != '-':
                    assigned_at = assigned_at.split('T')[0]
                print(f'  - {role.get("role_name")} (assigned by {role.get("assigned_by")} '
                      f'on {assigned_at})')
        else:
            print('\nRoles: None')
