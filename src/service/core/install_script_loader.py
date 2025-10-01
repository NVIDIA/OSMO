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

import enum
import os

from src.lib.utils import jinja_sandbox

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
SCRIPT_NAME = 'install.jinja'


class CliOSType(enum.Enum):
    """ OS type for CLI to download."""
    LINUX = 'linux'
    MACOS = 'macos'


def render_install_script(service_url: str) -> str:
    """ Renders the install script. """
    script = os.path.join(SCRIPT_DIR, SCRIPT_NAME)
    with open(script, 'r', encoding='utf-8') as file:
        script_content = file.read()

    return jinja_sandbox.sandboxed_jinja_substitute(script_content,
                                                    {'service_url': service_url,
                                                     'mac_enum': CliOSType.MACOS.value,
                                                     'linux_enum': CliOSType.LINUX.value})
