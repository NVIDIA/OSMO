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

from typing import Any, Dict

from src.lib.utils import osmo_errors
from src.utils import configmap_state

CONFIGMAP_SYNC_USERNAME = 'configmap-sync'
CONFIGMAP_SYNC_TAGS = ['configmap']

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
