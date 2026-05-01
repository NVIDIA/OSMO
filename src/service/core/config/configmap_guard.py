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

from src.lib.utils import osmo_errors
from src.utils import configmap_state

CONFIGMAP_SYNC_USERNAME = 'configmap-sync'

# Delegate state to configmap_state (dependency-free module importable
# by both the service layer and the utils/connectors layer).
set_configmap_mode = configmap_state.set_configmap_mode
is_configmap_mode = configmap_state.is_configmap_mode
set_parsed_configs = configmap_state.set_parsed_configs
get_snapshot = configmap_state.get_snapshot


def reject_if_configmap_mode(username: str) -> None:
    """Raise 409 if ConfigMap mode is active and caller is not
    configmap-sync.

    Single enforcement point for all config write protection.
    In ConfigMap mode, ALL config writes are blocked — configs are
    managed via GitOps/kubectl only.
    """
    if username == CONFIGMAP_SYNC_USERNAME:
        return
    if configmap_state.is_configmap_mode():
        raise osmo_errors.OSMOUserError(
            'Configs are managed by ConfigMap and cannot be modified '
            'via CLI/API. Update the Helm values and redeploy instead.',
            status_code=409)


def reject_user_role_writes_in_configmap_mode() -> None:
    """Raise 409 when a user-role write hits ConfigMap mode.

    Distinct from reject_if_configmap_mode because the remediation is
    different: role membership is declarative via either an IDP group
    (mapped to OSMO roles by `external_roles` in the ConfigMap) or via
    the ConfigMap's `users:` block for service accounts. There's no
    runtime grant path.
    """
    if configmap_state.is_configmap_mode():
        raise osmo_errors.OSMOUserError(
            'User role assignment is declarative in ConfigMap mode. '
            'For IDP users, edit the IDP group mapped to the role. '
            'For service accounts, edit the ConfigMap users: block.',
            status_code=409)
