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

# Configuration file for the Sphinx documentation builder.
#
# This file only contains a selection of the most common options. For a full
# list see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

# -- Path setup --------------------------------------------------------------

# If extensions (or modules to document with autodoc) are in another directory,
# add these directories to sys.path here. If the directory is relative to the
# documentation root, use os.path.abspath to make it absolute, like shown here.
#
import sys
import os

sys.path.insert(0, os.path.abspath('..'))
sys.path.insert(0, os.path.abspath('.'))

# -- Project information -----------------------------------------------------

project = 'NVIDIA OSMO'
copyright = "2025 NVIDIA CORPORATION & AFFILIATES"

OSMO_DOMAIN = "public"

# -- General configuration ---------------------------------------------------

# Add any Sphinx extension module names here, as strings. They can be
# extensions coming with Sphinx (named 'sphinx.ext.*') or your custom
# ones.
# sys.path.append('/usr/local/lib/python3.6/dist-packages/breathe')
# extensions = ['breathe']
# breathe_projects = { "myproject": "../src/xml"}
# breathe_default_project = "myproject"

extensions = [
    'sphinx_copybutton',
    'sphinx_immaterial',
    'sphinx_substitution_extensions',
    'sphinxcontrib.spelling',
    'sphinx.ext.autodoc',
    'sphinx.ext.autosummary',
    'sphinx.ext.viewcode',
    'sphinx_simplepdf',
    'sphinx_new_tab_link',

    # Locally defined extensions
    '_extensions.auto_include',
    '_extensions.markdown_argparse',
]

spelling_exclude_patterns = [
    '**/reference/cli/cli_*.rst',
]
spelling_show_suggestions = True
spelling_warning = True
spelling_word_list_filename = '../spelling_wordlist.txt'
copybutton_prompt_text = "$ "
copybutton_copy_empty_lines = False
copybutton_selector = "div:not(.no-copybutton) > div.highlight > pre"
sphinx_immaterial_override_builtin_admonitions = False
new_tab_link_show_external_link_icon = True
new_tab_link_enable_referrer = False

# Add any paths that contain templates here, relative to this directory.
templates_path = ['_templates']

# List of patterns, relative to source directory, that match files and
# directories to ignore when looking for source files.
# This pattern also affects html_static_path and html_extra_path.
exclude_patterns = [
    '_build',
    '_old_docs',
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
html_theme = "sphinx_immaterial"

html_title = 'OSMO Documentation'
html_show_sourcelink = False
html_favicon = '../_static/osmo_favicon.png'
html_logo = '../_static/NVIDIA-logo-black.png'

html_theme_options = {
    "font": False,
    "repo_url": "https://github.com/NVIDIA/OSMO/",
    "repo_name": "OSMO",
    "features": [
        "navigation.expand",
        "navigation.top",
        "navigation.footer",
        "search.highlight",
        "search.share",
        "search.suggest",
        "content.code.annotate",
        "toc.follow",
        "toc.sticky",
        "content.tooltips",
        "announce.dismiss",
    ],
    "toc_title_is_page_title": True,
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
    'css/custom.css',
]

templates_path = ["../_templates"]

osmo_domain = os.getenv("OSMO_DOMAIN", OSMO_DOMAIN)

# Create a JavaScript file with domain configuration
js_config = f"""
window.DomainUpdaterConfig = {{
    oldDomain: "{osmo_domain}.osmo.nvidia.com",
}};
"""

# Write the config to a physical JS file
static_path = os.path.join(os.path.dirname(__file__), '../_static/js')
os.makedirs(static_path, exist_ok=True)
with open(os.path.join(static_path, 'domain_config.js'), 'w') as f:
    f.write(js_config)

# JavaScript files to include in the HTML output
# Files are loaded in the order they appear in this list
html_js_files = [
    'js/add_documentation_options.js',  # This will load first
    'js/domain_config.js',
    'js/domain_updater.js',
]

# If not None, a 'Last updated on:' timestamp is inserted at every page
# bottom, using the given strftime format.
# The empty string is equivalent to '%b %d, %Y'.
#
html_last_updated_fmt = '%b %d, %Y'

# Constants that can be substituted in the document with |config_name|
constants = {
    'osmo_url': "https://" + osmo_domain + ".osmo.nvidia.com",
    'osmo_auth_url': "https://auth-" + osmo_domain + ".osmo.nvidia.com",
    'osmo_client_url': "https://" + osmo_domain + ".osmo.nvidia.com/client/osmo_client",
    'osmo_client_install_url': "https://" + osmo_domain + ".osmo.nvidia.com/client/install.sh",
    'osmo_pypi_url': "https://" + osmo_domain + ".osmo.nvidia.com/client/pypi/simple",
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

# Autodoc options for Library APIs
autodoc_typehints = 'description'
autodoc_member_order = 'bysource'
autodoc_unqualified_typehints = True
add_module_names = False
autodoc_typehints_format = 'short'
