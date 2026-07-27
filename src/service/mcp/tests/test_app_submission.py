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


_BEARER_SECRET = 'phase-three-app-submit-bearer-secret'
_HARNESS = protocol_harness.ProtocolHarness(
    tool_names=('osmo_submit_app',),
    bearer_secret=_BEARER_SECRET,
    request_id='app-submit-request-123',
)
_PROFILE_RESULT = {
    'profile': {
        'username': 'alice@example.com',
        'pool': 'pool-default',
    },
    'roles': ['osmo-user'],
    'pools': ['pool-default', 'pool-other'],
    'token': None,
}
_PLAIN_SPEC = """\
version: 2
workflow:
  name: app-submission
  tasks:
  - name: check
    image: ubuntu:22.04
    command: [echo]
    args: [ok]
"""


def _app_metadata(
    versions: list[tuple[int, str]],
    *,
    name: str = 'training_app',
    uuid: str = 'app-uuid-123',
) -> dict[str, object]:
    return {
        'uuid': uuid,
        'name': name,
        'description': 'app metadata',
        'created_date': '2026-07-27T12:00:00Z',
        'owner': 'alice@example.com',
        'versions': [
            {
                'version': version,
                'created_by': 'alice@example.com',
                'created_date': '2026-07-27T12:00:00Z',
                'status': status,
            }
            for version, status in versions
        ],
    }


def _metadata_only_handler(
    metadata: dict[str, object],
    captured_requests: list[httpx.Request],
) -> protocol_harness.AsyncUpstreamHandler:
    async def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(200, json=metadata)

    return handler


def _submission_result_handler(
    post_response: httpx.Response,
    captured_requests: list[httpx.Request],
) -> protocol_harness.AsyncUpstreamHandler:
    async def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        if request.url.path.endswith('/spec'):
            return httpx.Response(200, text=_PLAIN_SPEC)
        if request.method == 'GET':
            return httpx.Response(
                200,
                json=_app_metadata([(3, 'READY')]),
            )
        return post_response

    return handler


