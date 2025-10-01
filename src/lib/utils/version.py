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

import os
import re
from typing import Dict

import pydantic
import yaml

from . import osmo_errors

VERSION_HEADER = 'x-osmo-client-version'
SERVICE_VERSION_HEADER = 'x-osmo-service-version'


class Version(pydantic.BaseModel):
    """ A class to maintain version information. """
    major: str
    minor: str = '0'
    revision: str = '0'
    hash: str = ''

    def __str__(self):
        """ Gets the version number of OSMO. """
        version = '.'.join([self.major, self.minor, self.revision])
        # Development version will not have hash
        if self.hash:
            version += f'.{self.hash}'
        return version

    def __lt__(self, other: 'Version') -> bool:  # type: ignore[override]
        self_values = tuple(map(int, [self.major, self.minor, self.revision]))
        other_values = tuple(map(int, [other.major, other.minor, other.revision]))
        return self_values < other_values


    @classmethod
    def from_string(cls, version_str: str) -> 'Version':
        kwargs = {}
        version_pattern = re.compile(r'^\d+\.\d+\.\d+(\.[a-zA-Z0-9]+)?$')
        if not version_pattern.match(version_str):
            raise osmo_errors.OSMOError('Version should be of the format major.minor.revision')
        version_list = version_str.split('.')
        kwargs['major'] = version_list[0]
        if len(version_list) > 1:
            kwargs['minor'] = version_list[1]
        if len(version_list) > 2:
            kwargs['revision'] = version_list[2]
        if len(version_list) > 3:
            kwargs['hash'] = version_list[3]
        return Version(**kwargs)

    @classmethod
    def from_dict(cls, version_dict: Dict) -> 'Version':
        kwargs = {}
        if 'major' not in version_dict or 'minor' not in version_dict\
            or 'revision' not in version_dict:
            raise osmo_errors.OSMOError('Version dict should contain major, minor, and revision')
        kwargs['major'] = version_dict['major']
        kwargs['minor'] = version_dict['minor']
        kwargs['revision'] = version_dict['revision']
        if 'hash' in version_dict and version_dict['hash']:
            kwargs['hash'] = version_dict['hash']
        return Version(**kwargs)


def load_version() -> Version:
    """ Loads the version from the version file. """
    release_file_path = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'version.yaml')
    with open(release_file_path, 'r', encoding='UTF-8') as file:
        version_spec = yaml.safe_load(file)
    return Version(**version_spec)


def write_version(version: Version) -> None:
    """ Replaces the version into version file. """
    release_file_path = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'version.yaml')
    data = ''
    for key, value in version.dict().items():
        data += F'{key.lower()}: {value}\n'
    with open(release_file_path, 'w+', encoding='UTF-8') as file:
        file.write(data)


VERSION = load_version()
