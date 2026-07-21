"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

import argparse
from collections.abc import Mapping
import dataclasses
import os
import pathlib
import re
from typing import Dict

from . import common, osmo_errors
from ..data.storage import constants


MAX_WORKFLOW_LABELS = 16
MAX_WORKFLOW_LABEL_SELECTOR_PATTERNS = 32
WORKFLOW_LABEL_RESERVED_PREFIXES = ('osmo.', 'kai.scheduler/', 'runai/')
WORKFLOW_LABEL_RESERVED_DNS_SUFFIXES = ('kubernetes.io', 'k8s.io')

_LABEL_NAME_PATTERN = re.compile(
    r'^[A-Za-z0-9](?:[-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?$')
_DNS_LABEL_PATTERN = r'[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?'
_DNS_PREFIX_PATTERN = re.compile(
    rf'^(?=.{{1,253}}$){_DNS_LABEL_PATTERN}(?:\.{_DNS_LABEL_PATTERN})*$')


@dataclasses.dataclass(frozen=True)
class WorkflowLabelSelector:
    """A validated workflow label selector.

    Each value is either a literal (exact match) or an anchored glob pattern
    containing ``*`` wildcards; a workflow matches when any value matches.
    """

    key: str
    values: tuple[str, ...]


def validate_workflow_label_key(key: str) -> str:
    """Validate a workflow label key against Kubernetes qualified-name syntax."""
    if not isinstance(key, str):
        raise ValueError('Workflow label keys must be strings.')
    if any(key.startswith(prefix) for prefix in WORKFLOW_LABEL_RESERVED_PREFIXES):
        raise ValueError(f'Workflow label key "{key}" is reserved.')

    parts = key.split('/')
    if len(parts) == 1:
        prefix = None
        name = parts[0]
    elif len(parts) == 2:
        prefix, name = parts
    else:
        raise ValueError(f'Workflow label key "{key}" is not a valid Kubernetes label key.')

    if prefix is not None:
        if (prefix in WORKFLOW_LABEL_RESERVED_DNS_SUFFIXES or any(
                prefix.endswith(f'.{suffix}')
                for suffix in WORKFLOW_LABEL_RESERVED_DNS_SUFFIXES)):
            raise ValueError(f'Workflow label key "{key}" is reserved.')
        if not _DNS_PREFIX_PATTERN.fullmatch(prefix):
            raise ValueError(
                f'Workflow label key "{key}" has an invalid DNS prefix.')
    if not _LABEL_NAME_PATTERN.fullmatch(name):
        raise ValueError(
            f'Workflow label key "{key}" has an invalid name segment.')
    return key


def validate_workflow_label_value(value: str) -> str:
    """Validate a non-empty workflow label value against Kubernetes syntax."""
    if not isinstance(value, str):
        raise ValueError('Workflow label values must be strings.')
    if not _LABEL_NAME_PATTERN.fullmatch(value):
        raise ValueError(
            f'Workflow label value "{value}" must be a non-empty valid Kubernetes label value.')
    return value


def validate_workflow_labels(labels: Mapping[str, str]) -> Dict[str, str]:
    """Validate and copy a complete workflow labels map."""
    if not isinstance(labels, Mapping):
        raise ValueError('Workflow labels must be a map of string keys to string values.')
    if len(labels) > MAX_WORKFLOW_LABELS:
        raise ValueError(
            f'Workflows can have at most {MAX_WORKFLOW_LABELS} labels.')

    validated_labels: Dict[str, str] = {}
    for key, value in labels.items():
        validated_key = validate_workflow_label_key(key)
        validated_labels[validated_key] = validate_workflow_label_value(value)
    return validated_labels


def parse_workflow_label_assignment(assignment: str) -> tuple[str, str]:
    """Parse and validate a workflow label assignment in key=value form."""
    if not isinstance(assignment, str) or '=' not in assignment:
        raise ValueError('Workflow labels must use key=value format.')
    key, value = assignment.split('=', 1)
    return validate_workflow_label_key(key), validate_workflow_label_value(value)


