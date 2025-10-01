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

import shtab

from src.cli import main_parser


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--main',
                        required=True,
                        help='The path to the main script to run')
    parser.add_argument('--output_dir',
                        required=True,
                        help='The output directory for the "osmo" onedir')
    parser.add_argument('--add-data',
                        action='extend',
                        nargs='+',
                        help='The arguments to pass to PyInstaller')
    parser.add_argument('--additional-hooks',
                        action='extend',
                        nargs='+',
                        help='The additional hooks files to pass to PyInstaller')
    args = parser.parse_args()

    # Get the path to the runner directory
    runner_dir = os.getcwd()

    # Get the path to the main script
    main_path = os.path.join(runner_dir, args.main)

    # Create the arguments for the add data
    add_data_args = [
        f'--add-data={os.path.join(runner_dir, add_data_arg)}'
        for add_data_arg in args.add_data or []
    ]

    # Deduplicate hooks directories
    additional_hooks_dirs = set()
    if args.additional_hooks is not None:
        for additional_hook in args.additional_hooks:
            additional_hooks_dirs.add(os.path.dirname(additional_hook))

    # Create the arguments for the additional hooks directories
    additional_hooks_dir_args = [
        f'--additional-hooks-dir={os.path.join(runner_dir, additional_hooks_dir)}'
        for additional_hooks_dir in additional_hooks_dirs
    ]

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
            '-n', 'osmo-cli',
            '--python-option', 'u',  # Unbuffered output
            *add_data_args,
            *additional_hooks_dir_args,
            '--distpath', top_level_dir,
            '--target-arch=arm64',
            '--codesign-identity=-',  # Ad-hoc signing
            '--osx-bundle-identifier=com.nvidia.osmo',
            '--noupx',
            '--clean',
            '-y',
            '--log-level', 'WARN',
            f'{main_path}',
        ], env=env, check=True)

        parser = main_parser.create_cli_parser()
        with open(f'{top_level_dir}/autocomplete.bash', 'w', encoding='utf-8') as file:
            file.write(shtab.complete(parser, shell='bash'))

        with open(f'{top_level_dir}/autocomplete.zsh', 'w', encoding='utf-8') as file:
            file.write(shtab.complete(parser, shell='zsh'))


if __name__ == '__main__':
    main()
