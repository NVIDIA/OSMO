"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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

from collections.abc import Mapping
import dataclasses
import itertools
import math
import re


MAX_WORKFLOW_LABELS = 16
MAX_WORKFLOW_LABEL_SELECTOR_BYTES = 4096
MAX_WORKFLOW_LABEL_SELECTOR_PATTERNS = 32

_LABEL_NAME_PATTERN = re.compile(
    r'^[A-Za-z0-9](?:[-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?$')
_WILDCARD_RUN_PATTERN = re.compile(r'\*+')
_DNS_LABEL_PATTERN = r'[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?'
_DNS_PREFIX_PATTERN = re.compile(
    rf'^(?=.{{1,253}}$){_DNS_LABEL_PATTERN}(?:\.{_DNS_LABEL_PATTERN})*$')


@dataclasses.dataclass(frozen=True)
class WorkflowLabelSelector:
    """A validated workflow label selector.

    Each value is either a literal (exact match) or an anchored glob pattern
    containing '*' wildcards; a workflow matches when any value matches.
    """

    key: str
    values: tuple[str, ...]


def validate_workflow_label_key(key: str) -> str:
    """Validate a workflow label key against Kubernetes qualified-name syntax.

    Any syntactically valid key is accepted. System-owned pod labels (the
    'osmo.' selectors and scheduler queue labels) are protected by merge
    order at stamping time, not by a deny-list here.
    """
    if not isinstance(key, str):
        raise ValueError('Workflow label keys must be strings.')

    parts = key.split('/')
    if len(parts) == 1:
        prefix = None
        name = parts[0]
    elif len(parts) == 2:
        prefix, name = parts
    else:
        raise ValueError(f'Workflow label key "{key}" is not a valid Kubernetes label key.')

    if prefix is not None:
        if not _DNS_PREFIX_PATTERN.fullmatch(prefix):
            raise ValueError(
                f'Workflow label key "{key}" has an invalid DNS prefix.')
    if not _LABEL_NAME_PATTERN.fullmatch(name):
        raise ValueError(
            f'Workflow label key "{key}" has an invalid name segment.')
    return key


def validate_workflow_label_value(value: str) -> str:
    """Validate a workflow label value against Kubernetes label-value syntax."""
    if not isinstance(value, str):
        raise ValueError('Workflow label values must be strings.')
    if not _LABEL_NAME_PATTERN.fullmatch(value):
        raise ValueError(
            f'Workflow label value "{value}" is not a valid non-empty Kubernetes label value.')
    return value


def validate_workflow_labels(labels: Mapping[str, str]) -> dict[str, str]:
    """Validate and copy a complete workflow labels map."""
    if not isinstance(labels, Mapping):
        raise ValueError('Workflow labels must be a map of string keys to string values.')
    if len(labels) > MAX_WORKFLOW_LABELS:
        raise ValueError(
            f'Workflows can have at most {MAX_WORKFLOW_LABELS} labels.')

    for key, value in labels.items():
        validate_workflow_label_key(key)
        validate_workflow_label_value(value)
    return dict(labels)


def apply_pod_label_prefix(
        labels: Mapping[str, str], pod_label_prefix: str) -> dict[str, str]:
    """Prepend the configured pod-label prefix to every workflow label key.

    Returns a copy with keys unchanged when the prefix is empty. The prefix is
    an opaque string prepended verbatim; callers validate the resulting keys
    with validate_prefixed_workflow_label_keys before stamping them onto pods.
    """
    if not pod_label_prefix:
        return dict(labels)
    return {f'{pod_label_prefix}{key}': value for key, value in labels.items()}


