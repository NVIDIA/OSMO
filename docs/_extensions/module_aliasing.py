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

"""
Sphinx extension to alias src.lib modules to osmo namespace.

This extension creates module aliases so that:
- `osmo.data.storage.Client` -> `src.lib.data.storage.Client`
- `osmo.data.storage` -> `src.lib.data.storage`
- etc.

This allows documentation to reference `osmo.*` paths which match the installed
package name, rather than the internal `src.lib.*` paths.
"""

from types import ModuleType


import re
import sys
import importlib
from typing import Any


def _get_osmo_name(src_name: str) -> str:
    """Convert a src.lib.* name to osmo.* name."""
    return src_name.replace('src.lib.', 'osmo.', 1).replace('src.lib', 'osmo', 1)


def _get_src_name(osmo_name: str) -> str:
    """Convert an osmo.* name to src.lib.* name."""
    return osmo_name.replace('osmo.', 'src.lib.', 1).replace('osmo', 'src.lib', 1)


def _create_module_aliases():
    """
    Create sys.modules aliases from osmo.* to src.lib.*

    This allows imports like `import osmo.data.storage` to work by
    pointing them to the actual `src.lib.data.storage` module.
    """
    # First, ensure src.lib is importable
    try:
        import src.lib
    except ImportError:
        return

    # Get all src.lib.* modules that are already loaded
    src_lib_modules = {
        name: module
        for name, module in list[tuple[str, ModuleType]](sys.modules.items())
        if name.startswith('src.lib') and module is not None
    }

    # Create osmo.* aliases for each src.lib.* module
    for src_name, module in src_lib_modules.items():
        osmo_name = _get_osmo_name(src_name)
        if osmo_name not in sys.modules:
            sys.modules[osmo_name] = module


def _import_and_alias(modname: str):
    """
    Import a module under src.lib and create an osmo alias for it.
    """
    if modname.startswith('osmo.'):
        src_name = _get_src_name(modname)
    else:
        src_name = modname

    try:
        module = importlib.import_module(src_name)
        osmo_name = _get_osmo_name(src_name)
        sys.modules[osmo_name] = module
        return module
    except ImportError:
        return None


def autodoc_process_signature(app, what, name, obj, options, signature, return_annotation):
    """
    Process autodoc signatures to replace src.lib with osmo in displayed names.
    """
    new_sig = signature
    new_ret = return_annotation

    if signature and 'src.lib.' in signature:
        new_sig = signature.replace('src.lib.', 'osmo.')
    if return_annotation and 'src.lib.' in str(return_annotation):
        new_ret = str(return_annotation).replace('src.lib.', 'osmo.')

    if new_sig != signature or new_ret != return_annotation:
        return (new_sig, new_ret)
    return None


def autodoc_process_docstring(app, what, name, obj, options, lines):
    """
    Process docstrings to replace src.lib references with osmo.
    """
    for i, line in enumerate(lines):
        if 'src.lib.' in line:
            lines[i] = line.replace('src.lib.', 'osmo.')


def autodoc_skip_member(app, what, name, obj, skip, options):
    """
    Update the __module__ attribute of objects to use osmo namespace.
    """
    if hasattr(obj, '__module__') and obj.__module__ and obj.__module__.startswith('src.lib'):
        try:
            obj.__module__ = _get_osmo_name(obj.__module__)
        except (TypeError, AttributeError):
            # Some objects don't allow __module__ modification
            pass
    return None


def builder_inited(app):
    """
    Called when the builder is initialized.
    Create module aliases for all src.lib modules.
    """
    _create_module_aliases()


def missing_reference(app, env, node, contnode):
    """
    Handle missing references by trying to resolve osmo.* to src.lib.*
    """
    target = node.get('reftarget', '')
    if target.startswith('osmo.'):
        # Try to find it under src.lib
        src_target = _get_src_name(target)
        node['reftarget'] = src_target
    return None


def source_read(app, docname, source):
    """
    Process source files to replace src.lib with osmo in autoclass/automodule directives.
    This ensures the module aliasing is set up before autodoc tries to import.
    """
    content = source[0]
    if 'osmo.' in content:
        # Pre-import and alias any osmo.* modules referenced
        pattern = r'osmo\.[a-zA-Z0-9_.]+'
        for match in re.findall(pattern, content):
            _import_and_alias(match)


def setup(app) -> dict[str, Any]:
    """
    Setup the extension.
    """
    # Create initial aliases
    _create_module_aliases()

    # Connect to Sphinx events
    app.connect('builder-inited', builder_inited)
    app.connect('source-read', source_read)
    app.connect('autodoc-process-docstring', autodoc_process_docstring)
    app.connect('autodoc-process-signature', autodoc_process_signature)
    app.connect('autodoc-skip-member', autodoc_skip_member)
    app.connect('missing-reference', missing_reference)

    return {
        'version': '1.0',
        'parallel_read_safe': True,
        'parallel_write_safe': True,
    }
