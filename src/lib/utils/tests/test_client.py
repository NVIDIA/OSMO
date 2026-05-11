"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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


class FakeResponse:
    """ Minimal stand-in for a requests.Response used by handle_response. """

    def __init__(self, status_code: int = 200, text: str = '',
                 content: bytes = b'', headers: dict | None = None):
        self.status_code = status_code
        self.text = text
        self.content = content
        self.headers = headers if headers is not None else {}


class TestHandleResponseWarningHeader(unittest.TestCase):
    """ Tests for the x-osmo-warning header decoding branch. """

    def test_warning_header_absent_does_not_write_stderr(self):
        response = FakeResponse(
            status_code=200, text='{"ok": true}')
        stderr_capture = io.StringIO()
        with mock.patch('sys.stderr', stderr_capture):
            client.handle_response(response)
        self.assertEqual(stderr_capture.getvalue(), '')

    def test_warning_header_present_prints_decoded_message_to_stderr(self):
        encoded = base64.b64encode(b'heads up!').decode()
        response = FakeResponse(
            status_code=200,
            text='{"ok": true}',
            headers={version.WARNING_HEADER: encoded})
        stderr_capture = io.StringIO()
        with mock.patch('sys.stderr', stderr_capture):
            client.handle_response(response)
        self.assertIn('heads up!', stderr_capture.getvalue())


class TestHandleResponseSuccessModes(unittest.TestCase):
    """ Tests for successful (200) responses across ResponseMode values. """

    def test_json_mode_parses_response_text(self):
        response = FakeResponse(status_code=200, text='{"a": 1, "b": 2}')
        result = client.handle_response(response, mode=client.ResponseMode.JSON)
        self.assertEqual(result, {'a': 1, 'b': 2})

    def test_default_mode_is_json(self):
        response = FakeResponse(status_code=200, text='{"x": 42}')
        result = client.handle_response(response)
        self.assertEqual(result, {'x': 42})

    def test_plain_text_mode_returns_text(self):
        response = FakeResponse(status_code=200, text='hello world')
        result = client.handle_response(
            response, mode=client.ResponseMode.PLAIN_TEXT)
        self.assertEqual(result, 'hello world')

    def test_binary_mode_returns_content_bytes(self):
        response = FakeResponse(
            status_code=200, text='ignored', content=b'\x00\x01\x02')
        result = client.handle_response(
            response, mode=client.ResponseMode.BINARY)
        self.assertEqual(result, b'\x00\x01\x02')

    def test_streaming_mode_returns_response_object(self):
        response = FakeResponse(status_code=200, text='{}')
        result = client.handle_response(
            response, mode=client.ResponseMode.STREAMING)
        self.assertIs(result, response)


class TestHandleResponseClientErrors(unittest.TestCase):
    """ Tests for 4xx responses across JSON payload variants. """

    def test_invalid_json_body_raises_osmo_user_error_with_text(self):
        response = FakeResponse(status_code=400, text='not json at all')
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.message, 'not json at all')
        self.assertEqual(ctx.exception.status_code, 400)

    def test_json_without_error_code_raises_osmo_user_error_with_text(self):
        body_text = json.dumps({'message': 'oops'})
        response = FakeResponse(status_code=400, text=body_text)
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            client.handle_response(response)
        # Without an error_code key, the raw response text is used as the message.
        self.assertEqual(ctx.exception.message, body_text)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_usage_error_code_raises_submission_error(self):
        payload = {
            'error_code': osmo_errors.SubmissionErrorCode.USAGE.value,
            'message': 'bad usage',
            'workflow_id': 'wf-1',
        }
        response = FakeResponse(status_code=400, text=json.dumps(payload))
        with self.assertRaises(osmo_errors.OSMOSubmissionError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.message, 'bad usage')
        self.assertEqual(ctx.exception.workflow_id, 'wf-1')
        self.assertEqual(ctx.exception.status_code, 400)

    def test_resource_error_code_raises_submission_error(self):
        payload = {
            'error_code': osmo_errors.SubmissionErrorCode.RESOURCE.value,
            'message': 'no resources',
        }
        response = FakeResponse(status_code=400, text=json.dumps(payload))
        with self.assertRaises(osmo_errors.OSMOSubmissionError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.message, 'no resources')
        # workflow_id defaults to empty string when not in payload.
        self.assertEqual(ctx.exception.workflow_id, '')

    def test_credential_error_code_raises_credential_error(self):
        payload = {
            'error_code': 'CREDENTIAL',
            'message': 'bad creds',
            'workflow_id': 'wf-9',
        }
        response = FakeResponse(status_code=401, text=json.dumps(payload))
        with self.assertRaises(osmo_errors.OSMOCredentialError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.message, 'bad creds')
        self.assertEqual(ctx.exception.workflow_id, 'wf-9')
        self.assertEqual(ctx.exception.status_code, 401)

    def test_other_error_code_raises_osmo_user_error_with_message(self):
        payload = {'error_code': 'SOMETHING_ELSE', 'message': 'nope'}
        response = FakeResponse(status_code=404, text=json.dumps(payload))
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.message, 'nope')
        self.assertEqual(ctx.exception.status_code, 404)

    def test_status_499_also_treated_as_client_error(self):
        # Boundary: anything in [400, 500) goes through the client-error branch.
        response = FakeResponse(status_code=499, text='boom')
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.status_code, 499)


class TestHandleResponseServerErrors(unittest.TestCase):
    """ Tests for 5xx responses. """

    def test_500_raises_server_error_with_headers_and_body(self):
        response = FakeResponse(
            status_code=500,
            text='internal boom',
            headers={'X-Req-Id': 'req-123'})
        with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
            client.handle_response(response)
        self.assertIn('Status Code: 500', ctx.exception.message)
        self.assertIn('X-Req-Id: req-123', ctx.exception.message)
        self.assertIn('internal boom', ctx.exception.message)
        self.assertEqual(ctx.exception.status_code, 500)

    def test_503_is_also_server_error(self):
        response = FakeResponse(status_code=503, text='unavailable')
        with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
            client.handle_response(response)
        self.assertEqual(ctx.exception.status_code, 503)


class TestHandleResponseNon200Logs(unittest.TestCase):
    """ Tests that non-200 status codes are logged as errors. """

    def test_client_error_logs_status_code(self):
        response = FakeResponse(status_code=404, text='missing')
        with self.assertLogs(level='ERROR') as log_ctx:
            with self.assertRaises(osmo_errors.OSMOUserError):
                client.handle_response(response)
        joined = '\n'.join(log_ctx.output)
        self.assertIn('404', joined)


if __name__ == '__main__':
    unittest.main()
