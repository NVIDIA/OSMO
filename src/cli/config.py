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
import enum
import json
import subprocess
from typing import Any, Dict, Literal, Set, TypedDict

from src.cli import editor
from src.cli.formatters import RstStrippingHelpFormatter
from src.lib.utils import client, common, config_history, osmo_errors, role, validation

CONFIG_TYPES_STRING = ', '.join(config_history.CONFIG_TYPES)


class ConfigApiMapping(TypedDict):
    """Type definition for config API mapping."""
    method: client.RequestMethod
    payload_key: str


# Mapping of config types to their API endpoints and payload keys
UPDATE_CONFIG_API_MAPPING: Dict[
    config_history.ConfigHistoryType,
    Dict[Literal['default', 'named'], ConfigApiMapping | None]
] = {
    config_history.ConfigHistoryType.SERVICE: {
        'default': {'method': client.RequestMethod.PATCH, 'payload_key': 'configs_dict'},
        'named': None,  # Named configs not supported
    },
    config_history.ConfigHistoryType.WORKFLOW: {
        'default': {'method': client.RequestMethod.PATCH, 'payload_key': 'configs_dict'},
        'named': None,  # Named configs not supported
    },
    config_history.ConfigHistoryType.DATASET: {
        'default': {'method': client.RequestMethod.PATCH, 'payload_key': 'configs_dict'},
        'named': {'method': client.RequestMethod.PATCH, 'payload_key': 'configs_dict'},
    },
    config_history.ConfigHistoryType.BACKEND: {
        'default': None,  # Whole config not supported
        'named': {'method': client.RequestMethod.POST, 'payload_key': 'configs'},
    },
    config_history.ConfigHistoryType.POOL: {
        'default': {'method': client.RequestMethod.PUT, 'payload_key': 'configs'},
        'named': {'method': client.RequestMethod.PATCH, 'payload_key': 'configs_dict'},
    },
    config_history.ConfigHistoryType.POD_TEMPLATE: {
        'default': {'method': client.RequestMethod.PUT, 'payload_key': 'configs'},
        'named': {'method': client.RequestMethod.PUT, 'payload_key': 'configs'},
    },
    config_history.ConfigHistoryType.RESOURCE_VALIDATION: {
        'default': {'method': client.RequestMethod.PUT, 'payload_key': 'configs_dict'},
        'named': {'method': client.RequestMethod.PUT, 'payload_key': 'configs'},
    },
    config_history.ConfigHistoryType.BACKEND_TEST: {
        'default': {'method': client.RequestMethod.PUT, 'payload_key': 'configs'},
        'named': {'method': client.RequestMethod.PATCH, 'payload_key': 'configs_dict'},
    },
    config_history.ConfigHistoryType.ROLE: {
        'default': {'method': client.RequestMethod.PUT, 'payload_key': 'configs'},
        'named': {'method': client.RequestMethod.PUT, 'payload_key': 'configs'},
    },
}


DELETE_CONFIG_SUPPORTED_TYPES: Set[config_history.ConfigHistoryType] = {
    config_history.ConfigHistoryType.BACKEND,
    config_history.ConfigHistoryType.DATASET,
    config_history.ConfigHistoryType.POOL,
    config_history.ConfigHistoryType.POD_TEMPLATE,
    config_history.ConfigHistoryType.RESOURCE_VALIDATION,
    config_history.ConfigHistoryType.BACKEND_TEST,
    config_history.ConfigHistoryType.ROLE,
}
delete_choices = sorted([key.value for key in DELETE_CONFIG_SUPPORTED_TYPES])

SET_CONFIG_SUPPORTED_TYPES: Dict[config_history.ConfigHistoryType, ConfigApiMapping] = {
    config_history.ConfigHistoryType.ROLE: {
        'method': client.RequestMethod.PUT, 'payload_key': 'configs'
    },
}
set_choices = sorted([key.value for key in SET_CONFIG_SUPPORTED_TYPES])


def get_change_description(
        current_config: Any | None = None,
        updated_config: Any | None = None,
        config_type: config_history.ConfigHistoryType | None = None,
) -> str:
    """
    Prompt the user to enter a description for their change.
    """
    content = '\n# Please enter the description for your changes. Lines starting\n'
    content += "# with '#' will be ignored, and an empty description aborts the change.\n"
    if current_config is not None and updated_config is not None and config_type is not None:
        first_data_file = editor.save_to_temp_file(json.dumps(current_config, indent=2),
                                                   prefix=f'{config_type.value}-current_',
                                                   directory='/tmp/')
        second_data_file = editor.save_to_temp_file(json.dumps(updated_config, indent=2),
                                                    prefix=f'{config_type.value}-updated_',
                                                    directory='/tmp/')

        # The diff utility exits with one of the following values:
        # 0       No differences were found.
        # 1       Differences were found.
        # >1      An error occurred.
        result = subprocess.run(
            ['diff', '-u', '--color', first_data_file, second_data_file],
            capture_output=True, text=True, check=False)

        if result and result.stdout:
            content += f'#\n# Diff of {config_type.value} between current and updated config:\n#\n'
            content += '\n'.join([f'# {line}' for line in result.stdout.splitlines()[2:]]) + '\n'

    description_with_comments = editor.get_editor_input(content)

    description = [desc for desc in description_with_comments.splitlines()
                   if not desc.startswith('#')]
    return '\n'.join(description).strip()


