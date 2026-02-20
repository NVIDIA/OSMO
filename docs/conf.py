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

# -- Path setup --------------------------------------------------------------

import sys
from pathlib import Path


# Add the directory containing conf.py to the path so custom extensions can be found
# This is important for sphinx-multiversion which runs from temporary directories
sys.path.insert(0, str(Path(__file__).parent.resolve()))

# -- Project information -----------------------------------------------------

project = 'NVIDIA OSMO'
copyright = "2025 NVIDIA CORPORATION & AFFILIATES"
author = "NVIDIA"

# -- General configuration ---------------------------------------------------

# Add templates directory
templates_path = ['_templates']

extensions = [
    # Standard extensions
    'sphinx_copybutton',
    'sphinx_design',
    'sphinx_multiversion',
    'sphinx_new_tab_link',
    'sphinx_simplepdf',
    'sphinx_substitution_extensions',
    'sphinx.ext.autodoc',
    'sphinx.ext.autosummary',
    'sphinx.ext.viewcode',
    'sphinxarg.ext',
    'sphinxcontrib.autodoc_pydantic',
    'sphinxcontrib.mermaid',
    'sphinxcontrib.spelling',
    'sphinx_reredirects',

    # Custom extensions
    '_extensions.argparse_postprocess',
    '_extensions.auto_include',
    '_extensions.code_annotations',
    '_extensions.collapsible_code_block',
    '_extensions.domain_config',
    '_extensions.html_translator_mixin',
    '_extensions.markdown_translator',
    '_extensions.module_aliasing',

    # Theme extension
    '_extensions.nvidia_theme_override',
]

# Redirects
redirects = {
    # Note: We still need the root index.rst to be present to be the
    # root document and root toctree.
    'index': 'user_guide/index.html',
}

# Spelling
spelling_exclude_patterns = [
    '**/appendix/cli/cli_*.rst',
]
spelling_show_suggestions = True
spelling_warning = True
spelling_word_list_filename = 'spelling_wordlist.txt'

# Linkcheck ignore
linkcheck_ignore = [
    'https://osmo-example-url.com*',
    'http://osmo.example.com*',
    'https://osmo.example.com*',
    'http://localhost:*',
    # Requires authentication so we can't check it
    'https://github.com/settings/tokens/new',
    'https://console.volcengine.com*',
    'https://us-east-1.console.aws.amazon.com*'
]
linkcheck_anchors = False
linkcheck_report_timeouts_as_broken = False
linkcheck_retries = 3
linkcheck_timeout = 150

# Copybutton
copybutton_prompt_text = r">>> |\.\.\. |\$ |In \[\d*\]: | {2,5}\.\.\.: | {5,8}: "
copybutton_prompt_is_regexp = True
copybutton_line_continuation_character = "\\"
copybutton_here_doc_delimiter = "EOF"
copybutton_selector = "div:not(.no-copybutton) > div.highlight > pre"

# New tab link
new_tab_link_show_external_link_icon = True
new_tab_link_enable_referrer = False

# List of patterns, relative to source directory, that match files and
# directories to ignore when looking for source files.
# This pattern also affects html_static_path and html_extra_path.
exclude_patterns = [
    '_build',
    'Thumbs.db',
    '.DS_Store',
    '**/*.in.rst',  # Ignore files that are embedded in other files
]

suppress_warnings = [
    'toc.excluded',
    'misc.highlighting_failure',
]

# -- Options for HTML output -------------------------------------------------

# The theme to use for HTML and HTML Help pages.  See the documentation for
# a list of builtin themes.
#
html_theme = "nvidia_sphinx_theme"

html_title = 'OSMO Documentation'
html_show_sourcelink = False

html_favicon = '_static/osmo_favicon.png'
html_logo = '_static/nvidia-logo-horiz-rgb-wht-for-screen.png'
html_static_path = ['_static']
templates_path = ['_templates']

html_sidebars = {
    "index": [],
}

html_theme_options = {
    "collapse_navigation": False,
    "github_url": "https://github.com/NVIDIA/OSMO/",
    "navbar_start": ["navbar-logo"],
    "navbar_center": ["navbar-nav"],
    "navbar_end": ["versioning.html", "theme-switcher", "navbar-icon-links"],
    "primary_sidebar_end": [],
}

# Enable following symbolic links
html_extra_path_opts = {
    'follow_symlinks': True,
}

# These paths are either relative to html_static_path
# or fully qualified paths (eg. https://...)
html_css_files = [
    'css/base.css',
    'css/lifecycle-timeline.css',
    'css/mermaid_custom.css',
    'css/versioning.css',
    'https://cdn.jsdelivr.net/npm/glightbox/dist/css/glightbox.min.css',
]

# JavaScript files to include in the HTML output
# Files are loaded in the order they appear in this list
html_js_files = [
    'https://cdn.jsdelivr.net/npm/glightbox/dist/js/glightbox.min.js',
    'js/code_annotation.js',
    'js/tab-set.js',
    'js/glightbox-init.js',
]

# If not None, a 'Last updated on:' timestamp is inserted at every page
# bottom, using the given strftime format.
# The empty string is equivalent to '%b %d, %Y'.
#
html_last_updated_fmt = '%b %d, %Y'

# -- Options for substitution -------------------------------------------------

# Constants that can be substituted in the document with |config_name|
constants = {
    'osmo_url': "https://osmo-example-url.com",
    'osmo_client_install_url': "https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh",
    'data_solution': 'S3',
    'data_path': 's3://<location>/data_folder',
    'data_full_prefix': 's3://',
    'data_prefix': 's3://'
}

custom_rst_roles = '''
.. role:: bdg-pending
   :class: badge bg-pending badge-pending

.. role:: bdg-running
   :class: badge bg-running badge-running

.. role:: bdg-completed
   :class: badge bg-completed badge-completed

.. role:: bdg-failed
   :class: badge bg-failed badge-failed

.. role:: tag-online
   :class: tag tag-online

.. role:: tag-offline
   :class: tag tag-offline

.. role:: tag-maintenance
   :class: tag tag-maintenance

'''


def build_rst_prolog():
    prolog = ''
    for key, value in constants.items():
        prolog += f'.. |{key}| replace:: {value}\n'
    prolog += custom_rst_roles
    return prolog


rst_prolog = build_rst_prolog()

# -- Options for Autodoc --------------------------------------------------

# Hide __init__ signature for classes (cleaner rendering for dataclasses)
autodoc_class_signature = 'separated'
autodoc_default_options = {
    'exclude-members': '__init__, __new__, __repr__, __eq__, __hash__',
}

# -- Options for Autodoc Pydantic -----------------------------------------

autodoc_pydantic_field_show_constraints = False
autodoc_pydantic_dataclass_show_config_summary = False
autodoc_pydantic_model_member_order = 'bysource'
autodoc_pydantic_model_show_config_summary = False
autodoc_pydantic_model_show_field_summary = False
autodoc_pydantic_model_show_json = False
autodoc_pydantic_model_show_validator_members = False
autodoc_pydantic_model_show_validator_summary = False
autodoc_pydantic_model_signature_prefix = 'class'
autodoc_pydantic_model_summary_list_order = 'bysource'

# -- Options for Mermaid -------------------------------------------------

mermaid_version = '11.12.1'

# -- Options for Multiversion -------------------------------------------------

# Exclude all tags
smv_tag_whitelist = r'^$'

# Allow only the main branch and any branches that begin with 'release/' to be rendered
smv_branch_whitelist = r'^main$|^release/.*$'
smv_remote_whitelist = r'^origin$'
smv_prefer_remote_refs = True

# Latest version
smv_latest_version = 'main'
