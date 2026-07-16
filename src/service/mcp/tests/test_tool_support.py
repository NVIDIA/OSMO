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

from mcp.server.fastmcp.exceptions import ToolError

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

    def test_actionable_core_errors_preserve_only_safe_known_fields(self) -> None:
        body = (
            b'{"message":"Invalid request; password=\'correct horse battery '
            b'staple\'; endpoint=https://user:pass@example.test/path?'
            b'X-Amz-Signature=signature-secret",'
            b'"error_code":"OSMO_USAGE_ERROR","workflow_id":"job-42",'
            b'"credential":{"unusual_key":"arbitrary-secret"}}'
        )

        message = tool_errors.upstream_error(  # pylint: disable=protected-access
            'submit a request',
            400,
            body=body,
        )

        self.assertIn('Invalid request', message)
        self.assertIn('password=[REDACTED]', message)
        self.assertIn('https://[REDACTED]@example.test', message)
        self.assertIn('X-Amz-Signature=[REDACTED]', message)
        self.assertIn('error_code=OSMO_USAGE_ERROR', message)
        self.assertIn('workflow_id=job-42', message)
        self.assertNotIn('correct horse battery staple', message)
        self.assertNotIn('signature-secret', message)
        self.assertNotIn('arbitrary-secret', message)

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

    def test_actionable_message_is_scrubbed_before_truncation(self) -> None:
        secret = 's' * 1200
        body = json.dumps({
            'message': f'password="{secret}" correctable-field',
        }).encode('utf-8')

        message = tool_errors.upstream_error(  # pylint: disable=protected-access
            'submit a request',
            400,
            body=body,
        )

        self.assertIn('password=[REDACTED]', message)
        self.assertIn('correctable-field', message)
        self.assertNotIn(secret, message)

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

        self.assertIn(
            'Validation failed at body.credential - token=[REDACTED]',
            message,
        )
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
                    body=secret_body,
                    **options,
                )
                self.assertNotIn('upstream-detail-secret', message)

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
        self.assertTrue(result.text.endswith('configured byte limit.'))
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


if __name__ == '__main__':
    unittest.main()
