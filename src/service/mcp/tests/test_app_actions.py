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


_BEARER_SECRET = 'app-action-bearer-secret'
_INPUT_SECRET = 'app-spec-sensitive-canary'
_APP_SPEC = f"""\
version: 2
workflow:
  name: app-action-test
  tasks:
  - name: check
    image: ubuntu:22.04
    command: [echo]
    args: [{_INPUT_SECRET}]
"""
_HARNESS = protocol_harness.ProtocolHarness(
    tool_names=(
        'osmo_create_app',
        'osmo_update_app',
        'osmo_delete_app',
        'osmo_rename_app',
    ),
    bearer_secret=_BEARER_SECRET,
    request_id='app-action-request-123',
)
_UPDATE_RESPONSE = {
    'uuid': '0123456789abcdef0123456789abcdef',
    'version': 4,
    'name': 'training_app',
    'created_by': 'alice@example.com',
    'created_date': '2026-07-27T12:00:00Z',
}


class AppActionProtocolTest(unittest.IsolatedAsyncioTestCase):
    """Exercise app mutations through the real Streamable HTTP protocol."""

    async def _invoke_tool(
        self,
        handler: protocol_harness.UpstreamHandler,
        tool_name: str,
        arguments: dict[str, object],
    ) -> httpx.Response:
        return await _HARNESS.call_tool(
            handler,
            tool_name,
            arguments,
        )

    async def test_catalog_is_closed_and_marks_destructive_actions(self) -> None:
        response = await _HARNESS.list_tools()
        tools = _HARNESS.assert_closed_catalog(
            self,
            response,
            expected_annotations={
                'osmo_create_app': protocol_harness.WRITE_ANNOTATIONS,
                'osmo_update_app': protocol_harness.WRITE_ANNOTATIONS,
                'osmo_delete_app':
                    protocol_harness.DESTRUCTIVE_WRITE_ANNOTATIONS,
                'osmo_rename_app':
                    protocol_harness.DESTRUCTIVE_WRITE_ANNOTATIONS,
            },
        )

        create_schema = tools['osmo_create_app']['inputSchema']
        self.assertEqual(
            create_schema['required'],
            ['name', 'description', 'spec_content'],
        )
        self.assertEqual(
            create_schema['properties']['description']['maxLength'],
            2048,
        )
        self.assertEqual(
            create_schema['properties']['spec_content']['maxLength'],
            128 * 1024,
        )
        delete_schema = tools['osmo_delete_app']['inputSchema']
        self.assertEqual(delete_schema['required'], ['name'])
        self.assertEqual(
            delete_schema['properties']['version']['default'],
            None,
        )
        self.assertFalse(
            delete_schema['properties']['all_versions']['default']
        )
        self.assertIn(
            'Specify exactly one',
            delete_schema['properties']['version']['anyOf'][0][
                'description'
            ],
        )
        self.assertTrue(
            create_schema['properties']['spec_content']['writeOnly']
        )
        self.assertEqual(
            tools['osmo_delete_app']['outputSchema']['properties'][
                'scheduled_versions'
            ]['maxItems'],
            200,
        )
        for excluded_argument in ('file', 'force', 'method', 'route'):
            for tool in tools.values():
                self.assertNotIn(
                    excluded_argument,
                    tool['inputSchema']['properties'],
                )

    async def test_create_posts_exact_string_body_and_accepts_null(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(
                200,
                content=b'null',
                headers={'content-type': 'application/json'},
            )

        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured_logs:
            response = await self._invoke_tool(
                handler,
                'osmo_create_app',
                {
                    'name': 'training_app',
                    'description': 'Non-secret training app',
                    'spec_content': _APP_SPEC,
                },
            )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'name': 'training_app',
            'version': 1,
            'created': True,
            'upload_scheduled': True,
        })
        self.assertNotIn(_INPUT_SECRET, response.text)
        self.assertEqual(len(captured_requests), 1)
        request = captured_requests[0]
        self.assertEqual(request.method, 'POST')
        self.assertEqual(request.url.path, '/api/app/user/training_app')
        self.assertEqual(request.url.params.multi_items(), [
            ('description', 'Non-secret training app'),
        ])
        self.assertEqual(json.loads(request.content), _APP_SPEC)
        self.assertEqual(
            request.headers['authorization'],
            f'Bearer {_BEARER_SECRET}',
        )
        self.assertEqual(
            request.headers['x-request-id'],
            'app-action-request-123',
        )
        telemetry_text = '\n'.join(captured_logs.output)
        self.assertIn('tool=osmo_create_app', telemetry_text)
        self.assertIn(
            'route=/api/app/user/{app_name}',
            telemetry_text,
        )
        self.assertNotIn(_INPUT_SECRET, telemetry_text)
        self.assertNotIn('Non-secret training app', telemetry_text)
        self.assertNotIn('training_app', telemetry_text)

    async def test_update_patches_spec_and_projects_scheduled_version(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []
        upstream_secret = 'app-update-upstream-sensitive-value'

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                **_UPDATE_RESPONSE,
                'storage_uri': (
                    's3://bucket?X-Amz-Signature=' + upstream_secret
                ),
            })

        response = await self._invoke_tool(
            handler,
            'osmo_update_app',
            {
                'name': 'training_app',
                'spec_content': _APP_SPEC,
            },
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'name': 'training_app',
            'version': 4,
            'upload_scheduled': True,
        })
        self.assertNotIn(_INPUT_SECRET, response.text)
        self.assertNotIn(upstream_secret, response.text)
        self.assertEqual(len(captured_requests), 1)
        request = captured_requests[0]
        self.assertEqual(request.method, 'PATCH')
        self.assertEqual(request.url.path, '/api/app/user/training_app')
        self.assertEqual(request.url.params.multi_items(), [])
        self.assertEqual(json.loads(request.content), _APP_SPEC)

    async def test_delete_requires_and_maps_exactly_one_selector(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            if request.url.params.get('all_versions') == 'true':
                versions = list(range(205, 0, -1))
            elif request.url.params.get('version') == '7':
                versions = []
            else:
                versions = [3]
            return httpx.Response(200, json={'versions': versions})

        async with _HARNESS.client(handler) as client:
            version_response = await _HARNESS.call_tool_with_client(
                client,
                'osmo_delete_app',
                {'name': 'training_app', 'version': 3},
                request_id=1,
            )
            all_response = await _HARNESS.call_tool_with_client(
                client,
                'osmo_delete_app',
                {'name': 'training_app', 'all_versions': True},
                request_id=2,
            )
            already_deleted_response = (
                await _HARNESS.call_tool_with_client(
                    client,
                    'osmo_delete_app',
                    {'name': 'training_app', 'version': 7},
                    request_id=3,
                )
            )

        self.assertEqual(
            version_response.json()['result']['structuredContent'],
            {
                'name': 'training_app',
                'scheduled_versions': [3],
                'scheduled_version_count': 1,
                'more_versions': False,
                'deletion_scheduled': True,
            },
        )
        all_content = all_response.json()['result']['structuredContent']
        self.assertEqual(all_content['name'], 'training_app')
        self.assertEqual(
            all_content['scheduled_versions'],
            list(range(205, 5, -1)),
        )
        self.assertEqual(all_content['scheduled_version_count'], 205)
        self.assertTrue(all_content['more_versions'])
        self.assertTrue(all_content['deletion_scheduled'])
        self.assertEqual(
            already_deleted_response.json()['result'][
                'structuredContent'
            ],
            {
                'name': 'training_app',
                'scheduled_versions': [],
                'scheduled_version_count': 0,
                'more_versions': False,
                'deletion_scheduled': False,
            },
        )
        self.assertEqual(
            [
                (request.method, request.url.path, request.url.params.multi_items())
                for request in captured_requests
            ],
            [
                (
                    'DELETE',
                    '/api/app/user/training_app',
                    [('version', '3')],
                ),
                (
                    'DELETE',
                    '/api/app/user/training_app',
                    [('all_versions', 'true')],
                ),
                (
                    'DELETE',
                    '/api/app/user/training_app',
                    [('version', '7')],
                ),
            ],
        )
        self.assertTrue(all(not request.content for request in captured_requests))

    async def test_rename_posts_exact_scalar_and_requires_matching_response(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json='renamed_app')

        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured_logs:
            response = await self._invoke_tool(
                handler,
                'osmo_rename_app',
                {
                    'original_name': 'training_app',
                    'new_name': 'renamed_app',
                },
            )

        self.assertEqual(
            response.json()['result']['structuredContent'],
            {
                'original_name': 'training_app',
                'new_name': 'renamed_app',
                'renamed': True,
            },
        )
        self.assertEqual(len(captured_requests), 1)
        request = captured_requests[0]
        self.assertEqual(request.method, 'POST')
        self.assertEqual(
            request.url.path,
            '/api/app/user/training_app/rename',
        )
        self.assertEqual(json.loads(request.content), 'renamed_app')
        telemetry_text = '\n'.join(captured_logs.output)
        self.assertIn('tool=osmo_rename_app', telemetry_text)
        self.assertIn(
            'route=/api/app/user/{app_name}/rename',
            telemetry_text,
        )
        self.assertNotIn('training_app', telemetry_text)
        self.assertNotIn('renamed_app', telemetry_text)

    async def test_invalid_arguments_fail_before_transport(self) -> None:
        transport_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal transport_calls
            transport_calls += 1
            return httpx.Response(
                200,
                content=b'null',
                headers={'content-type': 'application/json'},
            )

        invalid_calls: tuple[tuple[str, dict[str, object]], ...] = (
            (
                'osmo_create_app',
                {
                    'name': 'bad/name',
                    'description': 'description',
                    'spec_content': _APP_SPEC,
                },
            ),
            (
                'osmo_create_app',
                {
                    'name': 'training_app',
                    'description': '\u00e9' * 1025,
                    'spec_content': _APP_SPEC,
                },
            ),
            (
                'osmo_create_app',
                {
                    'name': 'training_app',
                    'description': 'description',
                    'spec_content': '\u00e9' * (64 * 1024 + 1),
                },
            ),
            (
                'osmo_delete_app',
                {'name': 'training_app'},
            ),
            (
                'osmo_delete_app',
                {
                    'name': 'training_app',
                    'version': 3,
                    'all_versions': True,
                },
            ),
            (
                'osmo_delete_app',
                {'name': 'training_app', 'all_versions': 1},
            ),
            (
                'osmo_rename_app',
                {
                    'original_name': 'training_app',
                    'new_name': 'training_app',
                },
            ),
            (
                'osmo_update_app',
                {
                    'name': 'training_app',
                    'spec_content': _APP_SPEC,
                    'route': '/api/credentials',
                },
            ),
        )
        async with _HARNESS.client(handler) as client:
            for request_id, (tool_name, arguments) in enumerate(
                invalid_calls,
                start=1,
            ):
                with self.subTest(tool_name=tool_name, arguments=arguments):
                    response = await _HARNESS.call_tool_with_client(
                        client,
                        tool_name,
                        arguments,
                        request_id=request_id,
                    )
                    self.assertTrue(
                        response.json()['result']['isError']
                    )

        self.assertEqual(transport_calls, 0)

    async def test_mismatched_successes_are_unknown_and_not_retried(
        self,
    ) -> None:
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if request.method == 'PATCH':
                return httpx.Response(200, json={
                    **_UPDATE_RESPONSE,
                    'name': 'different_app',
                })
            if request.method == 'DELETE':
                return httpx.Response(200, json={'versions': [2]})
            if request.url.path.endswith('/rename'):
                return httpx.Response(200, json='different_app')
            return httpx.Response(200, json={})

        calls_and_arguments: tuple[
            tuple[str, dict[str, object]],
            ...,
        ] = (
            (
                'osmo_create_app',
                {
                    'name': 'training_app',
                    'description': 'description',
                    'spec_content': _APP_SPEC,
                },
            ),
            (
                'osmo_update_app',
                {
                    'name': 'training_app',
                    'spec_content': _APP_SPEC,
                },
            ),
            (
                'osmo_delete_app',
                {'name': 'training_app', 'version': 3},
            ),
            (
                'osmo_rename_app',
                {
                    'original_name': 'training_app',
                    'new_name': 'renamed_app',
                },
            ),
        )
        async with _HARNESS.client(handler) as client:
            for request_id, (tool_name, arguments) in enumerate(
                calls_and_arguments,
                start=1,
            ):
                response = await _HARNESS.call_tool_with_client(
                    client,
                    tool_name,
                    arguments,
                    request_id=request_id,
                )
                self.assertTrue(response.json()['result']['isError'])
                self.assertIn(
                    'write outcome is unknown',
                    response.text,
                )
                self.assertIn(
                    'Inspect OSMO state before retrying',
                    response.text,
                )

        self.assertEqual(calls, len(calls_and_arguments))

    async def test_write_errors_do_not_reflect_app_content_or_retry(
        self,
    ) -> None:
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal calls
            calls += 1
            return httpx.Response(422, json={
                'message': _INPUT_SECRET,
                'error_code': 'USAGE',
                'spec': _APP_SPEC,
            })

        response = await self._invoke_tool(
            handler,
            'osmo_create_app',
            {
                'name': 'training_app',
                'description': 'description',
                'spec_content': _APP_SPEC,
            },
        )

        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('HTTP 422', response.text)
        self.assertNotIn(_INPUT_SECRET, response.text)
        self.assertNotIn('error_code', response.text)
        self.assertEqual(calls, 1)

    async def test_server_failure_is_unknown_and_not_retried(self) -> None:
        calls = 0
        upstream_secret = 'app-server-sensitive-detail'

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal calls
            calls += 1
            return httpx.Response(
                503,
                json={'message': upstream_secret},
            )

        response = await self._invoke_tool(
            handler,
            'osmo_update_app',
            {
                'name': 'training_app',
                'spec_content': _APP_SPEC,
            },
        )

        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('write outcome is unknown', response.text)
        self.assertNotIn(upstream_secret, response.text)
        self.assertEqual(calls, 1)


if __name__ == '__main__':
    unittest.main()
