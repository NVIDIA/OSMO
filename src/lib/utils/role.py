"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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
import json
import re
from enum import Enum
from typing import Any, Dict, List

import pydantic

from . import osmo_errors


# Semantic action pattern: resource:Action (e.g., "workflow:Create", "*:*")
SEMANTIC_ACTION_PATTERN = re.compile(r'^(\*|[a-z]+):(\*|[A-Z][a-zA-Z]*)$')


def validate_semantic_action(value: str) -> str:
    """
    Validate a single semantic action string. Raises OSMOUserError if invalid.
    Use when constructing or appending actions outside RolePolicy (e.g. in migrations).
    """
    if not SEMANTIC_ACTION_PATTERN.match(value):
        raise osmo_errors.OSMOUserError(
            f'Invalid action format: {value}. '
            'Expected format: "resource:Action" (e.g., "workflow:Create", "*:*")')
    return value


class SyncMode(str, enum.Enum):
    """
    Sync mode for role assignments.

    - FORCE: Always apply this role to all users (e.g., for system roles)
    - IMPORT: Role is imported from IDP claims or user_roles table (default)
    - IGNORE: Ignore this role in IDP sync (role is managed manually)
    """
    FORCE = 'force'
    IMPORT = 'import'
    IGNORE = 'ignore'


class PolicyEffect(str, Enum):
    """Effect of a policy statement: Allow or Deny. Deny takes precedence over Allow."""

    ALLOW = 'Allow'
    DENY = 'Deny'


class LegacyRoleAction(pydantic.BaseModel):
    """Legacy path-based role action retained for 6.3 ConfigMap compatibility."""

    model_config = pydantic.ConfigDict(extra='forbid')

    base: str = ''
    path: str = ''
    method: str = ''

    @pydantic.model_validator(mode='after')
    def validate_non_empty(self) -> 'LegacyRoleAction':
        if not (self.base or self.path or self.method):
            raise ValueError('Legacy role action must set base, path, or method')
        return self


class RolePolicy(pydantic.BaseModel):
    """
    Single Role Policy Entry.

    Contains a list of actions (semantic format "resource:Action") and optional
    resources the policy applies to. If effect is Deny and the policy matches,
    access is denied even if another policy allows it.

    Actions are validated via regex; API/DB still use [{"action": "..."}] for
    compatibility with the Go authz_sidecar.
    """
    effect: PolicyEffect = PolicyEffect.ALLOW
    actions: List[str | LegacyRoleAction]
    # Resources this policy applies to (e.g., ["*"], ["pool/production"], ["bucket/*"])
    # If empty or not specified, the policy applies to all resources ("*")
    resources: List[str] = pydantic.Field(default_factory=list)

    @pydantic.field_validator('actions', mode='before')
    @classmethod
    def validate_actions(cls, value) -> List[str | Dict[str, str]]:
        """Parse and validate actions from various input formats."""
        if isinstance(value, str):
            value = [value]
        normalized_actions: List[str | Dict[str, str]] = []
        for action in value:
            if isinstance(action, str):
                normalized_actions.append(validate_semantic_action(action))
            elif isinstance(action, dict) and 'action' in action:
                semantic_action = action.get('action')
                if not isinstance(semantic_action, str):
                    raise ValueError('Semantic role action must be a string')
                normalized_actions.append(
                    validate_semantic_action(semantic_action))
            elif isinstance(action, dict):
                LegacyRoleAction.model_validate(action)
                normalized_actions.append(action)
            else:
                raise ValueError(
                    'Role actions must be semantic strings or action mappings')
        return normalized_actions

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to dict. Actions emitted as list of strings (Go accepts
        strings or legacy objects).
        """
        actions = [
            action if isinstance(action, str) else action.model_dump(
                exclude_defaults=True)
            for action in self.actions
        ]
        result: Dict[str, Any] = {
            'effect': self.effect.value,
            'actions': sorted(
                actions, key=lambda action: json.dumps(action, sort_keys=True))
        }
        if self.resources:
            result['resources'] = self.resources
        return result


class Role(pydantic.BaseModel):
    """
    Single Role Entry

    external_roles semantics:
    - None: Don't modify external role mappings (preserve existing)
    - []: Explicitly clear all external role mappings
    - ['role1', 'role2']: Set external role mappings to these values
    """
    name: str
    description: str
    policies: List[RolePolicy]
    immutable: bool = False
    sync_mode: SyncMode = SyncMode.IMPORT
    external_roles: List[str] | None = None

    def to_dict(self) -> Dict[str, Any]:
        result = {
            'name': self.name,
            'description': self.description,
            'policies': [policy.to_dict() for policy in self.policies],
            'immutable': self.immutable,
            'sync_mode': self.sync_mode.value,
        }
        # Only include external_roles if explicitly set (not None)
        if self.external_roles is not None:
            result['external_roles'] = self.external_roles
        return result
