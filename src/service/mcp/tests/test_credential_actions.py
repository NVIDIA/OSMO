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
from unittest import mock

import httpx
from mcp.server.fastmcp.exceptions import ToolError

from src.service.mcp import credential_actions
from src.service.mcp.credential_action_models import (
    MAX_CREDENTIAL_PAYLOAD_VALUE_LENGTH,
)
from src.service.mcp.tests import protocol_harness


_BEARER_SECRET = 'credential-action-bearer-secret'
_REQUEST_ID = 'phase-three-request-123'
_HARNESS = protocol_harness.ProtocolHarness(
    tool_names=(
        'osmo_set_credential',
        'osmo_delete_credential',
    ),
    bearer_secret=_BEARER_SECRET,
    request_id=_REQUEST_ID,
)
_DESTRUCTIVE_IDEMPOTENT_ANNOTATIONS = {
    **protocol_harness.DESTRUCTIVE_WRITE_ANNOTATIONS,
    'idempotentHint': True,
}


class CredentialActionProtocolTest(unittest.IsolatedAsyncioTestCase):
    """Exercise credential mutations through real Streamable HTTP handling."""

    async def test_catalog_has_non_reflective_closed_action_schemas(
        self,
    ) -> None:
        response = await _HARNESS.list_tools()
        tools = _HARNESS.assert_closed_catalog(
            self,
            response,
            expected_annotations={
                'osmo_set_credential':
                    _DESTRUCTIVE_IDEMPOTENT_ANNOTATIONS,
                'osmo_delete_credential':
                    _DESTRUCTIVE_IDEMPOTENT_ANNOTATIONS,
            },
        )

        set_schema = tools['osmo_set_credential']['inputSchema']
        self.assertEqual(
            set_schema['required'],
            ['name', 'cred_type', 'payload'],
        )
        self.assertEqual(
            set_schema['properties']['name']['maxLength'],
            512,
        )
        self.assertEqual(
            set_schema['properties']['cred_type']['enum'],
            ['REGISTRY', 'DATA', 'GENERIC'],
        )
        payload_schema = set_schema['properties']['payload']
        self.assertEqual(payload_schema['type'], 'object')
        self.assertEqual(payload_schema['maxProperties'], 64)
        self.assertEqual(
            payload_schema['additionalProperties']['type'],
            'string',
        )
        self.assertEqual(
            payload_schema['additionalProperties']['maxLength'],
            64 * 1024,
        )
        self.assertTrue(
            payload_schema['additionalProperties']['writeOnly']
        )
        self.assertEqual(
            tools['osmo_delete_credential']['inputSchema']['required'],
            ['name'],
        )
        for tool_name in _HARNESS.tool_names:
            output_properties = tools[tool_name][
                'outputSchema'
            ]['properties']
            for excluded_field in (
                'payload',
                'profile',
                'credential',
                'auth',
            ):
                self.assertNotIn(excluded_field, output_properties)

    async def test_set_relays_exact_envelope_and_request_identity(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []
        payload_secret = 'registry-protocol-payload-secret'

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
            response = await _HARNESS.call_tool(
                handler,
                'osmo_set_credential',
                {
                    'name': 'registry-cred',
                    'cred_type': 'REGISTRY',
                    'payload': {
                        'auth': payload_secret,
                        'registry': 'nvcr.io/example',
                        'username': 'registry-user',
                    },
                },
            )

        result = response.json()['result']
        self.assertFalse(result['isError'], response.text)
        self.assertEqual(result['structuredContent'], {
            'cred_name': 'registry-cred',
            'cred_type': 'REGISTRY',
            'saved': True,
        })
        self.assertNotIn(payload_secret, response.text)
        self.assertNotIn(_BEARER_SECRET, response.text)
        telemetry_text = '\n'.join(captured_logs.output)
        self.assertIn('tool=osmo_set_credential', telemetry_text)
        self.assertIn(
            'route=/api/credentials/{credential_name}',
            telemetry_text,
        )
        for excluded in (
            _BEARER_SECRET,
            'registry-cred',
            'registry-protocol-payload-secret',
            'nvcr.io/example',
            'registry-user',
        ):
            self.assertNotIn(excluded, telemetry_text)
        self.assertEqual(len(captured_requests), 1)
        request = captured_requests[0]
        self.assertEqual(request.method, 'POST')
        self.assertEqual(request.url.path, '/api/credentials/registry-cred')
        self.assertEqual(request.url.query, b'')
        self.assertEqual(json.loads(request.content), {
            'registry_credential': {
                'auth': payload_secret,
                'registry': 'nvcr.io/example',
                'username': 'registry-user',
            },
        })
        self.assertEqual(
            request.headers['authorization'],
            f'Bearer {_BEARER_SECRET}',
        )
        self.assertEqual(
            request.headers['x-request-id'],
            _REQUEST_ID,
        )

    async def test_delete_projects_exact_matching_metadata(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []
        profile_secret = (
            's3://user:password@example-bucket?'
            'X-Amz-Signature=delete-profile-secret'
        )

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                'credentials': [{
                    'cred_name': 'data_cred',
                    'cred_type': 'DATA',
                    'profile': profile_secret,
                    'payload': 'delete-upstream-payload-secret',
                }],
            })

        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured_logs:
            response = await _HARNESS.call_tool(
                handler,
                'osmo_delete_credential',
                {'name': 'data_cred'},
            )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'cred_name': 'data_cred',
            'cred_type': 'DATA',
            'deleted': True,
        })
        self.assertNotIn(profile_secret, response.text)
        self.assertNotIn('delete-upstream-payload-secret', response.text)
        self.assertNotIn(_BEARER_SECRET, response.text)
        telemetry_text = '\n'.join(captured_logs.output)
        self.assertIn('tool=osmo_delete_credential', telemetry_text)
        self.assertIn(
            'route=/api/credentials/{credential_name}',
            telemetry_text,
        )
        for excluded in (
            _BEARER_SECRET,
            'data_cred',
            profile_secret,
            'delete-upstream-payload-secret',
        ):
            self.assertNotIn(excluded, telemetry_text)
        self.assertEqual(len(captured_requests), 1)
        request = captured_requests[0]
        self.assertEqual(request.method, 'DELETE')
        self.assertEqual(request.url.path, '/api/credentials/data_cred')
        self.assertEqual(request.content, b'')
        self.assertEqual(
            request.headers['authorization'],
            f'Bearer {_BEARER_SECRET}',
        )
        self.assertEqual(
            request.headers['x-request-id'],
            _REQUEST_ID,
        )

    async def test_reflected_validation_error_is_not_returned(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []
        reflected_secret = 'reflected-core-validation-secret'

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(422, json={
                'detail': [{
                    'loc': ['body', 'generic_credential', 'credential'],
                    'msg': reflected_secret,
                    'input': {
                        'token': reflected_secret,
                    },
                }],
                'error_code': 'CREDENTIAL',
            })

        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured_logs:
            response = await _HARNESS.call_tool(
                handler,
                'osmo_set_credential',
                {
                    'name': 'generic-cred',
                    'cred_type': 'GENERIC',
                    'payload': {'token': reflected_secret},
                },
            )

        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertIn('HTTP 422', str(result))
        self.assertNotIn(reflected_secret, response.text)
        self.assertNotIn('generic_credential', response.text)
        self.assertNotIn('error_code', response.text)
        self.assertEqual(len(captured_requests), 1)
        telemetry_text = '\n'.join(captured_logs.output)
        for excluded in (
            _BEARER_SECRET,
            'generic-cred',
            reflected_secret,
            'generic_credential',
            'error_code',
        ):
            self.assertNotIn(excluded, telemetry_text)

    async def test_ambiguous_failures_are_unknown_and_one_shot(
        self,
    ) -> None:
        upstream_secret = 'ambiguous-upstream-secret'
        captured_requests: list[httpx.Request] = []

        async def malformed(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(
                200,
                content=f'not-json-{upstream_secret}'.encode('utf-8'),
            )

        async def unavailable(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(
                503,
                json={'message': upstream_secret},
            )

        async def transport_failure(
            request: httpx.Request,
        ) -> httpx.Response:
            captured_requests.append(request)
            raise httpx.ReadError(upstream_secret, request=request)

        for name, handler in (
            ('malformed', malformed),
            ('unavailable', unavailable),
            ('transport', transport_failure),
        ):
            with self.subTest(failure=name):
                captured_requests.clear()
                response = await _HARNESS.call_tool(
                    handler,
                    'osmo_set_credential',
                    {
                        'name': 'generic-cred',
                        'cred_type': 'GENERIC',
                        'payload': {'token': 'write-input-secret'},
                    },
                )
                result = response.json()['result']
                self.assertTrue(result['isError'])
                self.assertIn('write outcome is unknown', str(result))
                self.assertIn(
                    'Inspect OSMO state before retrying',
                    str(result),
                )
                self.assertNotIn(upstream_secret, response.text)
                self.assertEqual(len(captured_requests), 1)

    async def test_invalid_protocol_inputs_never_reach_transport(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []
        input_secret = 'invalid-protocol-input-secret'

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(
                200,
                content=b'null',
                headers={'content-type': 'application/json'},
            )

        invalid_arguments: tuple[dict[str, object], ...] = (
            {
                'name': f'bad/{input_secret}',
                'cred_type': 'GENERIC',
                'payload': {'token': input_secret},
            },
            {
                'name': 'generic-cred',
                'cred_type': input_secret,
                'payload': {'token': input_secret},
            },
            {
                'name': 'generic-cred',
                'cred_type': 'GENERIC',
                'payload': {'token': 123, 'opaque': input_secret},
            },
            {
                'name': 'generic-cred',
                'cred_type': 'GENERIC',
                'payload': [input_secret],
            },
            {
                'name': 'generic-cred',
                'cred_type': 'GENERIC',
                'payload': {
                    'token': input_secret + ('x' * (64 * 1024)),
                },
            },
            {
                'name': 'registry-cred',
                'cred_type': 'REGISTRY',
                'payload': {
                    'auth': 'registry-auth-secret',
                    'registry': (
                        'https://user:password@registry.example/'
                        f'?token={input_secret}'
                    ),
                },
            },
            {
                'name': 'data-cred',
                'cred_type': 'DATA',
                'payload': {
                    'access_key_id': 'access-key-id',
                    'access_key': 'access-key-secret',
                    'endpoint': (
                        f's3://bucket?X-Amz-Signature={input_secret}'
                    ),
                },
            },
        )

        for arguments in invalid_arguments:
            with self.subTest(
                cred_type=arguments.get('cred_type'),
                payload_type=type(arguments.get('payload')).__name__,
            ):
                captured_requests.clear()
                response = await _HARNESS.call_tool(
                    handler,
                    'osmo_set_credential',
                    arguments,
                )
                result = response.json()['result']
                self.assertTrue(result['isError'])
                self.assertNotIn(input_secret, response.text)
                self.assertNotIn('registry-auth-secret', response.text)
                self.assertNotIn('access-key-secret', response.text)
                self.assertEqual(captured_requests, [])


class CredentialActionTest(unittest.IsolatedAsyncioTestCase):
    """Validate secret-safe mappings for external credential mutations."""

    def setUp(self) -> None:
        self.context = mock.Mock()
        self.request_mutation = mock.AsyncMock()
        self.request_patch = mock.patch.object(
            credential_actions.tool_requests,
            'request_json_mutation',
            self.request_mutation,
        )
        self.request_patch.start()
        self.addCleanup(self.request_patch.stop)

    async def test_set_credential_sends_exact_type_envelopes(self) -> None:
        cases = (
            (
                'registry-cred',
                'REGISTRY',
                {
                    'auth': 'registry-secret-value',
                    'registry': 'nvcr.io/example',
                    'username': 'registry-user',
                },
                {
                    'registry_credential': {
                        'auth': 'registry-secret-value',
                        'registry': 'nvcr.io/example',
                        'username': 'registry-user',
                    },
                },
            ),
            (
                'data_cred',
                'DATA',
                {
                    'access_key_id': 'data-access-key-id',
                    'access_key': 'data-access-key-secret',
                    'endpoint': 's3://example-bucket',
                    'region': 'us-west-2',
                    'override_url': 'https://storage.example.test',
                    'addressing_style': 'virtual',
                },
                {
                    'data_credential': {
                        'access_key_id': 'data-access-key-id',
                        'access_key': 'data-access-key-secret',
                        'endpoint': 's3://example-bucket',
                        'region': 'us-west-2',
                        'override_url': 'https://storage.example.test',
                        'addressing_style': 'virtual',
                    },
                },
            ),
            (
                'generic-cred',
                'GENERIC',
                {
                    'api_token': 'generic-api-secret',
                    'ssh_key': 'line one\nline two\n',
                },
                {
                    'generic_credential': {
                        'credential': {
                            'api_token': 'generic-api-secret',
                            'ssh_key': 'line one\nline two\n',
                        },
                    },
                },
            ),
        )
        for name, cred_type, payload, expected_payload in cases:
            with self.subTest(cred_type=cred_type):
                self.request_mutation.reset_mock()
                self.request_mutation.return_value = None

                result = await credential_actions.osmo_set_credential(
                    self.context,
                    name,
                    cred_type,
                    payload,
                )

                self.assertEqual(result.model_dump(mode='json'), {
                    'cred_name': name,
                    'cred_type': cred_type,
                    'saved': True,
                })
                result_text = result.model_dump_json()
                for value in payload.values():
                    self.assertNotIn(value, result_text)
                self.request_mutation.assert_awaited_once_with(
                    self.context,
                    method='POST',
                    path=f'/api/credentials/{name}',
                    operation='set an OSMO credential',
                    max_response_bytes=1024,
                    payload=expected_payload,
                )

    async def test_invalid_payloads_are_fixed_and_never_reach_transport(
        self,
    ) -> None:
        input_secret = 'local-validation-secret-value'
        invalid_cases: tuple[tuple[object, object], ...] = (
            ('REGISTRY', {'username': input_secret}),
            (
                'REGISTRY',
                {'auth': input_secret, 'unexpected': input_secret},
            ),
            (
                'DATA',
                {
                    'access_key_id': input_secret,
                    'access_key': input_secret,
                },
            ),
            (
                'DATA',
                {
                    'access_key_id': input_secret,
                    'access_key': input_secret,
                    'endpoint': 's3://bucket',
                    'addressing_style': input_secret,
                },
            ),
            ('GENERIC', {}),
            ('GENERIC', {'token': 123}),
            ('GENERIC', {' token ': input_secret}),
            ('GENERIC', {'token': ''}),
            ('GENERIC', ['token', input_secret]),
        )

        for cred_type, payload in invalid_cases:
            with self.subTest(
                cred_type=cred_type,
                payload_type=type(payload).__name__,
            ):
                self.request_mutation.reset_mock()
                with self.assertRaisesRegex(
                    ToolError,
                    '^Invalid credential payload\\.$',
                ) as raised:
                    await credential_actions.osmo_set_credential(
                        self.context,
                        'generic-cred',
                        cred_type,
                        payload,
                    )
                self.assertNotIn(input_secret, str(raised.exception))
                self.request_mutation.assert_not_awaited()

    async def test_secret_bearing_url_components_are_rejected(
        self,
    ) -> None:
        cases = (
            (
                'REGISTRY',
                {
                    'auth': 'registry-auth-secret',
                    'registry': (
                        'https://user:url-userinfo-secret@'
                        'registry.example/repository'
                    ),
                },
                'url-userinfo-secret',
            ),
            (
                'REGISTRY',
                {
                    'auth': 'registry-auth-secret',
                    'registry': (
                        'registry.example/repository?'
                        'token=url-query-secret'
                    ),
                },
                'url-query-secret',
            ),
            (
                'REGISTRY',
                {
                    'auth': 'registry-auth-secret',
                    'registry': (
                        'registry.example/repository#'
                        'url-fragment-secret'
                    ),
                },
                'url-fragment-secret',
            ),
            (
                'DATA',
                {
                    'access_key_id': 'access-key-id',
                    'access_key': 'access-key-secret',
                    'endpoint': 's3://user:url-endpoint-secret@bucket',
                },
                'url-endpoint-secret',
            ),
            (
                'DATA',
                {
                    'access_key_id': 'access-key-id',
                    'access_key': 'access-key-secret',
                    'endpoint': 's3://bucket',
                    'override_url': (
                        'https://storage.example/'
                        '?signature=url-override-secret'
                    ),
                },
                'url-override-secret',
            ),
        )

        for cred_type, payload, reflected_secret in cases:
            with self.subTest(
                cred_type=cred_type,
                reflected_secret=reflected_secret,
            ):
                self.request_mutation.reset_mock()
                with self.assertRaisesRegex(
                    ToolError,
                    '^Invalid credential payload\\.$',
                ) as raised:
                    await credential_actions.osmo_set_credential(
                        self.context,
                        'credential-name',
                        cred_type,
                        payload,
                    )
                self.assertNotIn(
                    reflected_secret,
                    str(raised.exception),
                )
                self.request_mutation.assert_not_awaited()

    async def test_generic_payload_is_not_parsed_as_a_url(self) -> None:
        opaque_value = (
            'https://user:generic-secret@example.test/'
            '?token=opaque#fragment'
        )
        self.request_mutation.return_value = None

        result = await credential_actions.osmo_set_credential(
            self.context,
            'generic-cred',
            'GENERIC',
            {'signed_url': opaque_value},
        )

        self.assertTrue(result.saved)
        self.request_mutation.assert_awaited_once_with(
            self.context,
            method='POST',
            path='/api/credentials/generic-cred',
            operation='set an OSMO credential',
            max_response_bytes=1024,
            payload={
                'generic_credential': {
                    'credential': {'signed_url': opaque_value},
                },
            },
        )

    async def test_data_endpoint_matches_cli_contract_and_normalization(
        self,
    ) -> None:
        base_payload = {
            'access_key_id': 'access-key-id',
            'access_key': 'access-key-secret',
        }

        with self.assertRaisesRegex(
            ToolError,
            '^Invalid credential payload\\.$',
        ):
            await credential_actions.osmo_set_credential(
                self.context,
                'data-cred',
                'DATA',
                {
                    **base_payload,
                    'endpoint': 'https://storage.example.test',
                },
            )
        self.request_mutation.assert_not_awaited()

        self.request_mutation.return_value = None
        await credential_actions.osmo_set_credential(
            self.context,
            'data-cred',
            'DATA',
            {
                **base_payload,
                'endpoint': 's3://example-bucket/',
            },
        )
        self.request_mutation.assert_awaited_once_with(
            self.context,
            method='POST',
            path='/api/credentials/data-cred',
            operation='set an OSMO credential',
            max_response_bytes=1024,
            payload={
                'data_credential': {
                    **base_payload,
                    'endpoint': 's3://example-bucket',
                },
            },
        )

    async def test_oversized_payload_fails_without_reflection_or_transport(
        self,
    ) -> None:
        secret_prefix = 'oversized-secret-prefix'
        oversized_payloads = (
            {
                'token': secret_prefix + (
                    'x' * MAX_CREDENTIAL_PAYLOAD_VALUE_LENGTH
                ),
            },
            {
                'token_a': 'a' * (
                    MAX_CREDENTIAL_PAYLOAD_VALUE_LENGTH
                ),
                'token_b': 'b' * (
                    MAX_CREDENTIAL_PAYLOAD_VALUE_LENGTH
                ),
            },
        )

        for payload in oversized_payloads:
            with self.subTest(keys=tuple(payload)):
                self.request_mutation.reset_mock()
                with self.assertRaisesRegex(
                    ToolError,
                    '^Invalid credential payload\\.$',
                ) as raised:
                    await credential_actions.osmo_set_credential(
                        self.context,
                        'generic-cred',
                        'GENERIC',
                        payload,
                    )
                self.assertNotIn(secret_prefix, str(raised.exception))
                self.request_mutation.assert_not_awaited()

    async def test_malformed_successes_are_ambiguous_and_not_reflected(
        self,
    ) -> None:
        upstream_secret = 'malformed-upstream-secret'
        self.request_mutation.return_value = {
            'message': upstream_secret,
        }

        with self.assertRaisesRegex(
            ToolError,
            'write outcome is unknown',
        ) as set_error:
            await credential_actions.osmo_set_credential(
                self.context,
                'generic-cred',
                'GENERIC',
                {'token': 'set-input-secret'},
            )
        self.assertNotIn(upstream_secret, str(set_error.exception))
        self.assertEqual(self.request_mutation.await_count, 1)

        malformed_delete_responses: tuple[object, ...] = (
            upstream_secret,
            {},
            {'credentials': []},
            {
                'credentials': [
                    {
                        'cred_name': 'generic-cred',
                        'cred_type': 'GENERIC',
                    },
                    {
                        'cred_name': 'second-credential',
                        'cred_type': 'GENERIC',
                    },
                ],
            },
            {
                'credentials': [{
                    'cred_name': upstream_secret,
                    'cred_type': 'GENERIC',
                }],
            },
            {
                'credentials': [{
                    'cred_name': 'generic-cred',
                    'cred_type': upstream_secret,
                }],
            },
        )
        for response in malformed_delete_responses:
            with self.subTest(response_type=type(response).__name__):
                self.request_mutation.reset_mock()
                self.request_mutation.return_value = response
                with self.assertRaisesRegex(
                    ToolError,
                    'write outcome is unknown',
                ) as delete_error:
                    await credential_actions.osmo_delete_credential(
                        self.context,
                        'generic-cred',
                    )
                self.assertNotIn(
                    upstream_secret,
                    str(delete_error.exception),
                )
                self.assertEqual(self.request_mutation.await_count, 1)

if __name__ == '__main__':
    unittest.main()
