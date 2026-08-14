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

from src.service.mcp import credential_actions
from src.service.mcp.tests import protocol_harness


_BEARER_SECRET = 'credential-action-bearer-secret'
_REQUEST_ID = 'phase-three-request-123'
_HARNESS = protocol_harness.ProtocolHarness(
    tool_names=('osmo_delete_credential',),
    bearer_secret=_BEARER_SECRET,
    request_id=_REQUEST_ID,
)
_DESTRUCTIVE_IDEMPOTENT_ANNOTATIONS = {
    **protocol_harness.DESTRUCTIVE_WRITE_ANNOTATIONS,
    'idempotentHint': True,
}


class CredentialActionProtocolTest(unittest.IsolatedAsyncioTestCase):
    """Exercise credential deletion through real Streamable HTTP handling."""

    async def test_catalog_has_non_reflective_closed_action_schema(
        self,
    ) -> None:
        response = await _HARNESS.list_tools()
        tools = _HARNESS.assert_closed_catalog(
            self,
            response,
            expected_annotations={
                'osmo_delete_credential':
                    _DESTRUCTIVE_IDEMPOTENT_ANNOTATIONS,
            },
        )

        self.assertEqual(
            tools['osmo_delete_credential']['inputSchema']['required'],
            ['name'],
        )
        output_properties = tools['osmo_delete_credential'][
            'outputSchema'
        ]['properties']
        for excluded_field in (
            'payload',
            'profile',
            'credential',
            'auth',
        ):
            self.assertNotIn(excluded_field, output_properties)

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


class CredentialActionTest(unittest.IsolatedAsyncioTestCase):
    """Validate secret-safe credential deletion mappings."""

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

    async def test_delete_credential_returns_allowlisted_metadata(
        self,
    ) -> None:
        self.request_mutation.return_value = {
            'credentials': [{
                'cred_name': 'generic-cred',
                'cred_type': 'GENERIC',
                'profile': 'secret-profile-value',
            }],
        }

        result = await credential_actions.osmo_delete_credential(
            self.context,
            'generic-cred',
        )

        self.assertEqual(result.model_dump(mode='json'), {
            'cred_name': 'generic-cred',
            'cred_type': 'GENERIC',
            'deleted': True,
        })
        self.assertNotIn(
            'secret-profile-value',
            result.model_dump_json(),
        )
        self.request_mutation.assert_awaited_once_with(
            self.context,
            method='DELETE',
            path='/api/credentials/generic-cred',
            operation='delete an OSMO credential',
            max_response_bytes=64 * 1024,
            payload=None,
        )

    async def test_invalid_name_never_reaches_transport(self) -> None:
        with self.assertRaisesRegex(
            ToolError,
            '^Invalid credential name\\.$',
        ):
            await credential_actions.osmo_delete_credential(
                self.context,
                'invalid/name',
            )

        self.request_mutation.assert_not_awaited()

    async def test_malformed_successes_are_ambiguous_and_not_reflected(
        self,
    ) -> None:
        upstream_secret = 'malformed-upstream-secret'
        malformed_responses: tuple[object, ...] = (
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
        for response in malformed_responses:
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
