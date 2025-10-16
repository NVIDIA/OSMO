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

"""Extension to generate domain configuration JavaScript file."""

from pathlib import Path
from sphinx.application import Sphinx


def _write_domain_config(app: Sphinx):
    """Write domain configuration to a JavaScript file."""
    if app.builder.format != 'html':
        return

    osmo_domain = app.config.osmo_domain

    js_config = f"""
window.DomainUpdaterConfig = {{
    oldDomain: "{osmo_domain}.osmo.nvidia.com",
}};
"""

    path = Path(app.outdir) / '_static' / 'js' / 'domain_config.js'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(js_config, encoding='utf-8')


def setup(app: Sphinx):
    """Set up the domain config extension."""
    app.add_config_value('osmo_domain', 'public', 'html')
    app.add_js_file('js/domain_config.js')
    app.add_js_file('js/domain_updater.js')
    app.connect('builder-inited', _write_domain_config)

    return {
        'parallel_read_safe': True,
        'parallel_write_safe': True,
    }
