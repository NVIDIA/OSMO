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
import unittest
from unittest import mock

from src.lib.utils import client, osmo_errors, version


def make_response(status_code: int = 200,
                  text: str = '',
                  content: bytes = b'',
                  headers: dict | None = None) -> mock.MagicMock:
    """Build a mock requests.Response with the given attributes."""
    response = mock.MagicMock()
    response.status_code = status_code
    response.text = text
    response.content = content
    response.headers = headers if headers is not None else {}
    return response


class HandleResponseSuccessTests(unittest.TestCase):
    """Tests covering 200-status responses and ResponseMode dispatch."""

    def test_json_mode_returns_parsed_payload(self):
        response = make_response(status_code=200, text='{"key": "value"}')
        result = client.handle_response(response, mode=client.ResponseMode.JSON)
        self.assertEqual(result, {'key': 'value'})

    def test_default_mode_is_json(self):
        response = make_response(status_code=200, text='{"a": 1}')
        result = client.handle_response(response)
        self.assertEqual(result, {'a': 1})

    def test_plain_text_mode_returns_text(self):
        response = make_response(status_code=200, text='hello world')
        result = client.handle_response(response, mode=client.ResponseMode.PLAIN_TEXT)
        self.assertEqual(result, 'hello world')

    def test_binary_mode_returns_content(self):
        payload = b'\x00\x01\x02\x03'
        response = make_response(status_code=200, content=payload)
        result = client.handle_response(response, mode=client.ResponseMode.BINARY)
        self.assertEqual(result, payload)

    def test_streaming_mode_returns_response_object(self):
        response = make_response(status_code=200, text='ignored')
        result = client.handle_response(response, mode=client.ResponseMode.STREAMING)
        self.assertIs(result, response)


class HandleResponseWarningHeaderTests(unittest.TestCase):
    """Tests covering the warning header decode/print branch."""

    def test_warning_header_decoded_and_printed_to_stderr(self):
        warning_text = 'deprecated client version'
        encoded = base64.b64encode(warning_text.encode()).decode()
        response = make_response(
            status_code=200,
            text='{}',
            headers={version.WARNING_HEADER: encoded},
        )
        stderr = io.StringIO()
        with mock.patch('sys.stderr', stderr):
            client.handle_response(response)
        self.assertIn(warning_text, stderr.getvalue())

    def test_no_warning_header_does_not_print(self):
        response = make_response(status_code=200, text='{}', headers={})
        stderr = io.StringIO()
        with mock.patch('sys.stderr', stderr):
            client.handle_response(response)
        self.assertEqual(stderr.getvalue(), '')


class HandleResponseClientErrorTests(unittest.TestCase):
    """Tests covering 4xx response handling."""

    def test_invalid_json_raises_user_error_with_text(self):
        response = make_response(status_code=400, text='not-json')
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.message, 'not-json')
        self.assertEqual(ctx.exception.status_code, 400)

    def test_payload_without_error_code_raises_user_error_with_text(self):
        response = make_response(status_code=404, text='{"message": "missing"}')
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.message, '{"message": "missing"}')
        self.assertEqual(ctx.exception.status_code, 404)

    def test_unknown_error_code_raises_user_error_with_message(self):
        payload = {'error_code': 'UNKNOWN', 'message': 'something failed'}
        response = make_response(status_code=403, text=json.dumps(payload))
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.message, 'something failed')
        self.assertEqual(ctx.exception.status_code, 403)

    def test_usage_error_code_raises_submission_error(self):
        payload = {
            'error_code': osmo_errors.SubmissionErrorCode.USAGE.value,
            'message': 'bad usage',
            'workflow_id': 'wf-123',
        }
        response = make_response(status_code=400, text=json.dumps(payload))
        with self.assertRaises(osmo_errors.OSMOSubmissionError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.message, 'bad usage')
        self.assertEqual(ctx.exception.workflow_id, 'wf-123')
        self.assertEqual(ctx.exception.status_code, 400)

    def test_resource_error_code_raises_submission_error(self):
        payload = {
            'error_code': osmo_errors.SubmissionErrorCode.RESOURCE.value,
            'message': 'no resources',
        }
        response = make_response(status_code=409, text=json.dumps(payload))
        with self.assertRaises(osmo_errors.OSMOSubmissionError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.message, 'no resources')
        self.assertEqual(ctx.exception.workflow_id, '')
        self.assertEqual(ctx.exception.status_code, 409)

    def test_credential_error_code_raises_credential_error(self):
        payload = {
            'error_code': 'CREDENTIAL',
            'message': 'bad creds',
            'workflow_id': 'wf-9',
        }
        response = make_response(status_code=401, text=json.dumps(payload))
        with self.assertRaises(osmo_errors.OSMOCredentialError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.message, 'bad creds')
        self.assertEqual(ctx.exception.workflow_id, 'wf-9')
        self.assertEqual(ctx.exception.status_code, 401)

    def test_credential_error_without_workflow_id_defaults_to_empty(self):
        payload = {'error_code': 'CREDENTIAL', 'message': 'bad creds'}
        response = make_response(status_code=401, text=json.dumps(payload))
        with self.assertRaises(osmo_errors.OSMOCredentialError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.workflow_id, '')

    def test_status_499_treated_as_client_error(self):
        response = make_response(status_code=499, text='not-json')
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.status_code, 499)


class HandleResponseServerErrorTests(unittest.TestCase):
    """Tests covering 5xx response handling."""

    def test_500_raises_server_error_with_status_code(self):
        response = make_response(
            status_code=500,
            text='internal explosion',
            headers={'Content-Type': 'text/plain'},
        )
        with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertIn('Status Code: 500', ctx.exception.message)
        self.assertIn('Content-Type', ctx.exception.message)
        self.assertIn('internal explosion', ctx.exception.message)

    def test_503_raises_server_error(self):
        response = make_response(status_code=503, text='unavailable', headers={})
        with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertIn('unavailable', ctx.exception.message)


if __name__ == '__main__':
    unittest.main()