class AppSubmissionProtocolTest(unittest.IsolatedAsyncioTestCase):
    """Exercise app submission through the real Streamable HTTP protocol."""

    async def test_catalog_is_closed_and_declares_only_remote_inputs(
        self,
    ) -> None:
        response = await _HARNESS.list_tools()
        tools = _HARNESS.assert_closed_catalog(
            self,
            response,
            expected_annotations={
                'osmo_submit_app': protocol_harness.WRITE_ANNOTATIONS,
            },
        )
        schema = tools['osmo_submit_app']['inputSchema']
        self.assertEqual(schema['required'], ['name'])
        self.assertEqual(schema['properties']['pool']['default'], None)
        self.assertEqual(schema['properties']['version']['default'], None)
        self.assertEqual(
            schema['properties']['set_variables']['default'],
            None,
        )
        self.assertEqual(
            schema['properties']['set_string_variables']['default'],
            None,
        )
        self.assertEqual(
            schema['properties']['priority']['default'],
            'NORMAL',
        )
        for field in ('set_variables', 'set_string_variables'):
            self.assertTrue(
                schema['properties'][field]['anyOf'][0]['writeOnly']
            )
        for excluded_argument in (
            'dry_run',
            'local_path',
            'set_env',
            'rsync',
        ):
            self.assertNotIn(excluded_argument, schema['properties'])

    async def test_explicit_version_posts_exact_template_submission(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []
        spec_secret = 'synthetic-app-spec-secret'
        upstream_secret = 'synthetic-submit-response-secret'
        templated_spec = (
            _PLAIN_SPEC
            + '\ndefault-values:\n  replicas: 1\n'
            + f'# {{{{ replicas }}}} {spec_secret}\n'
        )

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            if request.method == 'GET' and request.url.path.endswith(
                '/spec'
            ):
                return httpx.Response(200, text=templated_spec)
            if request.method == 'GET':
                return httpx.Response(
                    200,
                    json=_app_metadata([(3, 'READY')]),
                )
            return httpx.Response(200, json={
                'name': 'app-run-1',
                'overview': (
                    f'https://example.test/?secret={upstream_secret}'
                ),
                'logs': (
                    f'https://example.test/logs?secret={upstream_secret}'
                ),
            })

        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured_logs:
            response = await _HARNESS.call_tool(
                handler,
                'osmo_submit_app',
                {
                    'name': 'training_app',
                    'pool': 'pool-a',
                    'version': 3,
                    'set_variables': ['replicas=2'],
                    'set_string_variables': ['image_tag=latest'],
                    'priority': 'HIGH',
                },
            )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'workflow_id': 'app-run-1',
            'app_name': 'training_app',
            'app_version': 3,
            'pool': 'pool-a',
            'priority': 'HIGH',
            'submitted': True,
        })
        self.assertNotIn(spec_secret, response.text)
        self.assertNotIn(upstream_secret, response.text)
        self.assertNotIn('app-uuid-123', response.text)
        self.assertEqual(len(captured_requests), 3)

        metadata_request = captured_requests[0]
        spec_request = captured_requests[1]
        submit_request = captured_requests[2]
        self.assertEqual(metadata_request.method, 'GET')
        self.assertEqual(
            metadata_request.url.path,
            '/api/app/user/training_app',
        )
        self.assertEqual(
            metadata_request.url.params.multi_items(),
            [('order', 'DESC'), ('limit', '1'), ('version', '3')],
        )
        self.assertEqual(
            spec_request.url.path,
            '/api/app/user/training_app/spec',
        )
        self.assertEqual(
            spec_request.url.params.multi_items(),
            [('version', '3')],
        )
        self.assertEqual(submit_request.method, 'POST')
        self.assertEqual(
            submit_request.url.path,
            '/api/pool/pool-a/workflow',
        )
        self.assertEqual(
            submit_request.url.params.multi_items(),
            [
                ('app_uuid', 'app-uuid-123'),
                ('app_version', '3'),
                ('priority', 'HIGH'),
            ],
        )
        self.assertEqual(json.loads(submit_request.content), {
            'file': templated_spec,
            'set_variables': ['replicas=2'],
            'set_string_variables': ['image_tag=latest'],
            'uploaded_templated_spec': templated_spec,
        })

        telemetry_text = '\n'.join(captured_logs.output)
        self.assertIn('tool=osmo_submit_app', telemetry_text)
        self.assertIn(
            'route=/api/app/user/{app_name}',
            telemetry_text,
        )
        self.assertIn(
            'route=/api/app/user/{app_name}/spec',
            telemetry_text,
        )
        self.assertIn(
            'route=/api/pool/{pool}/workflow',
            telemetry_text,
        )
        self.assertNotIn(spec_secret, telemetry_text)
        self.assertNotIn('app-uuid-123', telemetry_text)

    async def test_omitted_version_pins_newest_ready_and_default_pool(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            if request.url.path == '/api/profile/settings':
                return httpx.Response(200, json=_PROFILE_RESULT)
            if request.url.path.endswith('/spec'):
                self.assertEqual(
                    request.url.params.multi_items(),
                    [('version', '8')],
                )
                return httpx.Response(200, text=_PLAIN_SPEC)
            if request.method == 'GET':
                return httpx.Response(200, json=_app_metadata([
                    (9, 'PENDING'),
                    (8, 'READY'),
                    (7, 'READY'),
                ]))
            return httpx.Response(200, json={
                'name': 'app-run-2',
                'overview': 'https://example.test/workflow',
                'logs': 'https://example.test/logs',
            })

        response = await _HARNESS.call_tool(
            handler,
            'osmo_submit_app',
            {'name': 'training_app'},
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'workflow_id': 'app-run-2',
            'app_name': 'training_app',
            'app_version': 8,
            'pool': 'pool-default',
            'priority': 'NORMAL',
            'submitted': True,
        })
        self.assertEqual(
            [request.url.path for request in captured_requests],
            [
                '/api/profile/settings',
                '/api/app/user/training_app',
                '/api/app/user/training_app/spec',
                '/api/pool/pool-default/workflow',
            ],
        )
        self.assertEqual(
            captured_requests[1].url.params.multi_items(),
            [('order', 'DESC'), ('limit', '201')],
        )
        self.assertEqual(
            captured_requests[3].url.params.multi_items(),
            [
                ('app_uuid', 'app-uuid-123'),
                ('app_version', '8'),
            ],
        )
        self.assertEqual(json.loads(captured_requests[3].content), {
            'file': _PLAIN_SPEC,
            'set_variables': [],
            'set_string_variables': [],
        })

    async def test_invalid_arguments_are_rejected_before_relay(
        self,
    ) -> None:
        transport_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal transport_calls
            transport_calls += 1
            return httpx.Response(200, json={})

        invalid_arguments: tuple[dict[str, object], ...] = (
            {'name': '../training_app'},
            {'name': 'training_app', 'pool': ' pool-a'},
            {'name': 'training_app', 'pool': '../other-pool'},
            {'name': 'training_app', 'version': True},
            {'name': 'training_app', 'pool': 'pool-a', 'priority': 'URGENT'},
            {
                'name': 'training_app',
                'pool': 'pool-a',
                'set_variables': ['missing-separator'],
            },
            {
                'name': 'training_app',
                'pool': 'pool-a',
                'local_path': '/private/data',
            },
        )
        async with _HARNESS.client(handler) as client:
            for request_id, arguments in enumerate(
                invalid_arguments,
                start=1,
            ):
                with self.subTest(arguments=arguments):
                    response = await _HARNESS.call_tool_with_client(
                        client,
                        'osmo_submit_app',
                        arguments,
                        request_id=request_id,
                    )
                    self.assertTrue(response.json()['result']['isError'])

        self.assertEqual(transport_calls, 0)

    async def test_invalid_app_metadata_never_fetches_or_submits_spec(
        self,
    ) -> None:
        invalid_cases = (
            (
                _app_metadata([(3, 'READY')], name='different_app'),
                3,
            ),
            (_app_metadata([(3, 'PENDING')]), 3),
            (_app_metadata([]), 3),
            (_app_metadata([(3, 'READY'), (3, 'READY')]), None),
            (_app_metadata([(4, 'READY')]), 3),
        )

        for request_id, (metadata, version) in enumerate(
            invalid_cases,
            start=1,
        ):
            with self.subTest(metadata=metadata, version=version):
                captured_requests: list[httpx.Request] = []

                arguments: dict[str, object] = {
                    'name': 'training_app',
                    'pool': 'pool-a',
                }
                if version is not None:
                    arguments['version'] = version
                response = await _HARNESS.call_tool(
                    _metadata_only_handler(
                        metadata,
                        captured_requests,
                    ),
                    'osmo_submit_app',
                    arguments,
                    request_id=request_id,
                )
                self.assertTrue(response.json()['result']['isError'])
                self.assertEqual(len(captured_requests), 1)
                self.assertEqual(captured_requests[0].method, 'GET')

    async def test_oversized_spec_fails_before_submission(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            if request.url.path.endswith('/spec'):
                return httpx.Response(
                    200,
                    content=b'x' * (128 * 1024 + 1),
                )
            return httpx.Response(
                200,
                json=_app_metadata([(3, 'READY')]),
            )

        response = await _HARNESS.call_tool(
            handler,
            'osmo_submit_app',
            {
                'name': 'training_app',
                'pool': 'pool-a',
                'version': 3,
            },
        )

        self.assertTrue(response.json()['result']['isError'])
        self.assertEqual(len(captured_requests), 2)
        self.assertTrue(all(
            request.method == 'GET' for request in captured_requests
        ))

    async def test_ambiguous_or_malformed_submission_is_not_retried(
        self,
    ) -> None:
        private_detail = 'private-app-submit-server-detail'
        post_responses = (
            httpx.Response(503, text=private_detail),
            httpx.Response(200, json={'name': 'app-run-3'}),
        )

        for request_id, post_response in enumerate(
            post_responses,
            start=1,
        ):
            with self.subTest(status_code=post_response.status_code):
                captured_requests: list[httpx.Request] = []

                response = await _HARNESS.call_tool(
                    _submission_result_handler(
                        post_response,
                        captured_requests,
                    ),
                    'osmo_submit_app',
                    {
                        'name': 'training_app',
                        'pool': 'pool-a',
                        'version': 3,
                    },
                    request_id=request_id,
                )

                self.assertTrue(response.json()['result']['isError'])
                self.assertIn('write outcome is unknown', response.text)
                self.assertIn(
                    'Inspect OSMO state before retrying',
                    response.text,
                )
                self.assertNotIn(private_detail, response.text)
                self.assertEqual(len(captured_requests), 3)
                self.assertEqual(
                    sum(
                        request.method == 'POST'
                        for request in captured_requests
                    ),
                    1,
                )


if __name__ == '__main__':
    unittest.main()
