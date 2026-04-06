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
from src.utils import connectors

CONFIGMAP_SYNC_USERNAME = 'configmap-sync'
CONFIGMAP_SYNC_TAGS = ['configmap']

# Module-level reference to managed config state, set by ConfigMapWatcher.start()
_managed_configs: Dict[str, Any] | None = None


# Maps ConfigType enum to the config key string used in managed_configs
CONFIG_TYPE_TO_KEY = {
    connectors.ConfigType.SERVICE: 'service',
    connectors.ConfigType.WORKFLOW: 'workflow',
    connectors.ConfigType.DATASET: 'dataset',
}


def set_managed_configs(managed_configs: Dict[str, Any] | None) -> None:
    """Called by ConfigMapWatcher to update the cached managed configs."""
    global _managed_configs  # noqa: PLW0603
    _managed_configs = managed_configs


def get_managed_mode(config_key: str) -> str | None:
    """Return the managed_by mode for a config key, or None if not managed."""
    if _managed_configs is None:
        return None
    section = _managed_configs.get(config_key)
    if not section:
        return None
    return section.get('managed_by', 'seed')


def get_cached_section(config_key: str) -> Dict[str, Any] | None:
    """Return the cached ConfigMap section for a config key, or None."""
    if _managed_configs is None:
        return None
    return _managed_configs.get(config_key)


def is_singleton_managed(config_key: str) -> bool:
    """Return True if a singleton config is managed by ConfigMap in configmap mode."""
    return get_managed_mode(config_key) == 'configmap'


def is_named_item_managed(config_key: str, item_name: str) -> bool:
    """Return True if a named config item is managed by ConfigMap in configmap mode."""
    section = get_cached_section(config_key)
    if not section:
        return False
    if section.get('managed_by', 'seed') != 'configmap':
        return False
    items = section.get('items', {})
    return item_name in items


def reject_if_managed(config_key: str, username: str,
                      item_name: str | None = None) -> None:
    """Raise 409 if a config is managed by ConfigMap and caller is not configmap-sync.

    Single enforcement point for all config write protection.
    """
    if username == CONFIGMAP_SYNC_USERNAME:
        return

    if item_name is not None:
        if is_named_item_managed(config_key, item_name):
            raise osmo_errors.OSMOUserError(
                f'{item_name} is managed by ConfigMap (managed_by=configmap) '
                f'and cannot be modified via API. '
                f'Update the Helm values instead.',
                status_code=409)
    else:
        if is_singleton_managed(config_key):
            raise osmo_errors.OSMOUserError(
                f'{config_key.capitalize()} config is managed by ConfigMap '
                f'(managed_by=configmap) and cannot be modified via API. '
                f'Update the Helm values instead.',
                status_code=409)
