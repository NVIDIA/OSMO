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
from mcp.server.fastmcp.exceptions import ToolError

from src.lib.utils import resource_quantities
from src.service.mcp import (
    request_context,
    resources,
    tool_requests,
)
from src.service.mcp.tests import protocol_harness


_BEARER_SECRET = 'resource-tool-bearer-secret'
_HARNESS = protocol_harness.ProtocolHarness(
    tool_names=(
        'osmo_list_resources',
        'osmo_get_resource',
    ),
    bearer_secret=_BEARER_SECRET,
    request_id='resource-request-123',
)


def _profile(
    *,
    default_pool: str | None = 'alpha',
    accessible_pools: list[str] | None = None,
) -> dict[str, object]:
    return {
        'profile': {
            'username': 'alice@example.com',
            'pool': default_pool,
        },
        'roles': ['osmo-user'],
        'pools': (
            accessible_pools
            if accessible_pools is not None
            else ['alpha', 'beta']
        ),
        'token': None,
    }


def _resource(
    node: str = 'node-1',
) -> dict[str, object]:
    return {
        'hostname': node,
        'backend': 'backend-1',
        'resource_type': 'SHARED',
        'usage_fields': {
            'storage': '20481Mi',
            'cpu': '2.1',
            'memory': 8589934592,
            'gpu': '1.2',
            'internal_usage': 'not returned',
        },
        'allocatable_fields': {
            'storage': 107374182400,
            'cpu': '8.9',
            'memory': '33554432Ki',
            'gpu': '4.9',
            'internal_capacity': 'not returned',
        },
        'platform_allocatable_fields': {
            'alpha': {
                'gpu': {
                    'storage': '94371840Ki',
                    'cpu': '7.9',
                    'memory': 32212254720,
                    'gpu': '4.9',
                },
                'cpu': {
                    'storage': '80Gi',
                    'cpu': '6',
                    'memory': '28Gi',
                    'gpu': '0',
                },
            },
            'beta': {
                'gpu': {
                    'storage': '94371840Ki',
                    'cpu': '7.9',
                    'memory': 32212254720,
                    'gpu': '4.9',
                },
            },
        },
        'platform_available_fields': {
            'alpha': {
                'gpu': {
                    'storage': '70Gi',
                    'cpu': '5',
                    'memory': '22Gi',
                    'gpu': '3',
                },
                'cpu': {
                    'storage': '60Gi',
                    'cpu': '4',
                    'memory': '20Gi',
                    'gpu': '0',
                },
            },
            'beta': {
                'gpu': {
                    'storage': '70Gi',
                    'cpu': '5',
                    'memory': '22Gi',
                    'gpu': '3',
                },
            },
        },
        'config_fields': {
            'alpha': {
                'gpu': {
                    'host_network': True,
                    'privileged': False,
                    'default_mounts': ['/data'],
                    'allowed_mounts': ['/data', '/scratch'],
                    'internal_config': 'not returned',
                },
            },
        },
        'pool_platform_labels': {
            'alpha': ['gpu', 'cpu'],
            'beta': ['gpu'],
        },
        'label_fields': {'internal-label': 'not returned'},
        'taints': [{'internal-taint': 'not returned'}],
    }


