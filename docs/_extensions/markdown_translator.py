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
Extension to extend the markdown translator to handle various Sphinx nodes
that don't have default markdown handlers, including:
- sphinx-argparse option_list nodes
- Admonitions (caution, tip, warning, note, etc.)
- sphinx_design PassthroughTextElement nodes (emojis, etc.)
"""

from docutils import nodes
from sphinx_markdown_builder.translator import MarkdownTranslator
from sphinx_markdown_builder.contexts import SubContext, SubContextParams, IndentContext


class ExtendedMarkdownTranslator(MarkdownTranslator):
    """Extended markdown translator that handles various Sphinx nodes"""

    # ========================================================================
    # Argparse option list handlers
    # ========================================================================

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

    # ========================================================================
    # Admonition handlers
    # ========================================================================

    def _visit_admonition(self, node, title):
        """Generic handler for admonitions"""
        self.ensure_eol(2)
        self.add(f'> **{title}**\n>\n')
        self._push_context(IndentContext("> "))

    def _depart_admonition(self, node):
        """Generic depart handler for admonitions"""
        self._pop_context()
        self.ensure_eol(2)

    def visit_note(self, node):
        """Handle note admonition"""
        self._visit_admonition(node, 'Note')

    def depart_note(self, node):
        """End note admonition"""
        self._depart_admonition(node)

    def visit_warning(self, node):
        """Handle warning admonition"""
        self._visit_admonition(node, 'Warning')

    def depart_warning(self, node):
        """End warning admonition"""
        self._depart_admonition(node)

    def visit_caution(self, node):
        """Handle caution admonition"""
        self._visit_admonition(node, 'Caution')

    def depart_caution(self, node):
        """End caution admonition"""
        self._depart_admonition(node)

    def visit_tip(self, node):
        """Handle tip admonition"""
        self._visit_admonition(node, 'Tip')

    def depart_tip(self, node):
        """End tip admonition"""
        self._depart_admonition(node)

    def visit_important(self, node):
        """Handle important admonition"""
        self._visit_admonition(node, 'Important')

    def depart_important(self, node):
        """End important admonition"""
        self._depart_admonition(node)

    def visit_danger(self, node):
        """Handle danger admonition"""
        self._visit_admonition(node, 'Danger')

    def depart_danger(self, node):
        """End danger admonition"""
        self._depart_admonition(node)

    def visit_attention(self, node):
        """Handle attention admonition"""
        self._visit_admonition(node, 'Attention')

    def depart_attention(self, node):
        """End attention admonition"""
        self._depart_admonition(node)

    def visit_hint(self, node):
        """Handle hint admonition"""
        self._visit_admonition(node, 'Hint')

    def depart_hint(self, node):
        """End hint admonition"""
        self._depart_admonition(node)

    def visit_error(self, node):
        """Handle error admonition"""
        self._visit_admonition(node, 'Error')

    def depart_error(self, node):
        """End error admonition"""
        self._depart_admonition(node)

    # ========================================================================
    # sphinx_design PassthroughTextElement handlers (for emojis, etc.)
    # ========================================================================

    def visit_PassthroughTextElement(self, node):
        """Handle passthrough text elements (like emojis from sphinx_design)"""
        # Extract and add the text content as-is
        if node.children:
            for child in node.children:
                if hasattr(child, 'astext'):
                    self.add(child.astext())
                elif isinstance(child, str):
                    self.add(child)
        raise nodes.SkipNode

    def depart_PassthroughTextElement(self, node):
        """End passthrough text element"""
        pass


def setup(app):
    """Setup the extension"""
    # Override the markdown translator to handle additional nodes
    app.set_translator('markdown', ExtendedMarkdownTranslator)

    return {
        'parallel_read_safe': True,
        'parallel_write_safe': True,
    }
