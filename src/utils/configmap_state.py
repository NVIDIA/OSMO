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
