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

import pydantic

from src.utils import static_config


class DocsConfig(static_config.StaticConfig):
    """ Manages configuration specific to the workflow service. """
    host: str = pydantic.Field(
        command_line='host',
        default='0.0.0.0',
        description='The address to bind to when serving the workflow service.')
    port: int = pydantic.Field(
        command_line='port',
        default=8000,
        description='The port to serve the workflow service on.')
    docs_dir: str = pydantic.Field(
        command_line='docs_dir',
        default='',
        description='The directory to serve the docs from.')
