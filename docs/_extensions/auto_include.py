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
auto-include directive for Sphinx.
Allows including files using glob patterns that may or may not exist.
"""

import os
import glob
from docutils import nodes
from docutils.parsers.rst import Directive, directives
from sphinx.util import logging
from docutils.parsers.rst.directives.misc import Include

logger = logging.getLogger(__name__)


class AutoInclude(Directive):
    """
    Directive to include files matching a glob pattern.

    Usage:
        .. auto-include:: *.in.rst

        .. auto-include:: *.in.rst
           :exclude: data.in.rst workflow.in.rst
    """
    required_arguments = 1  # The glob pattern
    has_content = False
    option_spec = {
        'exclude': directives.unchanged,  # Space-separated list of files to exclude
    }

    def run(self):
        env = self.state.document.settings.env
        pattern = self.arguments[0]
        exclude_patterns = self.options.get('exclude', '').split()

        # Get the directory of the current document
        docdir = os.path.dirname(env.doc2path(env.docname))
        # Resolve docdir through symlinks to get canonical path
        docdir_real = os.path.realpath(docdir)

        # Get the docs root directory as the security boundary
        docs_root = os.path.realpath(env.srcdir)

        # Get the current document's path to exclude it automatically
        current_doc_path = env.doc2path(env.docname)

        # Validate and normalize the pattern to prevent directory traversal
        if os.path.isabs(pattern):
            error = self.state_machine.reporter.error(
                f'Absolute paths are not allowed in patterns: "{pattern}"',
                nodes.literal_block('', ''),
                line=self.lineno
            )
            return [error]

        # Resolve the glob pattern
        full_pattern = os.path.join(docdir, pattern)
        matched_files = sorted(glob.glob(full_pattern, recursive=True), reverse=True)

        # Verify all matched files are within docs_root after resolving symlinks
        verified_files = []
        for filepath in matched_files:
            filepath_real = os.path.realpath(filepath)
            # Check if the resolved path is truly inside docs_root using explicit prefix check
            try:
                # File must be exactly docs_root or start with docs_root + separator
                if filepath_real == docs_root or filepath_real.startswith(docs_root + os.sep):
                    verified_files.append(filepath)
                else:
                    # File is outside docs root, skip it
                    logger.warning(f'Skipping file outside documentation directory: {filepath}')
            except OSError:
                # OSError: file doesn't exist or permission issue
                logger.warning(f'Skipping inaccessible file: {filepath}')

        matched_files = verified_files

        # Automatically exclude the current document to prevent self-inclusion
        current_doc_real = os.path.realpath(current_doc_path)
        matched_files = [f for f in matched_files if os.path.realpath(f) != current_doc_real]

        # Filter out excluded files (with same security checks)
        if exclude_patterns:
            excluded_files = set()
            for excl_pattern in exclude_patterns:
                # Apply same validation to exclude patterns
                excl_normalized = excl_pattern.replace('\\', '/')
                excl_parts = excl_normalized.split('/')
                if os.path.isabs(excl_pattern):
                    logger.warning(f'Skipping invalid exclude pattern: {excl_pattern}')
                    continue

                excl_full = os.path.join(docdir, excl_pattern)
                excl_matches = glob.glob(excl_full, recursive=True)

                # Verify excluded files are also within docs_root
                for excl_file in excl_matches:
                    excl_file_real = os.path.realpath(excl_file)
                    try:
                        if excl_file_real == docs_root or excl_file_real.startswith(docs_root + os.sep):
                            excluded_files.add(excl_file)
                    except OSError:
                        pass

                # If no glob match, treat as exact filename (also verify)
                if not excl_matches:
                    try:
                        excl_real = os.path.realpath(excl_full)
                        if excl_real == docs_root or excl_real.startswith(docs_root + os.sep):
                            # Use the original path for exclusion to match the glob results
                            if os.path.exists(excl_full):
                                excluded_files.add(excl_full)
                    except OSError:
                        pass

            matched_files = [f for f in matched_files if f not in excluded_files]

        if not matched_files:
            # No files matched - silently return empty
            return []

        # Directly instantiate and run Sphinx's Include directive for each file
        # This ensures identical behavior to manually written include directives
        result_nodes = []

        for filepath in matched_files:
            # Get relative path from docdir for the include directive
            rel_path = os.path.relpath(filepath, docdir)

            try:
                # Create an Include directive instance with the relative path
                include_directive = Include(
                    name='include',
                    arguments=[rel_path],
                    options={},
                    content=[],
                    lineno=self.lineno,
                    content_offset=self.content_offset,
                    block_text='',
                    state=self.state,
                    state_machine=self.state_machine
                )

                # Run the directive and collect its nodes
                nodes_from_include = include_directive.run()
                result_nodes.extend(nodes_from_include)

            except Exception as exc:
                error = self.state_machine.reporter.error(
                    f'Problems including file "{rel_path}": {exc}',
                    nodes.literal_block('', ''),
                    line=self.lineno
                )
                result_nodes.append(error)

        return result_nodes


def setup(app):
    app.add_directive('auto-include', AutoInclude)

    return {
        'version': '0.1',
        'parallel_read_safe': True,
        'parallel_write_safe': True,
    }