class ResourceQuantityHelperTest(unittest.TestCase):
    """Keep CLI-facing normalization stable for real Core quantity shapes."""

    def test_normalizes_bytes_and_ki_with_null_platform_maps(self) -> None:
        payload = _resource()
        payload['platform_allocatable_fields'] = None
        payload['platform_available_fields'] = None

        result = resource_quantities.normalize_resource_quantities(
            payload,
            'alpha',
            'gpu',
        )

        self.assertEqual(result, {
            'storage': {
                'capacity': 100,
                'used': 21,
                'free': 79,
                'unit': 'Gi',
            },
            'cpu': {'capacity': 8, 'used': 3, 'free': 5},
            'memory': {
                'capacity': 32,
                'used': 8,
                'free': 24,
                'unit': 'Gi',
            },
            'gpu': {'capacity': 4, 'used': 2, 'free': 2},
        })

    def test_clamps_rounded_usage_to_capacity(self) -> None:
        result = resource_quantities.normalize_resource_quantities(
            {
                'allocatable_fields': {'cpu': '2.9'},
                'usage_fields': {'cpu': '8.1'},
            },
            'alpha',
            'gpu',
        )

        self.assertEqual(result, {
            'cpu': {'capacity': 2, 'used': 2, 'free': 0},
        })

    def test_skips_one_bad_quantity_and_defaults_missing_count_usage(self) -> None:
        result = resource_quantities.normalize_resource_quantities(
            {
                'allocatable_fields': {
                    'storage': 'not-a-quantity',
                    'cpu': '8',
                    'memory': '32Gi',
                    'gpu': '4',
                },
                'usage_fields': {'memory': '8Gi'},
            },
            'alpha',
            'gpu',
        )

        self.assertEqual(result, {
            'cpu': {'capacity': 8, 'used': 0, 'free': 8},
            'memory': {
                'capacity': 32,
                'used': 8,
                'free': 24,
                'unit': 'Gi',
            },
            'gpu': {'capacity': 4, 'used': 0, 'free': 4},
        })
        self.assertEqual(
            resources.ResourceQuantities.model_validate(
                result,
                strict=True,
            ).model_dump(mode='json'),
            result,
        )


