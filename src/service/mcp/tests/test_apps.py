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


_BEARER_SECRET = 'apps-tool-bearer-secret'
_HARNESS = protocol_harness.ProtocolHarness(
    tool_names=(
        'osmo_list_apps',
        'osmo_get_app',
        'osmo_get_app_spec',
    ),
    bearer_secret=_BEARER_SECRET,
    request_id='apps-request-123',
)
_APP_SUMMARY: dict[str, object] = {
    'uuid': '0123456789abcdef0123456789abcdef',
    'name': 'training_app',
    'description': 'Train a model',
    'created_date': '2026-07-10T12:30:00Z',
    'owner': 'alice@example.com',
    'latest_version': 3,
}
_APP_LIST_RESULT: dict[str, object] = {
    'apps': [_APP_SUMMARY],
    'more_entries': True,
}
_APP_VERSION: dict[str, object] = {
    'version': 3,
    'created_by': 'alice@example.com',
    'created_date': '2026-07-11T12:30:00Z',
    'status': 'READY',
}
_APP_RESULT: dict[str, object] = {
    'uuid': '0123456789abcdef0123456789abcdef',
    'name': 'training_app',
    'description': 'Train a model',
    'created_date': '2026-07-10T12:30:00Z',
    'owner': 'alice@example.com',
    'versions': [_APP_VERSION],
}


