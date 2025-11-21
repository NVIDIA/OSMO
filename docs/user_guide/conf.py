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

from conf import *  # isort: skip, # noqa: I001

# -- Options for HTML output -------------------------------------------------

html_title = 'OSMO User Guide'

# Override paths for subdirectory build
html_favicon = '../_static/osmo_favicon.png'
html_logo = '../_static/nvidia-logo-horiz-rgb-wht-for-screen.png'
html_static_path = ['../_static']

# Remove root page CSS - we want normal sidebars for user guide
html_css_files = [f for f in html_css_files if 'root_page.css' not in f]

# Restore default sidebars (remove the empty sidebar setting from root)
if 'html_sidebars' in dir() and html_sidebars == {"**": []}:
    del html_sidebars
