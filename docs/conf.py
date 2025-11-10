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

import os
import sys

sys.path.insert(0, os.path.abspath('..'))
sys.path.insert(0, os.path.abspath('.'))

# -- Project information -----------------------------------------------------

project = 'NVIDIA OSMO'
copyright = "2025 NVIDIA CORPORATION & AFFILIATES"
author = "NVIDIA"

osmo_domain = os.getenv("OSMO_DOMAIN", "public")

# -- General configuration ---------------------------------------------------

extensions = [
    # Standard extensions
    'sphinx_copybutton',
    'sphinx_design',
    'sphinx_new_tab_link',
    'sphinx_simplepdf',
    'sphinx_substitution_extensions',
    'sphinx.ext.autodoc',
    'sphinx.ext.autosummary',
    'sphinx.ext.viewcode',
    'sphinxcontrib.spelling',

    # Custom extensions
    '_extensions.auto_include',
    '_extensions.code_annotations',
    '_extensions.collapsible_code_block',
    '_extensions.domain_config',
    '_extensions.html_translator_mixin',
    '_extensions.markdown_translator',
]

# Spelling
spelling_exclude_patterns = [
    '**/appendix/cli/cli_*.rst',
]
spelling_show_suggestions = True
spelling_warning = True
spelling_word_list_filename = '../spelling_wordlist.txt'

# Copybutton
copybutton_prompt_text = "$ "
copybutton_copy_empty_lines = False
copybutton_line_continuation_character = "\\"
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
    'toc.excluded'
]

# -- Options for HTML output -------------------------------------------------

# The theme to use for HTML and HTML Help pages.  See the documentation for
# a list of builtin themes.
#
html_theme = "nvidia_sphinx_theme"

html_title = 'OSMO Documentation'
html_show_sourcelink = False
html_favicon = '../_static/osmo_favicon.png'
html_logo = '../_static/nvidia-logo-horiz-rgb-wht-for-screen.png'

html_theme_options = {
    "collapse_navigation": False,
    "github_url": "https://github.com/NVIDIA/OSMO/",
    "navbar_start": ["navbar-logo"],
    "primary_sidebar_end": [],
}

# Enable following symbolic links
html_extra_path_opts = {
    'follow_symlinks': True,
}

# Add any paths that contain custom static files (such as style sheets) here,
# relative to this directory. They are copied after the builtin static files,
# so a file named "default.css" will overwrite the builtin "default.css".
html_static_path = ['../_static']

# These paths are either relative to html_static_path
# or fully qualified paths (eg. https://...)
html_css_files = [
    'css/base.css',
    'css/lifecycle-timeline.css',
]

# JavaScript files to include in the HTML output
# Files are loaded in the order they appear in this list
html_js_files = [
    'js/code_annotation.js',
    'js/tab-set.js',
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

link_constants = {
    'osmo_ui': "https://" + osmo_domain + ".osmo.nvidia.com",
    'osmo_ui_workflows': "https://" + osmo_domain + ".osmo.nvidia.com/workflows",
    'osmo_grafana': "https://" + osmo_domain + ".osmo.nvidia.com/grafana",
    'osmo_explorer': "https://redash-" + osmo_domain + ".osmo.nvidia.com/dashboards/2-workflows?p_time_period=d_last_7_days",
    'data_config_patch': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Config%20API/patch_dataset_configs_api_configs_dataset_patch",
    'service_config_patch': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Config%20API/patch_service_configs_api_configs_service_patch",
    'workflow_config_patch': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Config%20API/patch_workflow_configs_api_configs_workflow_patch",
    'backend_config_patch': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Config%20API/patch_backend_api_configs_backend__name__patch",
    'backend_config_get': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Config%20API/get_backend_api_configs_backend__name__get",
    'backend_config_post': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Config%20API/update_backend_api_configs_backend__name__post",
    'backend_config_delete': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Config%20API/delete_backend_api_configs_backend__name__delete",
    'pool_config_put': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Config%20API/put_pool_api_configs_pool__name__put",
    'pool_config_delete': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Config%20API/delete_pool_api_configs_pool__name__delete",
    'platform_config_put': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Config%20API/put_platform_in_pool_api_configs_pool__name__platform__platform_name__put",
    'pod_template_config_put': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Config%20API/put_pod_templates_api_configs_pod_template_put",
    'resource_validation_config_put': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Config%20API/put_resource_validations_api_configs_resource_validation_put",
    'notify_post': "https://" + osmo_domain + ".osmo.nvidia.com/api/docs#/Notification%20API/set_notification_settings_api_notification_post",
    'priority_preemption_borrowing': "https://" + osmo_domain + ".osmo.nvidia.com/docs/concepts/wf/priority"
}

rst_prolog = ''
for key, value in constants.items():
    rst_prolog += f'.. |{key}| replace:: {value}\n'

for key, value in link_constants.items():
    rst_prolog += f'.. _{key}: {value}\n'

# Custom badge roles
rst_prolog += '''
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

# -- Options for Autodoc -------------------------------------------------

autodoc_typehints = 'description'
autodoc_member_order = 'bysource'
autodoc_unqualified_typehints = True
add_module_names = False
autodoc_typehints_format = 'short'
