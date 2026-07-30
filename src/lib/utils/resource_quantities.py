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

from collections.abc import Collection, Mapping
import math
import re
from typing import Any, Final


RESOURCE_REGEX: Final = r'(?P<size>(\d+(?:\.\d+)?))(?P<unit>([a-zA-Z]*))'

# Binary shifts relative to Gi. Kubernetes resource payloads use a mix of
# plain byte counts and binary unit suffixes, while OSMO presents memory and
# storage in Gi.
MEASUREMENTS: Final = {
    'T': 10,
    'Ti': 10,
    'TiB': 10,
    'G': 0,
    'Gi': 0,
    'GiB': 0,
    'M': -10,
    'Mi': -10,
    'MiB': -10,
    'K': -20,
    'Ki': -20,
    'KiB': -20,
    'B': -30,
    'm': -40,
}
MEASUREMENTS_SHORT: Final = {'Ti', 'Gi', 'Mi', 'Ki', 'B', 'm'}

RESOURCE_UNITS: Final = {
    'storage': 'Gi',
    'cpu': None,
    'memory': 'Gi',
    'gpu': None,
}


class UnsupportedResourceUnitError(ValueError):
    """A resource value or requested target has an unsupported unit."""

    def __init__(self, value: object) -> None:
        super().__init__(value)
        self.value = value


def convert_resource_value(value: object, target: str = 'GiB') -> float:
    """Convert a byte quantity to ``target`` using OSMO's binary units."""
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError(f'Failure in converting resource value {value}')

    match = re.fullmatch(RESOURCE_REGEX, str(value))
    if not match:
        raise ValueError(f'Failure in converting resource value {value}')

    unit = match.group('unit') or 'B'
    if unit not in MEASUREMENTS:
        raise UnsupportedResourceUnitError(value)
    if target not in MEASUREMENTS:
        raise UnsupportedResourceUnitError(target)

    power = MEASUREMENTS[unit] - MEASUREMENTS[target]
    return float(match.group('size')) * 2 ** power


def convert_quantity_value(name: str, value: object) -> float:
    """Convert one API quantity to the unit exposed by OSMO's CLI."""
    if name not in RESOURCE_UNITS:
        raise ValueError(f'Unsupported resource quantity {name}.')
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError(f'Invalid {name} resource quantity.')

    converted = (
        float(value)
        if RESOURCE_UNITS[name] is None
        else convert_resource_value(value)
    )
    if not math.isfinite(converted):
        raise ValueError(f'Invalid {name} resource quantity.')
    return converted


def round_used_capacity(used: float, capacity: float) -> tuple[int, int]:
    """Ceil usage, floor capacity, and clamp usage into the capacity range."""
    rounded_capacity = max(0, math.floor(capacity))
    rounded_used = max(0, min(math.ceil(used), rounded_capacity))
    return rounded_used, rounded_capacity


def normalize_resource_capacities(
    resource: Mapping[str, Any],
    pool: str,
    platform: str,
    resource_names: Collection[str] | None = None,
) -> dict[str, dict[str, int | str]]:
    """Project selected capacities while preserving valid zero count fields.

    The CLI resource-detail view reports capacity without usage. Kubernetes
    commonly omits the GPU allocatable key on CPU-only nodes even though
    Core's exposed resource fields correctly describe it as zero.
    """
    capacity_fields = _selected_capacity_fields(resource, pool, platform)
    selected_names = (
        frozenset(resource_names)
        if resource_names is not None
        else frozenset(RESOURCE_UNITS)
    )
    capacities: dict[str, dict[str, int | str]] = {}
    for name, unit in RESOURCE_UNITS.items():
        if name not in selected_names:
            continue
        if name in capacity_fields:
            raw_capacity = capacity_fields[name]
        elif name in ('cpu', 'gpu'):
            raw_capacity = 0
        else:
            continue
        try:
            capacity = convert_quantity_value(name, raw_capacity)
        except (ValueError, TypeError, OverflowError):
            continue

        quantity: dict[str, int | str] = {
            'capacity': max(0, math.floor(capacity)),
        }
        if unit is not None:
            quantity['unit'] = unit
        capacities[name] = quantity
    return capacities


def normalize_resource_quantities(
    resource: Mapping[str, Any],
    pool: str,
    platform: str,
) -> dict[str, dict[str, int | str]]:
    """Project one node assignment into capacity, used, free, and unit.

    Platform-specific capacity takes precedence when present. Availability is
    deliberately derived from normalized capacity and usage so all callers
    have the same rounding behavior even when ``platform_available_fields`` is
    absent or was calculated using unrounded values.
    """
    capacity_fields = _selected_capacity_fields(resource, pool, platform)
    usage_fields = resource.get('usage_fields')
    if not isinstance(usage_fields, Mapping):
        return {}

    quantities: dict[str, dict[str, int | str]] = {}
    for name, unit in RESOURCE_UNITS.items():
        if name not in capacity_fields:
            continue
        if name in ('cpu', 'gpu'):
            raw_usage = usage_fields.get(name, 0)
        elif name in usage_fields:
            raw_usage = usage_fields[name]
        else:
            continue
        try:
            capacity = convert_quantity_value(name, capacity_fields[name])
            used = convert_quantity_value(name, raw_usage)
        except (ValueError, TypeError, OverflowError):
            # Match the existing CLI/internal MCP projection: one malformed or
            # unsupported quantity does not discard the other resource kinds.
            continue
        if capacity <= 0:
            continue

        rounded_used, rounded_capacity = round_used_capacity(used, capacity)
        quantity: dict[str, int | str] = {
            'capacity': rounded_capacity,
            'used': rounded_used,
            'free': rounded_capacity - rounded_used,
        }
        if unit is not None:
            quantity['unit'] = unit
        quantities[name] = quantity
    return quantities


def _selected_capacity_fields(
    resource: Mapping[str, Any],
    pool: str,
    platform: str,
) -> Mapping[str, Any]:
    platform_fields = resource.get('platform_allocatable_fields')
    if isinstance(platform_fields, Mapping):
        pool_fields = platform_fields.get(pool)
        if isinstance(pool_fields, Mapping):
            selected_fields = pool_fields.get(platform)
            if isinstance(selected_fields, Mapping):
                return selected_fields

    allocatable_fields = resource.get('allocatable_fields')
    return allocatable_fields if isinstance(allocatable_fields, Mapping) else {}
