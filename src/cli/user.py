"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
    Configures parser for user management commands.

    Args:
        parser: The parser to be configured.
    """
    user_parser = parser.add_parser('user',
        help='Manage users and their roles.')
    subparsers = user_parser.add_subparsers(dest='command')
    subparsers.required = True

    # List users
    list_parser = subparsers.add_parser(
        'list',
        help='List all users.',
        description='List users with optional filtering.',
        epilog='Ex. osmo user list\n'
               'Ex. osmo user list --id-prefix service-\n'
               'Ex. osmo user list --roles osmo-admin osmo-user',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    list_parser.add_argument('--id-prefix', '-p',
                             help='Filter users whose ID starts with this prefix.')
    list_parser.add_argument('--roles', '-r', nargs='+',
                             help='Filter users who have ANY of these roles.')
    list_parser.add_argument('--count', '-c', type=int, default=100,
                             help='Number of results per page (default: 100).')
    list_parser.add_argument('--format-type', '-t',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    list_parser.set_defaults(func=_list_users)

    # Create user
    create_parser = subparsers.add_parser(
        'create',
        help='Create a new user.',
        description='Create a new user with optional roles.',
        epilog='Ex. osmo user create myuser@example.com\n'
               'Ex. osmo user create service-account --roles osmo-user osmo-ml-team',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    create_parser.add_argument('user_id',
                               help='User ID (e.g., email or username).')
    create_parser.add_argument('--roles', '-r', nargs='+',
                               help='Initial roles to assign to the user.')
    create_parser.add_argument('--format-type', '-t',
                               choices=('json', 'text'), default='text',
                               help='Specify the output format type (Default text).')
    create_parser.set_defaults(func=_create_user)

    # Update user (add/remove roles)
    update_parser = subparsers.add_parser(
        'update',
        help='Update a user (add or remove roles).',
        description='Add or remove roles from a user.',
        epilog='Ex. osmo user update myuser@example.com --add-roles osmo-admin\n'
               'Ex. osmo user update myuser@example.com --remove-roles osmo-ml-team\n'
               'Ex. osmo user update myuser@example.com --add-roles admin --remove-roles guest',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    update_parser.add_argument('user_id',
                               help='User ID to update.')
    update_parser.add_argument('--add-roles', '-a', nargs='+',
                               help='Roles to add to the user.')
    update_parser.add_argument('--remove-roles', '-r', nargs='+',
                               help='Roles to remove from the user.')
    update_parser.add_argument('--format-type', '-t',
                               choices=('json', 'text'), default='text',
                               help='Specify the output format type (Default text).')
    update_parser.set_defaults(func=_update_user)

    # Delete user
    delete_parser = subparsers.add_parser(
        'delete',
        help='Delete a user.',
        description='Delete a user and all associated data (tokens, roles, profile).',
        epilog='Ex. osmo user delete myuser@example.com',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    delete_parser.add_argument('user_id',
                               help='User ID to delete.')
    delete_parser.add_argument('--force', '-f', action='store_true',
                               help='Skip confirmation prompt.')
    delete_parser.set_defaults(func=_delete_user)

    # Get user details
    get_parser = subparsers.add_parser(
        'get',
        help='Get user details.',
        description='Get detailed information about a user including their roles.',
        epilog='Ex. osmo user get myuser@example.com',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    get_parser.add_argument('user_id',
                            help='User ID to get details for.')
    get_parser.add_argument('--format-type', '-t',
                            choices=('json', 'text'), default='text',
                            help='Specify the output format type (Default text).')
    get_parser.set_defaults(func=_get_user)


def _list_users(service_client: client.ServiceClient, args: argparse.Namespace):
    """List users with optional filtering."""
    params = {'count': args.count}

    if args.id_prefix:
        params['id_prefix'] = args.id_prefix

    if args.roles:
        params['roles'] = args.roles

    result = service_client.request(client.RequestMethod.GET, 'api/auth/user',
                                    params=params)

    users = result.get('users', [])
    if not users:
        print('No users found')
        return

    if args.format_type == 'json':
        print(json.dumps(result, indent=2, default=str))
    else:
        print(f'Total users: {result.get("total_results", len(users))}')
        print()
        collection_header = ['User ID', 'Created At']
        table = common.osmo_table(header=collection_header)
        for user in users:
            created_at = user.get('created_at', '-')
            if created_at and created_at != '-':
                created_at = created_at.split('T')[0]
            table.add_row([
                user.get('id', '-'),
                created_at
            ])
        print(f'{table.draw()}\n')


def _create_user(service_client: client.ServiceClient, args: argparse.Namespace):
    """Create a new user."""
    payload = {'id': args.user_id}

    if args.roles:
        payload['roles'] = args.roles

    result = service_client.request(client.RequestMethod.POST, 'api/auth/user',
                                    payload=payload)

    if args.format_type == 'json':
        print(json.dumps(result, indent=2, default=str))
    else:
        print(f'User created: {result.get("id")}')
        if args.roles:
            print(f'Roles assigned: {", ".join(args.roles)}')


def _update_user(service_client: client.ServiceClient, args: argparse.Namespace):
    """Update a user (add/remove roles)."""
    user_id = args.user_id

    # Add roles
    if args.add_roles:
        for role_name in args.add_roles:
            payload = {'role_name': role_name}
            service_client.request(client.RequestMethod.POST,
                                    f'api/auth/user/{user_id}/roles',
                                    payload=payload)
            print(f'Added role: {role_name}')

    # Remove roles
    if args.remove_roles:
        for role_name in args.remove_roles:
            service_client.request(client.RequestMethod.DELETE,
                                    f'api/auth/user/{user_id}/roles/{role_name}')
            print(f'Removed role: {role_name}')

    # Get updated user info
    if args.format_type == 'json':
        result = service_client.request(client.RequestMethod.GET,
                                        f'api/auth/user/{user_id}')
        print(json.dumps(result, indent=2, default=str))
    elif not args.add_roles and not args.remove_roles:
        print('No updates specified. Use --add-roles or --remove-roles.')


def _delete_user(service_client: client.ServiceClient, args: argparse.Namespace):
    """Delete a user."""
    user_id = args.user_id

    if not args.force:
        confirm = input(f'Are you sure you want to delete user "{user_id}"? '
                        'This will delete all associated tokens, roles, and profile. [y/N]: ')
        if confirm.lower() != 'y':
            print('Cancelled')
            return

    service_client.request(client.RequestMethod.DELETE, f'api/auth/user/{user_id}')
    print(f'User deleted: {user_id}')


def _get_user(service_client: client.ServiceClient, args: argparse.Namespace):
    """Get user details."""
    user_id = args.user_id

    result = service_client.request(client.RequestMethod.GET,
                                    f'api/auth/user/{user_id}')

    if args.format_type == 'json':
        print(json.dumps(result, indent=2, default=str))
    else:
        print(f'User ID: {result.get("id")}')
        created_at = result.get('created_at', '-')
        if created_at and created_at != '-':
            created_at = created_at.split('T')[0]
        print(f'Created At: {created_at}')
        print(f'Created By: {result.get("created_by") or "-"}')

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
