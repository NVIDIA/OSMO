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

from fastmcp.server.auth import AccessToken
from starlette.requests import Request

from src.service.mcp import request_context


class OIDCRequestCredentialsTest(unittest.TestCase):
    """Credentials come from FastMCP's verified access token, and only there."""

    def test_verified_upstream_token_is_relayed_to_gateway(self) -> None:
        access_token = AccessToken(
            token='verified-entra-token-value',
            client_id='codex-client',
            scopes=['access_as_user'],
        )
        request = Request({
            'type': 'http',
            'method': 'POST',
            'path': '/mcp',
            'headers': [
                (b'authorization', b'Bearer client-supplied-token'),
                (b'x-osmo-user', b'mallory@example.com'),
                (b'x-request-id', b'oidc-request-123'),
            ],
        })
        with (
            mock.patch.object(
                request_context,
                'get_access_token',
                return_value=access_token,
            ),
            mock.patch.object(
                request_context,
                'get_http_request',
                return_value=request,
            ),
        ):
            credentials = request_context.get_request_credentials()

        self.assertEqual(
            credentials.authorization_header,
            'Bearer verified-entra-token-value',
        )
        self.assertEqual(credentials.request_id, 'oidc-request-123')

    def test_unverified_request_headers_are_not_credentials(self) -> None:
        request = Request({
            'type': 'http',
            'method': 'POST',
            'path': '/mcp',
            'headers': [
                (b'authorization', b'Bearer client-supplied-token'),
                (b'x-osmo-user', b'mallory@example.com'),
            ],
        })
        with (
            mock.patch.object(
                request_context,
                'get_access_token',
                return_value=None,
            ),
            mock.patch.object(
                request_context,
                'get_http_request',
                return_value=request,
            ),
            self.assertRaisesRegex(
                request_context.RequestContextUnavailable,
                'credentials are unavailable',
            ),
        ):
            request_context.get_request_credentials()

    def test_verified_token_rejects_invalid_request_ids(self) -> None:
        access_token = AccessToken(
            token='verified-entra-token-value',
            client_id='codex-client',
            scopes=['access_as_user'],
        )
        invalid_headers = (
            [(b'x-request-id', b'')],
            [(b'x-request-id', b'invalid/request')],
            [
                (b'x-request-id', b'first-request'),
                (b'X-Request-ID', b'second-request'),
            ],
            [(b'x-request-id', b'verified-entra-token-value')],
        )

        for headers in invalid_headers:
            with self.subTest(headers=headers):
                request = Request({
                    'type': 'http',
                    'method': 'POST',
                    'path': '/mcp',
                    'headers': headers,
                })
                with (
                    mock.patch.object(
                        request_context,
                        'get_access_token',
                        return_value=access_token,
                    ),
                    mock.patch.object(
                        request_context,
                        'get_http_request',
                        return_value=request,
                    ),
                    self.assertRaisesRegex(
                        request_context.RequestContextUnavailable,
                        'credentials are unavailable',
                    ),
                ):
                    request_context.get_request_credentials()

    def test_request_ids_overlapping_bearer_are_rejected(self) -> None:
        """A request ID must not leak bearer material into logs."""
        bearer_token = 'opaque-token-segment-1234567890'
        authorization_header = f'Bearer {bearer_token}'
        for request_id in (
            bearer_token,
            'opaque-token-segment',
            'request-opaque-token-segment-suffix',
            'token-segment-1234',
        ):
            with self.subTest(request_id=request_id):
                self.assertTrue(
                    request_context.request_id_overlaps_bearer(
                        authorization_header, request_id
                    )
                )

    def test_unrelated_request_ids_are_accepted(self) -> None:
        self.assertFalse(
            request_context.request_id_overlaps_bearer(
                'Bearer opaque-token-segment-1234567890',
                'unrelated-request-identifier',
            )
        )

    def test_credentials_repr_does_not_expose_authorization(self) -> None:
        credentials = request_context.RequestCredentials(
            authorization_header='Bearer highly-sensitive-token',
            request_id='request-123',
        )

        self.assertNotIn('highly-sensitive-token', repr(credentials))
        self.assertNotIn('highly-sensitive-token', str(credentials))
        self.assertIn('request-123', repr(credentials))


if __name__ == '__main__':
    unittest.main()
