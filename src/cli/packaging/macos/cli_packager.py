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
Builds an unsigned macOS client package.

IMPORTANT: This script can *ONLY* be used from a MacOS machine.
"""

import argparse
import logging
import os
import sys
import subprocess
import tarfile
import tempfile
import shutil

from src.lib.utils import version


OUTPUT_PKG = 'osmo-client-macos-unsigned.pkg'
WORKING_DIR = 'osmo-cli'

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _codesign(working_dir: str, entitlement_path: str) -> None:
    """
    Uses the provided entitlements.plist to codesign osmo-cli libraries and binary.
    """
    codesign_cmd = [
        'codesign',
        '--force',
        '--deep',
        '--sign',
        '-',
        '--entitlements',
        entitlement_path,
    ]
    subprocess.run(
        ['find', working_dir, '-name', '"*.so"', '-exec'] + codesign_cmd + ['{}', ';'],
        text=True,
        check=True,
        stdout=sys.stdout,
        stderr=subprocess.STDOUT,
    )
    subprocess.run(
        ['find', working_dir, '-name', '"*.dylib"', '-exec'] + codesign_cmd + ['{}', ';'],
        text=True,
        check=True,
        stdout=sys.stdout,
        stderr=subprocess.STDOUT,
    )

    binary_path = os.path.join(working_dir, 'osmo', 'osmo-cli', 'osmo-cli')
    if not os.path.exists(binary_path):
        raise FileNotFoundError(
            'osmo-cli binary not found at path ' + binary_path)

    subprocess.run(
        codesign_cmd + [binary_path],
        text=True,
        check=True,
        stdout=sys.stdout,
        stderr=subprocess.STDOUT,
    )


def _build_installer(working_dir: str, scripts_dir: str) -> str:
    """
    Given an existing osmo-cli directory, create a component package and installer for MacOS.
    """
    # Save output one level up (to avoid polluting pkgbuild --root location)
    parent_dir = os.path.dirname(working_dir)
    output_pkg_path = os.path.join(parent_dir, OUTPUT_PKG)

    version_obj = version.VERSION
    version_str = f'{version_obj.major}.{version_obj.minor}.{version_obj.revision}'

    subprocess.run(
        [
            'pkgbuild',
            '--root', working_dir,
            '--identifier', 'com.nvidia.osmo',
            '--version', version_str,
            '--install-location', '/usr/local/',
            '--scripts', scripts_dir,
            output_pkg_path,
        ],
        text=True,
        check=True,
        stdout=sys.stdout,
        stderr=subprocess.STDOUT,
    )

    subprocess.run(
        [
            'productbuild',
            '--synthesize',
            '--package',
            output_pkg_path,
            'Distribution',
        ],
        text=True,
        check=True,
        stdout=sys.stdout,
        stderr=subprocess.STDOUT,
    )

    return output_pkg_path


def _build_package(
    input_tar_path: str,
    tmp_dir: str,
    entitlement_path: str,
    preinstall_script_path: str,
    postinstall_script_path: str,
) -> str:
    """
    Given a tarball of osmo-cli, generate a locally codesigned MacOS package installer.
    """
    working_dir = os.path.join(tmp_dir, WORKING_DIR)

    # Setup scripts directory for pkgbuild
    scripts_dir = os.path.join(tmp_dir, 'scripts')
    os.makedirs(scripts_dir, exist_ok=True)

    # Copy both scripts and make them executable
    shutil.copy(preinstall_script_path, os.path.join(scripts_dir, 'preinstall'))
    shutil.copy(postinstall_script_path, os.path.join(scripts_dir, 'postinstall'))
    os.chmod(os.path.join(scripts_dir, 'preinstall'), 0o755)
    os.chmod(os.path.join(scripts_dir, 'postinstall'), 0o755)

    with tarfile.open(input_tar_path, 'r') as tar:
        tar.extractall(working_dir)

    _codesign(working_dir, entitlement_path)

    return _build_installer(working_dir, scripts_dir)


def main():
    # Parse and validate input flags
    parser = argparse.ArgumentParser()
    parser.add_argument('--input_tar_path',
                        help='The input path to the macOS client tarball.',
                        required=True)
    parser.add_argument('--entitlement_path',
                        help='The input path to the macOS client entitlement file.',
                        required=True)
    parser.add_argument('--preinstall_script_path',
                        help='The input path to the preinstall script.',
                        required=True)
    parser.add_argument('--postinstall_script_path',
                        help='The input path to the postinstall script.',
                        required=True)
    parser.add_argument('--output_path',
                        help='The output path for the macOS client package.',
                        required=True)
    args = parser.parse_args()

    input_tar_path = args.input_tar_path
    if not os.path.exists(input_tar_path):
        raise FileNotFoundError(
            'osmo tarball does not exist at ' + input_tar_path)

    entitlement_path = args.entitlement_path
    if not os.path.exists(entitlement_path):
        raise FileNotFoundError(
            'entitlement file does not exist at ' + entitlement_path)

    preinstall_script_path = args.preinstall_script_path
    if not os.path.exists(preinstall_script_path):
        raise FileNotFoundError(
            'Preinstall script does not exist at ' + preinstall_script_path)

    postinstall_script_path = args.postinstall_script_path
    if not os.path.exists(postinstall_script_path):
        raise FileNotFoundError(
            'Postinstall script does not exist at ' + postinstall_script_path)

    with tempfile.TemporaryDirectory() as tmp_dir:
        built_package_path = _build_package(
            input_tar_path,
            tmp_dir,
            entitlement_path,
            preinstall_script_path,
            postinstall_script_path,
        )
        shutil.copy(built_package_path, args.output_path)
        logger.info('Generated unsigned package: %s', args.output_path)


if __name__ == '__main__':
    main()