def _run_history_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    List config history entries
    Args:
        service_client: The service client instance
        args: Parsed command line arguments
    """
    # Cannot specify --created-before or --created-after with --at-timestamp
    if args.created_before and args.at_timestamp:
        raise osmo_errors.OSMOUserError(
            'Cannot specify --created-before and --at-timestamp together')
    if args.created_after and args.at_timestamp:
        raise osmo_errors.OSMOUserError(
            'Cannot specify --created-after and --at-timestamp together')

    # Build query parameters
    params: Dict[str, Any] = {
        # Always omit data - show the config with `osmo config show`
        'omit_data': True
    }

    if args.offset is not None:
        params['offset'] = args.offset
    if args.count is not None:
        params['limit'] = args.count
    if args.order is not None:
        params['order'] = args.order.upper()
    if args.config:
        params['config_types'] = [args.config]
    if args.name:
        params['name'] = args.name
    if args.revision:
        params['revision'] = args.revision
    if args.tags:
        params['tags'] = args.tags
    if args.created_before:
        params['created_before'] = common.convert_timezone(
            args.created_before
            if common.valid_date_format(args.created_before, '%Y-%m-%dT%H:%M:%S')
            else f'{args.created_before}T00:00:00')
    if args.created_after:
        params['created_after'] = common.convert_timezone(
            args.created_after if common.valid_date_format(args.created_after, '%Y-%m-%dT%H:%M:%S')
            else f'{args.created_after}T00:00:00')
    if args.at_timestamp:
        params['at_timestamp'] = common.convert_timezone(
            args.at_timestamp if common.valid_date_format(args.at_timestamp, '%Y-%m-%dT%H:%M:%S')
            else f'{args.at_timestamp}T00:00:00')

    result = service_client.request(client.RequestMethod.GET, 'api/configs/history', params=params)

    if args.format_type == 'json':
        print(json.dumps(result, indent=2))
    else:
        # Create table for config history entries
        table = common.osmo_table(header=[
            'Config Type', 'Name', 'Revision', 'Username', 'Created At',
            'Description', 'Tags'
        ], fit_width=args.fit_width)

        for config in result['configs']:
            # Format tags as comma-separated string
            tags_str = ', '.join(sorted(config['tags'])) if config['tags'] else '-'

            # Format created_at timestamp
            created_at = common.convert_utc_datetime_to_user_zone(config['created_at'])

            table.add_row([
                config['config_type'],
                config['name'] or '-',
                str(config['revision']),
                config['username'],
                created_at,
                config['description'],
                tags_str
            ])

        print(table.draw())


def _run_rollback_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Roll back a config to a particular revision
    Args:
        service_client: The service client instance
        args: Parsed command line arguments
    """
    revision = config_history.ConfigHistoryRevision(args.revision)
    payload = {
        'revision': revision.revision,
        'config_type': revision.config_type.value,
    }
    if args.description:
        payload['description'] = args.description
    else:
        payload['description'] = get_change_description()
        if not payload['description']:
            print('Aborting rollback due to empty description.')
            return
    if args.tags:
        payload['tags'] = args.tags

    result = service_client.request(
        client.RequestMethod.POST,
        'api/configs/history/rollback',
        payload=payload,
    )
    print(f'Successfully rolled back {revision.config_type.value} to revision {revision.revision}.')
    if result:
        print(json.dumps(result, indent=2))


