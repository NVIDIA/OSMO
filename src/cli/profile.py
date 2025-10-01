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
import sys

import yaml

from src.lib.utils import client, client_configs, common

def setup_parser(parser: argparse._SubParsersAction):
    '''
    Profile parser setup and run command based on parsing.

    Args:
        parser: The parser to be configured.
    '''
    profile_parser = parser.add_parser('profile',
        help='Manage user profile.')

    subparsers = profile_parser.add_subparsers(dest='command')
    subparsers.required = True

    # Handle 'set' command
    set_parser = subparsers.add_parser(
        'set', help='Set profile settings.',
        formatter_class=argparse.RawTextHelpFormatter,
        epilog='Ex. osmo profile set bucket my_bucket\n'
               'Ex. osmo profile set pool my_pool\n'
               'Ex. osmo profile set notifications email true # Enable only email notifications\n'
               'Ex. osmo profile set notifications slack false # Disable slack notifications'
        )
    set_parser.add_argument('setting',
                            choices=['notifications', 'bucket', 'pool'],
                            help='Field to set')
    set_parser.add_argument('value', help='Type of notification, or name of bucket/pool')
    set_parser.add_argument('enabled',
                            choices=['true', 'false'], nargs='?',
                            help='Enable or disable, strictly for notifications.')
    set_parser.set_defaults(func=_run_setting_set)

    # Handle 'list' command
    list_parser = subparsers.add_parser('list',
                                        help='Fetch notification settings.')
    list_parser.add_argument('--format-type', '-t',
                             dest='format_type',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    list_parser.set_defaults(func=_run_setting_list)


def _run_setting_set(service_client: client.ServiceClient, args: argparse.Namespace):
    payload = {}
    if args.setting == 'notifications':
        if args.value == 'email':
            if args.enabled == 'true' or not args.enabled:
                payload['email_notification'] = True
            elif args.enabled == 'false':
                print('Disabling email notifications')
                payload['email_notification'] = False
        elif args.value == 'slack':
            if args.enabled == 'true' or not args.enabled:
                payload['slack_notification'] = True
            elif args.enabled == 'false':
                payload['slack_notification'] = False
        else:
            print(f'Invalid type of notification: {args.value}. Must be slack or email.')
            sys.exit(1)
    elif args.setting == 'bucket':
        payload['bucket'] = args.value
    elif args.setting == 'pool':
        payload['pool'] = args.value

    service_client.request(client.RequestMethod.POST, 'api/profile/settings', payload=payload,
                           params={})
    print('Profile Set')


def _run_setting_list(service_client: client.ServiceClient, args: argparse.Namespace):
    # pylint: disable=unused-argument
    result = service_client.request(client.RequestMethod.GET, 'api/profile/settings')
    if service_client.login_manager.using_osmo_token():
        access_token = service_client.login_manager.get_access_token()
        if access_token:
            # Get the roles for the token
            roles_result = service_client.request(
                client.RequestMethod.GET,
                'api/auth/access_token',
                params={'access_token': access_token})
            result['token'] = roles_result
    if args.format_type == 'text':
        print('user:')
        login_dir = client_configs.get_client_config_dir()
        login_file = login_dir  + '/login.yaml'
        try:
            with open(os.path.expanduser(login_file), 'r', encoding='utf-8') as file:
                login_dict = yaml.safe_load(file.read())
                if login_dict.get('name', None):
                    print(f'{common.TAB}name: {login_dict["name"]}')
        except FileNotFoundError:
            pass
        profile_result = result.get('profile', {})
        pools_result = [f'{common.TAB}- {pool_name}' for pool_name in result.get('pools', [])]
        pools_output = '\n'.join(pools_result)
        email = profile_result.get('username', '')
        print(f'{common.TAB}email: {email}')
        print('notifications:\n'
              f'{common.TAB}email: {profile_result.get("email_notification", "")}\n'
              f'{common.TAB}slack: {profile_result.get("slack_notification", "")}\n'
              'bucket:\n'
              f'{common.TAB}default: {profile_result.get("bucket", "")}\n'
              'pool:\n'
              f'{common.TAB}default: {profile_result.get("pool", "")}\n'
              f'{common.TAB}accessible:\n'
              f'{pools_output}')
        token_result = result.get('token', {})
        if token_result:
            expires_at = common.convert_str_to_time(token_result['expires_at'].split('T')[0],
                                                    '%Y-%m-%d').date()
            print(f'token roles:\n'
                  f'{common.TAB}name: {token_result.get("token_name", "")}\n'
                  f'{common.TAB}expires_at: {expires_at}\n'
                  f'{common.TAB}roles: {", ".join(token_result.get("roles", []))}')
    else:
        print(json.dumps(result, indent=2))
