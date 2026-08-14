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

import unittest
from unittest import mock

import httpx
from fastmcp.exceptions import ToolError

from src.service.mcp import (
    pools,
    request_context,
    tool_requests,
)
from src.service.mcp.tests import protocol_harness


_BEARER_SECRET = 'pool-tool-bearer-secret'
_HARNESS = protocol_harness.ProtocolHarness(
    tool_names=('osmo_search_pools',),
    bearer_secret=_BEARER_SECRET,
    request_id='pool-request-123',
)


def _usage(
    *,
    capacity: str = '8',
    free: str = '6',
) -> dict[str, str]:
    return {
        'quota_used': '2',
        'quota_free': '6',
        'quota_limit': '8',
        'total_usage': '2',
        'total_capacity': capacity,
        'total_free': free,
    }


def _pool(
    name: str,
    *,
    description: str,
    capacity: str = '8',
) -> dict[str, object]:
    return {
        'name': name,
        'description': description,
        'status': 'ONLINE',
        'backend': 'backend-1',
        'default_platform': 'gpu',
        'resource_usage': _usage(capacity=capacity),
        'platforms': {'gpu': {'internal': 'not returned'}},
        'topology_keys': [{'internal': 'not returned'}],
    }


def _profile(*accessible_pools: str) -> dict[str, object]:
    return {
        'profile': {
            'username': 'alice@example.com',
            'pool': accessible_pools[0] if accessible_pools else None,
        },
        'roles': ['osmo-user'],
        'pools': list(accessible_pools),
        'token': None,
    }


