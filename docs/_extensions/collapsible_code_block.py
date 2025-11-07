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
Sphinx extension for collapsible code blocks with nested collapsible sections.

This extension provides a `collapsible-code-block` directive that supports
nested `collapsible` sub-directives for creating expandable/collapsible
sections within syntax-highlighted code blocks.
"""

import re
from typing import List, Dict, Any
from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.application import Sphinx
from sphinx.util.docutils import SphinxDirective
from sphinx.util.logging import getLogger
from sphinx.writers.html5 import HTML5Translator
from pygments import highlight
from pygments.lexers import get_lexer_by_name, TextLexer
from pygments.formatters import HtmlFormatter

LOGGER = getLogger(__name__)


# Custom node classes
class collapsible_code_block(nodes.General, nodes.Element):
    """Container node for the entire collapsible code block."""
    pass


class collapsible_section(nodes.General, nodes.Element):
    """Node representing a collapsible region within the code block."""
    pass


class code_line(nodes.General, nodes.Element):
    """Node representing a single line of code."""
    pass


class CollapsibleCodeBlock(SphinxDirective):
    """
    Directive for creating collapsible code blocks.

    Usage:
        .. collapsible-code-block:: yaml

           code here
           .. collapsible: Label Text
              :indent: 1
              :open:

              collapsible content
           more code
    """

    has_content = True
    required_arguments = 1  # language
    optional_arguments = 0
    final_argument_whitespace = False
    option_spec = {
        'linenos': directives.flag,
        'emphasize-lines': directives.unchanged,
        'caption': directives.unchanged,
        'name': directives.unchanged,
    }

    def run(self) -> List[nodes.Node]:
        """Run the directive."""
        self.assert_has_content()

        language = self.arguments[0]

        # Create the main container node
        container = collapsible_code_block()
        container['language'] = language
        container['options'] = self.options.copy()

        # Parse the content for collapsible sections
        parsed_content = self.parse_collapsible_content(list(self.content), 0)

        # Store parsed content in the container
        container['parsed_content'] = parsed_content

        self.set_source_info(container)
        return [container]

    def parse_collapsible_content(self, lines: List[str], base_indent: int) -> List[Dict[str, Any]]:
        """
        Parse content for collapsible directives recursively.

        Args:
            lines: List of content lines
            base_indent: Base indentation level

        Returns:
            List of parsed elements (text lines or collapsible sections)
        """
        result = []
        i = 0

        while i < len(lines):
            line = lines[i]

            # Check for collapsible directive: ".. collapsible::"
            match = re.match(r'^(\s*)\.\.\s+collapsible::\s*(.*)$', line)
            if match:
                directive_indent = len(match.group(1))
                label = match.group(2).strip()

                # Parse options on following lines
                i += 1
                options = {'indent': 0, 'open': False}

                while i < len(lines):
                    option_line = lines[i]
                    stripped = option_line.strip()

                    if not stripped:
                        i += 1
                        continue

                    # Check if this is an option line
                    if stripped.startswith(':'):
                        if stripped == ':open:':
                            options['open'] = True
                        elif stripped.startswith(':indent:'):
                            indent_match = re.match(r':indent:\s*(\d+)', stripped)
                            if indent_match:
                                options['indent'] = int(indent_match.group(1))
                        i += 1
                    else:
                        # First non-option line, this is content
                        break

                # Extract collapsible content (indented relative to directive)
                content_lines = []
                
                while i < len(lines):
                    content_line = lines[i]
                    
                    # Handle empty lines - only include if followed by more content
                    if not content_line.strip():
                        # Look ahead to see if there's more indented content
                        j = i + 1
                        has_more_content = False
                        while j < len(lines):
                            if lines[j].strip():  # Found non-empty line
                                next_indent = len(lines[j]) - len(lines[j].lstrip())
                                if next_indent > directive_indent:
                                    has_more_content = True
                                break
                            j += 1
                        
                        if has_more_content:
                            content_lines.append(content_line)
                            i += 1
                            continue
                        else:
                            # Empty line(s) followed by non-content, stop here
                            break
                    
                    # Check indentation - content must be indented more than directive
                    line_indent = len(content_line) - len(content_line.lstrip())
                    
                    if line_indent > directive_indent:
                        content_lines.append(content_line)
                        i += 1
                    else:
                        # Content ended - line at or before directive indent
                        break

                # Recursively parse the collapsible content
                # Pass the expected base indent for content (directive + 2 for RST block indent)
                content_base = directive_indent + 2
                nested_content = self.parse_collapsible_content(content_lines, content_base)
                
                result.append({
                    'type': 'collapsible',
                    'label': label,
                    'options': options,
                    'content': nested_content,
                    'directive_indent': directive_indent,
                    'content_base_indent': content_base  # Store for later use
                })
            else:
                # Regular code line
                result.append({
                    'type': 'line',
                    'text': line
                })
                i += 1

        return result


def visit_collapsible_code_block(self: HTML5Translator, node: collapsible_code_block):
    """Visitor for collapsible code block nodes."""
    from . import code_annotations
    
    language = node['language']
    parsed_content = node['parsed_content']
    
    # Get the raw code text (without collapsible directives) for syntax highlighting
    raw_code = extract_raw_code(parsed_content)
    
    # Apply syntax highlighting
    try:
        lexer = get_lexer_by_name(language)
    except Exception:
        lexer = TextLexer()
    
    formatter = HtmlFormatter(nowrap=True)
    highlighted_html = highlight(raw_code, lexer, formatter)
    
    # Split highlighted HTML into lines
    highlighted_lines = highlighted_html.rstrip('\n').split('\n')
    
    # Check if there's an annotations list following this node
    next_element = node.next_node(nodes.Element, siblings=True, descend=False)
    has_annotations = isinstance(next_element, code_annotations.annotations_list)
    
    # Generate HTML with collapsible structure
    self.body.append('<div class="collapsible-code-block highlight-%s notranslate">' % language)
    
    # If there are annotations, add the annotate class
    if has_annotations:
        self.body.append('<div class="annotate highlight"><pre>')
    else:
        self.body.append('<div class="highlight"><pre>')
    
    # Process content and inject collapsible structure
    line_index = [0]  # Use list to make it mutable in nested function
    render_content(self, parsed_content, highlighted_lines, line_index, 0)
    
    self.body.append('</pre></div>')
    
    # Handle code annotations if present
    if has_annotations:
        next_element.children[0].walkabout(self)
        next_element['used'] = True
    
    self.body.append('</div>')
    
    raise nodes.SkipNode()


def extract_raw_code(parsed_content: List[Dict[str, Any]], base_strip_indent: int = 0) -> str:
    """
    Extract raw code text from parsed content, removing directive markers.
    
    Args:
        parsed_content: Parsed content structure
        base_strip_indent: Base indentation to strip from content lines
        
    Returns:
        Raw code as string
    """
    lines = []
    
    for item in parsed_content:
        if item['type'] == 'line':
            text = item['text']
            # Strip base indentation if applicable
            if base_strip_indent > 0 and text.startswith(' ' * base_strip_indent):
                text = text[base_strip_indent:]
            lines.append(text)
        elif item['type'] == 'collapsible':
            # Add the label as a line of code
            directive_indent = item['directive_indent']
            indent_option = item['options']['indent']
            label = item['label']
            
            # Adjust directive_indent if we're stripping base indent
            adjusted_directive_indent = max(0, directive_indent - base_strip_indent)
            
            # The label should appear exactly where the directive starts (after stripping)
            label_line = ' ' * adjusted_directive_indent + label
            lines.append(label_line)
            
            # For nested content, strip based on where the content actually starts in RST
            content_base_indent = directive_indent + 2
            
            # Recursively extract code from nested content
            nested_code = extract_raw_code(item['content'], content_base_indent)
            if nested_code:
                # Split nested code into lines and add each line
                for nested_line in nested_code.split('\n'):
                    if nested_line.strip():  # Non-empty lines
                        # Add the adjusted directive position plus indent option
                        lines.append(' ' * (adjusted_directive_indent + indent_option) + nested_line)
                    else:  # Empty lines stay empty
                        lines.append(nested_line)
    
    return '\n'.join(lines)


def render_content(
    translator: HTML5Translator,
    parsed_content: List[Dict[str, Any]],
    highlighted_lines: List[str],
    line_index: List[int],
    nesting_level: int
):
    """
    Render parsed content as HTML with collapsible sections.

    Args:
        translator: HTML translator instance
        parsed_content: Parsed content structure
        highlighted_lines: Pre-highlighted code lines
        line_index: Current line index (mutable)
        nesting_level: Current nesting depth
    """
    import hashlib

    for item in parsed_content:
        if item['type'] == 'line':
            # Regular code line
            if line_index[0] < len(highlighted_lines):
                line_html = highlighted_lines[line_index[0]]
                translator.body.append(line_html + '\n')
                line_index[0] += 1

        elif item['type'] == 'collapsible':
            # Collapsible section
            label = item['label']
            options = item['options']
            is_open = options['open']
            indent_value = options['indent']

            # Generate unique ID for this collapsible
            unique_id = hashlib.md5(
                f"{label}_{line_index[0]}_{nesting_level}".encode()
            ).hexdigest()[:8]

            # The label line in highlighted code
            if line_index[0] < len(highlighted_lines):
                label_html = highlighted_lines[line_index[0]]
                line_index[0] += 1
            else:
                label_html = ''

            # Create collapsible wrapper
            open_class = ' open' if is_open else ''
            
            translator.body.append(
                f'<div class="collapsible-wrapper{open_class}" '
                f'data-indent="{indent_value}" data-collapsible-id="{unique_id}">'
            )
            
            # Label line with toggle button positioned to the right
            translator.body.append('<span class="collapsible-line">')
            translator.body.append(label_html)
            # Button will be populated by JavaScript with the appropriate icon
            translator.body.append(
                f'<button class="collapsible-toggle" '
                f'onclick="toggleCollapsible(\'{unique_id}\')" '
                f'aria-expanded="{str(is_open).lower()}" '
                f'aria-label="Toggle collapsible section"></button>'
            )
            translator.body.append('</span>\n')

            # Collapsible content
            translator.body.append(
                f'<div class="collapsible-content" id="content-{unique_id}">')

            # Recursively render nested content
            render_content(translator, item['content'],
                           highlighted_lines, line_index, nesting_level + 1)

            translator.body.append('</div>')  # Close collapsible-content
            translator.body.append('</div>')  # Close collapsible-wrapper


def depart_collapsible_code_block(self: HTML5Translator, node: collapsible_code_block):
    """Depart visitor - not needed as we handle everything in visit."""
    pass


def visit_collapsible_code_block_markdown(translator, node: collapsible_code_block):
    """Visitor for markdown builder - renders as regular code block."""
    language = node['language']
    parsed_content = node['parsed_content']
    
    # Extract raw code without collapsible directives
    raw_code = extract_raw_code(parsed_content)
    
    # Render as markdown code block
    translator.ensure_eol(2)
    translator.add(f'```{language}\n')
    translator.add(raw_code)
    translator.add('\n```')
    translator.ensure_eol(2)
    
    raise nodes.SkipNode()


def depart_collapsible_code_block_markdown(translator, node: collapsible_code_block):
    """Depart visitor for markdown - not needed."""
    pass


def setup(app: Sphinx):
    """Setup the Sphinx extension."""
    app.add_directive('collapsible-code-block', CollapsibleCodeBlock)
    app.add_node(
        collapsible_code_block,
        html=(visit_collapsible_code_block, depart_collapsible_code_block),
        markdown=(visit_collapsible_code_block_markdown, depart_collapsible_code_block_markdown)
    )
    
    # Add CSS and JavaScript files
    app.add_css_file('css/collapsible_code_block.css')
    app.add_js_file('js/collapsible_code_block.js')
    
    return {
        'version': '0.1',
        'parallel_read_safe': True,
        'parallel_write_safe': True,
    }
