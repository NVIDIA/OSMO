"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

import os
import re
from typing import Any, Dict, FrozenSet, List

import yaml

from src.lib.utils import osmo_errors


_VAR_REF_PATTERN = re.compile(r'^\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}$')
_ENV_REF_PATTERN = re.compile(r'\$\{env:([^}]+)\}')
_SCALAR_REF_PATTERN = re.compile(r'(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})')
_JINJA_VAR_PATTERN = re.compile(r'\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}')
_DEFAULT_VALUES_BLOCK = re.compile(
    r'^default-values:[ \t]*\n((?:(?:[ \t]+[^\n]*|[ \t]*)(?:\n|$))*)',
    re.MULTILINE,
)
_MISSING = object()


def _is_named_dict_list(value: Any) -> bool:
    """Return True if *value* is a non-empty list of dicts that all have a ``name`` key."""
    if not isinstance(value, list) or len(value) == 0:
        return False
    return all(isinstance(item, dict) and 'name' in item for item in value)


def _merge_named_lists(base_list: List[Dict[str, Any]],
                       override_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Merge two lists of named dicts, matching items by their ``name`` field.

    - Items present in both lists are deep-merged (override wins).
    - Items only in base are kept in their original position.
    - Items only in override are appended after all base items.
    """
    base_by_name: Dict[str, Dict[str, Any]] = {}
    base_order: List[str] = []
    for item in base_list:
        name = item['name']
        base_by_name[name] = item
        base_order.append(name)

    override_by_name: Dict[str, Dict[str, Any]] = {}
    override_order: List[str] = []
    for item in override_list:
        name = item['name']
        override_by_name[name] = item
        override_order.append(name)

    merged: List[Dict[str, Any]] = []
    seen: set = set()

    for name in base_order:
        if name in override_by_name:
            merged.append(deep_merge_dicts(base_by_name[name], override_by_name[name]))
        else:
            merged.append(base_by_name[name])
        seen.add(name)

    for name in override_order:
        if name not in seen:
            merged.append(override_by_name[name])

    return merged


def deep_merge_dicts(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge two dicts where values in *override* take precedence.

    - Dict values are merged recursively.
    - Lists of dicts with a ``name`` key are merged by name (matched items
      are deep-merged, unmatched items are kept/appended).
    - All other types (plain lists, scalars) in *override* replace the
      corresponding *base* value entirely.
    """
    merged: Dict[str, Any] = {}
    for key in set(base) | set(override):
        if key in base and key in override:
            base_val = base[key]
            override_val = override[key]
            if isinstance(base_val, dict) and isinstance(override_val, dict):
                merged[key] = deep_merge_dicts(base_val, override_val)
            elif _is_named_dict_list(base_val) and _is_named_dict_list(override_val):
                merged[key] = _merge_named_lists(base_val, override_val)
            else:
                merged[key] = override_val
        elif key in base:
            merged[key] = base[key]
        else:
            merged[key] = override[key]
    return merged


def _lookup_dot_path(data: Dict[str, Any], dot_path: str) -> Any:
    """Navigate a nested dict via a dot-separated key path.

    Returns the value at the path, ``None`` if the key exists with a null
    value, or the ``_MISSING`` sentinel if the key does not exist.
    """
    current: Any = data
    for segment in dot_path.split('.'):
        if not isinstance(current, dict) or segment not in current:
            return _MISSING
        current = current[segment]
    return current


def _expand_task_refs(tasks: List[Any],
                      default_values: Dict[str, Any]) -> List[Any]:
    """Replace ``{{ ref }}`` strings in a task list with their dict values from *default_values*.

    - If the referenced value is a dict, it is injected as a task definition
      with ``name`` set to the last segment of the reference path (unless
      already present).
    - If the referenced value is explicitly ``null``, the entry is removed
      (the task is excluded from the workflow).
    - Unresolvable references or scalar values are left unchanged for Jinja.
    """
    expanded: List[Any] = []
    for item in tasks:
        if not isinstance(item, str):
            expanded.append(item)
            continue
        match = _VAR_REF_PATTERN.match(item)
        if match is None:
            expanded.append(item)
            continue
        ref_path = match.group(1)
        value = _lookup_dot_path(default_values, ref_path)
        if value is _MISSING:
            expanded.append(item)
            continue
        if value is None:
            continue
        if not isinstance(value, dict):
            expanded.append(item)
            continue
        task_dict = dict(value)
        if 'name' not in task_dict:
            task_dict['name'] = ref_path.rsplit('.', 1)[-1]
        expanded.append(task_dict)
    return expanded


def _expand_refs_in_workflow(spec_dict: Dict[str, Any],
                             default_values: Dict[str, Any]) -> None:
    """Expand ``{{ ref }}`` strings in workflow task and group-task lists in place."""
    workflow = spec_dict.get('workflow')
    if not isinstance(workflow, dict):
        return

    if 'tasks' in workflow and isinstance(workflow['tasks'], list):
        workflow['tasks'] = _expand_task_refs(workflow['tasks'], default_values)

    if 'groups' in workflow and isinstance(workflow['groups'], list):
        for group in workflow['groups']:
            if isinstance(group, dict) and 'tasks' in group \
                    and isinstance(group['tasks'], list):
                group['tasks'] = _expand_task_refs(group['tasks'], default_values)


def resolve_includes(spec_text: str, base_directory: str,
                     source_path: str | None = None) -> str:
    """Resolve ``includes`` directives in a workflow spec.

    Reads included files relative to *base_directory*, recursively resolves
    nested includes, and deep-merges all specs.  The main file's values take
    precedence over included values.  Diamond-shaped includes (A -> B -> D and
    A -> C -> D) are allowed; true cycles are detected and rejected.

    Included files (and the main file when it uses ``includes``) must be
    parseable by ``yaml.safe_load`` -- unquoted Jinja template syntax such as
    ``{{ var }}`` is not supported.  Quoted references like ``"{{ var }}"``
    are fine.

    Task references (``"{{ key }}"`` in ``tasks`` lists) are resolved against
    the merged ``default-values``.  Setting a key to ``null`` in
    ``default-values`` removes the corresponding task.

    Args:
        spec_text: Raw YAML text of the workflow spec.
        base_directory: Directory to resolve relative include paths against.
        source_path: Absolute path of the file being processed, used for
            cycle detection of the root file.

    Returns:
        Merged YAML text with all includes resolved and the ``includes`` key
        removed.  If the spec has no ``includes`` key the original text is
        returned unchanged.
    """
    if 'includes:' not in spec_text:
        return spec_text

    ancestors: FrozenSet[str] = frozenset()
    if source_path is not None:
        ancestors = frozenset({os.path.normpath(os.path.abspath(source_path))})

    try:
        spec_dict = yaml.safe_load(spec_text)
    except yaml.YAMLError as yaml_err:
        if re.search(r'^includes:', spec_text, re.MULTILINE):
            raise osmo_errors.OSMOUserError(
                'Failed to parse workflow spec for includes resolution. '
                'Specs using "includes" must be valid YAML — Jinja template '
                'variables like {{ }} must be in quoted strings. '
                f'Parse error: {yaml_err}') from yaml_err
        return spec_text

    if not isinstance(spec_dict, dict) or 'includes' not in spec_dict:
        return spec_text

    return _resolve_includes(spec_dict, base_directory, ancestors)


def _resolve_includes(spec_dict: Dict[str, Any], base_directory: str,
                      ancestors: FrozenSet[str]) -> str:
    """Internal recursive include resolver operating on a parsed YAML dict."""
    includes = spec_dict.pop('includes', None)
    if includes is None:
        defaults = spec_dict.get('default-values', {})
        if isinstance(defaults, dict):
            _expand_refs_in_workflow(spec_dict, defaults)
        return yaml.safe_dump(spec_dict, default_flow_style=False, sort_keys=False)

    if not isinstance(includes, list):
        raise osmo_errors.OSMOUserError(
            'The "includes" key must be a list of file paths.')

    included_dicts: List[Dict[str, Any]] = []

    for include_path in includes:
        if not isinstance(include_path, str):
            raise osmo_errors.OSMOUserError(
                f'Each include path must be a string, got: '
                f'{type(include_path).__name__}')

        resolved_path = os.path.normpath(
            os.path.join(base_directory, include_path))

        if resolved_path in ancestors:
            raise osmo_errors.OSMOUserError(
                f'Circular include detected: "{include_path}" '
                f'(resolved to {resolved_path})')

        if not os.path.isfile(resolved_path):
            raise osmo_errors.OSMOUserError(
                f'Included file not found: "{include_path}" '
                f'(resolved to {resolved_path})')

        with open(resolved_path, encoding='utf-8') as file_handle:
            included_text = file_handle.read()

        try:
            included_dict = yaml.safe_load(included_text)
        except yaml.YAMLError as yaml_err:
            raise osmo_errors.OSMOUserError(
                f'Failed to parse included file "{include_path}": {yaml_err}') from yaml_err

        if not isinstance(included_dict, dict):
            raise osmo_errors.OSMOUserError(
                f'Included file "{include_path}" must be a YAML mapping '
                f'at the top level.')

        child_ancestors = ancestors | {resolved_path}

        if 'includes' in included_dict:
            included_resolved_text = _resolve_includes(
                included_dict, os.path.dirname(resolved_path),
                child_ancestors)
            included_dict = yaml.safe_load(included_resolved_text)

        included_dict.pop('includes', None)
        included_dicts.append(included_dict)

    all_defaults: Dict[str, Any] = {}
    for included in included_dicts:
        all_defaults = deep_merge_dicts(
            all_defaults, included.get('default-values', {}))
    all_defaults = deep_merge_dicts(
        all_defaults, spec_dict.get('default-values', {}))

    for included in included_dicts:
        _expand_refs_in_workflow(included, all_defaults)
    _expand_refs_in_workflow(spec_dict, all_defaults)

    base_dict: Dict[str, Any] = {}
    for included in included_dicts:
        base_dict = deep_merge_dicts(base_dict, included)

    merged = deep_merge_dicts(base_dict, spec_dict)
    return yaml.safe_dump(merged, default_flow_style=False, sort_keys=False)


def _resolve_env_refs(text: str) -> str:
    """Replace ``${env:VAR}`` patterns with their values from ``os.environ``."""
    def _replacer(match: re.Match) -> str:
        return os.environ.get(match.group(1), '')
    return _ENV_REF_PATTERN.sub(_replacer, text)


def _resolve_env_refs_recursive(obj: Any) -> Any:
    """Walk *obj* and resolve ``${env:VAR}`` patterns in every string."""
    if isinstance(obj, str):
        return _resolve_env_refs(obj)
    if isinstance(obj, dict):
        return {k: _resolve_env_refs_recursive(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_resolve_env_refs_recursive(item) for item in obj]
    return obj


def _collect_scalar_variables(default_values: Dict[str, Any]) -> Dict[str, str]:
    """Return only the scalar (non-dict, non-list) entries from *default_values* as strings."""
    variables: Dict[str, str] = {}
    for key, value in default_values.items():
        if isinstance(value, str):
            variables[key] = value
        elif isinstance(value, (int, float, bool)):
            variables[key] = str(value)
    return variables


def _resolve_nested_variables(variables: Dict[str, str],
                              max_iterations: int = 10) -> None:
    """Iteratively resolve ``{ref}`` placeholders inside variable values themselves."""
    for _ in range(max_iterations):
        changed = False
        for key, value in list(variables.items()):
            if not isinstance(value, str):
                continue
            def _replacer(match: re.Match) -> str:
                ref = match.group(1)
                return variables.get(ref, match.group(0))
            new_value = _SCALAR_REF_PATTERN.sub(_replacer, value)
            if new_value != value:
                variables[key] = new_value
                changed = True
        if not changed:
            break


def _extract_and_remove_default_values(
        spec_text: str) -> tuple[Dict[str, Any] | None, str]:
    """Extract the ``default-values`` block from raw YAML text.

    Returns ``(default_values_dict, remaining_text)`` where the block has been
    removed from *remaining_text*.  Returns ``(None, spec_text)`` when no
    ``default-values`` section is found or when it cannot be parsed.
    """
    match = _DEFAULT_VALUES_BLOCK.search(spec_text)
    if match is None:
        return None, spec_text

    dv_section = 'default-values:\n' + match.group(1)
    try:
        parsed = yaml.safe_load(dv_section)
    except yaml.YAMLError:
        return None, spec_text

    default_values = parsed.get('default-values') if isinstance(parsed, dict) else None
    if not isinstance(default_values, dict):
        return None, spec_text

    remaining = spec_text[:match.start()] + spec_text[match.end():]
    return default_values, remaining


def resolve_default_values(spec_text: str) -> str:
    """Resolve ``default-values`` variables and ``${env:VAR}`` references.

    All processing happens at the text level so that Jinja-style ``{{var}}``
    patterns (which are invalid YAML when unquoted) can be substituted before
    the spec is parsed.

    Processing steps:

    1.  Resolve ``${env:VAR}`` patterns everywhere against ``os.environ``.
    2.  Extract and remove the ``default-values`` block from the raw text.
    3.  Collect scalar entries into a variable map.
    4.  Iteratively resolve ``{variable}`` references within the variable map
        itself (handles chained references like ``local_dir: "{repo_dir}/local"``).
    5.  Substitute ``{{variable}}`` (Jinja-style double-brace) and ``{variable}``
        (single-brace) patterns in the spec text for every known variable key.
        OSMO runtime tokens (``{{output}}``, ``{{input:0}}``, ``{{host:…}}``,
        ``{{item}}``, etc.) are left intact because their names are not keys in
        ``default-values``.
    6.  Return the cleaned text without the ``default-values`` section.

    If the spec has no ``default-values``, the text is returned with only
    ``${env:VAR}`` references resolved.
    """
    spec_text = _resolve_env_refs(spec_text)

    default_values, spec_text = _extract_and_remove_default_values(spec_text)
    if default_values is None:
        return spec_text

    resolved_defaults: Dict[str, Any] = _resolve_env_refs_recursive(default_values)
    variables = _collect_scalar_variables(resolved_defaults)
    _resolve_nested_variables(variables)

    def _jinja_replacer(match: re.Match) -> str:
        return variables.get(match.group(1), match.group(0))

    def _scalar_replacer(match: re.Match) -> str:
        return variables.get(match.group(1), match.group(0))

    spec_text = _JINJA_VAR_PATTERN.sub(_jinja_replacer, spec_text)
    spec_text = _SCALAR_REF_PATTERN.sub(_scalar_replacer, spec_text)

    return spec_text
