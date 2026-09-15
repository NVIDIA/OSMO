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
_FRAMEWORK_LOGGER = logging.getLogger('src.service.mcp.framework')
# These pinned framework sources log request payloads, rejected arguments, or
# exception tracebacks before the OSMO tool boundary can sanitize them. Their
# authentication loggers have a separate lifecycle and are not changed here.
_FRAMEWORK_COMPONENTS = {
    'fastmcp.server.server': 'server',
    'fastmcp.server.mixins.mcp_operations': 'dispatch',
    'fastmcp.server.low_level': 'initialization',
    'fastmcp.server.http': 'http',
    'fastmcp.tools.base': 'tool_result',
    'fastmcp.tools.function_tool': 'tool_function',
    'mcp.server.lowlevel.server': 'protocol',
    'mcp.server.streamable_http': 'transport',
    'mcp.server.streamable_http_manager': 'session_manager',
}
_FRAMEWORK_LIFECYCLE_MESSAGES = frozenset({
    'StreamableHTTP session manager started',
    'StreamableHTTP session manager shutting down',
})
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


class _FrameworkLogHandler(logging.Handler):
    """Project framework diagnostics before any raw record reaches a sink."""

    def __init__(self, component: str) -> None:
        super().__init__()
        self._component = component

    def emit(self, record: logging.LogRecord) -> None:
        _log_framework_event(record, self._component)


class _SDKSessionLogFilter(logging.Filter):
    """Project the pinned SDK session's direct root-logger diagnostics."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not record.pathname.endswith('/mcp/shared/session.py'):
            return True
        _log_framework_event(record, 'session')
        return False


_SDK_SESSION_LOG_FILTER = _SDKSessionLogFilter()


def _log_framework_event(record: logging.LogRecord, component: str) -> None:
    if (
        isinstance(record.msg, str)
        and record.msg in _FRAMEWORK_LIFECYCLE_MESSAGES
        and not record.args
        and record.exc_info is None
    ):
        _log_best_effort(_FRAMEWORK_LOGGER, record.levelno, record.msg)
    else:
        # funcName is Python source metadata, not the requested tool name.
        # Re-emission excludes the original args, traceback, and extras.
        _log_best_effort(
            _FRAMEWORK_LOGGER,
            record.levelno,
            'MCP framework event component=%s operation=%s',
            component,
            record.funcName,
        )


def configure_framework_logging() -> None:
    """Install the MCP process's payload-free dispatch and transport logging.

    Configure the source loggers because FastMCP has its own non-propagating
    handlers, and protocol payloads may be logged before a tool context exists.
    Preserve severity and code operation at every configured logging level.
    """
    for name, component in _FRAMEWORK_COMPONENTS.items():
        logger = logging.getLogger(name)
        if not (
            len(logger.handlers) == 1
            and isinstance(logger.handlers[0], _FrameworkLogHandler)
        ):
            for handler in logger.handlers[:]:
                logger.removeHandler(handler)
            logger.addHandler(_FrameworkLogHandler(component))
        logger.propagate = False
    # mcp.shared.session logs rejected envelopes directly on the root logger.
    # Child loggers propagate to root handlers without re-running root filters,
    # so the safe framework logger above does not recurse through this filter.
    logging.getLogger().addFilter(_SDK_SESSION_LOG_FILTER)


def _log_best_effort(
    logger: logging.Logger,
    level: int,
    message: str,
    *arguments: object,
) -> None:
    """A logging sink failure must never change a request or write outcome."""
    try:
        logger.log(level, message, *arguments)
    except Exception:  # pylint: disable=broad-exception-caught
        pass


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
    _log_best_effort(
        _LOGGER,
        logging.INFO,
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
    _log_best_effort(
        _LOGGER,
        logging.INFO,
        'OSMO MCP tool call tool=%s outcome=%s duration_ms=%.3f request_id=%s',
        tool_name,
        outcome,
        duration_ms,
        request_id or '-',
    )
