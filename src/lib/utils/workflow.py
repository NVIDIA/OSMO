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
from typing import Dict

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


def parse_workflow_spec(workflow_spec: str) -> Dict[str, str]:
    """
    Parse a workflow spec string into a mapping of top-level section names to their raw text.

    Each top-level key (e.g. workflow:, resources:, default-values:) becomes an entry in the
    returned dict. The value is the full raw text block for that section, including the key line
    itself, with no YAML parsing applied. Raises OSMOUserError if any top-level key appears more
    than once, or if no workflow section is found.
    """
    section_pattern = re.compile(
        r'^([a-zA-Z][a-zA-Z0-9_-]*):(.*?)(?=^[a-zA-Z][a-zA-Z0-9_-]*:|\Z)',
        re.DOTALL | re.MULTILINE,
    )
    sections: Dict[str, str] = {}
    for match in section_pattern.finditer(workflow_spec):
        key = match.group(1)
        raw_block = match.group(1) + ':' + match.group(2)
        if key in sections:
            raise osmo_errors.OSMOUserError(
                f'Duplicate top-level key "{key}" found in the workflow spec.')
        sections[key] = raw_block
    return sections