def _run_list_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    List current configs for each config type
    Args:
        service_client: The service client instance
        args: Parsed command line arguments
    """
    # Build query parameters
    params: Dict[str, Any] = {
        'omit_data': True,
        'at_timestamp': common.current_time()
    }

    result = service_client.request(client.RequestMethod.GET, 'api/configs/history', params=params)

    if args.format_type == 'json':
        print(json.dumps(result, indent=2))
    else:
        # Create table for current configs
        table = common.osmo_table(header=[
            'Config Type', 'Revision', 'Username', 'Created At'
        ], fit_width=args.fit_width)

        sorted_configs = sorted(result['configs'], key=lambda x: x['config_type'])

        for config in sorted_configs:
            # Format created_at timestamp
            created_at = common.convert_utc_datetime_to_user_zone(config['created_at'])

            table.add_row([
                config['config_type'],
                str(config['revision']),
                config['username'],
                created_at
            ])

        print(table.draw())


def _fetch_data_from_config(config_info: Any) -> Any:
    """
    Fetch data from a config
    """
    # Check if this is a backends config, which makes
    # `osmo config show/update BACKEND my-backend` nice
    if isinstance(config_info, dict) and 'backends' in config_info:
        config_info = config_info['backends']

    # Check if this is a pools config, which makes
    # `osmo config show/update POOL my-pool` nice
    if isinstance(config_info, dict) and 'pools' in config_info:
        config_info = config_info['pools']

    # Check if this is a datasets config, which makes
    # `osmo config show/update DATASET my-dataset` nice
    if isinstance(config_info, dict) and 'buckets' in config_info:
        config_info = config_info['buckets']

    # Check if this is a list of objects with 'name' field
    # which makes `osmo config show/update BACKEND my-backend` and
    # `osmo config show/update ROLE my-role` nice
    if (
        isinstance(config_info, list)
        and config_info
        and isinstance(config_info[0], dict)
        and 'name' in config_info[0]
    ):
        config_info = {item['name']: item for item in config_info}

    return config_info


def _get_current_config(service_client: client.ServiceClient, config_type: str) -> Any:
    """
    Get the current config
    Args:
        service_client: The service client instance
        config_type: The string config type from parsed arguments
    """
    if config_type not in [t.value for t in config_history.ConfigHistoryType]:
        raise osmo_errors.OSMOUserError(
            f'Invalid config type "{config_type}". '
            f'Available types: {CONFIG_TYPES_STRING}'
        )
    return service_client.request(
        client.RequestMethod.GET, f'api/configs/{config_type.lower()}'
    )


def _run_show_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Show a specific config revision
    Args:
        service_client: The service client instance
        args: Parsed command line arguments
    """
    # Parse the config identifier
    if ':' in args.config:
        # Format is <CONFIG_TYPE>:<revision>
        revision = config_history.ConfigHistoryRevision(args.config)
        params: Dict[str, Any] = {
            'config_types': [revision.config_type.value],
            'omit_data': False,
            'revision': revision.revision,
        }
        result = service_client.request(
            client.RequestMethod.GET, 'api/configs/history', params=params
        )

        if not result['configs']:
            raise osmo_errors.OSMOUserError(
                'No config found matching the specified criteria'
            )

        data = result['configs'][0]['data']
    else:
        # Format is <CONFIG_TYPE>
        data = _get_current_config(service_client, args.config)

    # Handle multiple name arguments for indexing
    if args.names:
        data = _fetch_data_from_config(data)
        path = []
        for name in args.names:
            path.append(name)
            if isinstance(data, dict) and name in data:
                data = data[name]
            elif isinstance(data, list):
                try:
                    index = int(name)
                    if 0 <= index < len(data):
                        data = data[index]
                    else:
                        raise osmo_errors.OSMOUserError(
                            f'Index {index} out of range for list of length {len(data)}')
                except ValueError as e:
                    raise osmo_errors.OSMOUserError(
                        f'Expected integer index for list, got "{name}"') from e
            else:
                raise osmo_errors.OSMOUserError(
                    f'Cannot index into {type(data).__name__} with "{name}"')

    print(json.dumps(data, indent=2))


def deep_diff(current: Any, updated: Any) -> Any:
    """
    Compute a deep diff between two values, returning only the changed fields.
    For dictionaries, only include keys that have different values.
    For lists, return the entire list if any elements differ.
    For other types, return the updated value if different.

    Args:
        current: The current value
        updated: The updated value

    Returns:
        The diff containing only changed fields, or None if no changes
    """
    if current == updated:
        return None

    if isinstance(current, type(updated)) and isinstance(current, dict):
        diff = {}
        for key, value in updated.items():
            value_diff = value
            if key in current:
                value_diff = deep_diff(current[key], value)
            if value_diff is not None:
                diff[key] = value_diff

        return diff if diff else None  # Required when a field is removed

    return updated


