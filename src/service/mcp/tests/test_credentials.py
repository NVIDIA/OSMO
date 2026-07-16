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

import json
import unittest

import httpx

from src.service.mcp.tests import protocol_harness


_BEARER_SECRET = 'credentials-tool-bearer-secret'
_HARNESS = protocol_harness.ProtocolHarness(
    tool_names=('osmo_list_credentials',),
    bearer_secret=_BEARER_SECRET,
    request_id='credentials-request-123',
)


class CredentialToolsProtocolTest(unittest.IsolatedAsyncioTestCase):
    """Exercise credential tools through the Streamable HTTP protocol."""

    async def _invoke_tool(
        self,
        handler: protocol_harness.UpstreamHandler,
        arguments: dict[str, object] | None = None,
    ) -> httpx.Response:
        return await _HARNESS.call_tool(
            handler,
            'osmo_list_credentials',
            arguments,
        )

    async def test_catalog_exposes_closed_world_structured_schema(self) -> None:
        response = await _HARNESS.list_tools(request_id=2)
        tools = _HARNESS.assert_read_only_closed_catalog(self, response)
        tool = tools['osmo_list_credentials']
        self.assertEqual(tool['title'], 'List OSMO credentials')
        self.assertEqual(tool['inputSchema']['properties'], {})

    async def test_list_credentials_projects_only_allowlisted_metadata(self) -> None:
        captured_requests: list[httpx.Request] = []
        upstream_secret = 'upstream-credential-payload-secret'
        upstream_response = {
            'credentials': [
                {
                    'cred_name': 'nvcr',
                    'cred_type': 'REGISTRY',
                    'profile': (
                        's3://user:password@bucket/path?'
                        'X-Amz-Signature=profile-secret#fragment'
                    ),
                    'password': upstream_secret,
                    'access_key': upstream_secret,
                },
                {
                    'cred_name': 'generic-api',
                    'cred_type': 'GENERIC',
                    'profile': None,
                    'credential': {'token': upstream_secret},
                },
            ],
            'debug_secret': upstream_secret,
        }

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json=upstream_response)

        response = await self._invoke_tool(handler)

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'credentials': [
                {
                    'cred_name': 'nvcr',
                    'cred_type': 'REGISTRY',
                },
                {
                    'cred_name': 'generic-api',
                    'cred_type': 'GENERIC',
                },
            ],
        })
        self.assertNotIn(upstream_secret, response.text)
        self.assertNotIn('profile-secret', response.text)
        self.assertNotIn('X-Amz-Signature', response.text)
        self.assertEqual(len(captured_requests), 1)
        upstream_request = captured_requests[0]
        self.assertEqual(upstream_request.method, 'GET')
        self.assertEqual(upstream_request.url.path, '/api/credentials')
        self.assertEqual(upstream_request.url.query, b'')
        self.assertEqual(
            upstream_request.headers['authorization'],
            f'Bearer {_BEARER_SECRET}',
        )
        self.assertEqual(
            upstream_request.headers['x-request-id'],
            'credentials-request-123',
        )

    async def test_invalid_shapes_fail_closed_without_reflecting_values(self) -> None:
        invalid_responses: tuple[object, ...] = (
            {},
            {'credentials': {}},
            {'credentials': ['upstream-list-item-secret']},
            {'credentials': [{
                'cred_name': 'missing-type',
            }]},
            {'credentials': [{
                'cred_name': 123,
                'cred_type': 'DATA',
                'profile': 'upstream-type-secret',
            }]},
            {'credentials': [{
                'cred_name': 'name',
                'cred_type': None,
                'profile': None,
            }]},
        )

        def response_handler(
            response_body: object,
        ) -> protocol_harness.UpstreamHandler:
            async def handler(request: httpx.Request) -> httpx.Response:
                del request
                return httpx.Response(200, json=response_body)

            return handler

        for upstream_response in invalid_responses:
            with self.subTest(upstream_response=upstream_response):
                response = await self._invoke_tool(
                    response_handler(upstream_response)
                )
                result = response.json()['result']
                self.assertTrue(result['isError'])
                self.assertIn('invalid response', json.dumps(result))
                self.assertNotIn('upstream-', json.dumps(result))
                self.assertNotIn(_BEARER_SECRET, json.dumps(result))

    async def test_status_malformed_and_oversized_bodies_are_sanitized(self) -> None:
        async def forbidden(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(403, content=b'upstream-status-secret')

        status_response = await self._invoke_tool(forbidden)
        status_result = status_response.json()['result']
        self.assertTrue(status_result['isError'])
        self.assertIn('HTTP 403', json.dumps(status_result))
        self.assertNotIn('upstream-status-secret', json.dumps(status_result))

        async def malformed(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, content=b'upstream-malformed-secret')

        malformed_response = await self._invoke_tool(malformed)
        malformed_result = malformed_response.json()['result']
        self.assertTrue(malformed_result['isError'])
        self.assertIn('invalid response', json.dumps(malformed_result))
        self.assertNotIn('upstream-malformed-secret', json.dumps(malformed_result))

        oversized_body = b'{"credentials":[],"padding":"' + (
            b'x' * (1024 * 1024)
        ) + b'"}'

        async def oversized(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, content=oversized_body)

        oversized_response = await self._invoke_tool(oversized)
        oversized_result = oversized_response.json()['result']
        self.assertTrue(oversized_result['isError'])
        self.assertIn('exceeds the size limit', json.dumps(oversized_result))
        self.assertNotIn(_BEARER_SECRET, json.dumps(oversized_result))

    async def test_unmapped_arguments_are_rejected_before_transport(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={'credentials': []})

        response = await self._invoke_tool(handler, {
            'include_secrets': True,
            'authorization': 'Bearer tool-input-secret',
        })

        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertEqual(captured_requests, [])
        self.assertNotIn('tool-input-secret', json.dumps(result))
        self.assertNotIn(_BEARER_SECRET, json.dumps(result))


if __name__ == '__main__':
    unittest.main()
