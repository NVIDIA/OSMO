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
from run.kind_utils import load_images_to_kind
from src.lib.utils import logging as logging_utils

logging.basicConfig(format='%(message)s')
logger = logging.getLogger()

def main():
    parser = argparse.ArgumentParser(description='Load images directly into a KIND cluster')
    parser.add_argument('--cluster-name', default='osmo', help='Name of the KIND cluster')
    parser.add_argument('--images', nargs='+', help='List of images to load (e.g., service, agent, etc.)')
    parser.add_argument('--all', action='store_true', help='Load all OSMO images')
    parser.add_argument(
        '--log-level', type=logging_utils.LoggingLevel.parse,
        default=logging_utils.LoggingLevel.INFO)

    args = parser.parse_args()
    logger.setLevel(args.log_level)

    if args.all:
        images = [
            'agent', 'service', 'delayed-job-monitor', 'logger', 'router', 'worker', 
            'backend-listener', 'backend-worker', 'web-ui', 'init-container', 'client'
        ]
    elif args.images:
        images = args.images
    else:
        logger.error('❌ Error: Specify --images or --all')
        return

    try:
        load_images_to_kind(args.cluster_name, images)
    except Exception as e:
        logger.error('❌ Error loading images: %s', e)
        raise SystemExit(1)

if __name__ == '__main__':
    main()
