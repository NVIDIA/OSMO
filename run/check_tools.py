#!/usr/bin/env python3
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

import logging
from typing import List

from run.run_command import run_command_with_logging


logger = logging.getLogger()


def _check_tool_installed(tool: str) -> bool:
    """Check if a tool is installed using 'which' command."""
    process = run_command_with_logging(['which', tool])
    return not process.has_failed()


def check_required_tools(required_tools: List[str]) -> None:
    """Check if all required tools are installed."""
    missing_tools = []
    for tool in required_tools:
        if not _check_tool_installed(tool):
            missing_tools.append(tool)

    if missing_tools:
        logger.error('❌ Error: The following required tools are not installed:')
        for tool in missing_tools:
            logger.error('   - %s', tool)
        logger.error('\nPlease install the missing tools and try again.')
        logger.error('Refer to the README.md for installation instructions.')
        raise RuntimeError('Missing required tools')

    logger.info('✅ All required tools are installed')
