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

from fastmcp.exceptions import ToolError

from src.lib.utils import osmo_errors
from src.service.mcp import (
    gateway,
    request_context,
    tool_errors,
    tool_requests,
    tool_validation,
)


class ToolSupportTest(unittest.TestCase):
    """Validate dynamic path segments before they reach the Gateway client."""

    def test_safe_path_segment_encodes_data_without_changing_route_shape(self) -> None:
        self.assertEqual(
            tool_validation.safe_path_segment(
                'workflow name+日本語',
                field='workflow_id',
            ),
            'workflow%20name%2B%E6%97%A5%E6%9C%AC%E8%AA%9E',
        )
        self.assertEqual(
            tool_validation.safe_path_segment('node-01.example', field='node_name'),
            'node-01.example',
        )

    def test_safe_path_segment_rejects_ambiguous_or_oversized_values(self) -> None:
        invalid_values = (
            '',
            ' leading',
            'trailing ',
            '.',
            '..',
            'parent/child',
            'parent\\child',
            'line\nbreak',
            'x' * 513,
        )
        for value in invalid_values:
            with self.subTest(value=value):
                with self.assertRaisesRegex(ToolError, 'Invalid workflow_id'):
                    tool_validation.safe_path_segment(value, field='workflow_id')

    def test_inline_text_validation_is_utf8_bounded_and_multiline_safe(
        self,
    ) -> None:
        value = 'version: 2\nworkflow:\n\tname: test\n'
        self.assertEqual(
            tool_validation.validate_inline_text(
                value,
                field='workflow_spec',
                max_bytes=len(value.encode('utf-8')),
            ),
            value,
        )
        for invalid_value in (
            '',
            ' \n\t',
            'control\x00value',
            '\u00e9' * 3,
            1,
        ):
            with self.subTest(value=invalid_value):
                with self.assertRaisesRegex(
                    ToolError,
                    '^Invalid workflow_spec\\.$',
                ):
                    tool_validation.validate_inline_text(
                        invalid_value,
                        field='workflow_spec',
                        max_bytes=5,
                    )

    def test_actionable_core_errors_preserve_only_safe_known_fields(self) -> None:
        body = (
            b'{"message":"Invalid request; password=\'correct horse battery '
            b'staple\'; endpoint=https://user:pass@example.test/path?'
            b'X-Amz-Signature=signature-secret",'
            b'"error_code":"USAGE","workflow_id":"job-42",'
            b'"credential":{"unusual_key":"arbitrary-secret"}}'
        )

        message = tool_errors.upstream_error(  # pylint: disable=protected-access
            'submit a request',
            400,
            body=body,
        )

        self.assertIn('error_code=USAGE', message)
        self.assertNotIn('workflow_id', message)
        self.assertNotIn('job-42', message)
        self.assertNotIn('Invalid request', message)
        self.assertNotIn('correct horse battery staple', message)
        self.assertNotIn('user:pass', message)
        self.assertNotIn('signature-secret', message)
        self.assertNotIn('arbitrary-secret', message)

    def test_upstream_error_codes_use_an_exact_static_allowlist(self) -> None:
        allowed_codes = {
            error_type.error_code
            for error_type in (
                osmo_errors.OSMOError,
                osmo_errors.OSMOUserError,
                osmo_errors.OSMOUsageError,
                osmo_errors.OSMOResourceError,
                osmo_errors.OSMOCredentialError,
                osmo_errors.OSMODatabaseError,
                osmo_errors.OSMOSubmissionError,
            )
        }
        self.assertEqual(
            set(tool_errors._PUBLIC_UPSTREAM_ERROR_CODES),  # pylint: disable=protected-access
            allowed_codes,
        )
        for error_code in allowed_codes:
            with self.subTest(error_code=error_code):
                message = tool_errors.upstream_error(
                    'submit a request',
                    400,
                    body=json.dumps({'error_code': error_code}).encode('utf-8'),
                )
                self.assertIn(f'error_code={error_code}', message)

        for error_code in (
            'INVALID_PROFILE',
            'OSMO_USAGE_ERROR',
            'sk-live-opaque-secret',
            'OTHER',
        ):
            with self.subTest(error_code=error_code):
                message = tool_errors.upstream_error(
                    'submit a request',
                    400,
                    body=json.dumps({'error_code': error_code}).encode('utf-8'),
                )
                self.assertNotIn('OSMO detail:', message)
                self.assertNotIn(error_code, message)

    def test_malformed_upstream_error_metadata_is_ignored(self) -> None:
        for body in (
            b'{',
            b'[]',
            b'null',
            b'\xff',
            b'{"error_code":["USAGE"]}',
            b'{"error_code":true}',
        ):
            with self.subTest(body=body):
                message = tool_errors.upstream_error(
                    'submit a request',
                    400,
                    body=body,
                )
                self.assertNotIn('OSMO detail:', message)

    def test_sensitive_assignments_fail_closed_for_ambiguous_values(self) -> None:
        cases = (
            (
                'password=correct horse battery staple; retry=true',
                ('correct', 'horse', 'battery', 'staple'),
            ),
            (
                'token="unterminated; secret, words',
                ('unterminated', 'secret', 'words'),
            ),
            (
                'validation failed: "password": "json secret words"',
                ('json', 'secret', 'words'),
            ),
        )

        for value, secrets in cases:
            with self.subTest(value=value):
                safe_value = tool_errors.safe_error_text(  # pylint: disable=protected-access
                    value
                )
                self.assertIn('[REDACTED]', safe_value)
                for secret in secrets:
                    self.assertNotIn(secret, safe_value)

    def test_arbitrary_upstream_messages_are_never_forwarded(self) -> None:
        opaque_secret = 'sk-live-opaque-value-without-a-sensitive-label'
        for status_code, body in (
            (400, json.dumps({'message': opaque_secret}).encode('utf-8')),
            (409, json.dumps({'message': opaque_secret}).encode('utf-8')),
            (422, json.dumps({'detail': [{
                'loc': ['query', 'name'],
                'msg': opaque_secret,
            }]}).encode('utf-8')),
        ):
            with self.subTest(status_code=status_code):
                message = tool_errors.upstream_error(  # pylint: disable=protected-access
                    'submit a request',
                    status_code,
                    body=body,
                )

                self.assertNotIn(opaque_secret, message)
                if status_code == 422:
                    self.assertNotIn('query.name', message)
                    self.assertNotIn('Validation failed', message)

    def test_fastapi_validation_errors_drop_input_context_and_unknown_fields(
        self,
    ) -> None:
        body = (
            b'{"detail":[{"loc":["body","credential"],'
            b'"msg":"token=validation-secret is invalid",'
            b'"input":{"unknown":"input-secret"},'
            b'"ctx":{"error":"context-secret"},'
            b'"type":"value_error"}],"extra":"extra-secret"}'
        )

        message = tool_errors.upstream_error(  # pylint: disable=protected-access
            'validate a request',
            422,
            body=body,
        )

        self.assertNotIn('Validation failed', message)
        self.assertNotIn('body.credential', message)
        for secret in (
            'validation-secret',
            'input-secret',
            'context-secret',
            'extra-secret',
        ):
            self.assertNotIn(secret, message)
        self.assertNotIn('value_error', message)

    def test_non_actionable_truncated_and_suppressed_errors_are_generic(
        self,
    ) -> None:
        secret_body = b'{"message":"upstream-detail-secret"}'
        for status_code in (401, 403, 404, 429, 500):
            with self.subTest(status_code=status_code):
                message = tool_errors.upstream_error(  # pylint: disable=protected-access
                    'read data',
                    status_code,
                    body=secret_body,
                )
                self.assertIn(f'HTTP {status_code}', message)
                self.assertNotIn('upstream-detail-secret', message)

        for options in (
            {'body_truncated': True},
            {'suppress_upstream_details': True},
        ):
            with self.subTest(options=options):
                message = tool_errors.upstream_error(  # pylint: disable=protected-access
                    'write a credential',
                    400,
                    body=b'{"error_code":"USAGE"}',
                    **options,
                )
                self.assertNotIn('OSMO detail:', message)
                self.assertNotIn('error_code=USAGE', message)

    def test_error_redaction_and_final_message_bound_are_central(self) -> None:
        message = tool_errors.upstream_error(  # pylint: disable=protected-access
            'operation with Bearer operation-secret',
            409,
            body=(
                b'{"message":"token=body-secret '
                b'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature '
                + b'x' * 5000
                + b'"}'
            ),
        )

        self.assertLessEqual(
            len(message),
            tool_errors._MAX_TOOL_ERROR_CHARS,  # pylint: disable=protected-access
        )
        self.assertIn('Bearer [REDACTED]', message)
        self.assertNotIn('operation-secret', message)
        self.assertNotIn('body-secret', message)
        self.assertNotIn('eyJhbGci', message)

    def test_text_prefix_decoder_drops_only_an_incomplete_final_codepoint(
        self,
    ) -> None:
        truncated = gateway.GatewayResponse(
            200,
            b'ab\xe2\x82',
            body_truncated=True,
            truncation_reason='response_size_limit',
        )
        self.assertEqual(
            tool_requests._decode_text_prefix(  # pylint: disable=protected-access
                truncated,
                operation='read text',
            ),
            'ab',
        )

        for response in (
            gateway.GatewayResponse(200, b'ab\xe2\x82'),
            gateway.GatewayResponse(
                200,
                b'a\xffb',
                body_truncated=True,
                truncation_reason='response_size_limit',
            ),
        ):
            with self.subTest(response=response):
                with self.assertRaisesRegex(ToolError, 'invalid response'):
                    tool_requests._decode_text_prefix(  # pylint: disable=protected-access
                        response,
                        operation='read text',
                    )


