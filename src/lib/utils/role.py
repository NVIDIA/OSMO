"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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
from typing import Any, Dict, List

import pydantic

from . import osmo_errors


# Semantic action pattern: resource:Action (e.g., "workflow:Create", "*:*")
SEMANTIC_ACTION_PATTERN = r'^(\*|[a-z]+):(\*|[A-Z][a-zA-Z]*)$'


class RoleAction(pydantic.BaseModel):
    """
    Single Role Action Entry using semantic action format.

    Format: {"action": "resource:Action"}

    Examples:
        - {"action": "workflow:Create"}
        - {"action": "bucket:Read"}
        - {"action": "*:*"} (all actions)
        - {"action": "workflow:*"} (all workflow actions)

    Authorization is handled by the authz_sidecar (Go service).
    """
    action: str

    class Config:
        extra = 'forbid'

    @pydantic.validator('action')
    @classmethod
    def validate_action(cls, value: str) -> str:
        """Validate the semantic action format."""
        if not re.match(SEMANTIC_ACTION_PATTERN, value):
            raise osmo_errors.OSMOUserError(
                f'Invalid action format: {value}. '
                'Expected format: "resource:Action" (e.g., "workflow:Create", "*:*")')
        return value

    def __lt__(self, other: 'RoleAction') -> bool:
        """Compare RoleActions by their action string for sorting."""
        return self.action < other.action

    def __str__(self) -> str:
        """Return string representation of the action."""
        return self.action

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {'action': self.action}


class RolePolicy(pydantic.BaseModel):
    """
    Single Role Policy Entry.

    Contains a list of actions and optional resources the policy applies to.
    """
    actions: List[RoleAction]
    # Resources this policy applies to (e.g., ["*"], ["pool/production"], ["bucket/*"])
    # If empty or not specified, the policy applies to all resources ("*")
    resources: List[str] = pydantic.Field(default_factory=list)

    @pydantic.validator('actions', pre=True)
    @classmethod
    def validate_actions(cls, value) -> List[RoleAction]:
        """Parse actions from various input formats."""
        actions = []
        for action in value:
            if isinstance(action, str):
                actions.append(RoleAction(action=action))
            elif isinstance(action, dict):
                actions.append(RoleAction(**action))
            elif isinstance(action, RoleAction):
                actions.append(action)
            else:
                raise osmo_errors.OSMOUserError(f'Invalid action type: {type(action)}')
        return actions

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        result = {
            'actions': [action.to_dict() for action in sorted(self.actions)]
        }
        if self.resources:
            result['resources'] = self.resources
        return result


class Role(pydantic.BaseModel):
    """Single Role Entry."""
    name: str
    description: str
    policies: List[RolePolicy]
    immutable: bool = False

    @classmethod
    def parse_actions_as_strings(cls, data: List[Dict]) -> List[Dict]:
        """Parse the actions as strings for display purposes."""
        data_list = []
        for role in data:
            role_copy = role.copy()
            role_copy['policies'] = []
            for policy in role['policies']:
                policy_dict = {
                    'actions': [action['action'] for action in policy['actions']]
                }
                if 'resources' in policy and policy['resources']:
                    policy_dict['resources'] = policy['resources']
                role_copy['policies'].append(policy_dict)
            data_list.append(role_copy)
        return data_list

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            'name': self.name,
            'description': self.description,
            'policies': [policy.to_dict() for policy in self.policies],
            'immutable': self.immutable
        }
