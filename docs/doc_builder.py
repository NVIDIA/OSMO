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
import tempfile

import sphinx.cmd.build as sphinx_build


def main():
    # Parse arguments
    parser = argparse.ArgumentParser()
    parser.add_argument('path', help='Path where the docs lie.')
    parser.add_argument('--output_dir',
                        required=True,
                        help='Output path of the generated docs.')
    parser.add_argument('--doctree_dir',
                        help='Intermediate doctree directory, useful for incremental builds.',
                        default='/tmp/doctree')
    parser.add_argument('--additional_dir',
                        help='Path to the additional docs.',
                        default='')

    args = parser.parse_args()

    temp_dir = ''
    docs_path = args.path
    if args.additional_dir:
        # Create a temporary directory for merged docs
        temp_dir = tempfile.mkdtemp()
        docs_path = os.path.join(temp_dir, 'merged_docs')
        shutil.copytree(os.path.dirname(args.path), temp_dir, dirs_exist_ok=True)
        shutil.copytree(args.path, docs_path, dirs_exist_ok=True)
        # Then copy additional docs on top (this will overwrite external docs with additional ones)
        shutil.copytree(args.additional_dir, docs_path, dirs_exist_ok=True)

    # Create doctree directory if it doesn't exist
    if not os.path.exists(args.doctree_dir):
        print(f'Creating doctree directory: {args.doctree_dir}')
        os.makedirs(args.doctree_dir, exist_ok=True)
    else:
        print(f'Reusing doctree directory: {args.doctree_dir}')

    # Build docs
    html_args = ['-b', 'html', '-d', args.doctree_dir,
                 docs_path, args.output_dir]
    markdown_args = ['-b', 'markdown', '-d', args.doctree_dir,
                     docs_path, args.output_dir]
    exit_code = sphinx_build.main(html_args)
    sphinx_build.main(markdown_args)
    if args.additional_dir:
        shutil.rmtree(temp_dir, ignore_errors=True)
    raise SystemExit(exit_code)


if __name__ == '__main__':
    main()
