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
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--main',
                        required=True,
                        help='The path to the main script to run')
    parser.add_argument('--output_dir',
                        required=True,
                        help='The output directory for the "osmo" onedir')
    args = parser.parse_args()

    # Get the path to the main script
    main_path = os.path.join(os.getcwd(), args.main)

    with tempfile.TemporaryDirectory() as config_dir:
        env = os.environ.copy()

        # Enables sandboxing of pyinstaller for concurrent builds
        env['PYINSTALLER_CONFIG_DIR'] = config_dir

        top_level_dir = f'{args.output_dir}/osmo'
        os.makedirs(top_level_dir, exist_ok=True)

        subprocess.run([
            sys.executable,
            '-OO',  # Python optimization (removes assert + docstrings)
            '-m', 'PyInstaller',
            '-n', 'osmo-init',
            '--distpath', top_level_dir,
            '--noupx',
            '--log-level', 'WARN',
            f'{main_path}',
        ], env=env, check=True)


if __name__ == '__main__':
    main()
