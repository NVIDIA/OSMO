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

import argparse
import logging

from run.start_backend_bazel import start_backend_bazel
from src.lib.utils import logging as logging_utils

logging.basicConfig(format='%(message)s')
logger = logging.getLogger()


def main():
    """Run OSMO backend processes against a local compute cluster."""
    parser = argparse.ArgumentParser(
        description='Run OSMO backend as local Bazel processes')
    parser.add_argument(
        '--log-level', type=logging_utils.LoggingLevel.parse,
        default=logging_utils.LoggingLevel.INFO)
    parser.add_argument(
        '--cluster-name', default='osmo',
        help='Name of the compute KIND cluster (default: osmo).')

    args = parser.parse_args()

    logger.setLevel(args.log_level)

    logger.info('🔧 OSMO Backend Setup')
    logger.info('=' * 50)

    logger.info('Running backend with Bazel')
    start_backend_bazel(args.cluster_name)


if __name__ == '__main__':
    main()
