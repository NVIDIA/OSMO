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


class PolicyEffect(str, Enum):
    """Effect of a policy statement: Allow or Deny. Deny takes precedence over Allow."""

    ALLOW = 'Allow'
    DENY = 'Deny'


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
    actions: List[str]
    # Resources this policy applies to (e.g., ["*"], ["pool/production"], ["bucket/*"])
    # If empty or not specified, the policy applies to all resources ("*")
    resources: List[str] = pydantic.Field(default_factory=list)

    @pydantic.validator('actions', pre=True)
    @classmethod
    def validate_actions(cls, value) -> List[str]:
        """Parse and validate actions from various input formats."""
        result = []
        for action in value:
            if isinstance(action, str):
                raw = action
            elif isinstance(action, dict):
                raw = action.get('action')
                if raw is None:
                    raise osmo_errors.OSMOUserError(
                        'Invalid action dict: missing "action" key')
            else:
                raise osmo_errors.OSMOUserError(f'Invalid action type: {type(action)}')
            result.append(validate_semantic_action(raw))
        return result

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to dict. Actions emitted as list of strings (Go accepts
        strings or legacy objects).
        """
        result: Dict[str, Any] = {
            'effect': self.effect.value,
            'actions': sorted(self.actions)
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

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            'name': self.name,
            'description': self.description,
            'policies': [policy.to_dict() for policy in self.policies],
            'immutable': self.immutable
        }
