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

import datetime
import enum
import yaml


class YamlLiteral(str):
    """ A helper class to allow pyyaml to dump strings in the "literal" format """
    pass


def _yaml_literal_representer(dumper: yaml.Dumper, data: YamlLiteral):
    """ A helper function to allow pyyaml to dump strings in the "literal" format """
    # YAML literal scalar does not like trailing spaces before newlines
    stripped_data = [line.rstrip() for line in data.splitlines()]
    processed_data = '\n'.join(stripped_data)
    return dumper.represent_scalar('tag:yaml.org,2002:str', processed_data, style='|')


def _yaml_timedelta_representer(dumper: yaml.Dumper, data: datetime.timedelta):
    """ A helper function to allow pyyaml to dump timedelta objects """
    days = data.days
    hours, remainder = divmod(data.seconds, 3600)
    minutes, seconds = divmod(remainder, 60)

    parts = []
    if days:
        parts.append(f'{days}d')
    if hours:
        parts.append(f'{hours}h')
    if minutes:
        parts.append(f'{minutes}m')
    if seconds:
        parts.append(f'{seconds}s')

    output = ''.join(parts) if parts else '0s'
    return dumper.represent_scalar('tag:yaml.org,2002:str', output)


def _yaml_enum_representer(dumper: yaml.Dumper, data: enum.Enum):
    """ A helper function to allow pyyaml to dump enum objects as their values """
    return dumper.represent_scalar('tag:yaml.org,2002:str', data.value)


# When this module is loaded, configure the yaml module to use the yaml_literal class
yaml.add_representer(YamlLiteral, _yaml_literal_representer)
yaml.add_representer(datetime.timedelta, _yaml_timedelta_representer)
yaml.add_multi_representer(enum.Enum, _yaml_enum_representer)