def _run_update_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Update a config by editing it in the default editor
    Args:
        service_client: The service client instance
        args: Parsed command line arguments
    """
    config_history_type = config_history.ConfigHistoryType(args.config)
    is_named = bool(args.name)
    api_mapping = UPDATE_CONFIG_API_MAPPING.get(config_history_type, {}).get(
        'named' if is_named else 'default')

    if api_mapping is None:
        if is_named:
            raise osmo_errors.OSMOUserError(
                f'Named config updates not supported for {args.config}')
        raise osmo_errors.OSMOUserError(
            f'Whole config updates not supported for {args.config}'
        )

    current_config = _get_current_config(service_client, args.config)

    if args.name:
        current_config = _fetch_data_from_config(current_config)
        if args.name not in current_config:
            raise osmo_errors.OSMOUserError(
                f'Config name "{args.name}" not found in {args.config}')

        current_config = current_config[args.name]

    # Get updated config from editor or file
    if args.file:
        with open(args.file, 'r', encoding='utf-8') as f:
            updated_config = f.read()
    else:
        # Format current config as JSON for editing
        current_json = json.dumps(current_config, indent=2)
        updated_config = editor.get_editor_input(current_json)
        if not updated_config or updated_config == current_json:
            print('No changes were made to the config.')
            return

    try:
        updated_config = json.loads(updated_config)
    except json.JSONDecodeError as e:
        temp_file = editor.save_to_temp_file(
            updated_config,
            directory='/tmp/',
            prefix=f'{args.config}{f"-{args.name}" if args.name else ""}-update_')
        raise osmo_errors.OSMOUserError(
            f'Invalid JSON: {e}\nAttempted changes saved to {temp_file}'
        ) from e

    # Compute diff between current and updated config
    if api_mapping['method'] == client.RequestMethod.PATCH:
        diff = deep_diff(current_config, updated_config)
    elif api_mapping['method'] == client.RequestMethod.POST:
        # POST is used for backend updates only, and should update the entire field for any field
        # that changed in the backend config
        diff = deep_diff(current_config, updated_config)
        for key in diff.keys():
            diff[key] = updated_config[key]
    elif api_mapping['method'] == client.RequestMethod.PUT:
        # If anything changed in the config, PUT the entire config
        diff = (
            updated_config
            if deep_diff(current_config, updated_config) is not None
            else None
        )
    else:
        raise osmo_errors.OSMOUserError(
            f'Unsupported method: {api_mapping["method"]}')

    if diff is None:
        print('No changes were made to the config.')
        return

    # PATCH /api/configs/pool does not expect the pools key
    if args.config == config_history.ConfigHistoryType.POOL.value and args.name is None:
        diff = diff['pools']

    try:
        endpoint = f'api/configs/{args.config.lower()}'
        if args.name:
            endpoint = f'{endpoint}/{args.name}'

        # Build payload with optional description and tags
        payload = {api_mapping['payload_key']: diff}
        if args.description:
            payload['description'] = args.description
        else:
            payload['description'] = get_change_description(
                current_config, updated_config, config_history_type)
            if not payload['description']:
                print('Aborting update due to empty description.')
                return
        if args.tags:
            payload['tags'] = args.tags

        service_client.request(
            api_mapping['method'],
            endpoint,
            payload=payload)

        print(f'Successfully updated {args.config} config')
    except Exception as e:
        temp_file = editor.save_to_temp_file(
            json.dumps(updated_config, indent=2),
            directory='/tmp/',
            prefix=f'{args.config}{f"-{args.name}" if args.name else ""}-update_')
        raise osmo_errors.OSMOUserError(
            f'Error updating config: {e}\nAttempted changes saved to {temp_file}'
        ) from e


def _run_delete_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Delete a named config or a specific config revision
    Args:
        service_client: The service client instance
        args: Parsed command line arguments
    """
    # Check if config_type contains a revision number (format: CONFIG_TYPE:revision)
    if ':' in args.config:
        revision = config_history.ConfigHistoryRevision(args.config)

        try:
            service_client.request(
                client.RequestMethod.DELETE,
                f'api/configs/history/{revision.config_type.value.lower()}/revision/'
                f'{revision.revision}')
            print(f'Successfully deleted revision {revision.revision} of '
                  f'{revision.config_type.value} config')
        except Exception as e:
            raise osmo_errors.OSMOUserError(f'Error deleting config revision: {e}')
    else:
        if args.config not in [t.value for t in config_history.ConfigHistoryType]:
            raise osmo_errors.OSMOUserError(
                f'Invalid config type "{args.config}". '
                f'Available types: {CONFIG_TYPES_STRING}')

        # Delete a named config
        if not args.name:
            raise osmo_errors.OSMOUserError('Name is required when deleting a config')

        # Build payload with optional description and tags
        payload = {}
        if args.description:
            payload['description'] = args.description
        else:
            payload['description'] = get_change_description()
            if not payload['description']:
                print('Aborting delete due to empty description.')
                return
        if args.tags:
            payload['tags'] = args.tags

        try:
            service_client.request(
                client.RequestMethod.DELETE,
                f'api/configs/{args.config.lower()}/{args.name}',
                payload=payload)
            print(f'Successfully deleted {args.config} config "{args.name}"')
        except Exception as e:
            raise osmo_errors.OSMOUserError(f'Error deleting config: {e}')


class SetRoleType(enum.Enum):
    """ Type of configs supported by config history """
    BACKEND = 'BACKEND'
    POOL = 'POOL'


def create_role(role_type: SetRoleType, role_name: str, field_name: str | None = None) -> role.Role:
    """
    Create a pool role
    """
    if role_type == SetRoleType.POOL:
        if field_name:
            raise osmo_errors.OSMOUserError('Pool name must be specified in the role name')
        if not role_name.startswith('osmo-'):
            raise osmo_errors.OSMOUserError('Pool role name must start with "osmo-"')
        pool_name = role_name[len('osmo-'):]
        return role.Role(
            name=role_name,
            description=f'Generated Role for pool {pool_name}',
            policies=[
                role.RolePolicy(
                    actions=[
                        f'http:/api/pool/{pool_name}*:post',
                        'http:/api/profile/*:*',
                    ],
                )
            ]
        )
    elif role_type == SetRoleType.BACKEND:
        if field_name is None:
            raise osmo_errors.OSMOUserError('Backend name is required for backend role')
        return role.Role(
            name=role_name,
            description=f'Generated Role for backend {field_name}',
            policies=[
                role.RolePolicy(
                    actions=[
                        f'http:/api/agent/listener/*/*/{field_name}:*',
                        f'http:/api/agent/worker/*/*/{field_name}:*',
                        'http:/api/pool/*:get',
                        'http:/api/configs/backend:get',
                        'http:/api/configs/backend*:get',
                        'http:/api/profile/*:*',
                    ],
                )
            ]
        )
    else:
        raise osmo_errors.OSMOUserError(f'Unsupported role type: {role_type}')


