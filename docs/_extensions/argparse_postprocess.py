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
Extension to enhance sphinx-argparse output with reference labels and deep links.

This extension provides a custom directive that wraps sphinxarg.ext's argparse
directive and adds:
1. Reference labels (targets) for each subcommand section
2. Anchor IDs for all arguments (positional and options)
3. Scoped IDs for subsections to avoid _repeat1, _repeat2 suffixes
4. Proper handling of epilog section titles at any nesting level

Usage:
    .. argparse-with-postprocess::
       :module: src.cli.main_parser
       :func: create_cli_parser
       :prog: osmo
       :path: workflow
       :ref-prefix: cli_reference_workflow
       :argument-anchor:

    This will automatically generate reference labels like:
    - cli_reference_workflow_submit
    - cli_reference_workflow_restart
    - cli_reference_workflow_submit_positional_arguments
    - cli_reference_workflow_submit_named_arguments
    - cli_reference_workflow_submit_examples
    - cli_reference_workflow_submit_format_type (if :argument-anchor: is set)
    - cli_reference_workflow_submit_workflow_file (if :argument-anchor: is set)

Options:
    :ref-prefix: (string) - Prefix for all generated reference labels.
                            Subcommand refs will be: {ref-prefix}_{subcommand}
    :argument-anchor: (flag) - If present, also create anchors for arguments
                               within each subcommand section.
