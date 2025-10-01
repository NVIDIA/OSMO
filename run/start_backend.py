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
from run.start_backend_kind import start_backend_kind
from src.lib.utils import logging as logging_utils

logging.basicConfig(format='%(message)s')
logger = logging.getLogger()


def main():
    """Main function to orchestrate the OSMO backend setup."""
    parser = argparse.ArgumentParser(
        description='Run OSMO backend in a KIND cluster or with bazel')
    parser.add_argument(
        '--log-level', type=logging_utils.LoggingLevel.parse,
        default=logging_utils.LoggingLevel.INFO)
    parser.add_argument(
        '--mode',
        choices=['kind', 'bazel'],
        default='kind',
        help='''
        Mode to run backend in (default: kind). Use "kind" to run backend as docker images
        in a KIND cluster or "bazel" to run backend with bazel (no container images are used).
        '''
    )
    parser.add_argument(
        '--cluster-name', default='osmo',
        help='Name of the cluster (default: osmo). For KIND mode, this is the '
             'KIND cluster name. For bazel mode, this is used as the cluster name.')

    # KIND cluster arguments
    cluster_group = parser.add_argument_group('KIND cluster arguments',
                                              'Arguments only used with --mode kind')
    cluster_group.add_argument(
        '--container-registry-username', default='$oauthtoken',
        help='Container registry username (default: $oauthtoken)')
    cluster_group.add_argument(
        '--container-registry-password',
        help='Container registry password')
    cluster_group.add_argument(
        '--image-location', default='nvcr.io/nvstaging/osmo',
        help='OSMO image location (default: nvcr.io/nvstaging/osmo)')
    cluster_group.add_argument(
        '--image-tag', default='latest',
        help='OSMO image tag (default: latest)')

    args = parser.parse_args()

    # Validate required arguments for KIND mode
    if args.mode == 'kind' and not args.container_registry_password:
        parser.error('--container-registry-password is required when using --mode kind')

    logger.setLevel(args.log_level)

    logger.info('🔧 OSMO Backend Setup')
    logger.info('=' * 50)

    if args.mode == 'kind':
        logger.info('Running backend as docker images in a KIND cluster')
        start_backend_kind(args)
    elif args.mode == 'bazel':
        logger.info('Running backend with bazel')
        start_backend_bazel(args.cluster_name)


if __name__ == '__main__':
    main()