class TruncatedTextRequestTest(unittest.IsolatedAsyncioTestCase):
    async def test_request_reserves_sentinel_and_returns_metadata(self) -> None:
        gateway_client = mock.AsyncMock(spec=gateway.GatewayClient)
        gateway_client.request_text_prefix.return_value = gateway.GatewayResponse(
            200,
            b'partial text',
            body_truncated=True,
            truncation_reason='response_size_limit',
        )
        credentials = request_context.RequestCredentials(
            authorization_header='Bearer test-token-value',
            user_name='test-user',
            request_id='request-1',
        )
        maximum_bytes = 256

        with (
            mock.patch.object(
                tool_requests,
                'get_app_context',
                return_value=gateway.AppContext(gateway=gateway_client),
            ),
            mock.patch.object(
                request_context,
                'get_request_credentials',
                return_value=credentials,
            ),
        ):
            result = await tool_requests.request_truncated_text(
                mock.Mock(),
                path='/api/workflow/test-1/logs',
                operation='get workflow logs',
                max_response_bytes=maximum_bytes,
            )

        self.assertTrue(result.truncated)
        self.assertEqual(result.truncation_reason, 'response_size_limit')
        self.assertTrue(result.text.startswith('partial text'))
        self.assertTrue(result.text.endswith('configured output boundary.'))
        self.assertLessEqual(len(result.text.encode('utf-8')), maximum_bytes)
        gateway_client.request_text_prefix.assert_awaited_once_with(
            'GET',
            '/api/workflow/test-1/logs',
            credentials=credentials,
            max_response_bytes=(
                maximum_bytes
                - tool_requests._TEXT_TRUNCATION_SENTINEL_BYTES  # pylint: disable=protected-access
            ),
            query=None,
        )


