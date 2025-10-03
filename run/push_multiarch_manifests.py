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
import os
import subprocess
import sys
import urllib.parse


def create_multiarch_manifest(registry_path, image_name, tag, push_latest=False):
    """Create and push a multi-arch manifest for the given image."""
    image_path = urllib.parse.urljoin(registry_path + '/', image_name)

    amd64_image = f'{image_path}:{tag}-amd64'
    arm64_image = f'{image_path}:{tag}-arm64'
    manifest_image = f'{image_path}:{tag}'

    print(f'Creating multi-arch manifest for {image_path}:{tag}')
    print(f'  AMD64 image: {amd64_image}')
    print(f'  ARM64 image: {arm64_image}')

    create_cmd = [
        'docker', 'manifest', 'create',
        manifest_image,
        amd64_image,
        arm64_image
    ]

    try:
        print(f'Running: {" ".join(create_cmd)}')
        subprocess.run(create_cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f'Error creating manifest for {image_name}: {e}')
        raise

    push_cmd = ['docker', 'manifest', 'push', manifest_image]

    try:
        print(f'Pushing manifest: {" ".join(push_cmd)}')
        subprocess.run(push_cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f'Error pushing manifest for {image_name}: {e}')
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

        try:
            print(f'Creating latest manifest: {" ".join(create_latest_cmd)}')
            subprocess.run(create_latest_cmd, check=True)

            print(f'Pushing latest manifest: docker manifest push {latest_manifest_image}')
            subprocess.run(['docker', 'manifest', 'push', latest_manifest_image], check=True)
        except subprocess.CalledProcessError as e:
            print(f'Error creating/pushing latest manifest for {image_name}: {e}')
            raise

    print(f'Successfully created and pushed multi-arch manifest for {image_name}:{tag}')


def push_multiarch_manifests(registry_path, tag, images_to_process, push_latest=False):
    """
    Helper function to create multiarch manifests for a list of images.

    Args:
        registry_path: The registry path (e.g., "nvcr.io/my_org/my_team")
        tag: The image tag to use
        images_to_process: List or set of image names to process
        push_latest: Whether to also push latest tags

    Returns:
        List of failed image names (empty if all succeeded)
    """
    print(f"Creating multi-arch manifests for {len(images_to_process)} images with tag '{tag}'")

    os.environ['DOCKER_CLI_EXPERIMENTAL'] = 'enabled'

    failed_images = []
    for image_name in sorted(images_to_process):
        try:
            create_multiarch_manifest(
                registry_path,
                image_name,
                tag,
                push_latest
            )
        except subprocess.CalledProcessError as e:
            print(f'Failed to create manifest for {image_name}: {e}')
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
    args = parser.parse_args()

    if not args.images:
        print('ERROR: No images specified. Use --images to specify which images to process.')
        sys.exit(1)

    failed_images = push_multiarch_manifests(
        args.registry_path,
        args.tag,
        args.images,
        args.push_latest_tag
    )

    if failed_images:
        print(f'\nERROR: Failed to create multi-arch manifests for {len(failed_images)} images:')
        for image_name in failed_images:
            print(f'  - {image_name}')
        sys.exit(1)

    print(f'\nSuccessfully created multi-arch manifests for all {len(args.images)} images.')


if __name__ == '__main__':
    main()
