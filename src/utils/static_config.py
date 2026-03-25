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
import os
import sys
import typing
from typing import Any, Dict

import pydantic
import yaml


def _get_field_extras(field: pydantic.fields.FieldInfo) -> Dict[str, Any]:
    """Get json_schema_extra as a dict, handling Callable and None cases."""
    extra = field.json_schema_extra
    if isinstance(extra, dict):
        return extra
    return {}


class StaticConfig(pydantic.BaseModel):
    """ A class for reading in config information from either command line, files,
    or environment variables """
    _instance = None
    @classmethod
    def load(cls):
        if cls._instance is not None:
            return cls._instance

        # First, build the argument parser, add an argument for each field in the config that
        # supports "command_line"
        parser = argparse.ArgumentParser()
        parser.add_argument('--config', action='append', default=[],
                            help='The yaml file from which to load configuration data. Multiple ' \
                                 'files may be specified by including this argument multiple ' \
                                 'times. If a config parameter is duplicated in more than one ' \
                                 'file, the value in the last file is used.')

        for name, field in cls.model_fields.items():
            extras = _get_field_extras(field)
            if 'command_line' in extras:
                help_message = field.description or ''
                if field.default is not None:
                    help_message += f' (default: {str(field.default)})'
                parser.add_argument(f'--{extras["command_line"]}',
                                    action=extras.get('action', 'store'),
                                    help=help_message)
        args = parser.parse_args()

        # Initialize config with default values
        config = {}
        for name, field in cls.model_fields.items():
            # If the default is None and its not optional, then dont set the default because the
            # user must provide this value
            if not field.is_required():
                config[name] = field.default

        # Load any config files. The later files override anything from the earlier files
        for config_file in args.config:
            with open(config_file, encoding='utf-8') as file:
                config.update(yaml.safe_load(file))
            for key in config:
                if key not in cls.model_fields.keys():
                    raise ValueError(f'Unrecognized key "{key}" in config file {config_file}')
        args_dict = vars(args)
        args_dict.pop('config')

        # Now, make sure each field is set, picking from the following priority
        # 1. Environment variable
        # 2. Command line argument
        # 3. Config file
        # 4. Default
        for name, field in cls.model_fields.items():
            extras = _get_field_extras(field)
            env_name = extras.get('env')
            arg_name = extras.get('command_line')
            is_list = typing.get_origin(field.annotation) is list
            # Do we have an environment variable? If so, use that
            if env_name is not None and env_name in os.environ:
                if is_list:
                    config[name] = os.environ[env_name].split(',')
                else:
                    config[name] = os.environ[env_name]
            # Do we have a command line value from Argparser?
            elif arg_name is not None and args_dict.get(arg_name) is not None:
                if is_list:
                    config[name] = args_dict[arg_name].split(',')
                else:
                    config[name] = args_dict[arg_name]

        try:
            cls._instance = cls(**config)
        except pydantic.ValidationError as error:
            # Parse through errors and print them in a more user friendly manner
            for type_error in error.errors():
                if type_error['type'] not in ('type_error.none.not_allowed', 'value_error.missing',
                                                 'missing', 'none_required'):
                    print(type_error)
                else:
                    field_name = str(type_error['loc'][0])
                    field = cls.model_fields[field_name]  # pylint: disable=E1136
                    extras = _get_field_extras(field)
                    print(f'ERROR: No value provided for config {field_name} ' \
                          'via any of the following methods:')
                    print(f'- Config file key: {field_name}')
                    if 'command_line' in extras:
                        command_line = extras['command_line']
                        print(f'- Command line argument: --{command_line}')
                    if 'env' in extras:
                        env = extras['env']
                        print(f'- Environment variable: {env}')
            sys.exit(1)
        return cls._instance
