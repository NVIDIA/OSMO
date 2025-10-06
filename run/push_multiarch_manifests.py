"""
SPDX-FileCopyrightText: NVIDIA CORPORATION
Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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
import os
import subprocess
import sys
import urllib.parse

from run.check_tools import check_required_tools
from src.lib.utils import logging as logging_utils


logging.basicConfig(format='%(message)s')
logger = logging.getLogger()


def create_multiarch_manifest(registry_path, image_name, tag, push_latest=False, amend=False):
    """Create and push a multi-arch manifest for the given image."""
    image_path = urllib.parse.urljoin(registry_path + '/', image_name)

    amd64_image = f'{image_path}:{tag}-amd64'
    arm64_image = f'{image_path}:{tag}-arm64'
    manifest_image = f'{image_path}:{tag}'

    logger.info('Creating multi-arch manifest for %s:%s', image_path, tag)
    logger.info('  AMD64 image: %s', amd64_image)
    logger.info('  ARM64 image: %s', arm64_image)

    create_cmd = [
        'docker', 'manifest', 'create',
        manifest_image,
        amd64_image,
        arm64_image
    ]
    if amend:
        create_cmd.append('--amend')

    try:
        logger.info('Running: %s', ' '.join(create_cmd))
        subprocess.run(create_cmd, check=True)
    except subprocess.CalledProcessError as e:
        logger.error('Error creating manifest for %s: %s', image_name, e)
        raise

    push_cmd = ['docker', 'manifest', 'push', manifest_image]

    try:
        logger.info('Pushing manifest: %s', ' '.join(push_cmd))
        subprocess.run(push_cmd, check=True)
    except subprocess.CalledProcessError as e:
        logger.error('Error pushing manifest for %s: %s', image_name, e)
        raise

    # If requested, also push with latest tag
    if push_latest and tag != 'latest':
        latest_manifest_image = f'{image_path}:latest'
        create_latest_cmd = [
            'docker', 'manifest', 'create',
            latest_manifest_image,
            amd64_image,
            arm64_image
        ]
        if amend:
            create_latest_cmd.append('--amend')

        try:
            logger.info('Creating latest manifest: %s', ' '.join(create_latest_cmd))
            subprocess.run(create_latest_cmd, check=True)

            logger.info('Pushing latest manifest: docker manifest push %s', latest_manifest_image)
            subprocess.run(['docker', 'manifest', 'push', latest_manifest_image], check=True)
        except subprocess.CalledProcessError as e:
            logger.error('Error creating/pushing latest manifest for %s: %s', image_name, e)
            raise

    logger.info('Successfully created and pushed multi-arch manifest for %s:%s', image_name, tag)


def push_multiarch_manifests(registry_path, tag, images_to_process, push_latest=False, amend=False):
    """
    Helper function to create multiarch manifests for a list of images.

    Args:
        registry_path: The registry path (e.g., "nvcr.io/my_org/my_team")
        tag: The image tag to use
        images_to_process: List or set of image names to process
        push_latest: Whether to also push latest tags
        amend: Whether to amend the manifest

    Returns:
        List of failed image names (empty if all succeeded)
    """
    logger.info(
        'Creating multi-arch manifests for %d images with tag \'%s\'', len(images_to_process), tag)

    os.environ['DOCKER_CLI_EXPERIMENTAL'] = 'enabled'

    failed_images = []
    for image_name in sorted(images_to_process):
        try:
            create_multiarch_manifest(
                registry_path,
                image_name,
                tag,
                push_latest,
                amend
            )
        except subprocess.CalledProcessError as e:
            logger.error('Failed to create manifest for %s: %s', image_name, e)
            failed_images.append(image_name)

    return failed_images


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--registry_path', required=True,
                        help='The image registry path to push the image to, ie, '
                             '"nvcr.io/my_org/my_team"')
    parser.add_argument('--images', '-i',
                        nargs='+',
                        default=[],
                        help='List of images to create multi-arch manifests for')
    parser.add_argument('--tag', required=True,
                        help='The image tag to use for the manifests')
    parser.add_argument('--push_latest_tag', action='store_true',
                        help='If set, the latest tag of the manifest is pushed as well')
    parser.add_argument('--amend', action='store_true',
                        help='If set, the manifest is amended')
    parser.add_argument('--log-level', type=logging_utils.LoggingLevel.parse,
                        default=logging_utils.LoggingLevel.INFO)
    args = parser.parse_args()

    logger.setLevel(args.log_level)

    check_required_tools(['docker'])

    if not args.images:
        logger.error('ERROR: No images specified. Use --images to specify which images to process.')
        sys.exit(1)

    failed_images = push_multiarch_manifests(
        args.registry_path,
        args.tag,
        args.images,
        args.push_latest_tag,
        args.amend
    )

    if failed_images:
        logger.error(
            '\nERROR: Failed to create multi-arch manifests for %d images:', len(failed_images))
        for image_name in failed_images:
            logger.error('  - %s', image_name)
        sys.exit(1)

    logger.info('\nSuccessfully created multi-arch manifests for all %d images.', len(args.images))


if __name__ == '__main__':
    main()
