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
from docutils.statemachine import StringList
from sphinx.util import logging

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
        matched_files = sorted(glob.glob(full_pattern, recursive=True))

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

        # Collect nodes from all matched files
        result_nodes = []

        # Process each matched file
        for filepath in matched_files:
            rel_path = os.path.relpath(filepath, docdir)

            try:
                # Read the file content
                with open(filepath, 'r', encoding='utf-8') as f:
                    include_lines = f.read().splitlines()

                # Skip leading RST comment blocks (like copyright headers)
                # Comments start with ".." and continue on indented lines
                start_idx = 0
                in_comment = False
                for i, line in enumerate(include_lines):
                    stripped = line.lstrip()
                    # Check if this is a comment start (.. followed by whitespace or nothing on same line)
                    if stripped.startswith('..') and (len(stripped) == 2 or stripped[2:3].isspace()):
                        in_comment = True
                    elif in_comment:
                        # Comments continue on indented lines or empty lines
                        if line and not line[0].isspace() and stripped:
                            # First non-indented, non-empty line after comment
                            start_idx = i
                            break
                    elif stripped:
                        # First content line (not a comment)
                        start_idx = i
                        break

                include_lines = include_lines[start_idx:]

                # Create a StringList from the included lines for parsing
                string_list = StringList(include_lines, source=filepath)

                # Create a container node to hold the parsed content
                container = nodes.container()
                container['classes'].append('auto-include-content')

                # Parse the content synchronously in the current state's context
                # This makes the nodes immediately available for parent directive validation
                self.state.nested_parse(string_list, self.content_offset, container)

                # Extract and return the children nodes (not the container itself)
                # This makes it as if the content was written directly in the parent file
                result_nodes.extend(container.children)

            except Exception as exc:
                error = self.state_machine.reporter.error(
                    f'Problems including file "{rel_path}": {exc}',
                    nodes.literal_block('', ''),
                    line=self.lineno
                )
                result_nodes.append(error)

        return result_nodes


def _strip_rst_comments(file_lines):
    """
    Strip leading RST comment blocks (like copyright headers) from file lines.

    RST comments start with ".." followed by indented content, and can be 
    closed with another "..". This function finds the index where real 
    content begins.

    Args:
        file_lines: List of strings representing file lines

    Returns:
        int: The index of the first line of real content
    """
    start_idx = 0
    in_comment = False

    for j, line in enumerate(file_lines):
        stripped = line.lstrip().rstrip()  # Remove trailing whitespace too

        # Check if this is a comment marker: ".." with ONLY whitespace after (or nothing)
        is_comment_marker = (stripped.startswith('..') and
                             (len(stripped) == 2 or stripped[2:].strip() == ''))

        # Check if this starts or continues a comment block
        if not in_comment:
            # Look for comment start: ".." with nothing or only whitespace after
            if is_comment_marker:
                in_comment = True
                continue
            elif stripped:
                # First real content (not a comment)
                start_idx = j
                break
        else:
            # We're in a comment block
            if not stripped:
                # Empty line, continue
                continue
            elif line[0].isspace():
                # Indented line, part of comment
                continue
            elif is_comment_marker:
                # Another ".." marker (comment closer)
                # Skip it and any following blank lines
                continue
            else:
                # Non-indented, non-comment, non-blank line - real content starts here
                start_idx = j
                break

    return start_idx


def _process_single_directive(match, lines, current_idx, srcdir):
    """
    Process a single auto-include directive by parsing options, matching files,
    applying exclusions, reading file contents, and formatting with indentation.

    Args:
        match: Regex match object containing directive information
        lines: List of all source file lines
        current_idx: Index of the current directive line
        srcdir: Source directory path for resolving file patterns

    Returns:
        tuple: (processed_lines, next_line_index) where processed_lines contains
               the formatted content to replace the directive, and next_line_index
               is the index of the next line to process after this directive
    """
    indent = match.group(1)
    file_pattern = match.group(2).strip()

    # Start from the line after the directive
    i = current_idx + 1

    # Parse option lines (lines starting with more indentation + :)
    exclude_patterns = []
    while i < len(lines):
        line_stripped = lines[i].strip()
        if line_stripped.startswith(':') and len(lines[i]) - len(lines[i].lstrip()) > len(indent):
            # Parse the option
            if line_stripped.startswith(':exclude:'):
                # Extract the exclude patterns (space-separated list after :exclude:)
                exclude_value = line_stripped[9:].strip()  # Remove ':exclude:'
                if exclude_value:
                    exclude_patterns = exclude_value.split()
            i += 1
        elif not line_stripped:
            i += 1
        else:
            break

    processed_lines = []

    # Find matching files
    if not os.path.isabs(file_pattern):
        full_pattern = os.path.join(srcdir, file_pattern)
        matched_files = sorted(glob.glob(full_pattern, recursive=True))

        # Apply exclusions
        if exclude_patterns:
            excluded_files = set()
            for excl_pattern in exclude_patterns:
                if not os.path.isabs(excl_pattern):
                    excl_full = os.path.join(srcdir, excl_pattern)
                    excl_matches = glob.glob(excl_full, recursive=True)
                    excluded_files.update(excl_matches)
                    # If no glob match, treat as exact filename
                    if not excl_matches and os.path.exists(excl_full):
                        excluded_files.add(excl_full)

            matched_files = [f for f in matched_files if f not in excluded_files]

        # Include each matched file's content with proper indentation
        for filepath in matched_files:
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    include_lines = f.readlines()

                # Strip leading RST comments (like copyright headers)
                start_idx = _strip_rst_comments(include_lines)

                # Add indented content
                for line in include_lines[start_idx:]:
                    if line.strip():
                        processed_lines.append(indent + line)
                    else:
                        processed_lines.append(line)

                # Add a blank line after the included content to ensure proper RST spacing
                # This prevents "Explicit markup ends without a blank line" warnings
                if processed_lines and processed_lines[-1].strip():
                    processed_lines.append('\n')

            except Exception as e:
                logger.warning(f'Failed to include {filepath}: {e}')

    return processed_lines, i


def process_auto_includes(app, docname, source):
    """
    Process auto-include directives in the source before parsing.
    This ensures included content is available when parent directives execute.
    """
    import re

    content = source[0]
    srcdir = os.path.dirname(app.env.doc2path(docname))

    # Pattern to match auto-include directives
    # Captures the indentation, pattern, and any options
    pattern = r'^(\s*)\.\.\ auto-include::\ +(.+?)$'

    lines = content.splitlines(keepends=True)
    result_lines = []
    i = 0

    while i < len(lines):
        match = re.match(pattern, lines[i])
        if match:
            # Process this directive and get the included content
            processed_lines, next_idx = _process_single_directive(match, lines, i, srcdir)
            result_lines.extend(processed_lines)
            i = next_idx
        else:
            result_lines.append(lines[i])
            i += 1

    new_source = ''.join(result_lines)
    if new_source != content:
        source[0] = new_source


def setup(app):
    # Register the source-read event handler to process includes before parsing
    # This happens before RST parsing, ensuring included content is available
    # when parent directives execute
    app.connect('source-read', process_auto_includes)

    # Keep the directive registered but it will be processed by source-read
    app.add_directive('auto-include', AutoInclude)

    return {
        'version': '0.1',
        'parallel_read_safe': True,
        'parallel_write_safe': False,  # source-read modifies source
    }
