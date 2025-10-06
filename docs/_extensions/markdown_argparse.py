# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
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
Extension to properly handle sphinx-argparse option_list nodes in markdown output
"""

from sphinx_markdown_builder.translator import MarkdownTranslator
from sphinx_markdown_builder.contexts import SubContext, SubContextParams


class MarkdownArgparseTranslator(MarkdownTranslator):
    """Extended markdown translator that handles sphinx-argparse nodes"""

    def visit_option_list(self, node):
        """Start an option list in markdown"""
        self.ensure_eol(2)

    def depart_option_list(self, node):
        """End an option list in markdown"""
        self.ensure_eol(2)

    def visit_option_list_item(self, node):
        """Start an option list item in markdown"""
        self.add('* ', prefix_eol=1)
        self._push_context(SubContext(SubContextParams(0, 1)))

    def depart_option_list_item(self, node):
        """End an option list item in markdown"""
        self._pop_context()

    def visit_option_group(self, node):
        """Handle option group (the option names like -h, --help)"""
        self.add('**')

    def depart_option_group(self, node):
        """End option group"""
        self.add('**')

    def visit_option(self, node):
        """Handle individual option"""
        pass

    def depart_option(self, node):
        """End individual option"""
        pass

    def visit_option_string(self, node):
        """Handle option string (like -h or --help)"""
        pass

    def depart_option_string(self, node):
        """End option string"""
        pass

    def visit_option_argument(self, node):
        """Handle option argument (like <file>)"""
        self.add(' ')

    def depart_option_argument(self, node):
        """End option argument"""
        pass

    def visit_description(self, node):
        """Handle option description"""
        self.add(': ')

    def depart_description(self, node):
        """End option description"""
        pass


def setup(app):
    """Setup the extension"""
    # Override the markdown translator to handle argparse nodes
    app.set_translator('markdown', MarkdownArgparseTranslator)

    return {
        'parallel_read_safe': True,
        'parallel_write_safe': True,
    }
