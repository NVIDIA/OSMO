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
from typing import Annotated, Any, Dict, List

import pydantic

from . import osmo_errors


ROLE_ACTION_BASE = r'(?P<base>http)'
ROLE_ACTION_PATH = r'(?P<path>(\*|(!?)/([^:]+)))'
ROLE_ACTION_METHOD = r'(?P<method>(\*|([a-zA-Z]+)))'
ROLE_ACTION = f'^{ROLE_ACTION_BASE}:{ROLE_ACTION_PATH}:{ROLE_ACTION_METHOD}$'
RoleActionBasePattern = Annotated[str, pydantic.Field(regex=f'^{ROLE_ACTION_BASE}$')]
RoleActionPathPattern = Annotated[str, pydantic.Field(regex=f'^{ROLE_ACTION_PATH}$')]
RoleActionMethodPattern = Annotated[str, pydantic.Field(regex=f'^{ROLE_ACTION_METHOD}$')]
RoleActionPattern = Annotated[str, pydantic.Field(regex=ROLE_ACTION)]


class RoleAction(pydantic.BaseModel):
    """ Single Role Action Entry """
    base: RoleActionBasePattern
    path: RoleActionPathPattern
    method: RoleActionMethodPattern

    @classmethod
    def from_action(cls, action: str) -> 'RoleAction':
        parsed_action = re.fullmatch(ROLE_ACTION, action)

        if not parsed_action:
            raise osmo_errors.OSMOUserError(f'Invalid action: {action}')

        return cls(base=parsed_action.group('base'),
                   path=parsed_action.group('path'),
                   method=parsed_action.group('method'))

    @classmethod
    def to_str(cls, base: str, path: str, method: str) -> str:
        """Combines the base, path and method fields into a single action string"""
        return f'{base}:{path}:{method}'

    def __lt__(self, other: 'RoleAction') -> bool:
        """Compare RoleActions by their string representation for sorting"""
        return self.to_str(self.base, self.path, self.method) < \
            other.to_str(other.base, other.path, other.method)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'base': self.base,
            'path': self.path,
            'method': self.method
        }


class RolePolicy(pydantic.BaseModel):
    """ Single Role Policy Entry """
    actions: List[RoleAction]

    # Allow users to enter string format to be converted to RoleAction
    @pydantic.validator('actions', pre=True)
    @classmethod
    def validate_actions(cls, value) -> List[RoleAction]:
        actions = []
        for action in value:
            if isinstance(action, str):
                action_info = RoleAction.from_action(action)

                valid_methods = ['*', 'get', 'post', 'put', 'patch', 'delete', 'websocket']
                if action_info.method.lower() not in valid_methods:
                    raise osmo_errors.OSMOUserError(f'Invalid method: {action_info.method}. '
                                                    f'Method must be one of: {valid_methods}')
                if action_info.method != '*':
                    action_info.method = action_info.method[0].upper()\
                        + action_info.method[1:].lower()

                actions.append(RoleAction(base=action_info.base,
                                          path=action_info.path,
                                          method=action_info.method))
            else:
                actions.append(action)
        return actions

    def to_dict(self) -> Dict[str, Any]:
        return {
            'actions': [action.to_dict() for action in sorted(self.actions)]
        }


class Role(pydantic.BaseModel):
    """ Single Role Entry """
    name: str
    description: str
    policies: List[RolePolicy]
    immutable: bool = False

    @classmethod
    def parse_actions_as_strings(cls, data: List[Dict])\
        -> List[Dict]:
        """ Parse the actions as strings """
        data_list = []
        for role in data:
            role['policies'] = [{
                'actions': [RoleAction.to_str(action['base'], action['path'], action['method'])
                            for action in policy['actions']]
            } for policy in role['policies']]
            data_list.append(role)
        return data_list

    def to_dict(self) -> Dict[str, Any]:
        return {
            'name': self.name,
            'description': self.description,
            'policies': [policy.to_dict() for policy in self.policies],
            'immutable': self.immutable
        }
