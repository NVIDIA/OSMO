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

import logging

from src.service.mcp import request_context


_LOGGER = logging.getLogger(__name__)
_STATIC_ROUTES = frozenset({
    '/api/profile/settings',
    '/api/pool_quota',
    '/api/resources',
    '/api/workflow',
    '/api/app',
    '/api/credentials',
})
_WORKFLOW_SUFFIXES = frozenset({
    'logs',
    'error_logs',
    'events',
    'spec',
    'cancel',
})


def route_template(path: str) -> str:
    """Return a static telemetry label without logging resource identifiers."""
    if path in _STATIC_ROUTES:
        return path

    parts = path.split('/')
    if len(parts) in (4, 5) and parts[:3] == ['', 'api', 'workflow']:
        template = '/api/workflow/{workflow_id}'
        if len(parts) == 5 and parts[4] in _WORKFLOW_SUFFIXES:
            return f'{template}/{parts[4]}'
        if len(parts) == 4:
            return template

    if (
        len(parts) in (5, 6)
        and parts[:4] == ['', 'api', 'app', 'user']
    ):
        template = '/api/app/user/{app_name}'
        if len(parts) == 6 and parts[5] in ('rename', 'spec'):
            return f'{template}/{parts[5]}'
        if len(parts) == 5:
            return template

    if len(parts) == 4 and parts[:3] == ['', 'api', 'resources']:
        return '/api/resources/{node_name}'

    if len(parts) == 4 and parts[:3] == ['', 'api', 'credentials']:
        return '/api/credentials/{credential_name}'

    if (
        len(parts) == 5
        and parts[:3] == ['', 'api', 'pool']
        and parts[4] == 'workflow'
    ):
        return '/api/pool/{pool}/workflow'

    if (
        len(parts) == 7
        and parts[:3] == ['', 'api', 'pool']
        and parts[4] == 'workflow'
        and parts[6] == 'restart'
    ):
        return '/api/pool/{pool}/workflow/{workflow_id}/restart'

    return '/api/{unclassified}'


def log_upstream_call(
    *,
    method: str,
    path: str,
    status_code: int | None,
    duration_ms: float,
    outcome: str,
    request_id: str | None,
) -> None:
    """Emit one identifier-free structured record for an upstream call."""
    _LOGGER.info(
        'OSMO MCP upstream call tool=%s method=%s route=%s status=%s '
        'outcome=%s duration_ms=%.3f request_id=%s',
        request_context.get_active_tool_name() or '-',
        method,
        route_template(path),
        status_code if status_code is not None else '-',
        outcome,
        duration_ms,
        request_id or '-',
    )


def log_tool_outcome(
    *,
    tool_name: str,
    outcome: str,
    duration_ms: float,
    request_id: str | None,
) -> None:
    """Emit the final result classification after MCP result validation."""
    _LOGGER.info(
        'OSMO MCP tool call tool=%s outcome=%s duration_ms=%.3f request_id=%s',
        tool_name,
        outcome,
        duration_ms,
        request_id or '-',
    )