def _expand_workflow_label_selector_pattern(value: str) -> tuple[str, ...]:
    """Expand non-nested alternation groups into complete glob patterns."""
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

    expanded_patterns: tuple[str, ...] = ('',)
    for alternatives in segments:
        if (len(expanded_patterns) * len(alternatives) >
                MAX_WORKFLOW_LABEL_SELECTOR_PATTERNS):
            raise ValueError(
                'Workflow label selectors can expand to at most '
                f'{MAX_WORKFLOW_LABEL_SELECTOR_PATTERNS} patterns.')
        expanded_patterns = tuple(
            prefix + alternative
            for prefix in expanded_patterns
            for alternative in alternatives
        )

    normalized_patterns: list[str] = []
    for pattern in expanded_patterns:
        normalized_pattern = re.sub(r'\*+', '*', pattern)
        validate_workflow_label_value(normalized_pattern.replace('*', 'a'))
        if normalized_pattern not in normalized_patterns:
            normalized_patterns.append(normalized_pattern)
    return tuple(normalized_patterns)


def parse_workflow_label_selector(selector: str) -> WorkflowLabelSelector:
    """Parse an exact or anchored glob-alternation selector."""
    if not isinstance(selector, str) or '=' not in selector:
        raise ValueError('Workflow label selectors must use key=value format.')

    key, value = selector.split('=', 1)
    return WorkflowLabelSelector(
        key=validate_workflow_label_key(key),
        values=_expand_workflow_label_selector_pattern(value),
    )


def positive_integer(x: int):
    x = int(x)
    if x <= 0:
        raise argparse.ArgumentTypeError('The value should be greater than zero.')
    return x


def positive_float(x: float):
    x = float(x)
    if x <= 0:
        raise argparse.ArgumentTypeError('The value should be greater than zero.')
    return x


def non_negative_integer(x: int):
    x = int(x)
    if x < 0:
        raise argparse.ArgumentTypeError('The value should be greater than or equal to zero.')
    return x


def is_regex(regex: str):
    try:
        re.compile(regex)
        return regex
    except re.error as _:
        raise argparse.ArgumentTypeError(f'Invalid regex: {regex}')


def is_storage_path(path: str):
    if re.fullmatch(constants.STORAGE_BACKEND_REGEX, path):
        return path
    else:
        raise argparse.ArgumentTypeError(f'Invalid storage path: {path}')


def is_storage_credential_path(path: str):
    if re.fullmatch(constants.STORAGE_CREDENTIAL_REGEX, path):
        return path
    else:
        raise argparse.ArgumentTypeError(f'Invalid storage credential path: {path}')


def valid_path(path):
    path = os.path.abspath(path)
    if os.path.isdir(path) or os.path.isfile(path):
        return path
    else:
        raise osmo_errors.OSMOUserError(f'{path} is not a valid path')


def valid_file_path(path):
    if os.path.isdir(path):
        raise argparse.ArgumentTypeError(f'{path} is a directory. Please give a file path!')
    if os.path.isfile(path):
        raise argparse.ArgumentTypeError(f'{path} file already exists!')
    return path


def date_str(date: str) -> str:
    if common.valid_date_format(date, '%Y-%m-%d'):
        return date
    raise argparse.ArgumentTypeError(f'Invalid date format: {date}')


def datetime_str(datetime: str) -> str:
    if common.valid_date_format(datetime, '%Y-%m-%dT%H:%M:%S'):
        return datetime
    raise argparse.ArgumentTypeError(f'Invalid datetime format: {datetime}')


def date_or_datetime_str(date_or_datetime: str) -> str:
    try:
        return date_str(date_or_datetime)
    except argparse.ArgumentTypeError:
        return datetime_str(date_or_datetime)


def sanitized_path(path: str) -> str | None:
    """
    Sanitizes a path. It removes any double slashes and ensures that the path
    ensures that the path does not contain any '..' components.

    :param path: The path to sanitize.
    :return: The sanitized path or None if the path is invalid.
    """
    if not path:
        return None
    try:
        pathlib.Path(path)
        normalized = os.path.normpath(path)
        if '..' in normalized:
            return None
        return normalized
    except ValueError:
        return None
