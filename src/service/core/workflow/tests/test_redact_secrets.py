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
import textwrap
import unittest

from src.service.core.workflow.workflow_service import redact_secrets


# The AWS keys used below are the well-known example credentials from the AWS documentation
# and pose no security risk.
_AWS_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE'
_AWS_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'

_SPEC_WITH_SECRETS = textwrap.dedent(f'''\
    workflow:
      name: "test"
      resources:
        default:
          gpu: 0
          cpu: 1
          storage: 1Gi
          memory: 1Gi
      tasks:
      - name: task
        image: amazon/aws-cli
        command: [bash]
        args: [/tmp/run.sh]
        files:
        - path: /tmp/run.sh
          contents: |
            AWS_ACCESS_KEY_ID={_AWS_ACCESS_KEY} AWS_SECRET_ACCESS_KEY={_AWS_SECRET_KEY} aws s3 cp <file> s3://testbucket
''')


def _redact(spec: str) -> str:
    return ''.join(redact_secrets(spec.splitlines(keepends=True)))


class TestRedactSecretsPlaintext(unittest.TestCase):
    """redact_secrets correctly handles plaintext key=value secrets."""

    def test_redacts_aws_access_key_id(self):
        redacted = _redact(_SPEC_WITH_SECRETS)
        self.assertNotIn(_AWS_ACCESS_KEY, redacted)
        self.assertIn('**redacted**', redacted)

    def test_redacts_aws_secret_access_key(self):
        redacted = _redact(_SPEC_WITH_SECRETS)
        self.assertNotIn(_AWS_SECRET_KEY, redacted)
        self.assertIn('**redacted**', redacted)

    def test_redacted_value_pads_to_original_length(self):
        # _AWS_ACCESS_KEY is 20 chars; '**redacted**' is 12 chars → 8 padding chars split
        # evenly (4 per side), giving '****' + '**redacted**' + '****' = 20 chars total.
        redacted = _redact(_SPEC_WITH_SECRETS)
        self.assertIn('*' * 4 + '**redacted**' + '*' * 4, redacted)

    def test_preserves_non_secret_content(self):
        redacted = _redact(_SPEC_WITH_SECRETS)
        self.assertIn('name: "test"', redacted)
        self.assertIn('image: amazon/aws-cli', redacted)
        self.assertIn('s3://testbucket', redacted)


class TestRedactSecretsBase64(unittest.TestCase):
    """redact_secrets detects and redacts secrets hidden inside base64 blobs."""

    def test_redacts_base64_encoded_secret(self):
        encoded = base64.b64encode(f'AWS_ACCESS_KEY_ID={_AWS_ACCESS_KEY}'.encode()).decode()
        spec = f'workflow:\n  name: test\n  config: {encoded}\n'

        redacted = _redact(spec)

        self.assertNotIn(encoded, redacted)
        self.assertIn('**redacted**', redacted)

    def test_leaves_safe_base64_untouched(self):
        safe_text = 'this is completely safe content with no credentials at all'
        encoded = base64.b64encode(safe_text.encode()).decode()
        spec = f'workflow:\n  name: test\n  data: {encoded}\n'

        redacted = _redact(spec)

        self.assertIn(encoded, redacted)


if __name__ == '__main__':
    unittest.main()
