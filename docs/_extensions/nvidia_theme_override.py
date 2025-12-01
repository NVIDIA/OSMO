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

"""Override NVIDIA theme's sidebar behavior to restore PyData defaults."""

# Store the original suppress_sidebar_toctree before NVIDIA overrides it
_original_suppress_sidebar_toctree = {}

def capture_original_sidebar_logic(app, pagename, templatename, context, doctree):
    """Capture PyData's original suppress_sidebar_toctree before NVIDIA overrides it."""
    # Store whatever PyData theme set (or didn't set)
    if pagename not in _original_suppress_sidebar_toctree:
        _original_suppress_sidebar_toctree[pagename] = context.get("suppress_sidebar_toctree")

def restore_original_sidebar_logic(app, pagename, templatename, context, doctree):
    """Restore PyData's original suppress_sidebar_toctree after NVIDIA overrides it."""
    # Restore the original value that PyData set
    original_value = _original_suppress_sidebar_toctree.get(pagename)
    if original_value is not None:
        context["suppress_sidebar_toctree"] = original_value
    elif "suppress_sidebar_toctree" in context:
        # If PyData didn't set it, remove NVIDIA's override
        del context["suppress_sidebar_toctree"]

def setup(app):
    # Run at priority 999 to capture PyData's value before NVIDIA (which runs at 1000)
    app.connect("html-page-context", capture_original_sidebar_logic, priority=999)
    
    # Run at priority 1001 to restore after NVIDIA has overridden it (which runs at 1000)
    app.connect("html-page-context", restore_original_sidebar_logic, priority=1001)
    
    return {
        "version": "0.1",
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }