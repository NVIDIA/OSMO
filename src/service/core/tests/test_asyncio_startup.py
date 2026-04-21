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

import asyncio
import importlib
import os
import types
import unittest
from unittest import mock


class _FakeProgressWriter:
    def report_progress(self):
        pass


class _FakeMeter:
    def start_server(self):
        pass


class _FakeMetricCreator:
    def __init__(self, config=None):
        self.config = config

    def get_meter_instance(self):
        return _FakeMeter()


class _FakeWorkflowServiceContext:
    def __init__(self, config, database):
        self.config = config
        self.database = database

    @staticmethod
    def set(context):
        _ = context
        pass


class _FakeUvicornServer:
    def __init__(self, config):
        self.config = config
        self.serve_calls = 0

    async def serve(self):
        self.serve_calls += 1


async def _idle_forever():
    await asyncio.Future()


def _run_without_current_loop(main_function):
    asyncio.set_event_loop(None)
    try:
        main_function()
    finally:
        asyncio.set_event_loop(None)


class AsyncioStartupTestCase(unittest.TestCase):
    """Regression tests for asyncio service startup on Python 3.14."""

    def test_logger_main_starts_without_default_event_loop(self):
        logger = importlib.import_module('src.service.logger.logger')
        config = types.SimpleNamespace(
            host='http://127.0.0.1:8000',
            progress_file='/tmp/logger-progress',
            progress_period=60,
        )

        with (
            mock.patch.object(logger.LoggerServiceConfig, 'load', return_value=config),
            mock.patch.object(logger.src.lib.utils.logging, 'init_logger'),
            mock.patch.object(logger.connectors, 'PostgresConnector'),
            mock.patch.object(
                logger.progress,
                'ProgressWriter',
                return_value=_FakeProgressWriter(),
            ),
            mock.patch.object(logger.uvicorn, 'Config', return_value=object()),
            mock.patch.object(logger.uvicorn, 'Server', _FakeUvicornServer),
        ):
            _run_without_current_loop(logger.main)

    def test_agent_main_starts_without_default_event_loop(self):
        agent_service = importlib.import_module('src.service.agent.agent_service')
        workflow_config = types.SimpleNamespace(
            host='http://127.0.0.1:8000',
            progress_file='/tmp/agent-progress',
        )
        agent_config = types.SimpleNamespace(progress_period=60)

        with (
            mock.patch.object(
                agent_service.objects.WorkflowServiceConfig,
                'load',
                return_value=workflow_config,
            ),
            mock.patch.object(
                agent_service.BackendServiceConfig,
                'load',
                return_value=agent_config,
            ),
            mock.patch.object(agent_service.src.lib.utils.logging, 'init_logger'),
            mock.patch.object(
                agent_service.connectors,
                'PostgresConnector',
                return_value=object(),
            ),
            mock.patch.object(agent_service.connectors, 'RedisConnector'),
            mock.patch.object(
                agent_service.metrics,
                'MetricCreator',
                _FakeMetricCreator,
            ),
            mock.patch.object(
                agent_service.objects,
                'WorkflowServiceContext',
                _FakeWorkflowServiceContext,
            ),
            mock.patch.object(
                agent_service.progress,
                'ProgressWriter',
                return_value=_FakeProgressWriter(),
            ),
            mock.patch.object(agent_service.uvicorn, 'Config', return_value=object()),
            mock.patch.object(agent_service.uvicorn, 'Server', _FakeUvicornServer),
        ):
            _run_without_current_loop(agent_service.main)

    def test_router_main_starts_without_default_event_loop(self):
        with (
            mock.patch.dict(
                os.environ,
                {'OSMO_POSTGRES_PASSWORD': 'test-password'},
            ),
            mock.patch('fastapi.applications.FastAPI.add_middleware'),
        ):
            router = importlib.import_module('src.service.router.router')
        config = types.SimpleNamespace(host='http://127.0.0.1:8000')

        with (
            mock.patch.object(router.RouterServiceConfig, 'load', return_value=config),
            mock.patch.object(router.src.lib.utils.logging, 'init_logger'),
            mock.patch.object(router.connectors, 'PostgresConnector'),
            mock.patch.object(
                router,
                'check_webserver_timeout',
                side_effect=_idle_forever,
            ),
            mock.patch.object(router.uvicorn, 'Config', return_value=object()),
            mock.patch.object(router.uvicorn, 'Server', _FakeUvicornServer),
        ):
            _run_without_current_loop(router.main)


if __name__ == '__main__':
    unittest.main()
