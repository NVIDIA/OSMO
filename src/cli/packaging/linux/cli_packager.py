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
Builds a Linux client package.

Outputs a self-extracting script that installs the Linux client.
"""

import argparse
import logging
import os
import shutil
import stat
import tempfile

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--client_tarball_path',
                        help='The input path to the Linux client tarball.',
                        required=True)
    parser.add_argument('--installer_script_path',
                        help='The input path to the Linux client installer script.',
                        required=True)
    parser.add_argument('--cpu_arch',
                        choices=['x86_64', 'arm64'],
                        help='The CPU architecture of the Linux client.',
                        required=True)
    parser.add_argument('--output_path',
                        help='The output path for the Linux client installer script.',
                        required=True)
    args = parser.parse_args()

    client_tarball_path = args.client_tarball_path
    if not os.path.exists(client_tarball_path):
        raise FileNotFoundError(
            'osmo tarball does not exist at ' + client_tarball_path)

    installer_script_path = args.installer_script_path
    if not os.path.exists(installer_script_path):
        raise FileNotFoundError(
            'linux client installer script does not exist at ' + installer_script_path)

    with tempfile.NamedTemporaryFile(suffix='.sh') as temp_file:
        # Add install script
        with open(installer_script_path, 'rb') as f:
            temp_file.write(f.read())

        # Add archive marker
        temp_file.write(b'\n__ARCHIVE_BELOW__\n')

        # Add signed package
        with open(client_tarball_path, 'rb') as f:
            temp_file.write(f.read())

        shutil.copy(temp_file.name, args.output_path)

    # Set executable permissions
    st = os.stat(args.output_path)
    os.chmod(args.output_path, st.st_mode | stat.S_IEXEC)
    logger.info('Generated Linux client installer script: %s', args.output_path)


if __name__ == '__main__':
    main()
