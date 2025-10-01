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
import os
import shutil
import sys

DATA_LOCATION = '/osmo/data'
LOGIN_LOCATION = '/osmo/login'
USER_BIN_LOCATION = '/osmo/usr/bin'
RUN_LOCATION = '/osmo/run'


def main(data_location: str,
         login_location: str,
         user_bin_location: str,
         run_location: str,
         enable_rsync: bool):
    # Check for non-empty content in DATA_LOCATION excluding lost+found
    content = [item for item in os.listdir(
        data_location) if item != 'lost+found']
    if content:
        sys.exit(0)

    # Copy /osmo to /osmo_binaries
    os.makedirs(os.path.join('/osmo_binaries', 'osmo'), exist_ok=True)
    shutil.copyfile('/osmo/osmo_ctrl', '/osmo_binaries/osmo/osmo_ctrl')
    shutil.copyfile('/osmo/osmo_exec', '/osmo_binaries/osmo/osmo_exec')
    os.chmod(os.path.join('/osmo_binaries', 'osmo', 'osmo_ctrl'), 0o777)
    os.chmod(os.path.join('/osmo_binaries', 'osmo', 'osmo_exec'), 0o777)

    # Create necessary directories
    os.makedirs(os.path.join(data_location, 'benchmarks'), exist_ok=True)
    os.makedirs(os.path.join(data_location, 'input'), exist_ok=True)
    os.makedirs(os.path.join(data_location, 'output'), exist_ok=True)
    os.makedirs(os.path.join(data_location, 'socket'), exist_ok=True)

    # Set permissions
    os.chmod(os.path.join(data_location, 'benchmarks'), 0o777)
    os.chmod(os.path.join(data_location, 'input'), 0o777)
    os.chmod(os.path.join(data_location, 'output'), 0o777)
    os.chmod(os.path.join(data_location, 'socket'), 0o777)

    # OSMO CLI Initialization
    cli_dir = os.path.join(user_bin_location, 'osmo_cli')
    shutil.copytree('/osmo/osmo_cli_onedir', cli_dir)
    os.chmod(cli_dir, 0o777)

    # Calculate relative path from osmo symlink to actual osmo-cli binary
    osmo_cli_bin = os.path.join(cli_dir, 'osmo', 'osmo-cli', 'osmo-cli')
    relative_path = os.path.relpath(osmo_cli_bin, user_bin_location)
    os.symlink(relative_path, os.path.join(user_bin_location, 'osmo'))

    # Copy CLI login config for ctrl
    ctrl_config_path = os.path.join(login_location, 'ctrl', 'config')
    os.makedirs(ctrl_config_path, exist_ok=True)
    os.chmod(ctrl_config_path, 0o777)
    shutil.copy('/osmo/login.yaml',
                os.path.join(ctrl_config_path, 'login.yaml'))
    os.chmod(os.path.join(ctrl_config_path, 'login.yaml'), 0o777)

    # Copy CLI login and data config for user
    user_config_path = os.path.join(login_location, 'user', 'config')
    os.makedirs(user_config_path, exist_ok=True)
    os.chmod(user_config_path, 0o777)
    shutil.copy('/osmo/login.yaml',
                os.path.join(user_config_path, 'login.yaml'))
    os.chmod(os.path.join(user_config_path, 'login.yaml'), 0o777)
    shutil.copy('/osmo/user_config.yaml',
                os.path.join(user_config_path, 'config.yaml'))
    os.chmod(os.path.join(user_config_path, 'config.yaml'), 0o777)

    # Setup user workspace directory
    os.makedirs(os.path.join(run_location, 'workspace'), exist_ok=True)
    os.chmod(os.path.join(run_location, 'workspace'), 0o777)

    if enable_rsync:
        # Setup rsync binary
        shutil.copyfile(
            '/osmo/rsync', os.path.join(user_bin_location, 'rsync'))
        os.chmod(os.path.join(user_bin_location, 'rsync'), 0o755)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data_location', default=DATA_LOCATION)
    parser.add_argument('--login_location', default=LOGIN_LOCATION)
    parser.add_argument('--user_bin_location', default=USER_BIN_LOCATION)
    parser.add_argument('--run_location', default=RUN_LOCATION)
    parser.add_argument('--enable_rsync', action='store_true')
    args = parser.parse_args()

    try:
        main(data_location=args.data_location,
             login_location=args.login_location,
             user_bin_location=args.user_bin_location,
             run_location=args.run_location,
             enable_rsync=args.enable_rsync)
    except Exception as e:  # pylint: disable=broad-except
        print(f'Error initializing OSMO: {e}')
        sys.exit(1)