class AppToolsProtocolTest(unittest.IsolatedAsyncioTestCase):
    """Exercise app tools through the stateless Streamable HTTP protocol."""

    async def _invoke_tool(
        self,
        handler: protocol_harness.UpstreamHandler,
        tool_name: str,
        arguments: dict[str, object] | None = None,
    ) -> httpx.Response:
        return await _HARNESS.call_tool(
            handler,
            tool_name,
            arguments,
        )

    async def test_catalog_exposes_closed_world_structured_schemas(self) -> None:
        response = await _HARNESS.list_tools(request_id=2)
        tools = _HARNESS.assert_read_only_closed_catalog(self, response)

        list_properties = tools['osmo_list_apps']['inputSchema']['properties']
        self.assertEqual(list_properties['limit']['default'], 50)
        self.assertEqual(list_properties['limit']['maximum'], 200)
        self.assertEqual(list_properties['offset']['default'], 0)
        self.assertEqual(list_properties['offset']['minimum'], 0)
        for tool_name in ('osmo_get_app', 'osmo_get_app_spec'):
            name_schema = json.dumps(
                tools[tool_name]['inputSchema']['properties']['name']
            )
            self.assertIn('^[A-Za-z0-9_-]+$', name_schema)
        self.assertEqual(
            tools['osmo_get_app_spec']['inputSchema']['required'],
            ['name'],
        )

    async def test_list_apps_defaults_to_current_user_and_newest_first(self) -> None:
        captured_requests: list[httpx.Request] = []
        upstream_secret = 'additive-app-field-secret'
        upstream_result = {
            **_APP_LIST_RESULT,
            'apps': [{
                **_APP_SUMMARY,
                'internal_field': upstream_secret,
            }],
            'internal_field': upstream_secret,
        }

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json=upstream_result)

        response = await self._invoke_tool(handler, 'osmo_list_apps')

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], _APP_LIST_RESULT)
        self.assertNotIn(upstream_secret, response.text)
        self.assertEqual(len(captured_requests), 1)
        upstream_request = captured_requests[0]
        self.assertEqual(upstream_request.url.path, '/api/app')
        self.assertEqual(upstream_request.url.params.multi_items(), [
            ('order', 'DESC'),
            ('limit', '50'),
            ('offset', '0'),
        ])
        self.assertNotIn('users', upstream_request.url.params)
        self.assertNotIn('all_users', upstream_request.url.params)
        self.assertEqual(
            upstream_request.headers['authorization'],
            f'Bearer {_BEARER_SECRET}',
        )

    async def test_list_apps_maps_filters_and_pagination_exactly(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json=_APP_LIST_RESULT)

        response = await self._invoke_tool(
            handler,
            'osmo_list_apps',
            {
                'name': 'train',
                'users': ['alice@example.com', 'bob@example.com'],
                'limit': 200,
                'offset': 25,
            },
        )

        self.assertFalse(response.json()['result']['isError'])
        self.assertEqual(captured_requests[0].url.params.multi_items(), [
            ('order', 'DESC'),
            ('limit', '200'),
            ('offset', '25'),
            ('name', 'train'),
            ('users', 'alice@example.com'),
            ('users', 'bob@example.com'),
        ])

    async def test_get_app_maps_name_version_and_limit_exactly(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json=_APP_RESULT)

        response = await self._invoke_tool(
            handler,
            'osmo_get_app',
            {'name': 'training_app', 'version': 3, 'limit': 7},
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            **_APP_RESULT,
            'more_versions': False,
        })
        self.assertEqual(
            captured_requests[0].url.path,
            '/api/app/user/training_app',
        )
        self.assertEqual(captured_requests[0].url.params.multi_items(), [
            ('order', 'DESC'),
            ('limit', '8'),
            ('version', '3'),
        ])

    async def test_get_app_reports_omitted_versions(self) -> None:
        captured_requests: list[httpx.Request] = []
        older_version = {
            **_APP_VERSION,
            'version': 2,
            'created_date': '2026-07-10T12:30:00Z',
        }

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                **_APP_RESULT,
                'versions': [_APP_VERSION, older_version],
            })

        response = await self._invoke_tool(
            handler,
            'osmo_get_app',
            {'name': 'training_app', 'limit': 1},
        )

        structured_content = response.json()['result']['structuredContent']
        self.assertEqual(structured_content['versions'], _APP_RESULT['versions'])
        self.assertTrue(structured_content['more_versions'])
        self.assertEqual(captured_requests[0].url.params.multi_items(), [
            ('order', 'DESC'),
            ('limit', '2'),
        ])

    async def test_get_app_spec_returns_bounded_text_with_selection(self) -> None:
        captured_requests: list[httpx.Request] = []
        app_spec = 'version: 1\nworkflow:\n  tasks: []\n'

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, text=app_spec)

        response = await self._invoke_tool(
            handler,
            'osmo_get_app_spec',
            {'name': 'training_app', 'version': 2},
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'name': 'training_app',
            'version': 2,
            'spec': app_spec,
            'truncated': False,
            'truncation_reason': None,
        })
        self.assertEqual(
            captured_requests[0].url.path,
            '/api/app/user/training_app/spec',
        )
        self.assertEqual(
            captured_requests[0].url.params.multi_items(),
            [('version', '2')],
        )

    async def test_get_app_spec_resolves_newest_ready_version(self) -> None:
        captured_requests: list[httpx.Request] = []
        app_spec = 'version: 3\nworkflow:\n  tasks: []\n'
        pending_version = {
            **_APP_VERSION,
            'version': 4,
            'status': 'PENDING',
        }

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            if request.url.path == '/api/app/user/training_app':
                return httpx.Response(200, json={
                    **_APP_RESULT,
                    'versions': [pending_version, _APP_VERSION],
                })
            if request.url.path == '/api/app/user/training_app/spec':
                return httpx.Response(200, text=app_spec)
            self.fail(f'unexpected Gateway route: {request.url}')

        response = await self._invoke_tool(
            handler,
            'osmo_get_app_spec',
            {'name': 'training_app'},
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'name': 'training_app',
            'version': 3,
            'spec': app_spec,
            'truncated': False,
            'truncation_reason': None,
        })
        self.assertEqual(len(captured_requests), 2)
        self.assertEqual(
            captured_requests[0].url.params.multi_items(),
            [('order', 'DESC'), ('limit', '201')],
        )
        self.assertEqual(
            captured_requests[1].url.params.multi_items(),
            [('version', '3')],
        )

    async def test_get_app_spec_fails_when_app_has_no_ready_versions(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                **_APP_RESULT,
                'versions': [{
                    **_APP_VERSION,
                    'version': 4,
                    'status': 'PENDING',
                }],
            })

        response = await self._invoke_tool(
            handler,
            'osmo_get_app_spec',
            {'name': 'training_app'},
        )

        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertIn('has no READY versions', response.text)
        self.assertEqual(len(captured_requests), 1)

    async def test_get_app_spec_reports_bounded_resolution_exhaustion(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []
        non_ready_versions = [
            {
                **_APP_VERSION,
                'version': version,
                'status': 'PENDING',
            }
            for version in range(201, 0, -1)
        ]

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                **_APP_RESULT,
                'versions': non_ready_versions,
            })

        response = await self._invoke_tool(
            handler,
            'osmo_get_app_spec',
            {'name': 'training_app'},
        )

        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertIn('bounded version history', response.text)
        self.assertIn('specify version explicitly', response.text)
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(
            captured_requests[0].url.params.multi_items(),
            [('order', 'DESC'), ('limit', '201')],
        )

    async def test_invalid_names_and_pagination_fail_before_transport(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json=_APP_RESULT)

        cases: tuple[tuple[str, dict[str, object]], ...] = (
            ('osmo_get_app', {'name': 'parent/child'}),
            ('osmo_get_app_spec', {'name': '..'}),
            ('osmo_list_apps', {'limit': 201}),
            ('osmo_list_apps', {'limit': True}),
            ('osmo_list_apps', {'offset': -1}),
            ('osmo_list_apps', {'offset': True}),
            ('osmo_get_app', {'name': 'training_app', 'version': True}),
            ('osmo_get_app_spec', {'name': 'training_app', 'version': True}),
            ('osmo_list_apps', {'name': 'bad\nfilter'}),
            ('osmo_list_apps', {'users': ['é' * 200]}),
            ('osmo_list_apps', {
                'users': [
                    ('é' * 120) + f'{index:02d}'
                    for index in range(50)
                ],
            }),
            ('osmo_list_apps', {
                'users': ['alice@example.com'],
                'all_users': True,
            }),
        )
        for tool_name, arguments in cases:
            with self.subTest(tool_name=tool_name, arguments=arguments):
                response = await self._invoke_tool(handler, tool_name, arguments)
                self.assertTrue(response.json()['result']['isError'])

        self.assertEqual(captured_requests, [])

    async def test_status_and_malformed_responses_are_sanitized(self) -> None:
        async def not_found(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(404, content=b'upstream-app-body-secret')

        status_response = await self._invoke_tool(
            not_found,
            'osmo_get_app',
            {'name': 'training_app'},
        )
        status_result = status_response.json()['result']
        self.assertTrue(status_result['isError'])
        self.assertIn('HTTP 404', json.dumps(status_result))
        self.assertNotIn('upstream-app-body-secret', json.dumps(status_result))

        async def malformed_json(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, content=b'upstream-malformed-secret')

        malformed_response = await self._invoke_tool(
            malformed_json,
            'osmo_list_apps',
        )
        malformed_result = malformed_response.json()['result']
        self.assertTrue(malformed_result['isError'])
        self.assertIn('invalid response', json.dumps(malformed_result))
        self.assertNotIn('upstream-malformed-secret', json.dumps(malformed_result))

        async def wrong_shape(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, json={
                'apps': 'upstream-shape-secret',
                'more_entries': False,
            })

        shape_response = await self._invoke_tool(
            wrong_shape,
            'osmo_list_apps',
        )
        shape_result = shape_response.json()['result']
        self.assertTrue(shape_result['isError'])
        self.assertNotIn('upstream-shape-secret', json.dumps(shape_result))

    async def test_json_strict_and_escape_heavy_spec_truncation_is_bounded(
        self,
    ) -> None:
        oversized_json = b'{"apps":[],"padding":"' + (
            b'x' * (1024 * 1024)
        ) + b'","more_entries":false}'
        oversized_spec = b'\x00\x1b' * (512 * 1024)

        def oversized_handler(
            body: bytes,
        ) -> protocol_harness.UpstreamHandler:
            async def handler(request: httpx.Request) -> httpx.Response:
                del request
                return httpx.Response(200, content=body)

            return handler

        response = await self._invoke_tool(
            oversized_handler(oversized_json),
            'osmo_get_app',
            {'name': 'training_app'},
        )
        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertIn('exceeds the size limit', json.dumps(result))
        self.assertNotIn(_BEARER_SECRET, json.dumps(result))

        response = await self._invoke_tool(
            oversized_handler(oversized_spec),
            'osmo_get_app_spec',
            {'name': 'training_app', 'version': 1},
        )
        result = response.json()['result']
        self.assertFalse(result['isError'])
        structured_content = result['structuredContent']
        self.assertTrue(structured_content['truncated'])
        self.assertIsNotNone(structured_content['truncation_reason'])
        self.assertIn('truncated', structured_content['spec'])
        self.assertLess(len(response.content), 512 * 1024)
        self.assertNotIn(_BEARER_SECRET, json.dumps(result))


if __name__ == '__main__':
    unittest.main()
