"""Credential HTTP assertions preserve failures without exposing credential bodies."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import http.client
import io
import unittest
import urllib.error
from unittest import mock

from test.oetf import embedded_auth


class CredentialRequestTests(unittest.TestCase):
    """Exercise request shape and sanitized credential failures."""

    def test_exchange_and_profile_request_shapes(self):
        fixture = embedded_auth.EmbeddedAuthAssertions()
        response = mock.MagicMock()
        response.status = 200
        response.read.return_value = b'{"token":"session"}'
        with mock.patch('urllib.request.urlopen') as urlopen:
            urlopen.return_value.__enter__.return_value = response
            self.assertEqual(fixture.credential_request(
                'http://localhost', access_token='credential'), (200, {'token': 'session'}))
            request = urlopen.call_args.args[0]
            self.assertEqual(request.data, b'{"token": "credential"}')
            fixture.credential_request('http://localhost', jwt_token='session')
            request = urlopen.call_args.args[0]
            self.assertIsNone(request.data)
            self.assertEqual(request.headers['Authorization'], 'Bearer session')

    def test_http_error_body_is_not_returned(self):
        error = urllib.error.HTTPError(
            'http://localhost', 401, 'Denied', http.client.HTTPMessage(), io.BytesIO(b'secret'))
        with mock.patch('urllib.request.urlopen', side_effect=error):
            self.assertEqual(embedded_auth.EmbeddedAuthAssertions().credential_request(
                'http://localhost', access_token='credential'), (401, {}))


if __name__ == '__main__':
    unittest.main()
