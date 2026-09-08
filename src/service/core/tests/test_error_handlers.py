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

import unittest

import fastapi.testclient

from src.lib.utils import osmo_errors
from src.service.core import service

SUBMISSION_ERROR_CLASSES = [
    osmo_errors.OSMOUsageError,
    osmo_errors.OSMOResourceError,
    osmo_errors.OSMOCredentialError,
    osmo_errors.OSMOUserError,
    osmo_errors.OSMOSubmissionError,
    osmo_errors.OSMORegistryError,
    osmo_errors.OSMOImageNotFoundError,
    osmo_errors.OSMORegistryRateLimitError,
    osmo_errors.OSMORegistryUnavailableError,
]

_ERROR_CLASSES_BY_NAME = {cls.__name__: cls for cls in SUBMISSION_ERROR_CLASSES}


@service.app.get('/tests/raise/{error_name}')
def _raise_submission_error(error_name: str):
    """ Test-only route that raises the requested submission error. """
    raise _ERROR_CLASSES_BY_NAME[error_name]('boom', workflow_id='wf-1')


class SubmissionErrorResponseTest(unittest.TestCase):
    """ Every submission-facing error must serialize as an actionable 4xx body. """

    def setUp(self):
        self.client = fastapi.testclient.TestClient(service.app, raise_server_exceptions=False)

    def test_submission_errors_return_a_populated_4xx_body(self):
        for error_class in SUBMISSION_ERROR_CLASSES:
            with self.subTest(error=error_class.__name__):
                response = self.client.get(f'/tests/raise/{error_class.__name__}')

                self.assertEqual(response.status_code, 400)
                payload = response.json()
                self.assertEqual(payload['message'], 'boom')
                self.assertEqual(payload['error_code'], error_class.error_code)
                self.assertEqual(payload['workflow_id'], 'wf-1')

    def test_registry_error_codes_are_distinct_from_the_credential_error_code(self):
        credential_code = osmo_errors.OSMOCredentialError.error_code
        registry_codes = {
            osmo_errors.OSMORegistryError.error_code,
            osmo_errors.OSMOImageNotFoundError.error_code,
            osmo_errors.OSMORegistryRateLimitError.error_code,
            osmo_errors.OSMORegistryUnavailableError.error_code,
        }

        self.assertEqual(len(registry_codes), 4)
        self.assertNotIn(credential_code, registry_codes)


if __name__ == '__main__':
    unittest.main()
