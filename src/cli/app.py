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
from typing import Any, Dict, List

from src.lib.utils import (client, common, osmo_errors, priority as wf_priority, validation,
                        workflow as workflow_utils)
from src.cli import editor, pool, workflow


def setup_parser(parser: argparse._SubParsersAction):
    """
    Configures parser to show basic pool information.

    Args:
        parser: The parser to be configured.
    """
    app_parser = parser.add_parser('app',
        help='Create and manage workflow apps.',
        description='Apps are reusable workflow files that can be shared with other users.')
    subparsers = app_parser.add_subparsers(dest='command')
    subparsers.required = True

    create_parser = subparsers.add_parser(
        'create',
        help='Create a workflow app.',
        description=('If file is not provided, the app will be created using the user\'s editor.'),
        epilog='Ex. osmo app create my-app --description "My app description"',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    create_parser.add_argument('name',
                               help='Name of the app.')
    create_parser.add_argument('--description', '-d', required=True,
                               help='Description of the app.')
    create_parser.add_argument('--file', '-f',
                               help='Path to the app file.')
    create_parser.set_defaults(func=_create_app)

    update_parser = subparsers.add_parser(
        'update',
        help='Update a workflow app.',
        description=('Update a workflow app using the user\'s editor.'),
        epilog='Ex. osmo app update my-app')
    update_parser.add_argument('name',
                               help='Name of the app. Can specify a version number to edit from '
                                    'a specific version by using <app>:<version> format.')
    update_parser.add_argument('--file', '-f',
                               help='Path to the app file.')
    update_parser.set_defaults(func=_update_app)

    info_parser = subparsers.add_parser(
        'info',
        help='Show app and app version information.',
        epilog='Ex. osmo app info my-app')
    info_parser.add_argument('name',
                             help='Name of the app. Specify version to get info '
                                  'from a specific version by using '
                                  '<app>:<version> format.')
    info_parser.add_argument('--count', '-c',
                             dest='count',
                             type=validation.positive_integer,
                             default=20,
                             help='For Datasets. Display the given number of versions. '
                                  'Default 20.')
    info_parser.add_argument('--order', '-o', choices=['asc', 'desc'], default='asc',
                             help='Display in the given order. asc means latest at the bottom. '
                                  'desc means latest at the top')
    info_parser.add_argument('--format-type', '-t',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    info_parser.set_defaults(func=_info_app)

    show_parser = subparsers.add_parser('show',
                                        help='Show app parameters.')
    show_parser.add_argument('name',
                             help='Name of the app. Specify version to get info '
                                  'from a specific version by using '
                                  '<app>:<version> format.')
    show_parser.set_defaults(func=_show_app)

    spec_parser = subparsers.add_parser('spec',
                                        help='Show app spec.')
    spec_parser.add_argument('name',
                            help='Name of the app. Specify version to get info '
                                 'from a specific version by using '
                                 '<app>:<version> format.')
    spec_parser.set_defaults(func=_spec_app)

    list_parser = subparsers.add_parser(
        'list',
        help='Lists all apps you created, updated, or submitted.',
        description='Lists all apps you created, updated, or submitted by default. If --user '
                    'is specified, it will list all apps owned by the user(s).')
    list_parser.add_argument('--name', '-n',
                             help='Display apps that have the given substring in their name')
    list_parser.add_argument('--user', '-u', nargs='+',
                             help='Display all app where the user has created.')
    list_parser.add_argument('--all-users', '-a', action='store_true',
                             help='Display all apps with no filtering on users')
    list_parser.add_argument('--count', '-c', type=int, default=20,
                             help='Display the given number of apps. Default 20.')
    list_parser.add_argument('--order', '-o', choices=['asc', 'desc'], default='asc',
                             help='Display in the given order. asc means latest at the bottom. '
                                  'desc means latest at the top')
    list_parser.add_argument('--format-type', '-t',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    list_parser.set_defaults(func=_list_apps)

    delete_parser = subparsers.add_parser(
        'delete',
        help='Delete a workflow app version you created.',
        epilog='Ex. osmo app delete my-app')
    delete_parser.add_argument('name',
                               help='Name of the app. Specify version to delete '
                                    'a specific version by using <app>:<version> format.')
    delete_parser.add_argument('--all', '-a', action='store_true',
                               help='Delete all versions of the app.')
    delete_parser.add_argument('--force', '-f', action='store_true',
                               help='Delete the app without user confirmation.')
    delete_parser.set_defaults(func=_delete_app)

    rename_parser = subparsers.add_parser(
        'rename',
        help='Rename a workflow app.',
        description=('Rename a workflow app from the original name to a new name.'),
        epilog='Ex. osmo app rename original-app-name new-app-name')
    rename_parser.add_argument('original_name',
                               help='Original name of the app.')
    rename_parser.add_argument('new_name',
                               help='New name for the app.')
    rename_parser.add_argument('--force', '-f', action='store_true',
                               help='Rename the app without user confirmation.')
    rename_parser.set_defaults(func=_rename_app)

    submit_parser = subparsers.add_parser(
        'submit',
        help='Submit a workflow app version you created.')
    submit_parser.add_argument('name',
                               help='Name of the app. Specify version to submit '
                                    'a specific version by using <app>:<version> format.')
    submit_parser.add_argument('--format-type', '-t',
                               dest='format_type',
                               choices=('json', 'text'), default='text',
                               help='Specify the output format type (Default text).')
    submit_parser.add_argument('--set',
                               nargs='+',
                               default=[],
                               help='Assign fields in the workflow file with desired elements '
                                    'in the form "<field>=<value>". These values will override '
                                    'values set in the "default-values" section. Overridden fields'
                                    ' in the yaml file should be in the form {{ field }}. '
                                    'Values will be cast as int or float if applicable')
    submit_parser.add_argument('--set-string',
                               dest='set_string',
                               nargs='+',
                               default=[],
                               help='Assign fields in the workflow file with desired elements '
                                    'in the form "<field>=<value>". These values will override '
                                    'values set in the "default-values" section. Overridden fields'
                                    ' in the yaml file should be in the form {{ field }}. '
                                    'All values will be cast as string')
    submit_parser.add_argument('--set-env',
                               dest='set_env',
                               nargs='+',
                               default=[],
                               help='Assign environment variables to the workflow. '
                                    'The value should be in the format <key>=<value>. '
                                    'Multiple key-value pairs can be passed. If an environment '
                                    'variable passed here is already defined in the workflow, the '
                                    'value declared here will override the value in the workflow.')
    submit_parser.add_argument('--dry-run',
                               action='store_true',
                               dest='dry',
                               help='Does not submit the workflow and prints the workflow into '
                                    'the console.')
    submit_parser.add_argument('--pool', '-p',
                               help='The target pool to run the workflow with. If no pool is '
                                    'specified, the default pool assigned in the profile will '
                                    'be used.')
    submit_parser.add_argument('--local-path', '-l', type=validation.valid_path,
                               help='The absolute path to the location for where local files '
                                    'in the workflow file should be fetched from. If not '
                                    'specified, the current working directory will be used.')
    submit_parser.add_argument('--rsync',
                               type=str,
                               help='Start a background rsync daemon to continuously upload data '
                                    'from local machine to the lead task of the workflow. '
                                    'The value should be in the format <local_path>:<remote_path>. '
                                    'The daemon process will automatically exit when the workflow '
                                    'is terminated.')
    submit_parser.add_argument('--priority',
                               type=lambda x: x.upper(),
                               help='The priority to use when scheduling the workflow. If none is '
                                    'provided, NORMAL will be used. The scheduler will prioritize '
                                    'scheduling workflows in the order of HIGH, NORMAL, '
                                    'LOW. LOW workflows may be preempted to allow a '
                                    'higher priority workflow to run.',
                               choices=[p.value for p in wf_priority.WorkflowPriority])
    submit_parser.set_defaults(func=_submit_app)


def _create_app(service_client: client.ServiceClient, args: argparse.Namespace):
    if args.file:
        with open(args.file, 'r', encoding='utf-8') as tf:
            app_content = tf.read()
    else:
        app_content = editor.get_editor_input()

    if not app_content:
        raise osmo_errors.OSMOUserError('App is empty')

    params = {
        'description': args.description,
    }

    try:
        service_client.request(
            client.RequestMethod.POST,
            f'api/app/user/{args.name}',
            params=params, payload=app_content)
        print(f'App {args.name} created successfully')
    except Exception as e:  # pylint: disable=broad-except
        file_name = editor.save_to_temp_file(app_content, suffix='.yaml')
        raise osmo_errors.OSMOUserError(
            f'Error creating app: {e}\n\nSaved content to file: {file_name}')


def _update_app(service_client: client.ServiceClient, args: argparse.Namespace):
    # Fetch app from service
    app_info = common.AppStructure(args.name)
    params: Dict[str, Any] = {}
    if app_info.version:
        params['version'] = app_info.version

    app_result = None
    try:
        app_result = service_client.request(
            client.RequestMethod.GET,
            f'api/app/user/{app_info.name}/spec',
            mode=client.ResponseMode.PLAIN_TEXT,
            params=params)
    except osmo_errors.OSMOUserError as err:
        # If the app version is deleted, the spec will not be available
        if app_info.version:
            raise err
        print(f'App {app_info.name} has been deleted/does not exist. '
              'Trying to create a new version...')
        app_result = None

    # Edit app
    if args.file:
        with open(args.file, 'r', encoding='utf-8') as tf:
            app_content = tf.read()
    else:
        app_content = editor.get_editor_input(app_result)
    if (not app_content) or app_content == app_result:
        print('No version was created because no changes were made to the app.')
        return

    # Send app to service
    try:
        app_result = service_client.request(
            client.RequestMethod.PATCH,
            f'api/app/user/{app_info.name}',
            payload=app_content)
        print(f'App {app_result["name"]} updated successfully')
        print(f'Version: {app_result["version"]}')
    except Exception as e:  # pylint: disable=broad-except
        file_name = editor.save_to_temp_file(app_content, suffix='.yaml')
        raise osmo_errors.OSMOUserError(
            f'Error editing app: {e}\n\nSaved content to file: {file_name}')


def _info_app(service_client: client.ServiceClient, args: argparse.Namespace):

    app_info = common.AppStructure(args.name)
    params: Dict[str, Any] = {'order': args.order.upper(), 'limit': args.count}
    if app_info.version:
        params['version'] = app_info.version

    app_result = service_client.request(
        client.RequestMethod.GET,
        f'api/app/user/{app_info.name}',
        params=params)

    if args.format_type == 'json':
        print(json.dumps(app_result, indent=2))
    else:
        print('-----------------------------------------------------\n')
        print(f'Name: {app_info.name}\n'
              f'UUID: {app_result["uuid"]}\n'
              f'Owner: {app_result["owner"]}\n'
              f'Create Date: '
              f'{common.convert_utc_datetime_to_user_zone(app_result["created_date"])}\n'
              f'Description: {app_result["description"]}\n')

        key_mapping = {'Version': 'version',
                       'Created By': 'created_by',
                       'Created Date': 'created_date',
                       'Status': 'status'}
        keys = list(key_mapping.keys())
        table = common.osmo_table(header=keys)
        for version in app_result['versions']:
            version['created_date'] = common.convert_utc_datetime_to_user_zone(
                version['created_date'])
            table.add_row([version.get(column, '-') for column in key_mapping.values()])

        print(table.draw())


def _show_app(service_client: client.ServiceClient, args: argparse.Namespace):

    app_info = common.AppStructure(args.name)
    params: Dict[str, Any] = {}

    app_info_result = service_client.request(
        client.RequestMethod.GET,
        f'api/app/user/{app_info.name}',
        params=params)

    if app_info.version:
        params['version'] = app_info.version

    app_spec_result = service_client.request(
        client.RequestMethod.GET,
        f'api/app/user/{app_info.name}/spec',
        mode=client.ResponseMode.PLAIN_TEXT,
        params=params)

    default_values = workflow_utils.fetch_default_values(app_spec_result)

    print(f'DESCRIPTION\n{common.TAB}{app_info_result["description"]}\n')
    if default_values:
        print('PARAMETERS')
        # Add common.TAB after every newline that is not already followed by a space or tab
        formatted_values = re.sub(r'\n(?![\s])', f'\n{common.TAB}', str(default_values))
        print(f'{common.TAB}{formatted_values}')


def _spec_app(service_client: client.ServiceClient, args: argparse.Namespace):
    app_info = common.AppStructure(args.name)
    params: Dict[str, Any] = {}
    if app_info.version:
        params['version'] = app_info.version

    app_spec_result = service_client.request(
        client.RequestMethod.GET,
        f'api/app/user/{app_info.name}/spec',
        mode=client.ResponseMode.PLAIN_TEXT,
        params=params)

    print(app_spec_result)


def _list_apps(service_client: client.ServiceClient, args: argparse.Namespace):
    params: Dict[str, Any] = {'order': args.order.upper()}
    if args.user:
        params['users'] = args.user
    if args.name:
        params['name'] = args.name
    if args.all_users:
        params['all_users'] = True

    current_count = 0
    app_list: List[Dict[str, Any]] = []
    while True:
        count = min(args.count - current_count, 1000)
        params['limit'] = count
        params['offset'] = current_count

        app_result = service_client.request(
            client.RequestMethod.GET,
            'api/app',
            params=params)
        app_list = app_result['apps'] + app_list
        current_count += count
        if args.count <= current_count or not app_result['more_entries']:
            break

    if args.format_type == 'json':
        print(json.dumps({'apps': app_list}, indent=2))
    else:
        if app_list:
            key_mapping = {'Owner': 'owner',
                           'Name': 'name',
                           'Description': 'description',
                           'Created Date': 'created_date',
                           'Latest Version': 'latest_version'}
            keys = list(key_mapping.keys())
            table = common.osmo_table(header=keys)
            for app in app_list:
                app['created_date'] = common.convert_utc_datetime_to_user_zone(app['created_date'])
                table.add_row([app.get(column, '-') for column in key_mapping.values()])

            print(table.draw())
        else:
            print('There are no apps to view.')


def _delete_app(service_client: client.ServiceClient, args: argparse.Namespace):
    # pylint: disable=unused-argument

    app_info = common.AppStructure(args.name)
    params: Dict[str, Any] = {}
    if args.all:
        params['all_versions'] = True
    elif app_info.version:
        params['version'] = app_info.version
    else:
        raise osmo_errors.OSMOUserError('Must specify a version or all_versions')

    if not args.force:
        if args.all:
            prompt_info = f'all versions in App {app_info.name}'
        elif app_info.version:
            prompt_info = f'app {app_info.name} version {app_info.version}'
        else:
            raise osmo_errors.OSMOUserError('Must specify a version or all_versions')

        confirm = common.prompt_user(f'Are you sure you want to delete {prompt_info}?')
        if not confirm:
            return

    delete_result = service_client.request(
        client.RequestMethod.DELETE,
        f'api/app/user/{app_info.name}',
        params=params)

    for version in delete_result['versions']:
        print(f'Delete Job for App {app_info.name} version ' +\
              f'{version} has been scheduled.')


def _rename_app(service_client: client.ServiceClient, args: argparse.Namespace):
    app_info = common.AppStructure(args.original_name)
    if app_info.version:
        raise osmo_errors.OSMOUserError('Cannot rename a specific version of an app.')

    new_app_info = common.AppStructure(args.new_name)
    if new_app_info.version:
        raise osmo_errors.OSMOUserError('Cannot rename to a specific version of an app.')

    if not args.force:
        confirm = common.prompt_user(
            f'Are you sure you want to rename App {app_info.name} to {new_app_info.name}?')
        if not confirm:
            return

    rename_result = service_client.request(
        client.RequestMethod.POST,
        f'api/app/user/{app_info.name}/rename',
        payload=new_app_info.name)

    print(f'App {app_info.name} renamed to {rename_result} successfully.')


def _submit_app(service_client: client.ServiceClient, args: argparse.Namespace):
    app_info = common.AppStructure(args.name)
    params: Dict[str, Any] = {}
    if app_info.version:
        params['version'] = app_info.version

    info_params = params.copy()
    info_params['limit'] = 1
    app_info_result = service_client.request(
        client.RequestMethod.GET,
        f'api/app/user/{app_info.name}',
        params=info_params)

    app_spec_result = service_client.request(
        client.RequestMethod.GET,
        f'api/app/user/{app_info.name}/spec',
        mode=client.ResponseMode.PLAIN_TEXT,
        params=params)

    if not args.pool:
        args.pool = pool.fetch_default_pool(service_client)

    params = {
        'app_uuid': app_info_result['uuid'],
        'app_version': app_info_result['versions'][0]['version']
    }

    if args.priority:
        params['priority'] = args.priority

    template_data = workflow.parse_file_for_template(app_spec_result,
                                                     args.set,
                                                     args.set_string)

    if args.local_path:
        local_path = args.local_path
    else:
        # Get the location from which python is being called
        local_path = os.getcwd()

    workflow.submit_workflow_helper(service_client, args, template_data, local_path, params)