def validate_prefixed_workflow_label_keys(
        labels: Mapping[str, str], pod_label_prefix: str) -> None:
    """Validate every label key once the pod-label prefix is prepended.

    The prefix is not assumed to be a DNS prefix: the key and prefix are merged
    first, then the result is validated as a Kubernetes label key. Raises
    ValueError naming the key, the prefix, and the resulting key on the first
    invalid merge.
    """
    if not pod_label_prefix:
        return
    for key in labels:
        prefixed_key = f'{pod_label_prefix}{key}'
        try:
            validate_workflow_label_key(prefixed_key)
        except ValueError as error:
            raise ValueError(
                f'Label key "{key}" with the configured pod label prefix '
                f'"{pod_label_prefix}" forms an invalid Kubernetes label key '
                f'"{prefixed_key}": {error}') from error


def parse_workflow_label_assignment(assignment: str) -> tuple[str, str]:
    """Parse and validate a workflow label assignment in key=value form."""
    if '=' not in assignment:
        raise ValueError('Workflow labels must use key=value format.')
    key, value = assignment.split('=', 1)
    return validate_workflow_label_key(key), validate_workflow_label_value(value)


def _expand_workflow_label_selector_value(value: str) -> tuple[str, ...]:
    """Expand a selector value's alternation groups into glob patterns.

    Expansion is eager: the full cross product is materialized, capped at
    MAX_WORKFLOW_LABEL_SELECTOR_PATTERNS before wildcard-run collapsing and
    deduplication, and every expanded pattern must satisfy label-value syntax.
    """
    segments: list[tuple[str, ...]] = []
    literal_characters: list[str] = []
    position = 0
    while position < len(value):
        character = value[position]
        if character == '(':
            if literal_characters:
                segments.append((''.join(literal_characters),))
                literal_characters = []

            closing_position = value.find(')', position + 1)
            if closing_position == -1:
                raise ValueError(
                    'Workflow label selector alternatives must use '
                    '(value|value) format.')

            group_value = value[position + 1:closing_position]
            if '(' in group_value:
                raise ValueError(
                    'Workflow label selector alternatives cannot be nested.')

            alternatives = tuple(group_value.split('|'))
            if len(alternatives) < 2 or any(not item for item in alternatives):
                raise ValueError(
                    'Workflow label selector alternatives must contain at least '
                    'two non-empty values.')
            segments.append(alternatives)
            position = closing_position + 1
            continue

        if character in ')|':
            raise ValueError(
                'Workflow label selector alternatives must use '
                '(value|value) format.')

        literal_characters.append(character)
        position += 1

    if literal_characters:
        segments.append((''.join(literal_characters),))

    if (math.prod(len(alternatives) for alternatives in segments) >
            MAX_WORKFLOW_LABEL_SELECTOR_PATTERNS):
        raise ValueError(
            'Workflow label selectors can expand to at most '
            f'{MAX_WORKFLOW_LABEL_SELECTOR_PATTERNS} patterns.')

    normalized_patterns = dict.fromkeys(
        _WILDCARD_RUN_PATTERN.sub('*', ''.join(parts))
        for parts in itertools.product(*segments))
    for normalized_pattern in normalized_patterns:
        # Wildcards are not valid label characters; validate syntax and
        # length with a stand-in character per wildcard.
        validate_workflow_label_value(normalized_pattern.replace('*', 'a'))
    return tuple(normalized_patterns)


def parse_workflow_label_selector(selector: str) -> WorkflowLabelSelector:
    """Parse an exact or anchored glob-alternation selector."""
    if not isinstance(selector, str):
        raise ValueError('Workflow label selectors must be strings.')
    try:
        selector_bytes = selector.encode('utf-8')
    except UnicodeEncodeError as error:
        raise ValueError('Workflow label selectors must be valid UTF-8.') from error
    if len(selector_bytes) > MAX_WORKFLOW_LABEL_SELECTOR_BYTES:
        raise ValueError(
            'Workflow label selectors can be at most '
            f'{MAX_WORKFLOW_LABEL_SELECTOR_BYTES} bytes.')
    if '=' not in selector:
        raise ValueError('Workflow label selectors must use key=value format.')

    key, value = selector.split('=', 1)
    return WorkflowLabelSelector(
        key=validate_workflow_label_key(key),
        values=_expand_workflow_label_selector_value(value),
    )
