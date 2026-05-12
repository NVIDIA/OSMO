"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import base64
import io
import json
import sys
import unittest
from unittest import mock

from src.lib.utils import client, osmo_errors, version


class FakeResponse:
    """Minimal stand-in for requests.Response usable by handle_response."""

    def __init__(self, status_code: int = 200, text: str = '',
                 content: bytes = b'', headers: dict | None = None):
        self.status_code = status_code
        self.text = text
        self.content = content
        self.headers = headers if headers is not None else {}


class HandleResponseSuccessTests(unittest.TestCase):
    """Tests for the success-path branches of handle_response."""

    def test_default_mode_returns_parsed_json(self):
        response = FakeResponse(status_code=200, text='{"foo": "bar"}')

        result = client.handle_response(response)

        self.assertEqual(result, {'foo': 'bar'})

    def test_explicit_json_mode_returns_parsed_json(self):
        response = FakeResponse(status_code=200, text='{"value": 42}')

        result = client.handle_response(response, mode=client.ResponseMode.JSON)

        self.assertEqual(result, {'value': 42})

    def test_plain_text_mode_returns_text(self):
        response = FakeResponse(status_code=200, text='hello world')

        result = client.handle_response(response, mode=client.ResponseMode.PLAIN_TEXT)

        self.assertEqual(result, 'hello world')

    def test_binary_mode_returns_content(self):
        response = FakeResponse(status_code=200, content=b'\x00\x01\x02')

        result = client.handle_response(response, mode=client.ResponseMode.BINARY)

        self.assertEqual(result, b'\x00\x01\x02')

    def test_streaming_mode_returns_response_object(self):
        response = FakeResponse(status_code=200, text='ignored')

        result = client.handle_response(response, mode=client.ResponseMode.STREAMING)

        self.assertIs(result, response)


class HandleResponseWarningHeaderTests(unittest.TestCase):
    """Tests for the warning-header decoding and printing."""

    def test_warning_header_decoded_and_printed_to_stderr(self):
        warning_text = 'deprecated client'
        encoded = base64.b64encode(warning_text.encode()).decode()
        response = FakeResponse(
            status_code=200,
            text='{}',
            headers={version.WARNING_HEADER: encoded},
        )

        captured = io.StringIO()
        with mock.patch.object(sys, 'stderr', captured):
            client.handle_response(response)

        self.assertIn(warning_text, captured.getvalue())

    def test_warning_header_absent_writes_nothing_to_stderr(self):
        response = FakeResponse(status_code=200, text='{}')

        captured = io.StringIO()
        with mock.patch.object(sys, 'stderr', captured):
            client.handle_response(response)

        self.assertEqual(captured.getvalue(), '')


class HandleResponseClientErrorTests(unittest.TestCase):
    """Tests for 4xx response handling."""

    def test_invalid_json_4xx_raises_user_error_with_text(self):
        response = FakeResponse(status_code=404, text='not json at all')

        with self.assertRaises(osmo_errors.OSMOUserError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.message, 'not json at all')
        self.assertEqual(cm.exception.status_code, 404)

    def test_4xx_without_error_code_raises_user_error_with_text(self):
        response = FakeResponse(status_code=400, text='{"message": "bad"}')

        with self.assertRaises(osmo_errors.OSMOUserError) as cm:
            client.handle_response(response)

        # The function uses response.text (not payload['message']) when
        # 'error_code' is absent.
        self.assertEqual(cm.exception.message, '{"message": "bad"}')
        self.assertEqual(cm.exception.status_code, 400)

    def test_4xx_with_unknown_error_code_raises_user_error_with_message(self):
        payload = {'error_code': 'OTHER', 'message': 'bad input'}
        response = FakeResponse(status_code=422, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOUserError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.message, 'bad input')
        self.assertEqual(cm.exception.status_code, 422)

    def test_4xx_with_credential_error_code_raises_credential_error(self):
        payload = {
            'error_code': 'CREDENTIAL',
            'message': 'bad creds',
            'workflow_id': 'wf-1',
        }
        response = FakeResponse(status_code=401, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOCredentialError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.message, 'bad creds')
        self.assertEqual(cm.exception.workflow_id, 'wf-1')
        self.assertEqual(cm.exception.status_code, 401)

    def test_4xx_with_credential_error_code_without_workflow_id_uses_default(self):
        payload = {'error_code': 'CREDENTIAL', 'message': 'bad creds'}
        response = FakeResponse(status_code=401, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOCredentialError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.workflow_id, '')

    def test_4xx_with_usage_error_code_raises_submission_error(self):
        payload = {
            'error_code': 'USAGE',
            'message': 'invalid usage',
            'workflow_id': 'wf-2',
        }
        response = FakeResponse(status_code=400, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOSubmissionError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.message, 'invalid usage')
        self.assertEqual(cm.exception.workflow_id, 'wf-2')
        self.assertEqual(cm.exception.status_code, 400)

    def test_4xx_with_resource_error_code_raises_submission_error(self):
        payload = {'error_code': 'RESOURCE', 'message': 'no resources'}
        response = FakeResponse(status_code=409, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOSubmissionError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.message, 'no resources')
        self.assertEqual(cm.exception.workflow_id, '')
        self.assertEqual(cm.exception.status_code, 409)

    def test_lower_boundary_400_routes_to_client_error_branch(self):
        response = FakeResponse(status_code=400, text='boundary')

        with self.assertRaises(osmo_errors.OSMOUserError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.status_code, 400)

    def test_upper_boundary_499_routes_to_client_error_branch(self):
        response = FakeResponse(status_code=499, text='boundary')

        with self.assertRaises(osmo_errors.OSMOUserError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.status_code, 499)


class HandleResponseServerErrorTests(unittest.TestCase):
    """Tests for 5xx response handling."""

    def test_500_raises_server_error_with_status_and_body(self):
        response = FakeResponse(
            status_code=500,
            text='something broke',
            headers={'X-Trace': 'abc'},
        )

        with self.assertRaises(osmo_errors.OSMOServerError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.status_code, 500)
        self.assertIn('Status Code: 500', cm.exception.message)
        self.assertIn('X-Trace: abc', cm.exception.message)
        self.assertIn('something broke', cm.exception.message)

    def test_503_raises_server_error(self):
        response = FakeResponse(status_code=503, text='unavailable')

        with self.assertRaises(osmo_errors.OSMOServerError) as cm:
            client.handle_response(response)

        self.assertEqual(cm.exception.status_code, 503)


if __name__ == '__main__':
    unittest.main()
