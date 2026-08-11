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

import argparse
import os
import pathlib
import re

from . import common, osmo_errors
from . import workflow_labels
from ..data.storage import constants


MAX_WORKFLOW_LABELS = workflow_labels.MAX_WORKFLOW_LABELS
MAX_WORKFLOW_LABEL_SELECTOR_BYTES = (
    workflow_labels.MAX_WORKFLOW_LABEL_SELECTOR_BYTES
)
MAX_WORKFLOW_LABEL_SELECTOR_PATTERNS = (
    workflow_labels.MAX_WORKFLOW_LABEL_SELECTOR_PATTERNS
)
WorkflowLabelSelector = workflow_labels.WorkflowLabelSelector
validate_workflow_label_key = workflow_labels.validate_workflow_label_key
validate_workflow_label_value = workflow_labels.validate_workflow_label_value
validate_workflow_labels = workflow_labels.validate_workflow_labels
apply_pod_label_prefix = workflow_labels.apply_pod_label_prefix
validate_prefixed_workflow_label_keys = (
    workflow_labels.validate_prefixed_workflow_label_keys
)
parse_workflow_label_assignment = (
    workflow_labels.parse_workflow_label_assignment
)
parse_workflow_label_selector = workflow_labels.parse_workflow_label_selector


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
