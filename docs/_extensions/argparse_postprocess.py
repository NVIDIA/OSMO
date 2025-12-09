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

import re
from typing import List

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.application import Sphinx
from sphinx.util.logging import getLogger
from sphinxarg.ext import ArgParseDirective

from . import html_translator_mixin

LOGGER = getLogger(__name__)

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
    """Add reference targets to subcommand sections in the result nodes."""

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

        if not subcommands_section:
            continue

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


class ArgParseWithPostprocessDirective(ArgParseDirective):
    """
    Extended argparse directive that adds reference labels and deep links.

    This directive extends sphinxarg's ArgParseDirective to add:
    - Reference labels for each subcommand
    - Optional anchor IDs for arguments
    """

    # Inherit all options from ArgParseDirective and add our own
    option_spec = ArgParseDirective.option_spec.copy()
    option_spec.update({
        'ref-prefix': directives.unchanged,
        'argument-anchor': directives.flag,
    })

    def run(self) -> List[nodes.Node]:
        """Run the directive and postprocess the results."""
        # Get our custom options before running parent
        ref_prefix = self.options.get('ref-prefix', '').strip()
        add_argument_anchors = 'argument-anchor' in self.options

        # Remove our custom options so parent directive doesn't see them
        options_to_remove = ['ref-prefix', 'argument-anchor']
        for opt in options_to_remove:
            self.options.pop(opt, None)

        # Run the parent ArgParseDirective
        result = super().run()

        # If no ref-prefix specified, just return the original result
        if not ref_prefix:
            return result

        # Get environment info
        env = self.state.document.settings.env
        docname = env.docname

        LOGGER.debug(f"Postprocessing {docname} with prefix: {ref_prefix}")

        # Add subcommand references to the result nodes
        add_subcommand_refs(result, env, ref_prefix, docname, add_argument_anchors)

        return result


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