class PoolToolTest(unittest.IsolatedAsyncioTestCase):
    """Validate pool mapping, pagination, and MCP catalog metadata."""

    async def _invoke_tool(
        self,
        handler: protocol_harness.UpstreamTransport,
        arguments: dict[str, object] | None = None,
    ) -> httpx.Response:
        return await _HARNESS.call_tool(
            handler,
            'osmo_search_pools',
            arguments,
        )

    async def test_catalog_has_bounded_schema_and_read_only_annotations(self) -> None:
        response = await _HARNESS.list_tools()
        tools = _HARNESS.assert_read_only_closed_catalog(self, response)
        tool = tools['osmo_search_pools']
        input_schema = tool['inputSchema']
        self.assertEqual(input_schema['properties']['limit']['default'], 50)
        self.assertEqual(input_schema['properties']['limit']['minimum'], 1)
        self.assertEqual(input_schema['properties']['limit']['maximum'], 200)
        self.assertEqual(input_schema['properties']['offset']['minimum'], 0)

    async def test_search_uses_accessible_pools_and_preserves_shared_node_set(self) -> None:
        context = mock.Mock()
        pool_payload = {
            'node_sets': [
                {
                    'pools': [
                        _pool('alpha', description='Shared GPU capacity'),
                        _pool('beta', description='Shared GPU capacity'),
                    ],
                },
                {
                    'pools': [
                        _pool(
                            'gamma',
                            description='CPU-only pool',
                            capacity='0',
                        ),
                    ],
                },
            ],
            'resource_sum': _usage(capacity='8'),
        }
        request_json = mock.AsyncMock(side_effect=[
            _profile('alpha', 'beta', 'gamma', 'alpha'),
            pool_payload,
        ])

        with mock.patch.object(
            tool_requests,
            'request_json_object',
            request_json,
        ):
            result = await pools.osmo_search_pools(
                context,
                query=' shared ',
                limit=1,
                offset=1,
            )

        self.assertEqual(request_json.await_args_list, [
            mock.call(
                context,
                path='/api/profile/settings',
                operation='read the active user profile',
                max_response_bytes=64 * 1024,
            ),
            mock.call(
                context,
                path='/api/pool_quota',
                operation='search accessible pools',
                max_response_bytes=1024 * 1024,
                query={
                    'all_pools': False,
                    'pools': ['alpha', 'beta', 'gamma'],
                },
            ),
        ])
        self.assertEqual(result.count, 1)
        self.assertEqual(result.total_matches, 2)
        self.assertFalse(result.more_entries)
        self.assertEqual(
            result.accessible_resource_sum.total_capacity,
            '8',
        )
        self.assertEqual(len(result.node_sets), 1)
        node_set = result.node_sets[0]
        self.assertEqual(node_set.index, 0)
        self.assertTrue(node_set.shared_capacity)
        self.assertEqual(node_set.pool_names, ['alpha', 'beta'])
        self.assertEqual(node_set.capacity.total_capacity, '8')
        self.assertEqual([pool.name for pool in node_set.pools], ['beta'])
        result_json = result.model_dump_json()
        self.assertNotIn('topology_keys', result_json)
        self.assertNotIn('internal', result_json)

    async def test_no_accessible_pools_returns_zero_without_pool_query(self) -> None:
        context = mock.Mock()
        request_json = mock.AsyncMock(return_value=_profile())

        with mock.patch.object(
            tool_requests,
            'request_json_object',
            request_json,
        ):
            result = await pools.osmo_search_pools(
                context,
                query='anything',
                limit=10,
                offset=7,
            )

        request_json.assert_awaited_once_with(
            context,
            path='/api/profile/settings',
            operation='read the active user profile',
            max_response_bytes=64 * 1024,
        )
        self.assertEqual(result.node_sets, [])
        self.assertEqual(result.count, 0)
        self.assertEqual(result.total_matches, 0)
        self.assertEqual(result.offset, 7)
        self.assertEqual(result.limit, 10)
        self.assertFalse(result.more_entries)
        self.assertEqual(result.accessible_resource_sum, pools.PoolResourceUsage(
            quota_used='0',
            quota_free='0',
            quota_limit='0',
            total_usage='0',
            total_capacity='0',
            total_free='0',
        ))

    async def test_protocol_relays_credentials_through_both_fixed_routes(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            if request.url.path == '/api/profile/settings':
                return httpx.Response(200, json=_profile('alpha'))
            if request.url.path == '/api/pool_quota':
                return httpx.Response(200, json={
                    'node_sets': [{
                        'pools': [_pool('alpha', description='GPU pool')],
                    }],
                    'resource_sum': _usage(),
                })
            self.fail(f'unexpected Gateway route: {request.url}')

        response = await self._invoke_tool(handler)

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(
            result['structuredContent']['node_sets'][0]['pools'][0]['name'],
            'alpha',
        )
        self.assertIn('accessible_resource_sum', result['structuredContent'])
        self.assertNotIn('resource_sum', result['structuredContent'])
        self.assertEqual(
            [request.url.path for request in captured_requests],
            ['/api/profile/settings', '/api/pool_quota'],
        )
        self.assertEqual(captured_requests[1].url.params.multi_items(), [
            ('all_pools', 'false'),
            ('pools', 'alpha'),
        ])
        for request in captured_requests:
            self.assertEqual(
                request.headers['authorization'],
                f'Bearer {_BEARER_SECRET}',
            )
            self.assertEqual(
                request.headers[request_context.REQUEST_ID_HEADER],
                'pool-request-123',
            )
        self.assertNotIn(_BEARER_SECRET, response.text)

    async def test_protocol_sanitizes_gateway_failure(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(403, content=b'upstream-pool-body-secret')

        response = await self._invoke_tool(handler)

        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('HTTP 403', response.text)
        self.assertNotIn('upstream-pool-body-secret', response.text)
        self.assertNotIn(_BEARER_SECRET, response.text)

    async def test_inaccessible_or_malformed_upstream_pool_fails_closed(self) -> None:
        context = mock.Mock()
        inaccessible_payload = {
            'node_sets': [{
                'pools': [_pool('not-allowed', description='private')],
            }],
            'resource_sum': _usage(),
        }
        request_json = mock.AsyncMock(side_effect=[
            _profile('alpha'),
            inaccessible_payload,
        ])
        with (
            mock.patch.object(
                tool_requests,
                'request_json_object',
                request_json,
            ),
            self.assertRaisesRegex(ToolError, 'invalid pool response'),
        ):
            await pools.osmo_search_pools(context)

        malformed_request = mock.AsyncMock(side_effect=[
            _profile('alpha'),
            {'node_sets': 'not-a-list', 'resource_sum': _usage()},
        ])
        with (
            mock.patch.object(
                tool_requests,
                'request_json_object',
                malformed_request,
            ),
            self.assertRaisesRegex(ToolError, 'invalid pool response'),
        ):
            await pools.osmo_search_pools(context)

    async def test_invalid_search_bounds_fail_before_transport(self) -> None:
        context = mock.Mock()
        request_json = mock.AsyncMock()
        invalid_calls = (
            {'limit': 0},
            {'limit': 201},
            {'limit': True},
            {'offset': -1},
            {'offset': True},
            {'query': 'x' * 257},
            {'query': 'line\nbreak'},
        )
        with mock.patch.object(
            tool_requests,
            'request_json_object',
            request_json,
        ):
            for arguments in invalid_calls:
                with self.subTest(arguments=arguments):
                    with self.assertRaises(ToolError):
                        await pools.osmo_search_pools(context, **arguments)

        request_json.assert_not_awaited()

    async def test_protocol_rejects_boolean_pagination_before_relay(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json=_profile('alpha'))

        cases: tuple[dict[str, object], ...] = (
            {'limit': True},
            {'offset': True},
        )
        for arguments in cases:
            with self.subTest(arguments=arguments):
                response = await self._invoke_tool(
                    handler,
                    arguments,
                )
                self.assertTrue(response.json()['result']['isError'])

        self.assertEqual(captured_requests, [])

    async def test_profile_and_gateway_failures_are_not_rewritten(self) -> None:
        context = mock.Mock()
        upstream_error = ToolError('OSMO Gateway response exceeds the size limit.')
        with (
            mock.patch.object(
                tool_requests,
                'request_json_object',
                mock.AsyncMock(side_effect=upstream_error),
            ),
            self.assertRaises(ToolError) as raised,
        ):
            await pools.osmo_search_pools(context)

        self.assertIs(raised.exception, upstream_error)


if __name__ == '__main__':
    unittest.main()
