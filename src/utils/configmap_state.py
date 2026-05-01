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

from typing import Any, Dict, List

# Global ConfigMap mode state. Set by ConfigMapWatcher, read by
# postgres.py model methods and configmap_guard.py.
#
# This module is intentionally dependency-free (only stdlib) so it can
# be imported from both the utils layer (connectors/postgres.py) and
# the service layer (config/configmap_guard.py) without circular deps.

_configmap_mode_active: bool = False
_parsed_configs: Dict[str, Any] | None = None


def set_configmap_mode(active: bool) -> None:
    global _configmap_mode_active  # noqa: PLW0603
    _configmap_mode_active = active


def is_configmap_mode() -> bool:
    return _configmap_mode_active


def set_parsed_configs(configs: Dict[str, Any] | None) -> None:
    global _parsed_configs  # noqa: PLW0603
    _parsed_configs = configs


def get_snapshot() -> Dict[str, Any] | None:
    """Return the current parsed config dict.

    Callers should grab this reference once per request and reuse it
    for all config lookups to get a consistent snapshot.
    """
    return _parsed_configs


def get_declarative_user_roles(user_name: str) -> List[str] | None:
    """Return roles for a user declared in the ConfigMap `users:` block.

    Returns None when the user isn't declared (caller treats them as IDP-
    managed) or when the snapshot isn't loaded. Returns an empty list
    when the user is declared with no roles. The caller can distinguish
    "not declared" from "declared with no roles" by the None check.
    """
    snapshot = _parsed_configs
    if snapshot is None:
        return None
    for entry in snapshot.get('users') or []:
        if isinstance(entry, dict) and entry.get('name') == user_name:
            roles = entry.get('roles') or []
            return [r for r in roles if isinstance(r, str)]
    return None


def get_declared_role_names() -> set:
    """Return the set of role names declared in the ConfigMap `roles:` block.

    Empty set when not in ConfigMap mode or the snapshot lacks a `roles:`
    block. Used by access-token validation to confirm a requested role
    is declarative before storing the role_name on `access_token_roles`.
    """
    snapshot = _parsed_configs
    if snapshot is None:
        return set()
    return set((snapshot.get('roles') or {}).keys())
