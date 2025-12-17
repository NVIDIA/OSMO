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

import os
from typing import Optional

import yaml

from . import cache, common


def get_client_config_dir(create: bool = True) -> str:
    """ Get path of directory where config files should be stored """
    override_dir = os.getenv(common.OSMO_CONFIG_OVERRIDE)
    xdg_config = os.getenv('XDG_CONFIG_HOME')

    # If an override dir is provided, use it
    if override_dir is not None:
        config_dir = override_dir

    # Otherwise try to use xdg path
    elif xdg_config is not None:
        config_dir = f'{xdg_config}/osmo'

    # Lastly, resort to ~/.config
    else:
        config_dir = os.path.expanduser('~/.config/osmo')

    if create:
        os.makedirs(config_dir, exist_ok=True)

    return config_dir


def get_cache_config() -> Optional[cache.CacheConfig]:
    osmo_directory = get_client_config_dir(create=False)
    password_file = osmo_directory + '/config.yaml'

    if os.path.isfile(password_file):
        with open(password_file, 'r', encoding='utf-8') as file:
            configs = yaml.safe_load(file.read())
            if 'cache' in configs:
                return cache.CacheConfig(**configs['cache'])
    return None


def get_client_state_dir() -> str:
    """ Get path of directory where state info should be stored, like logs """
    override_dir = os.getenv(common.OSMO_STATE_OVERRIDE)
    xdg_config = os.getenv('XDG_STATE_HOME')

    # If an override dir is provided, use it
    if override_dir is not None:
        state_dir = override_dir

    # Otherwise try to use xdg path
    elif xdg_config is not None:
        state_dir = f'{xdg_config}/osmo'

    # Lastly, resort to ~/.local/state/osmo
    else:
        state_dir = os.path.expanduser('~/.local/state/osmo')

    os.makedirs(state_dir, exist_ok=True)
    return state_dir


def get_log_file_path() -> str:
    return f'{get_client_state_dir()}/client.log'