class JsonMutationRequestTest(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _credentials() -> request_context.RequestCredentials:
        return request_context.RequestCredentials(
            authorization_header='Bearer write-test-token-value',
            user_name='test-user',
            request_id='write-request-1',
        )

    async def test_mutation_relays_one_fixed_post_and_validates_json(self) -> None:
        gateway_client = mock.AsyncMock(spec=gateway.GatewayClient)
        gateway_client.request.return_value = gateway.GatewayResponse(
            200,
            b'{"name":"workflow-1"}',
        )
        credentials = self._credentials()
        payload: tool_requests.JsonObject = {
            'file': 'version: 2',
            'set_variables': [],
            'set_string_variables': [],
        }

        with (
            mock.patch.object(
                tool_requests,
                'get_app_context',
                return_value=gateway.AppContext(gateway=gateway_client),
            ),
            mock.patch.object(
                request_context,
                'get_request_credentials',
                return_value=credentials,
            ),
        ):
            result = await tool_requests.request_json_mutation(
                mock.Mock(),
                path='/api/pool/pool-a/workflow',
                operation='validate a workflow',
                max_response_bytes=1024,
                query={'validation_only': True},
                payload=payload,
            )

        self.assertEqual(result, {'name': 'workflow-1'})
        gateway_client.request.assert_awaited_once_with(
            'POST',
            '/api/pool/pool-a/workflow',
            credentials=credentials,
            max_response_bytes=1024,
            query={'validation_only': True},
            json_body=payload,
        )

    async def test_general_mutation_supports_methods_bodies_and_result_values(
        self,
    ) -> None:
        gateway_client = mock.AsyncMock(spec=gateway.GatewayClient)
        credentials = self._credentials()
        cases = (
            (
                'POST',
                {'pool': 'pool-a'},
                b'null',
                None,
            ),
            (
                'PATCH',
                'version: 2',
                b'{"name":"app-a","version":2}',
                {'name': 'app-a', 'version': 2},
            ),
            (
                'DELETE',
                None,
                b'"app-a"',
                'app-a',
            ),
        )

        with (
            mock.patch.object(
                tool_requests,
                'get_app_context',
                return_value=gateway.AppContext(gateway=gateway_client),
            ),
            mock.patch.object(
                request_context,
                'get_request_credentials',
                return_value=credentials,
            ),
        ):
            for method, payload, body, expected in cases:
                with self.subTest(method=method):
                    gateway_client.reset_mock()
                    gateway_client.request.return_value = (
                        gateway.GatewayResponse(200, body)
                    )
                    result = await tool_requests.request_json_mutation(
                        mock.Mock(),
                        method=method,  # type: ignore[arg-type]
                        path='/api/profile/settings',
                        operation='update a setting',
                        max_response_bytes=1024,
                        payload=payload,
                    )

                    self.assertEqual(result, expected)
                    gateway_client.request.assert_awaited_once_with(
                        method,
                        '/api/profile/settings',
                        credentials=credentials,
                        max_response_bytes=1024,
                        query=None,
                        json_body=payload,
                    )

    async def test_mutation_rejects_unsupported_json_without_reflection_or_retry(
        self,
    ) -> None:
        gateway_client = mock.AsyncMock(spec=gateway.GatewayClient)
        credentials = self._credentials()
        invalid_bodies = (
            b'["malformed-success-upstream-secret"',
            b'{"value":"malformed-success-upstream-secret"',
            b'[]',
            b'true',
            b'1',
        )

        with (
            mock.patch.object(
                tool_requests,
                'get_app_context',
                return_value=gateway.AppContext(gateway=gateway_client),
            ),
            mock.patch.object(
                request_context,
                'get_request_credentials',
                return_value=credentials,
            ),
        ):
            for body in invalid_bodies:
                with self.subTest(body=body):
                    gateway_client.reset_mock()
                    gateway_client.request.return_value = (
                        gateway.GatewayResponse(200, body)
                    )
                    with self.assertRaisesRegex(
                        ToolError,
                        'write outcome is unknown',
                    ) as raised:
                        await tool_requests.request_json_mutation(
                            mock.Mock(),
                            method='PATCH',
                            path='/api/app/user/app-a',
                            operation='update an app',
                            max_response_bytes=1024,
                            payload='version: 2',
                        )

                    self.assertNotIn('upstream-secret', str(raised.exception))
                    gateway_client.request.assert_awaited_once()

    async def test_mutation_suppresses_upstream_error_body_without_retry(
        self,
    ) -> None:
        gateway_client = mock.AsyncMock(spec=gateway.GatewayClient)
        gateway_client.request.return_value = gateway.GatewayResponse(
            422,
            (
                b'{"error_code":"USER",'
                b'"message":"profile-write-upstream-secret"}'
            ),
        )
        credentials = self._credentials()

        with (
            mock.patch.object(
                tool_requests,
                'get_app_context',
                return_value=gateway.AppContext(gateway=gateway_client),
            ),
            mock.patch.object(
                request_context,
                'get_request_credentials',
                return_value=credentials,
            ),
        ):
            with self.assertRaisesRegex(ToolError, 'HTTP 422') as raised:
                await tool_requests.request_json_mutation(
                    mock.Mock(),
                    method='POST',
                    path='/api/profile/settings',
                    operation='update the active user profile',
                    max_response_bytes=1024,
                    payload={'pool': 'pool-a'},
                )

        self.assertNotIn('profile-write-upstream-secret', str(raised.exception))
        self.assertNotIn('error_code=USER', str(raised.exception))
        gateway_client.request.assert_awaited_once()

    async def test_mutation_transport_and_server_failures_are_uncertain(
        self,
    ) -> None:
        gateway_client = mock.AsyncMock(spec=gateway.GatewayClient)
        credentials = self._credentials()
        failures = (
            gateway.GatewayUncertainWriteError(
                'transport-upstream-secret'
            ),
            gateway.GatewayResponse(
                503,
                b'{"message":"server-upstream-secret"}',
            ),
            gateway.GatewayResponse(
                400,
                (
                    b'{"error_code":"DATABASE",'
                    b'"message":"database-upstream-secret"}'
                ),
            ),
        )

        with (
            mock.patch.object(
                tool_requests,
                'get_app_context',
                return_value=gateway.AppContext(gateway=gateway_client),
            ),
            mock.patch.object(
                request_context,
                'get_request_credentials',
                return_value=credentials,
            ),
        ):
            for failure in failures:
                with self.subTest(failure=type(failure).__name__):
                    gateway_client.reset_mock()
                    if isinstance(failure, Exception):
                        gateway_client.request.side_effect = failure
                    else:
                        gateway_client.request.side_effect = None
                        gateway_client.request.return_value = failure
                    with self.assertRaisesRegex(
                        ToolError,
                        'write outcome is unknown',
                    ) as raised:
                        await tool_requests.request_json_mutation(
                            mock.Mock(),
                            path='/api/pool/pool-a/workflow',
                            operation='validate a workflow',
                            max_response_bytes=1024,
                        )
                    message = str(raised.exception)
                    self.assertIn('Inspect OSMO state before retrying', message)
                    self.assertNotIn('upstream-secret', message)
                    gateway_client.request.assert_awaited_once()


if __name__ == '__main__':
    unittest.main()