def _run_set_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Delete a named config
    Args:
        service_client: The service client instance
        args: Parsed command line arguments
    """
    config_history_type = config_history.ConfigHistoryType(args.config)
    api_mapping = SET_CONFIG_SUPPORTED_TYPES.get(config_history_type)
    if not api_mapping:
        raise osmo_errors.OSMOUserError(
            f'Setting of {args.config} config is not supported')

    if config_history_type == config_history.ConfigHistoryType.ROLE:
        role_type = SetRoleType(args.type.upper())
        content = create_role(role_type, args.name, args.field).to_dict()
    else:
        raise osmo_errors.OSMOUserError(f'Unsupported config type: {args.config}')

    name = args.name

    # Build payload with optional description and tags
    payload: Dict[str, Any] = {api_mapping['payload_key']: content}
    if args.description:
        payload['description'] = args.description
    else:
        payload['description'] = get_change_description()
        if not payload['description']:
            print('Aborting set due to empty description.')
            return
    if args.tags:
        payload['tags'] = args.tags

    try:
        service_client.request(
            api_mapping['method'],
            f'api/configs/{args.config.lower()}/{args.name}',
            payload=payload)
        print(f'Successfully set {args.config} config "{name}"')
    except Exception as err:
        raise osmo_errors.OSMOUserError(f'Error setting config: {err}')


def _run_tag_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Update tags for a config revision
    Args:
        service_client: The service client instance
        args: Parsed command line arguments
    """
    # Parse the config identifier
    if ':' in args.config:
        # Format is <CONFIG_TYPE>:<revision>
        revision = config_history.ConfigHistoryRevision(args.config)
        config_type = revision.config_type.value.lower()
        revision_num = revision.revision
    else:
        # Format is <CONFIG_TYPE> - use current revision
        if args.config not in [t.value for t in config_history.ConfigHistoryType]:
            raise osmo_errors.OSMOUserError(
                f'Invalid config type "{args.config}". '
                f'Available types: {CONFIG_TYPES_STRING}')
        config_type = args.config.lower()
        # Get the latest revision
        params = {
            'config_types': [args.config],
            'order': 'DESC',
            'limit': 1,
        }
        result = service_client.request(
            client.RequestMethod.GET, 'api/configs/history', params=params
        )
        if not result['configs']:
            raise osmo_errors.OSMOUserError('No config found matching the specified criteria')
        revision_num = result['configs'][0]['revision']

    # Build payload
    payload = {}
    if args.set:
        payload['set_tags'] = args.set
    if args.delete:
        payload['delete_tags'] = args.delete

    try:
        service_client.request(
            client.RequestMethod.POST,
            f'api/configs/history/{config_type}/revision/{revision_num}/tags',
            payload=payload)
        print(f'Successfully updated tags for {args.config}')
    except Exception as e:
        raise osmo_errors.OSMOUserError(f'Error updating tags: {e}')


def _run_diff_command(service_client: client.ServiceClient, args: argparse.Namespace) -> None:
    """Run the diff command to compare two config revisions.

    Args:
        service_client: The service client to use for API calls
        args: Command line arguments containing:
            - first: First revision to compare (format: CONFIG_TYPE:revision_number or
                      CONFIG_TYPE)
            - second: Second revision to compare (format: CONFIG_TYPE:revision_number or
                      CONFIG_TYPE)

    Raises:
        OSMOUserError: If the config type is invalid or revisions don't exist
    """
    def get_current_revision(config_type: config_history.ConfigHistoryType) -> str:
        """Get the current revision number for a config type.

        Args:
            config_type: The config type to get the current revision for

        Returns:
            The current revision number as a string

        Raises:
            OSMOUserError: If no config history entries exist for the type
        """
        response = service_client.request(
            client.RequestMethod.GET,
            '/api/configs/history',
            params={'config_types': [config_type.value], 'order': 'DESC', 'limit': 1}
        )
        if not response['configs']:
            raise osmo_errors.OSMOUserError(
                f'No config history entries found for type {config_type.value}'
            )
        return str(response['configs'][0]['revision'])

    # Parse the first revision
    if ':' in args.first:
        first = config_history.ConfigHistoryRevision(args.first)
        config_type = first.config_type
        first_revision = str(first.revision)
    else:
        config_type = config_history.ConfigHistoryType(args.first)
        first_revision = get_current_revision(config_type)

    # Parse the second revision
    if not args.second:
        second_revision = get_current_revision(config_type)
    elif ':' in args.second:
        second = config_history.ConfigHistoryRevision(args.second)
        if second.config_type != config_type:
            raise osmo_errors.OSMOUserError(
                f'Config type mismatch: {second.config_type.value} != {config_type.value}. '
                'Must diff the same config type.'
            )
        second_revision = str(second.revision)
    else:
        # If only CONFIG_TYPE was provided, look up current revision
        if args.second != config_type.value:
            raise osmo_errors.OSMOUserError(
                f'Config type mismatch: {args.second} != {config_type.value}. '
                'Must diff the same config type.'
            )
        second_revision = get_current_revision(config_type)

    # Get the diff from the API
    response = service_client.request(
        client.RequestMethod.GET,
        '/api/configs/diff',
        params={
            'config_type': config_type.value,
            'first_revision': first_revision,
            'second_revision': second_revision,
        }
    )

    first_data_file = editor.save_to_temp_file(json.dumps(response['first_data'], indent=2),
                                               prefix=f'{config_type.value}-r{first_revision}_',
                                               directory='/tmp/')
    second_data_file = editor.save_to_temp_file(json.dumps(response['second_data'], indent=2),
                                                prefix=f'{config_type.value}-r{second_revision}_',
                                                directory='/tmp/')

    # The diff utility exits with one of the following values:
    # 0       No differences were found.
    # 1       Differences were found.
    # >1      An error occurred.
    try:
        subprocess.run(['diff', '-u', '--color', first_data_file, second_data_file], check=True)
        # exit code 0 means no differences were found
        print('No differences were found between the two revisions')
    except subprocess.CalledProcessError as e:
        if e.returncode > 1:
            raise osmo_errors.OSMOUserError(f'Error rendering diff: {e}')


