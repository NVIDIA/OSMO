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
import dataclasses
import io
import json
import unittest
from unittest import mock

from src.lib.utils import client, osmo_errors, version


@dataclasses.dataclass
class StubResponse:
    """Minimal stand-in for requests.Response used by handle_response."""
    status_code: int = 200
    text: str = ''
    content: bytes = b''
    headers: dict = dataclasses.field(default_factory=dict)


class TestHandleResponseSuccess(unittest.TestCase):
    """Tests for the 200-OK response paths of client.handle_response."""

    def test_json_mode_returns_parsed_payload(self):
        payload = {'foo': 'bar', 'count': 3}
        response = StubResponse(status_code=200, text=json.dumps(payload))

        result = client.handle_response(response, mode=client.ResponseMode.JSON)

        self.assertEqual(result, payload)

    def test_default_mode_is_json(self):
        payload = {'ok': True}
        response = StubResponse(status_code=200, text=json.dumps(payload))

        result = client.handle_response(response)

        self.assertEqual(result, payload)

    def test_plain_text_mode_returns_text(self):
        response = StubResponse(status_code=200, text='hello world')

        result = client.handle_response(response, mode=client.ResponseMode.PLAIN_TEXT)

        self.assertEqual(result, 'hello world')

    def test_binary_mode_returns_content_bytes(self):
        response = StubResponse(status_code=200, content=b'\x00\x01\x02')

        result = client.handle_response(response, mode=client.ResponseMode.BINARY)

        self.assertEqual(result, b'\x00\x01\x02')

    def test_streaming_mode_returns_response_object(self):
        response = StubResponse(status_code=200)

        result = client.handle_response(response, mode=client.ResponseMode.STREAMING)

        self.assertIs(result, response)


class TestHandleResponseWarningHeader(unittest.TestCase):
    """Tests for the version-warning header handling."""

    def test_warning_header_decoded_and_printed_to_stderr(self):
        warning_text = 'client version is outdated'
        encoded = base64.b64encode(warning_text.encode()).decode()
        response = StubResponse(
            status_code=200,
            text=json.dumps({}),
            headers={version.WARNING_HEADER: encoded},
        )

        stderr_buffer = io.StringIO()
        with mock.patch('sys.stderr', stderr_buffer):
            client.handle_response(response)

        self.assertIn(warning_text, stderr_buffer.getvalue())

    def test_missing_warning_header_does_not_print(self):
        response = StubResponse(status_code=200, text=json.dumps({}))

        stderr_buffer = io.StringIO()
        with mock.patch('sys.stderr', stderr_buffer):
            client.handle_response(response)

        self.assertEqual(stderr_buffer.getvalue(), '')


class TestHandleResponseClientErrors(unittest.TestCase):
    """Tests for 4xx response handling."""

    def test_non_json_body_raises_osmo_user_error_with_raw_text(self):
        response = StubResponse(status_code=404, text='<html>not found</html>')

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            client.handle_response(response)

        self.assertEqual(context.exception.message, '<html>not found</html>')
        self.assertEqual(context.exception.status_code, 404)

    def test_json_body_without_error_code_raises_osmo_user_error_with_text(self):
        body = json.dumps({'message': 'something went wrong'})
        response = StubResponse(status_code=400, text=body)

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            client.handle_response(response)

        # When there is no error_code, the raw response.text is used as the message.
        self.assertEqual(context.exception.message, body)
        self.assertEqual(context.exception.status_code, 400)

    def test_submission_error_code_usage_raises_submission_error(self):
        payload = {
            'error_code': osmo_errors.SubmissionErrorCode.USAGE.value,
            'message': 'bad usage',
            'workflow_id': 'wf-123',
        }
        response = StubResponse(status_code=400, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOSubmissionError) as context:
            client.handle_response(response)

        self.assertEqual(context.exception.message, 'bad usage')
        self.assertEqual(context.exception.workflow_id, 'wf-123')
        self.assertEqual(context.exception.status_code, 400)

    def test_submission_error_code_resource_raises_submission_error(self):
        payload = {
            'error_code': osmo_errors.SubmissionErrorCode.RESOURCE.value,
            'message': 'no resources',
        }
        response = StubResponse(status_code=400, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOSubmissionError) as context:
            client.handle_response(response)

        self.assertEqual(context.exception.message, 'no resources')
        self.assertEqual(context.exception.workflow_id, '')

    def test_credential_error_code_raises_credential_error(self):
        payload = {
            'error_code': 'CREDENTIAL',
            'message': 'bad credential',
            'workflow_id': 'wf-7',
        }
        response = StubResponse(status_code=403, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOCredentialError) as context:
            client.handle_response(response)

        self.assertEqual(context.exception.message, 'bad credential')
        self.assertEqual(context.exception.workflow_id, 'wf-7')
        self.assertEqual(context.exception.status_code, 403)

    def test_generic_error_code_raises_osmo_user_error_with_message(self):
        payload = {'error_code': 'SOMETHING_ELSE', 'message': 'generic failure'}
        response = StubResponse(status_code=422, text=json.dumps(payload))

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            client.handle_response(response)

        self.assertEqual(context.exception.message, 'generic failure')
        self.assertEqual(context.exception.status_code, 422)

    def test_status_499_still_classified_as_client_error(self):
        # Boundary: status codes < 500 go through the 4xx branch.
        response = StubResponse(status_code=499, text='too close')

        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            client.handle_response(response)

        self.assertEqual(context.exception.status_code, 499)


class TestHandleResponseServerErrors(unittest.TestCase):
    """Tests for 5xx response handling."""

    def test_500_raises_osmo_server_error_with_headers_and_body(self):
        response = StubResponse(
            status_code=500,
            text='boom',
            headers={'X-Request-Id': 'abc-123'},
        )

        with self.assertRaises(osmo_errors.OSMOServerError) as context:
            client.handle_response(response)

        message = context.exception.message
        self.assertIn('Status Code: 500', message)
        self.assertIn('X-Request-Id: abc-123', message)
        self.assertIn('boom', message)
        self.assertEqual(context.exception.status_code, 500)

    def test_503_is_treated_as_server_error(self):
        response = StubResponse(status_code=503, text='unavailable')

        with self.assertRaises(osmo_errors.OSMOServerError) as context:
            client.handle_response(response)

        self.assertEqual(context.exception.status_code, 503)


class TestResponseMode(unittest.TestCase):
    """Sanity checks on the ResponseMode enum values used by callers."""

    def test_response_mode_has_expected_members(self):
        self.assertEqual(client.ResponseMode.JSON.value, 'JSON')
        self.assertEqual(client.ResponseMode.PLAIN_TEXT.value, 'PLAIN_TEXT')
        self.assertEqual(client.ResponseMode.BINARY.value, 'BINARY')
        self.assertEqual(client.ResponseMode.STREAMING.value, 'STREAMING')


if __name__ == '__main__':
    unittest.main()