"""

import argparse
import re
from typing import List

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.application import Sphinx
from sphinx.util.logging import getLogger
from sphinxarg.ext import ArgParseDirective

from . import html_translator_mixin

LOGGER = getLogger(__name__)

# Pattern to match RST section titles in epilogs
RST_SECTION_PATTERN = re.compile(
    r'^([^\n]+)\n([=\-~`\'"^_*+#]+)$',
    re.MULTILINE
)


def convert_epilog_sections_to_rubric(epilog: str) -> str:
    """Convert RST section headers in epilog to rubric directives.

    This prevents "Unexpected section title" errors when epilogs appear
    at levels where section titles would violate RST hierarchy.

    The rubric directive creates a title-like element that doesn't
    participate in the section hierarchy, avoiding the warning while
    still rendering as a styled heading.
    """
    if not epilog:
        return epilog

    def replace_section(match):
        title = match.group(1).strip()
        underline = match.group(2)
        if len(underline) >= len(title.strip()):
            return f'.. rubric:: {title}'
        return match.group(0)

    return RST_SECTION_PATTERN.sub(replace_section, epilog)


def preprocess_parser_epilogs(parser: argparse.ArgumentParser) -> None:
    """Recursively preprocess all epilogs in a parser and its subparsers."""
    if parser.epilog:
        parser.epilog = convert_epilog_sections_to_rubric(parser.epilog)

    # pylint: disable=protected-access
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            for subparser in action.choices.values():
                preprocess_parser_epilogs(subparser)


# Store argument IDs that need headerlinks
# Key: node id (from id(node)), Value: (arg_id, arg_text)
_argument_headerlinks = {}


def slugify(text: str) -> str:
    """Convert text to a valid ID/slug."""
    # Remove leading dashes from options
    text = re.sub(r'^-+', '', text)
    # Replace non-alphanumeric chars with underscores
    text = re.sub(r'[^a-zA-Z0-9]+', '_', text)
    # Remove leading/trailing underscores
    text = text.strip('_').lower()
    return text


def add_argument_refs(
    section: nodes.section,
    env,
    parent_ref: str,
    docname: str
) -> None:
    """Add reference targets to arguments within a section."""

    # sphinxarg uses nodes.option_list and nodes.option_list_item
    # Structure: option_list > option_list_item > option_group > option_string
    for option_list in section.traverse(nodes.option_list):
        for item in option_list.children:
            if isinstance(item, nodes.option_list_item):
                # Find the option_group which contains the option names
                option_group = None
                for child in item.children:
                    if isinstance(child, nodes.option_group):
                        option_group = child
                        break

                if option_group is None:
                    continue

                # Get the argument text from option_string nodes
                arg_text = option_group.astext()

                # Handle options like "--format-type, -t"
                # Take the first long option or first option
                arg_names = [a.strip() for a in arg_text.split(',')]
                primary_arg = None
                for name in arg_names:
                    if name.startswith('--'):
                        primary_arg = name
                        break
                if not primary_arg:
                    primary_arg = arg_names[0]

                arg_id = f"{parent_ref}_{slugify(primary_arg)}"

                # Add ID to the option_group node (which becomes the <dt> in HTML)
                if 'ids' not in option_group:
                    option_group['ids'] = []
                if arg_id not in option_group['ids']:
                    option_group['ids'].insert(0, arg_id)

                    # Mark this node for headerlink generation
                    _argument_headerlinks[id(option_group)] = (arg_id, arg_text)

                    # Register with standard domain
                    std_domain = env.get_domain('std')
                    std_domain.anonlabels[arg_id] = (docname, arg_id)
                    std_domain.labels[arg_id] = (docname, arg_id, arg_text)
                    LOGGER.debug(f"Added argument ref: {arg_id}")


def add_subsection_refs(
    section: nodes.section,
    env,
    parent_ref: str,
    docname: str
) -> None:
    """Add scoped reference targets to ALL subsections within a section.

    This prevents docutils from adding _repeat1, _repeat2 suffixes
    by giving each subsection a unique, hierarchically scoped ID.
    """
    for child in section.children:
        if not isinstance(child, nodes.section):
            continue

        # Get the title of this subsection
        if not child.children or not isinstance(child[0], nodes.title):
            continue

        title = child[0].astext()
        slug = slugify(title)

        if not slug:
            continue

        ref_id = f"{parent_ref}_{slug}"

        # Replace the existing IDs with our scoped one
        # This removes the original unscoped ID that causes _repeat suffixes
        child['ids'] = [ref_id]

        # Register with Sphinx's standard domain
        std_domain = env.get_domain('std')
        std_domain.anonlabels[ref_id] = (docname, ref_id)
        std_domain.labels[ref_id] = (docname, ref_id, title)
        LOGGER.debug(f"Added subsection ref: {ref_id}")

        # Recursively handle nested subsections
        add_subsection_refs(child, env, ref_id, docname)


def add_subcommand_refs(
    result_nodes: List[nodes.Node],
    env,
    ref_prefix: str,
    docname: str,
    add_argument_anchors: bool = False
) -> None:
    """Add reference targets to subcommand sections and top-level commands."""

    # Find all sections in the result
    for node in result_nodes:
        if not isinstance(node, nodes.Element):
            continue

        # Find the "Sub-commands" section
        subcommands_section = None
        for section in node.traverse(nodes.section):
            section_ids = section.get('ids', [])
            title = ''
            if section.children and isinstance(section[0], nodes.title):
                title = section[0].astext()

            if ('sub-commands' in section_ids or
                'Sub-commands' in section_ids or
                    title.lower() == 'sub-commands'):
                subcommands_section = section
                break

        if subcommands_section:
            # Process each child section (these are the subcommands)
            for child in subcommands_section.children:
                if not isinstance(child, nodes.section):
                    continue

                # Get the subcommand name from the section ID or title
                section_ids = child.get('ids', [])
                if not section_ids:
                    continue

                subcommand_name = section_ids[0]
                ref_id = f"{ref_prefix}_{slugify(subcommand_name)}"

                # Check if this ref already exists
                if ref_id not in child.get('ids', []):
                    # Add the new ID to the section
                    child['ids'].insert(0, ref_id)

                    # Register with Sphinx's standard domain for :ref: role
                    std_domain = env.get_domain('std')

                    # Get title for the label
                    title = subcommand_name
                    if child.children and isinstance(child[0], nodes.title):
                        title = child[0].astext()

                    std_domain.anonlabels[ref_id] = (docname, ref_id)
                    std_domain.labels[ref_id] = (docname, ref_id, title)
                    LOGGER.debug(f"Added subcommand ref: {ref_id} -> {title}")

                # Add scoped refs for ALL subsections (prevents _repeat suffixes)
                add_subsection_refs(child, env, ref_id, docname)

                # Add refs for arguments within this subcommand if requested
                if add_argument_anchors:
                    add_argument_refs(child, env, ref_id, docname)
        else:
            # No Sub-commands section - this is a leaf command (like config delete)
            # Add argument refs and subsection refs at the top level
            if add_argument_anchors:
                # Find sections that contain arguments (Positional/Named Arguments)
                for section in node.traverse(nodes.section):
                    add_argument_refs(section, env, ref_prefix, docname)

            # Add scoped refs for top-level subsections
            for section in node.traverse(nodes.section):
                add_subsection_refs(section, env, ref_prefix, docname)
                break  # Only process the first (root) section


class ArgParseWithPostprocessDirective(ArgParseDirective):
    """
    Extended argparse directive that adds reference labels and deep links.

    This directive extends sphinxarg's ArgParseDirective to add:
    - Reference labels for each subcommand
    - Optional anchor IDs for arguments
    - Proper handling of epilog section titles
    """

    # Inherit all options from ArgParseDirective and add our own
    option_spec = ArgParseDirective.option_spec.copy()
    option_spec.update({
        'ref-prefix': directives.unchanged,
        'argument-anchor': directives.flag,
    })

    def run(self) -> List[nodes.Node]:
        """Run the directive and postprocess the results."""
        import importlib
        from sphinxarg.ext import mock

        # Get our custom options before running parent
        ref_prefix = self.options.get('ref-prefix', '').strip()
        add_argument_anchors = 'argument-anchor' in self.options

        # Remove our custom options so parent directive doesn't see them
        options_to_remove = ['ref-prefix', 'argument-anchor']
        for opt in options_to_remove:
            self.options.pop(opt, None)

        # Temporarily patch the parser factory to preprocess epilogs
        # This converts RST section headers to rubrics before parsing,
        # avoiding "Unexpected section title" warnings.
        original_func = None
        mod = None

        if 'module' in self.options and 'func' in self.options:
            module_name = self.options['module']
            attr_name = self.options['func']

            try:
                with mock(self.config.autodoc_mock_imports):
                    mod = importlib.import_module(module_name)
                    if hasattr(mod, attr_name):
                        original_func = getattr(mod, attr_name)

                        def wrapper_func():
                            if isinstance(original_func, argparse.ArgumentParser):
                                parser = original_func
                            else:
                                parser = original_func()
                            preprocess_parser_epilogs(parser)
                            return parser

                        setattr(mod, attr_name, wrapper_func)
            except Exception as e:
                LOGGER.warning(f"Failed to preprocess epilogs: {e}")
                original_func = None

        try:
            result = super().run()
        finally:
            if mod is not None and original_func is not None:
                setattr(mod, attr_name, original_func)

        # Get environment info
        env = self.state.document.settings.env
        docname = env.docname

        # Convert rubrics to proper sections in the result
        for node in result:
            if isinstance(node, nodes.Element):
                # Count rubrics before conversion
                rubric_count = len(list(node.traverse(nodes.rubric)))
                if rubric_count > 0:
                    LOGGER.debug(f"Found {rubric_count} rubric(s) to convert in {docname}")
                convert_rubrics_to_sections(node, ref_prefix, result)

        # If no ref-prefix specified, just return the original result
        if not ref_prefix:
            return result

        LOGGER.debug(f"Postprocessing {docname} with prefix: {ref_prefix}")

        # Add subcommand references to the result nodes
        add_subcommand_refs(result, env, ref_prefix, docname, add_argument_anchors)

        return result


def find_containing_section(node: nodes.Node) -> nodes.section | None:
    """Find the nearest ancestor section node."""
    current = node.parent
    while current is not None:
        if isinstance(current, nodes.section):
            return current
        current = current.parent
    return None


def find_or_create_container(node: nodes.Node) -> nodes.Element | None:
    """Find the best container to add a new section to.

    For rubrics inside sections, returns that section.
    For rubrics at the root level (in result nodes), returns the
    first section found, or the root element itself.
    """
    # First try to find a containing section
    section = find_containing_section(node)
    if section is not None:
        return section

    # No section ancestor - we're likely at the result root
    # Walk up to find the root element
    root = node
    while root.parent is not None:
        root = root.parent

    # If root is a section, use it
    if isinstance(root, nodes.section):
        return root

    # Otherwise, find the first section child of root
    for child in root.traverse(nodes.section):
        return child

    # Last resort: return the root if it's an Element
    if isinstance(root, nodes.Element):
        return root

    return None


def convert_rubrics_to_sections(
    node: nodes.Element,
    ref_prefix: str,
    result_list: List[nodes.Node] | None = None
) -> None:
    """Convert rubric nodes (from epilog preprocessing) to proper sections.

    This runs after sphinx-argparse parsing, converting rubrics back to
    sections so they integrate properly with Sphinx's TOC and heading system.

    The key insight is that when sphinx-argparse parses an epilog with
    a rubric directive:
        .. rubric:: Examples

        Content here...

    The content after the rubric appears AFTER the rubric's container in the
    result list. We need to handle two cases:
    1. Rubric inside a section (normal case) - work with section children
    2. Rubric at root level (orphan nodes) - work with the result list
    """
    # Find all rubric nodes
    rubrics = list(node.traverse(nodes.rubric))

    for rubric in rubrics:
        # Get the rubric title
        title_text = rubric.astext()
        if not title_text:
            continue

        # Get the rubric's direct parent (usually a paragraph or section)
        direct_parent = rubric.parent
        if direct_parent is None:
            continue

        # Determine the container
        container = direct_parent.parent

        # Derive section ID from the nearest section ancestor if available,
        # otherwise use ref_prefix. This ensures proper scoping for subcommands.
        section_id = slugify(title_text)
        containing_section = find_containing_section(rubric)
        if containing_section is not None:
            # Use the containing section's first ID as prefix
            parent_ids = containing_section.get('ids', [])
            if parent_ids:
                section_id = f"{parent_ids[0]}_{section_id}"
            elif ref_prefix:
                section_id = f"{ref_prefix}_{section_id}"
        elif ref_prefix:
            section_id = f"{ref_prefix}_{section_id}"

        # Create a new section
        new_section = nodes.section()
        new_section['ids'] = [section_id]
        new_section['names'] = [nodes.fully_normalize_name(title_text)]

        # Create a title for the section
        title_node = nodes.title(text=title_text)
        new_section.append(title_node)

        # Case 1: Rubric is at root level (direct_parent has no parent)
        # This happens for commands without sub-commands
        if container is None and result_list is not None:
            # The epilog content is typically INSIDE direct_parent, not as
            # separate siblings in result_list. So we need to collect content
            # from within direct_parent that comes AFTER the rubric.

            # Find nodes after the rubric within direct_parent
            try:
                rubric_idx = direct_parent.index(rubric)
            except ValueError:
                continue

            # Collect all siblings after the rubric within direct_parent
            nodes_to_move = []
            for i in range(rubric_idx + 1, len(direct_parent.children)):
                nodes_to_move.append(direct_parent.children[i])

            # Move nodes into new section
            for n in nodes_to_move:
                direct_parent.remove(n)
                new_section.append(n)

            # Remove rubric from direct_parent
            direct_parent.remove(rubric)

            # If direct_parent is now empty, replace it in result_list
            try:
                idx = result_list.index(direct_parent)
                if len(direct_parent.children) == 0:
                    result_list[idx] = new_section
                else:
                    result_list.insert(idx + 1, new_section)
            except ValueError:
                # direct_parent not in result_list, just append
                result_list.append(new_section)

            LOGGER.debug(f"Converted root-level rubric '{title_text}' to section")
            continue

        # Case 2: Rubric inside a section
        # The rubric is a direct child of a section (like port-forward).
        # Content that should go into the Examples section appears as
        # siblings AFTER the rubric within the same section.
        if isinstance(direct_parent, nodes.section):
            # Find rubric's index within the section
            try:
                rubric_idx = direct_parent.index(rubric)
            except ValueError:
                continue

            # Collect all siblings after the rubric within this section
            nodes_to_move = []
            for i in range(rubric_idx + 1, len(direct_parent.children)):
                sibling = direct_parent.children[i]
                if isinstance(sibling, nodes.section):
                    break
                if isinstance(sibling, nodes.rubric):
                    break
                nodes_to_move.append(sibling)

            # Move nodes into new section
            for n in nodes_to_move:
                direct_parent.remove(n)
                new_section.append(n)

            # Replace the rubric with the new section
            direct_parent.replace(rubric, new_section)

            LOGGER.debug(f"Converted section rubric '{title_text}' to section '{section_id}'")
            continue

        # Case 3: Rubric inside a non-section container (e.g., paragraph)
        if container is None:
            continue

        # Find the index of direct_parent in container
        try:
            parent_idx = container.index(direct_parent)
        except ValueError:
            continue

        # Collect siblings after direct_parent in the container
        nodes_to_move = []
        for i in range(parent_idx + 1, len(container.children)):
            sibling = container.children[i]
            if isinstance(sibling, nodes.section):
                break
            if list(sibling.traverse(nodes.rubric)):
                break
            nodes_to_move.append(sibling)

        # Move collected nodes into the new section
        for n in nodes_to_move:
            container.remove(n)
            new_section.append(n)

        # Remove the rubric from direct_parent
        direct_parent.remove(rubric)

        # If direct_parent is now empty, replace it with the new section
        if len(direct_parent.children) == 0:
            container.replace(direct_parent, new_section)
        else:
            idx = container.index(direct_parent)
            container.insert(idx + 1, new_section)

        LOGGER.debug(f"Converted rubric '{title_text}' to section '{section_id}'")


# Override depart_option_group to add headerlinks
@html_translator_mixin.override
def depart_option_group(
    self: html_translator_mixin.HTMLTranslatorMixin,
    node: nodes.option_group,
    super_func: html_translator_mixin.BaseVisitCallback[nodes.option_group],
) -> None:
    """Add headerlink after </kbd> but before </dt>."""
    # Check if this node needs a headerlink
    node_id = id(node)
    if node_id in _argument_headerlinks:
        arg_id, _ = _argument_headerlinks[node_id]
        # Close </kbd>, add headerlink, then close </dt>
        self.body.append('</kbd>')
        self.body.append(
            f'<a class="headerlink" href="#{arg_id}" '
            f'title="Link to this argument">#</a>'
        )
        self.body.append('</dt>\n')
        # Clean up
        del _argument_headerlinks[node_id]
    else:
        # No headerlink needed, use default behavior
        super_func(self, node)


def setup(app: Sphinx):
    """Set up the extension."""

    # Register the custom directive
    app.add_directive('argparse-with-postprocess', ArgParseWithPostprocessDirective)

    return {
        'version': '1.0',
        'parallel_read_safe': True,
        'parallel_write_safe': True,
    }
