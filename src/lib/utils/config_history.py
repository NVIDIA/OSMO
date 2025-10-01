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

import enum
import re

from . import osmo_errors


class ConfigHistoryType(enum.Enum):
    """ Type of configs supported by config history """
    SERVICE = 'SERVICE'
    WORKFLOW = 'WORKFLOW'
    DATASET = 'DATASET'
    BACKEND = 'BACKEND'
    POOL = 'POOL'
    POD_TEMPLATE = 'POD_TEMPLATE'
    RESOURCE_VALIDATION = 'RESOURCE_VALIDATION'
    BACKEND_TEST = 'BACKEND_TEST'
    ROLE = 'ROLE'


CONFIG_TYPES = sorted([t.value for t in ConfigHistoryType])
CONFIG_TYPES_REGEX = rf'^({"|".join(CONFIG_TYPES)}):([1-9][0-9]*)$'


class ConfigHistoryRevision:
    """ Splits config type and revision number. """

    config_type: ConfigHistoryType
    revision: int

    def __init__(self, revision: str):
        parsed_revision = re.fullmatch(CONFIG_TYPES_REGEX, revision)

        if not parsed_revision:
            raise osmo_errors.OSMOUserError(
                f'Invalid revision "{revision}": expected <CONFIG_TYPE>:<revision> where ' +
                f'<CONFIG_TYPE> is one of {", ".join(CONFIG_TYPES)}')

        self.config_type = ConfigHistoryType(parsed_revision.group(1).upper())
        self.revision = int(parsed_revision.group(2))