def setup_parser(parser: argparse._SubParsersAction):
    """
    Configures parser for config commands
    Args:
        parser: The parser to be configured
    """
    config_parser = parser.add_parser('config',
                                      help='Commands for managing configurations')
    config_subparsers = config_parser.add_subparsers(dest='subcommand')
    config_subparsers.required = True

    # Handle 'list' command
    list_parser = config_subparsers.add_parser(
        'list',
        help='List current configuration revisions for each config type',
        description='List current configuration revisions for each config type',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples
========

List configurations in text format (default)::

    osmo config list

List configurations in JSON format::

    osmo config list --format-type json
        '''
    )
    list_parser.add_argument('--format-type', '-t',
                             choices=('json', 'text'),
                             default='text',
                             help='Specify the output format type (default text)')
    list_parser.add_argument(
        '--fit-width',
        action='store_true',
        help='Fit the table width to the terminal width')
    list_parser.set_defaults(func=_run_list_command)

    # Handle 'show' command
    show_parser = config_subparsers.add_parser(
        'show',
        help='Show a configuration or previous revision of a configuration',
        description='Show a configuration or previous revision of a configuration',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f'''
Available config types (CONFIG_TYPE): {CONFIG_TYPES_STRING}

Examples
========

Show a service configuration in JSON format::

    osmo config show SERVICE

Show the ``default_cpu`` resource validation rule::

    osmo config show RESOURCE_VALIDATION default_cpu

Show the ``user_workflow_limits`` workflow configuration in a previous revision::

    osmo config show WORKFLOW:3 user_workflow_limits
'''
    )
    show_parser.add_argument(
        'config',
        metavar='config_type',
        help='Config to show in format <CONFIG_TYPE>[:<revision>]',
    )
    show_parser.add_argument(
        'names',
        nargs='*',
        help='Optional names/indices to index into the config. Can be used to show a named config.'
    )

    show_parser.set_defaults(func=_run_show_command)

    # Handle 'update' command
    # NOTE: Custom usage message! If you change arguments, you need to update usage.
    update_parser = config_subparsers.add_parser(
        'update',
        help='Update a configuration',
        description='Update a configuration',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        usage='osmo config update [-h] config_type [name] [--file FILE] [--description DESCRIPTION]'
              ' [--tags TAGS [TAGS ...]]',
        epilog=f'''
Available config types (CONFIG_TYPE): {CONFIG_TYPES_STRING}

Examples
========

Update a service configuration::

    osmo config update SERVICE

Update a backend configuration from a file::

    osmo config update BACKEND my-backend --file config.json

Update with description and tags::

    osmo config update POOL my-pool --description "Updated pool settings" --tags production high-priority
        '''
    )
    update_parser.add_argument(
        'config',
        choices=config_history.CONFIG_TYPES,
        metavar='config_type',
        help='Config type to update (CONFIG_TYPE)',
    )
    update_parser.add_argument(
        'name',
        nargs='?',
        help='Optional name of the config to update'
    )
    update_parser.add_argument(
        '--file', '-f',
        help='Path to a JSON file containing the updated config'
    )
    update_parser.add_argument(
        '--description', '-d',
        help='Description of the config update'
    )
    update_parser.add_argument(
        '--tags', '-t',
        nargs='+',
        help='Tags for the config update'
    )
    update_parser.set_defaults(func=_run_update_command)

    # Handle 'delete' command
    # NOTE: Custom usage message! If you change arguments, you need to update usage.
    delete_parser = config_subparsers.add_parser(
        'delete',
        help='Delete a named configuration or a specific config revision',
        description='Delete a named configuration or a specific config revision',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        usage='osmo config delete [-h] config_type [name] [--description DESCRIPTION] '
              '[--tags TAGS [TAGS ...]]',
        epilog=f'''
Available config types (CONFIG_TYPE): {", ".join(delete_choices)}

Examples
========

Delete a named pool configuration::

    osmo config delete POOL my-pool

Delete a specific revision::

    osmo config delete SERVICE:123

Delete with description and tags::

    osmo config delete BACKEND my-backend --description "Removing unused backend" --tags cleanup deprecated
        '''
    )
    delete_parser.add_argument(
        'config',
        metavar='config_type',
        help='Type of config to delete (CONFIG_TYPE) or CONFIG_TYPE:revision_number to delete a '
             'specific revision',
    )
    delete_parser.add_argument(
        'name',
        nargs='?',
        help='Name of the config to delete (required when not deleting a revision)'
    )
    delete_parser.add_argument(
        '--description', '-d',
        help='Description of the deletion (only used when deleting a named config)'
    )
    delete_parser.add_argument(
        '--tags', '-t',
        nargs='+',
        help='Tags for the deletion (only used when deleting a named config)'
    )
    delete_parser.set_defaults(func=_run_delete_command)

    # Handle 'history' command
    # NOTE: Custom usage message! If you change arguments, you need to update usage.
    history_parser = config_subparsers.add_parser(
        'history',
        help='List history of configuration changes',
        description='List history of configuration changes',
        formatter_class=argparse.RawTextHelpFormatter,
        usage='osmo config history [-h] [config_type] [--offset OFFSET] [--count COUNT] '
              '[--order {asc,desc}] [--name NAME] [--revision REVISION] [--tags TAGS [TAGS ...]] '
              '[--at-timestamp AT_TIMESTAMP] [--created-before CREATED_BEFORE] '
              '[--created-after CREATED_AFTER] [--format-type {json,text}] [--fit-width]',
        epilog=f'''
Available config types (CONFIG_TYPE): {CONFIG_TYPES_STRING}

Examples
========

View history in text format (default)::

    osmo config history

View history in JSON format with pagination::

    osmo config history --format-type json --offset 10 --count 2

View history for a specific configuration type::

    osmo config history SERVICE

View history for a specific time range::

    osmo config history --created-after "2025-05-18" --created-before "2025-05-25"
        '''
    )

    # Add all query parameters as CLI arguments
    history_parser.add_argument(
        '--offset', '-o',
        type=validation.non_negative_integer,
        default=0,
        help='Number of records to skip for pagination (default 0)'
    )
    history_parser.add_argument(
        '--count', '-c',
        type=validation.positive_integer,
        default=20,
        help='Maximum number of records to return (default 20, max 1000)'
    )
    history_parser.add_argument(
        '--order',
        choices=['asc', 'desc'],
        default='asc',
        help='Sort order by creation time (default asc)'
    )
    history_parser.add_argument(
        'config',
        metavar='config_type',
        nargs='?',
        choices=config_history.CONFIG_TYPES,
        help='Config type to show history for (CONFIG_TYPE)'
    )
    history_parser.add_argument(
        '--name',
        '-n',
        help='Filter by changes to a particular config, e.g. "isaac-hil" pool',
    )
    history_parser.add_argument('--revision', '-r',
                                type=validation.positive_integer,
                                help='Filter by revision number')
    history_parser.add_argument('--tags',
                                nargs='+',
                                help='Filter by tags')
    history_parser.add_argument(
        '--at-timestamp',
        type=validation.date_or_datetime_str,
        help='Get config state at specific timestamp (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)'
             ' in current timezone'
    )
    history_parser.add_argument(
        '--created-before',
        type=validation.date_or_datetime_str,
        help='Filter by creation time before (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)'
             ' in current timezone'
    )
    history_parser.add_argument(
        '--created-after',
        type=validation.date_or_datetime_str,
        help='Filter by creation time after (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)'
             ' in current timezone'
    )
    history_parser.add_argument('--format-type', '-t',
                                choices=('json', 'text'),
                                default='text',
                                help='Specify the output format type (default text)')
    history_parser.add_argument(
        '--fit-width',
        action='store_true',
        help='Fit the table width to the terminal width')

    history_parser.set_defaults(func=_run_history_command)

    # Handle 'rollback' command
    # NOTE: Custom usage message! If you change arguments, you need to update usage.
    rollback_parser = config_subparsers.add_parser(
        'rollback',
        help='Roll back a configuration to a previous revision',
        description='Roll back a configuration to a previous revision\n\n'
                    'When rolling back a configuration, the revision number is incremented by 1 '
                    'and a new revision is created. The new revision will have the same data as '
                    'the desired rollback revision.',
        formatter_class=argparse.RawTextHelpFormatter,
        usage='osmo config rollback [-h] revision [--description DESCRIPTION] '
              '[--tags TAGS [TAGS ...]]',
        epilog=f'''
Available config types (CONFIG_TYPE): {CONFIG_TYPES_STRING}

Examples
========

Roll back a service configuration::

    osmo config rollback SERVICE:4

Roll back with description and tags::

    osmo config rollback BACKEND:7 --description "Rolling back to stable version" --tags rollback stable
        '''
    )
    rollback_parser.add_argument(
        'revision',
        help='Revision to roll back to in format <CONFIG_TYPE>:<revision>, '
             'e.g. SERVICE:12'
    )
    rollback_parser.add_argument('--description',
                                 help='Optional description for the rollback action')
    rollback_parser.add_argument('--tags',
                                 nargs='+',
                                 help='Optional tags for the rollback action')
    rollback_parser.set_defaults(func=_run_rollback_command)

    # Handle 'set' command
    # NOTE: Custom usage message! If you change arguments, you need to update usage.
    set_parser = config_subparsers.add_parser(
        'set',
        help='Set a field into the config',
        description='Set a field into the config',
        formatter_class=RstStrippingHelpFormatter,
        usage='osmo config set [-h] config_type name type [--field FIELD] '
              '[--description DESCRIPTION] [--tags TAGS [TAGS ...]]',
        epilog=f'''
Available config types (CONFIG_TYPE): {", ".join(set_choices)}

Examples
========

Creating a new pool role::

    osmo config set ROLE osmo-pool-name pool

.. note::

    The pool name **MUST** start with ``osmo-`` to be correctly recognized so that users
    can see the pool in the UI and profile settings. This will be changed to be more flexible
    in the future.

Creating a new backend role::

    osmo config set ROLE my-backend-role backend --field name-of-backend
        '''
    )
    set_parser.add_argument(
        'config',
        choices=set_choices,
        help='Config type to set (CONFIG_TYPE)',
        metavar='config_type',
    )
    set_parser.add_argument(
        'name',
        help='Name of the role'
    )
    set_parser.add_argument(
        'type',
        help='Type of field'
    )
    set_parser.add_argument(
        '--field',
        help='Field name in context. For example, the backend to target.'
    )
    set_parser.add_argument('--description',
                            help='Optional description for the set action')
    set_parser.add_argument('--tags',
                            nargs='+',
                            help='Optional tags for the set action')
    set_parser.set_defaults(func=_run_set_command)

    # Handle 'tag' command
    # NOTE: Custom usage message! If you change arguments, you need to update usage.
    tag_parser = config_subparsers.add_parser(
        'tag',
        help='Update tags for a config revision',
        description='Update tags for a config revision. Tags can be used for organizing configs by '
                    'category and filtering output of ``osmo config history``. Tags do not '
                    'affect the configuration itself.',
        formatter_class=argparse.RawTextHelpFormatter,
        usage='osmo config tag [-h] config_type [--set SET [SET ...]] '
              '[--delete DELETE [DELETE ...]]',
        epilog=f'''
Available config types (CONFIG_TYPE): {CONFIG_TYPES_STRING}

Examples
========

View current tags for a revision::

    osmo config history BACKEND -r 5

Update tags by adding and removing::

    osmo config tag BACKEND:5 --set foo --delete test-4 test-3

Verify the updated tags::

    osmo config history BACKEND -r 5

Update tags for current revision::

    osmo config tag BACKEND --set current-tag
        '''
    )
    tag_parser.add_argument(
        'config',
        help='Config to update tags for in format <CONFIG_TYPE>[:<revision>]',
        metavar='config_type',
    )
    tag_parser.add_argument(
        '--set', '-s',
        nargs='+',
        help='Tags to add to the config history entry'
    )
    tag_parser.add_argument(
        '--delete', '-d',
        nargs='+',
        help='Tags to remove from the config history entry'
    )
    tag_parser.set_defaults(func=_run_tag_command)

    # Add diff command
    diff_parser = config_subparsers.add_parser(
        'diff',
        help='Show the difference between two config revisions',
        description='Show the difference between two config revisions\n\n'
                    f'Available config types (config_type): {CONFIG_TYPES_STRING}',
        formatter_class=RstStrippingHelpFormatter,
        epilog='''
Examples
========

Show changes made to the workflow config since revision 15::

  osmo config diff WORKFLOW:15

.. image:: images/config_diff_workflow.png
    :align: center
    :class: mb-2

Show changes made between two revisions of the service configuration::

  osmo config diff SERVICE:14 SERVICE:15

.. image:: images/config_diff_service.png
    :align: center
    :class: mb-2
        '''
    )
    diff_parser.add_argument(
        'first',
        help='First config to compare. Format: <config_type>[:<revision>] '
             '(e.g. BACKEND:3). If no revision is provided, uses the current revision.',
    )
    diff_parser.add_argument(
        'second',
        nargs='?',
        help='Second config to compare. Format: <config_type>[:<revision>] '
             '(e.g. BACKEND:6). If no revision is provided, uses the current revision.',
    )
    diff_parser.set_defaults(func=_run_diff_command)
