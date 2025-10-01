# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

"""
Main parser for the CLI.
"""

import argparse

from src.cli import (
    app,
    access_token,
    bucket,
    config,
    credential,
    data,
    dataset,
    login,
    pool,
    profile,
    resources,
    task,
    workflow,
    version,
)
from src.lib.utils import logging as logging_utils


PARSERS = (
    login.setup_parser,
    version.setup_parser,
    workflow.setup_parser,
    app.setup_parser,
    task.setup_parser,
    data.setup_parser,
    dataset.setup_parser,
    credential.setup_parser,
    access_token.setup_parser,
    bucket.setup_parser,
    resources.setup_parser,
    profile.setup_parser,
    pool.setup_parser,
    config.setup_parser
)


def create_cli_parser() -> argparse.ArgumentParser:
    """
    Create the CLI argument parser for OSMO Client.
    """
    parser = argparse.ArgumentParser(
        prog='osmo',
        description='OSMO is a cloud based platform that allows easy, efficient access to compute '
                    'and data storage specially purposed for development of robots; OSMO enables '
                    'projects to scale from a single developer to groups maintaining robots in '
                    'production by abstracting the complexity of various backend compute and data '
                    'storage systems.',
    )
    parser.add_argument('--log-level',
                        type=logging_utils.LoggingLevel.parse,
                        default=logging_utils.LoggingLevel.INFO)

    subparsers = parser.add_subparsers(dest='module')
    for setup in PARSERS:
        setup(subparsers)

    return parser