class ResourceToolTest(unittest.IsolatedAsyncioTestCase):
    """Validate resource route mapping, projection, and input boundaries."""

    async def _invoke_tool(
        self,
        handler: protocol_harness.UpstreamTransport,
        tool_name: str,
        arguments: dict[str, object],
    ) -> httpx.Response:
        return await _HARNESS.call_tool(
            handler,
            tool_name,
            arguments,
        )

    async def test_catalog_has_two_bounded_read_only_tools(self) -> None:
        response = await _HARNESS.list_tools()
        tools = _HARNESS.assert_read_only_closed_catalog(self, response)
        list_tool = tools['osmo_list_resources']
        list_schema = list_tool['inputSchema']
        self.assertEqual(list_schema['properties']['limit']['default'], 50)
        self.assertEqual(list_schema['properties']['limit']['maximum'], 200)
        self.assertEqual(list_schema['properties']['offset']['minimum'], 0)
        get_tool = tools['osmo_get_resource']
        self.assertEqual(get_tool['inputSchema']['required'], ['node_name'])

    async def test_list_uses_default_pool_and_projects_allowlisted_fields(self) -> None:
        context = mock.Mock()
        request_json = mock.AsyncMock(side_effect=[
            _profile(),
            {'resources': [_resource()]},
        ])

        with mock.patch.object(
            tool_requests,
            'request_json_object',
            request_json,
        ):
            result = await resources.osmo_list_resources(
                context,
                platform=['gpu'],
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
                path='/api/resources',
                operation='list node resources',
                max_response_bytes=2 * 1024 * 1024,
                query={
                    'all_pools': False,
                    'pools': ['alpha'],
                    'platforms': ['gpu'],
                },
            ),
        ])
        self.assertEqual(result.count, 1)
        self.assertEqual(result.total_entries, 1)
        entry = result.resources[0]
        self.assertEqual(entry.node, 'node-1')
        self.assertEqual(entry.pool, 'alpha')
        self.assertEqual(entry.platform, 'gpu')
        self.assertEqual(entry.resources.cpu, resources.ResourceQuantity(
            capacity=7,
            used=3,
            free=4,
        ))
        self.assertEqual(entry.resources.storage, resources.ResourceQuantity(
            capacity=90,
            used=21,
            free=69,
            unit='Gi',
        ))
        self.assertEqual(entry.resources.memory, resources.ResourceQuantity(
            capacity=30,
            used=8,
            free=22,
            unit='Gi',
        ))
        self.assertEqual(entry.resources.gpu, resources.ResourceQuantity(
            capacity=4,
            used=2,
            free=2,
        ))
        serialized_entry = entry.model_dump(mode='json')
        self.assertEqual(serialized_entry['resources'], {
            'storage': {
                'capacity': 90,
                'used': 21,
                'free': 69,
                'unit': 'Gi',
            },
            'cpu': {
                'capacity': 7,
                'used': 3,
                'free': 4,
            },
            'memory': {
                'capacity': 30,
                'used': 8,
                'free': 22,
                'unit': 'Gi',
            },
            'gpu': {
                'capacity': 4,
                'used': 2,
                'free': 2,
            },
        })
        result_json = result.model_dump_json()
        self.assertNotIn('internal', result_json)
        self.assertNotIn('label_fields', result_json)
        self.assertNotIn('taints', result_json)

    async def test_list_explicit_pools_deduplicates_and_paginates_locally(self) -> None:
        context = mock.Mock()
        request_json = mock.AsyncMock(side_effect=[
            _profile(),
            {'resources': [_resource()]},
        ])

        with mock.patch.object(
            tool_requests,
            'request_json_object',
            request_json,
        ):
            result = await resources.osmo_list_resources(
                context,
                pool=['alpha', 'alpha', 'beta'],
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
                path='/api/resources',
                operation='list node resources',
                max_response_bytes=2 * 1024 * 1024,
                query={
                    'all_pools': False,
                    'pools': ['alpha', 'beta'],
                },
            ),
        ])
        self.assertEqual(result.count, 1)
        self.assertEqual(result.total_entries, 3)
        self.assertTrue(result.more_entries)
        self.assertEqual(result.resources[0].pool, 'alpha')
        self.assertEqual(result.resources[0].platform, 'gpu')

    async def test_list_with_no_accessible_pools_short_circuits(self) -> None:
        context = mock.Mock()
        request_json = mock.AsyncMock(return_value=_profile(
            accessible_pools=[],
        ))

        with mock.patch.object(
            tool_requests,
            'request_json_object',
            request_json,
        ):
            result = await resources.osmo_list_resources(
                context,
                limit=10,
                offset=7,
            )

        request_json.assert_awaited_once_with(
            context,
            path='/api/profile/settings',
            operation='read the active user profile',
            max_response_bytes=64 * 1024,
        )
        self.assertEqual(result.resources, [])
        self.assertEqual(result.count, 0)
        self.assertEqual(result.total_entries, 0)
        self.assertEqual(result.offset, 7)
        self.assertEqual(result.limit, 10)
        self.assertFalse(result.more_entries)

    async def test_protocol_relays_credentials_to_fixed_resource_route(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            if request.url.path == '/api/profile/settings':
                return httpx.Response(200, json=_profile())
            if request.url.path == '/api/resources':
                return httpx.Response(200, json={'resources': [_resource()]})
            self.fail(f'unexpected Gateway route: {request.url}')

        response = await self._invoke_tool(
            handler,
            'osmo_list_resources',
            {'pool': ['alpha'], 'platform': ['gpu']},
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent']['resources'][0]['node'], 'node-1')
        self.assertEqual(len(captured_requests), 2)
        request = captured_requests[1]
        self.assertEqual(request.url.path, '/api/resources')
        self.assertEqual(request.url.params.multi_items(), [
            ('all_pools', 'false'),
            ('pools', 'alpha'),
            ('platforms', 'gpu'),
        ])
        for captured_request in captured_requests:
            self.assertEqual(
                captured_request.headers['authorization'],
                f'Bearer {_BEARER_SECRET}',
            )
            self.assertEqual(
                captured_request.headers[request_context.REQUEST_ID_HEADER],
                'resource-request-123',
            )
        self.assertNotIn(_BEARER_SECRET, response.text)

    async def test_get_protocol_reads_profile_then_fetches_only_the_node(self) -> None:
        captured_requests: list[httpx.Request] = []
        node = _resource()
        node['pool_platform_labels'] = {'alpha': ['gpu']}

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            if request.url.path == '/api/profile/settings':
                return httpx.Response(200, json=_profile())
            if request.url.path == '/api/resources/node-1':
                return httpx.Response(200, json={'resources': [node]})
            self.fail(f'unexpected Gateway route: {request.url}')

        response = await self._invoke_tool(
            handler,
            'osmo_get_resource',
            {'node_name': 'node-1'},
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent']['node'], 'node-1')
        self.assertEqual(len(captured_requests), 2)
        request = captured_requests[1]
        self.assertEqual(request.url.path, '/api/resources/node-1')
        self.assertEqual(request.url.params.multi_items(), [])
        for captured_request in captured_requests:
            self.assertEqual(
                captured_request.headers['authorization'],
                f'Bearer {_BEARER_SECRET}',
            )
        self.assertNotIn(_BEARER_SECRET, response.text)

    async def test_get_protocol_has_uniform_missing_and_inaccessible_result(
        self,
    ) -> None:
        inaccessible_node = _resource()
        inaccessible_node['pool_platform_labels'] = {'beta': ['gpu']}
        outcomes = (
            httpx.Response(404, json={'message': 'node does not exist'}),
            httpx.Response(200, json={'resources': [inaccessible_node]}),
        )
        messages: list[str] = []

        for detail_response in outcomes:
            async def handler(
                request: httpx.Request,
                response: httpx.Response = detail_response,
            ) -> httpx.Response:
                if request.url.path == '/api/profile/settings':
                    return httpx.Response(
                        200,
                        json=_profile(accessible_pools=['alpha']),
                )
                if request.url.path == '/api/resources/node-1':
                    return response
                self.fail(f'unexpected Gateway route: {request.url}')

            response = await self._invoke_tool(
                handler,
                'osmo_get_resource',
                {'node_name': 'node-1'},
            )
            result = response.json()['result']
            self.assertTrue(result['isError'])
            messages.append(result['content'][0]['text'])

        self.assertEqual(messages, [
            (
                'Error executing tool osmo_get_resource: '
                'The requested node is not available.'
            ),
            (
                'Error executing tool osmo_get_resource: '
                'The requested node is not available.'
            ),
        ])

    async def test_protocol_rejects_boolean_pagination_before_transport(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json=_profile())

        invalid_calls: tuple[dict[str, object], ...] = (
            {'limit': True},
            {'offset': True},
        )
        for arguments in invalid_calls:
            with self.subTest(arguments=arguments):
                response = await self._invoke_tool(
                    handler,
                    'osmo_list_resources',
                    arguments,
                )
                self.assertTrue(response.json()['result']['isError'])

        self.assertEqual(captured_requests, [])

    async def test_protocol_sanitizes_gateway_failure(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(403, content=b'upstream-resource-body-secret')

        response = await self._invoke_tool(
            handler,
            'osmo_list_resources',
            {'pool': ['alpha']},
        )

        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('HTTP 403', response.text)
        self.assertNotIn('upstream-resource-body-secret', response.text)
        self.assertNotIn(_BEARER_SECRET, response.text)

    async def test_get_resource_uses_node_route_and_returns_configuration(self) -> None:
        context = mock.Mock()
        node_name = 'node name+日本語'
        node = _resource(node_name)
        node['pool_platform_labels'] = {'alpha': ['gpu', 'cpu']}
        request_json = mock.AsyncMock(side_effect=[
            _profile(accessible_pools=['alpha']),
            {'resources': [node]},
        ])

        with mock.patch.object(
            tool_requests,
            'request_json_object',
            request_json,
        ):
            result = await resources.osmo_get_resource(
                context,
                node_name,
                pool='alpha',
                platform='gpu',
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
                path=(
                    '/api/resources/'
                    'node%20name%2B%E6%97%A5%E6%9C%AC%E8%AA%9E'
                ),
                operation='get a node resource',
                max_response_bytes=2 * 1024 * 1024,
                not_found_message='The requested node is not available.',
            ),
        ])
        self.assertEqual(result.node, node_name)
        self.assertEqual(result.selected.pool, 'alpha')
        self.assertEqual(result.selected.platform, 'gpu')
        self.assertEqual(result.assignments, {
            'alpha': ['cpu', 'gpu'],
        })
        self.assertTrue(result.configuration.host_network)
        self.assertFalse(result.configuration.privileged)
        self.assertEqual(result.configuration.default_mounts, ['/data'])
        storage = result.resources.storage
        self.assertIsNotNone(storage)
        assert storage is not None
        self.assertEqual(storage.capacity, 90)
        self.assertEqual(storage.used, 21)
        self.assertEqual(storage.free, 69)
        self.assertNotIn('internal_config', result.model_dump_json())

    async def test_get_resource_disambiguates_duplicate_node_names_by_assignment(self) -> None:
        context = mock.Mock()
        alpha_resource = _resource()
        alpha_resource['pool_platform_labels'] = {'alpha': ['gpu']}
        beta_resource = _resource()
        beta_resource['backend'] = 'backend-2'
        beta_resource['pool_platform_labels'] = {'beta': ['gpu']}
        request_json = mock.AsyncMock(side_effect=[
            _profile(),
            {'resources': [alpha_resource, beta_resource]},
        ])

        with mock.patch.object(
            tool_requests,
            'request_json_object',
            request_json,
        ):
            result = await resources.osmo_get_resource(
                context,
                'node-1',
                pool='alpha',
                platform='gpu',
            )

        self.assertEqual(result.backend, 'backend-1')
        self.assertEqual(result.assignments, {'alpha': ['gpu']})

    async def test_get_resource_requires_selection_for_multiple_assignments(self) -> None:
        context = mock.Mock()
        request_json = mock.AsyncMock(side_effect=[
            _profile(),
            {'resources': [_resource()]},
        ])

        with (
            mock.patch.object(
                tool_requests,
                'request_json_object',
                request_json,
            ),
            self.assertRaisesRegex(ToolError, 'provide pool and platform'),
        ):
            await resources.osmo_get_resource(context, 'node-1')

        self.assertEqual(request_json.await_count, 2)

    async def test_get_resource_auto_selects_exactly_one_assignment(self) -> None:
        context = mock.Mock()
        node = _resource()
        node['pool_platform_labels'] = {
            'alpha': ['gpu'],
            'beta': ['gpu'],
        }
        request_json = mock.AsyncMock(side_effect=[
            _profile(accessible_pools=['alpha']),
            {'resources': [node]},
        ])

        with mock.patch.object(
            tool_requests,
            'request_json_object',
            request_json,
        ):
            result = await resources.osmo_get_resource(context, 'node-1')

        self.assertEqual(result.selected, resources.ResourceSelection(
            pool='alpha',
            platform='gpu',
        ))
        self.assertEqual(result.assignments, {'alpha': ['gpu']})
        self.assertNotIn('beta', result.model_dump_json())

    async def test_get_resource_has_uniform_not_found_result(self) -> None:
        context = mock.Mock()
        messages: list[str] = []

        payloads: tuple[dict[str, object], ...] = (
            {'resources': []},
            {'resources': [_resource('another-node')]},
        )
        for payload in payloads:
            with (
                mock.patch.object(
                    tool_requests,
                    'request_json_object',
                    mock.AsyncMock(side_effect=[_profile(), payload]),
                ),
                self.assertRaises(ToolError) as raised,
            ):
                await resources.osmo_get_resource(context, 'node-1')
            messages.append(str(raised.exception))

        self.assertEqual(messages, [
            'The requested node is not available.',
            'The requested node is not available.',
        ])

    async def test_get_resource_with_no_accessible_pools_short_circuits(self) -> None:
        context = mock.Mock()
        request_json = mock.AsyncMock(return_value=_profile(accessible_pools=[]))

        with (
            mock.patch.object(
                tool_requests,
                'request_json_object',
                request_json,
            ),
            self.assertRaisesRegex(
                ToolError,
                'The requested node is not available',
            ),
        ):
            await resources.osmo_get_resource(context, 'node-1')

        request_json.assert_awaited_once_with(
            context,
            path='/api/profile/settings',
            operation='read the active user profile',
            max_response_bytes=64 * 1024,
        )

    async def test_get_resource_in_inaccessible_pool_uses_uniform_not_found(self) -> None:
        context = mock.Mock()
        request_json = mock.AsyncMock(return_value=_profile(
            accessible_pools=['alpha'],
        ))

        with (
            mock.patch.object(
                tool_requests,
                'request_json_object',
                request_json,
            ),
            self.assertRaises(ToolError) as raised,
        ):
            await resources.osmo_get_resource(
                context,
                'node-1',
                pool='beta',
                platform='gpu',
            )

        self.assertEqual(
            str(raised.exception),
            'The requested node is not available.',
        )
        request_json.assert_awaited_once_with(
            context,
            path='/api/profile/settings',
            operation='read the active user profile',
            max_response_bytes=64 * 1024,
        )

    async def test_invalid_paths_filters_and_bounds_fail_before_transport(self) -> None:
        context = mock.Mock()
        request_json = mock.AsyncMock()
        with mock.patch.object(
            tool_requests,
            'request_json_object',
            request_json,
        ):
            with self.assertRaisesRegex(ToolError, 'Invalid node_name'):
                await resources.osmo_get_resource(context, '../node')
            with self.assertRaisesRegex(ToolError, 'provided together'):
                await resources.osmo_get_resource(
                    context,
                    'node-1',
                    pool='alpha',
                )
            with self.assertRaisesRegex(ToolError, 'Invalid pool'):
                await resources.osmo_list_resources(
                    context,
                    pool=['alpha/other'],
                )
            with self.assertRaisesRegex(ToolError, 'Invalid pool'):
                await resources.osmo_list_resources(context, pool=[])
            with self.assertRaisesRegex(ToolError, 'Invalid platform'):
                await resources.osmo_list_resources(context, platform=[])
            with self.assertRaisesRegex(ToolError, 'cannot be used together'):
                await resources.osmo_list_resources(
                    context,
                    pool=['alpha'],
                    all_pools=True,
                )
            with self.assertRaisesRegex(ToolError, 'pagination'):
                await resources.osmo_list_resources(context, limit=201)
            with self.assertRaisesRegex(ToolError, 'pagination'):
                await resources.osmo_list_resources(context, limit=True)
            with self.assertRaisesRegex(ToolError, 'pagination'):
                await resources.osmo_list_resources(context, offset=True)

        request_json.assert_not_awaited()

    async def test_inaccessible_pool_is_rejected_before_resource_request(self) -> None:
        context = mock.Mock()
        request_json = mock.AsyncMock(return_value=_profile(
            accessible_pools=['alpha'],
        ))

        with (
            mock.patch.object(
                tool_requests,
                'request_json_object',
                request_json,
            ),
            self.assertRaisesRegex(ToolError, 'not accessible'),
        ):
            await resources.osmo_list_resources(context, pool=['beta'])

        request_json.assert_awaited_once_with(
            context,
            path='/api/profile/settings',
            operation='read the active user profile',
            max_response_bytes=64 * 1024,
        )

    async def test_malformed_and_gateway_failures_are_sanitized_or_preserved(self) -> None:
        context = mock.Mock()
        malformed = mock.AsyncMock(side_effect=[
            _profile(),
            {'resources': [{'hostname': 'node-1'}]},
        ])
        with (
            mock.patch.object(
                tool_requests,
                'request_json_object',
                malformed,
            ),
            self.assertRaisesRegex(ToolError, 'invalid resource response'),
        ):
            await resources.osmo_list_resources(
                context,
                pool=['alpha'],
            )

        missing_configuration = _resource()
        missing_configuration['config_fields'] = {}
        with (
            mock.patch.object(
                tool_requests,
                'request_json_object',
                mock.AsyncMock(side_effect=[
                    _profile(accessible_pools=['alpha']),
                    {'resources': [missing_configuration]},
                ]),
            ),
            self.assertRaisesRegex(ToolError, 'invalid node resource response'),
        ):
            await resources.osmo_get_resource(
                context,
                'node-1',
                pool='alpha',
                platform='gpu',
            )

        upstream_error = ToolError('OSMO Gateway response exceeds the size limit.')
        with (
            mock.patch.object(
                tool_requests,
                'request_json_object',
                mock.AsyncMock(side_effect=[_profile(), upstream_error]),
            ),
            self.assertRaises(ToolError) as raised,
        ):
            await resources.osmo_get_resource(context, 'node-1')
        self.assertIs(raised.exception, upstream_error)


if __name__ == '__main__':
    unittest.main()
