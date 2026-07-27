"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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

from collections.abc import Mapping, Sequence
from typing import TypeVar
from urllib import parse

import pydantic

from src.service.mcp.tool_errors import PublicToolError, uncertain_write_error


_MAX_PATH_SEGMENT_BYTES = 512

_Model = TypeVar('_Model', bound=pydantic.BaseModel)


def safe_path_segment(value: str, *, field: str) -> str:
    """Validate and percent-encode one user-selected OSMO path segment."""
    try:
        encoded_length = len(value.encode('utf-8'))
    except (AttributeError, UnicodeEncodeError):
        encoded_length = _MAX_PATH_SEGMENT_BYTES + 1
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or encoded_length > _MAX_PATH_SEGMENT_BYTES
        or value in ('.', '..')
        or '/' in value
        or '\\' in value
        or any(
            ord(character) < 0x20 or ord(character) == 0x7F
            for character in value
        )
    ):
        raise PublicToolError(f'Invalid {field}.')
    return parse.quote(value, safe='-._~')


def validate_response(
    model: type[_Model],
    response: object,
    *,
    operation: str | None = None,
    error_message: str | None = None,
) -> _Model:
    """Strictly validate an upstream DTO behind one fixed public error."""
    if (operation is None) == (error_message is None):
        raise ValueError('Specify exactly one response validation error.')
    try:
        return model.model_validate(response, strict=True)
    except pydantic.ValidationError:
        message = error_message or (
            f'OSMO returned an invalid response while attempting to {operation}.'
        )
        raise PublicToolError(message) from None


def validate_mutation_response(
    model: type[_Model],
    response: object,
    *,
    operation: str,
) -> _Model:
    """Validate a successful write result or classify its outcome as unknown."""
    try:
        return validate_response(
            model,
            response,
            operation=operation,
        )
    except PublicToolError:
        raise uncertain_write_error(operation) from None


def validate_integer(
    value: int,
    *,
    field: str,
    minimum: int,
    maximum: int | None = None,
) -> int:
    """Require a strict JSON integer within inclusive bounds."""
    if not _is_valid_integer(
        value,
        minimum=minimum,
        maximum=maximum,
    ):
        raise PublicToolError(f'Invalid {field}.')
    return value


def validate_optional_integer(
    value: int | None,
    *,
    field: str,
    minimum: int,
    maximum: int | None = None,
) -> int | None:
    """Validate an optional strict integer without coercion."""
    if value is None:
        return None
    return validate_integer(
        value,
        field=field,
        minimum=minimum,
        maximum=maximum,
    )


def validate_page(
    limit: int,
    offset: int,
    *,
    maximum_limit: int,
    error_message: str | None = None,
) -> tuple[int, int]:
    """Validate strict non-boolean pagination arguments."""
    valid = (
        _is_valid_integer(limit, minimum=1, maximum=maximum_limit)
        and _is_valid_integer(offset, minimum=0)
    )
    if not valid:
        if error_message is not None:
            raise PublicToolError(error_message)
        if not _is_valid_integer(limit, minimum=1, maximum=maximum_limit):
            raise PublicToolError('Invalid limit.')
        raise PublicToolError('Invalid offset.')
    return limit, offset


def validate_query_size(
    query: Mapping[str, object],
    *,
    operation: str,
    max_bytes: int,
) -> None:
    """Bound a query by the exact ASCII byte length sent upstream."""
    encoded_query = parse.urlencode(query, doseq=True).encode('ascii')
    if len(encoded_query) > max_bytes:
        raise PublicToolError(f'{operation} is too large.')


def validate_query_text(
    value: str,
    *,
    field: str,
    max_bytes: int,
) -> str:
    """Validate one bounded, trimmed, control-free query value."""
    try:
        encoded_length = len(value.encode('utf-8'))
    except (AttributeError, UnicodeEncodeError):
        encoded_length = max_bytes + 1
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or encoded_length > max_bytes
        or any(
            ord(character) < 0x20 or ord(character) == 0x7F
            for character in value
        )
    ):
        raise PublicToolError(f'Invalid {field}.')
    return value


def validate_query_values(
    values: Sequence[str],
    *,
    field: str,
    max_count: int,
    max_value_bytes: int,
    deduplicate: bool = False,
) -> list[str]:
    """Validate one bounded list of query values without coercion."""
    if (
        not isinstance(values, list)
        or not values
        or len(values) > max_count
    ):
        raise PublicToolError(f'Invalid {field}.')
    validated = [
        validate_query_text(
            value,
            field=field,
            max_bytes=max_value_bytes,
        )
        for value in values
    ]
    return list(dict.fromkeys(validated)) if deduplicate else validated


def validate_inline_text(
    value: object,
    *,
    field: str,
    max_bytes: int,
) -> str:
    """Validate bounded, non-empty multiline UTF-8 tool input."""
    if not isinstance(value, str):
        encoded_value = b''
    else:
        try:
            encoded_value = value.encode('utf-8')
        except UnicodeEncodeError:
            encoded_value = b''
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(encoded_value) > max_bytes
        or any(
            not character.isprintable()
            and character not in '\n\r\t'
            for character in value
        )
    ):
        raise PublicToolError(f'Invalid {field}.')
    return value


def _is_valid_integer(
    value: object,
    *,
    minimum: int,
    maximum: int | None = None,
) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and value >= minimum
        and (maximum is None or value <= maximum)
    )
