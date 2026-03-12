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

import re
from typing import Dict, Tuple

import yaml

from . import osmo_errors


def fetch_default_values(workflow_spec: str) -> str | None:
    """ Fetch the default values from the workflow spec. """
    default_values_pattern = re.compile(r'(^\s*default-values:\s*)(.*?)(?=^(?![#\s])\S|\Z)',
                                        re.DOTALL | re.MULTILINE)
    default_groups = [match.group(2)
                      for match in default_values_pattern.finditer(workflow_spec)]
    if len(default_groups) > 1:
        raise osmo_errors.OSMOUserError(
            'Multiple default-values sections found in the workflow spec.')

    if default_groups:
        return default_groups[0]
    return None


def parse_workflow_spec(workflow_spec: str) -> Tuple[str, Dict | None]:
    """ Parse the workflow spec. """
    workflow_pattern = re.compile(r'(^workflow:.*?)(?=^workflow:|\Z)',
                                  re.DOTALL | re.MULTILINE)
    workflows = workflow_pattern.findall(workflow_spec)
    if len(workflows) > 1:
        raise osmo_errors.OSMOUserError('Multiple workflows sections found in the workflow spec.')

    if workflows:
        workflow_portion = workflows[0]
    else:
        raise osmo_errors.OSMOUserError('Workflow spec not found.')

    default_values_pattern = re.compile(r'(^default-values:.*?)(?=^(?![#\s])\S|\Z)',
                                        re.DOTALL | re.MULTILINE)
    default_locs = default_values_pattern.findall(workflow_spec)
    if len(default_locs) > 1:
        raise osmo_errors.OSMOUserError(
            'Multiple default-values sections found in the workflow spec.')

    default_values = None

    # Get default values from 'default-values'
    if default_locs:
        default_values = yaml.safe_load(default_locs[0])['default-values']

    return workflow_portion, default_values
