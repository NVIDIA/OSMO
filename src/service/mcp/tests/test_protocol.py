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

from collections.abc import Callable
import json
from typing import Annotated
import unittest
from unittest import mock

import httpx
from mcp.server.fastmcp.exceptions import ToolError
import pydantic

from src.lib.utils import login
from src.service.mcp import protocol, tool_errors, request_context


def _failing_tool(message: str) -> Callable[[], object]:
    async def failure() -> None:
        raise tool_errors.PublicToolError(message)

    return failure


class PublicExceptionBoundaryTest(unittest.IsolatedAsyncioTestCase):
    """Exercise exception classification through the real MCP transport."""

    async def _call_tool(
        self,
        function: Callable[..., object],
        arguments: dict[str, object] | None = None,
        *,
        requested_name: str = 'boundary_test_tool',
    ) -> httpx.Response:
        mcp_server = protocol.OSMOFastMCP(
            name='OSMO public exception boundary test',
            host='0.0.0.0',
            port=8000,
            streamable_http_path='/mcp',
            stateless_http=True,
            json_response=True,
        )
        mcp_server.add_tool(function, name='boundary_test_tool')
        application = mcp_server.streamable_http_app()
        application.add_middleware(
            request_context.RequestContextMiddleware,
            path='/mcp',
        )
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=application),
                base_url='http://mcp.test',
            ) as client:
                return await client.post(
                    '/mcp',
                    headers={
                        'Accept': 'application/json, text/event-stream',
                        'Content-Type': 'application/json',
                        login.OSMO_AUTH_HEADER: 'Bearer boundary-test-secret',
                        login.OSMO_USER_HEADER: 'boundary-user@example.com',
                        request_context.REQUEST_ID_HEADER: 'boundary-request-123',
                    },
                    json={
                        'jsonrpc': '2.0',
                        'id': 1,
                        'method': 'tools/call',
                        'params': {
                            'name': requested_name,
                            'arguments': arguments or {},
                        },
                    },
                )

    async def test_plain_tool_error_is_generic(self) -> None:
        unsafe_detail = 'plain-tool-error-detail-must-not-be-public'

        async def unmarked_failure() -> None:
            raise ToolError(unsafe_detail)

        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured:
            response = await self._call_tool(unmarked_failure)

        result = response.json()['result']
        self.assertTrue(result['isError'])
        result_text = json.dumps(result)
        self.assertIn(tool_errors.GENERIC_TOOL_ERROR, result_text)
        self.assertNotIn(unsafe_detail, result_text)
        self.assertEqual(len(captured.output), 1)
        self.assertIn('outcome=unexpected_error', captured.output[0])
        self.assertNotIn(unsafe_detail, captured.output[0])

    async def test_explicit_public_tool_error_remains_public(self) -> None:
        async def expected_failure() -> None:
            raise tool_errors.PublicToolError(
                'The requested workflow is not available.'
            )

        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured:
            response = await self._call_tool(expected_failure)

        result_text = json.dumps(response.json()['result'])
        self.assertIn('The requested workflow is not available.', result_text)
        self.assertNotIn(tool_errors.GENERIC_TOOL_ERROR, result_text)
        self.assertEqual(len(captured.output), 1)
        self.assertIn('outcome=public_error', captured.output[0])

    async def test_unexpected_exception_is_generic(self) -> None:
        unexpected_secret = 'unexpected-runtime-detail-secret'

        async def unexpected_failure() -> None:
            raise RuntimeError(f'database failure: {unexpected_secret}')

        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured:
            response = await self._call_tool(unexpected_failure)

        result = response.json()['result']
        self.assertTrue(result['isError'])
        result_text = json.dumps(result)
        self.assertIn(tool_errors.GENERIC_TOOL_ERROR, result_text)
        self.assertNotIn(unexpected_secret, result_text)
        self.assertNotIn('RuntimeError', result_text)
        self.assertLess(len(response.content), 16 * 1024)
        self.assertEqual(len(captured.output), 1)
        self.assertIn('outcome=unexpected_error', captured.output[0])
        self.assertNotIn(unexpected_secret, captured.output[0])

    async def test_nested_tool_error_is_not_treated_as_public(self) -> None:
        unexpected_secret = 'nested-exception-detail-secret'

        async def nested_failure() -> None:
            try:
                raise RuntimeError(unexpected_secret)
            except RuntimeError as error:
                raise ToolError('apparently safe outer message') from error

        response = await self._call_tool(nested_failure)

        result_text = json.dumps(response.json()['result'])
        self.assertIn(tool_errors.GENERIC_TOOL_ERROR, result_text)
        self.assertNotIn('apparently safe outer message', result_text)
        self.assertNotIn(unexpected_secret, result_text)

    async def test_invalid_public_messages_fail_closed(self) -> None:
        invalid_messages = (
            'line one\nline two',
            'x' * (tool_errors.MAX_PUBLIC_TOOL_ERROR_BYTES + 1),
        )
        for message in invalid_messages:
            with self.subTest(message_length=len(message)):
                response = await self._call_tool(_failing_tool(message))

                result_text = json.dumps(response.json()['result'])
                self.assertIn(tool_errors.GENERIC_TOOL_ERROR, result_text)
                self.assertLess(len(response.content), 16 * 1024)

    async def test_validation_exception_uses_fixed_public_error(self) -> None:
        async def typed_tool(
            value: Annotated[int, pydantic.Field(strict=True)],
        ) -> int:
            return value

        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured:
            response = await self._call_tool(typed_tool, {'value': True})

        result_text = json.dumps(response.json()['result'])
        self.assertIn('MCP tool validation failed.', result_text)
        self.assertNotIn('validation error', result_text.lower())
        self.assertEqual(len(captured.output), 1)
        self.assertIn('outcome=validation_error', captured.output[0])

    async def test_success_is_logged_after_result_validation(self) -> None:
        async def successful_tool() -> dict[str, str]:
            return {'status': 'ok'}

        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured:
            response = await self._call_tool(successful_tool)

        self.assertFalse(response.json()['result']['isError'])
        self.assertEqual(len(captured.output), 1)
        record = captured.output[0]
        self.assertIn('tool=boundary_test_tool', record)
        self.assertIn('outcome=success', record)
        self.assertIn('request_id=boundary-request-123', record)

    async def test_invalid_result_is_never_logged_as_success(self) -> None:
        async def credential_result() -> dict[str, str]:
            credentials = request_context.get_request_credentials()
            return {'unsafe': credentials.authorization_header}

        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured:
            response = await self._call_tool(credential_result)

        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertEqual(len(captured.output), 1)
        record = captured.output[0]
        self.assertIn('outcome=invalid_result', record)
        self.assertNotIn('outcome=success', record)
        self.assertNotIn('boundary-test-secret', record)

    async def test_unknown_name_is_not_written_to_telemetry(self) -> None:
        async def unused_tool() -> None:
            self.fail('unknown tool must not execute')

        client_supplied_name = 'private-client-supplied-tool-name'
        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured:
            response = await self._call_tool(
                unused_tool,
                requested_name=client_supplied_name,
            )

        self.assertTrue(response.json()['result']['isError'])
        self.assertEqual(len(captured.output), 1)
        record = captured.output[0]
        self.assertIn('tool=unknown', record)
        self.assertIn('outcome=public_error', record)
        self.assertIn('request_id=boundary-request-123', record)
        self.assertNotIn(client_supplied_name, record)

    async def test_missing_request_context_has_final_outcome(self) -> None:
        async def unused_tool() -> None:
            self.fail('tool must not execute without a request context')

        mcp_server = protocol.OSMOFastMCP(name='context boundary test')
        mcp_server.add_tool(unused_tool, name='context_test_tool')

        with (
            self.assertLogs(
                'src.service.mcp.telemetry',
                level='INFO',
            ) as captured,
            self.assertRaises(tool_errors.PublicToolError),
        ):
            await mcp_server.call_tool('context_test_tool', {})

        self.assertEqual(len(captured.output), 1)
        record = captured.output[0]
        self.assertIn('tool=context_test_tool', record)
        self.assertIn('outcome=context_error', record)

    async def test_telemetry_failure_cannot_replace_public_result(self) -> None:
        async def expected_failure() -> None:
            raise tool_errors.PublicToolError(
                'The requested object is not available.'
            )

        telemetry_secret = 'telemetry-handler-exception-secret'
        with mock.patch.object(
            protocol.telemetry,
            'log_tool_outcome',
            side_effect=RuntimeError(telemetry_secret),
        ):
            response = await self._call_tool(expected_failure)

        result = response.json()['result']
        self.assertTrue(result['isError'])
        result_text = json.dumps(result)
        self.assertIn('The requested object is not available.', result_text)
        self.assertNotIn(telemetry_secret, result_text)
