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
from typing import Any

from src.lib.utils.redact import redact_pod_spec_env, redact_secrets


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

# Credential field references (e.g. access_key_id) should never be masked — they are
# identifiers that name which field of a stored credential to use, not secret values.
_CRED_FIELD_ACCESS_KEY = 'access_key_id'
_CRED_FIELD_SECRET_KEY = 'secret_access_key'
_CRED_FIELD_DATA = 'data_credentials'

_SPEC_WITH_CREDENTIALS = textwrap.dedent(f'''\
    workflow:
      groups:
      - name: training
        tasks:
        - args:
          - /tmp/entry.sh
          command:
          - bash
          credentials:
            aws-cred:
              AWS_ACCESS_KEY_ID: {_CRED_FIELD_ACCESS_KEY}
              AWS_DEFAULT_REGION: aws_default_region
              AWS_ENDPOINT_URL: aws_endpoint_url
              AWS_SECRET_ACCESS_KEY: {_CRED_FIELD_SECRET_KEY}
            data-credentials:
              DATA_CREDENTIALS: {_CRED_FIELD_DATA}
''')


def _redact(spec: str, value_allowlist: frozenset | None = None,
            entropy_threshold: float | None = None) -> str:
    return ''.join(redact_secrets(spec.splitlines(keepends=True), value_allowlist,
                                  entropy_threshold))


class TestRedactSecretsPlaintext(unittest.TestCase):
    """redact_secrets correctly handles plaintext key=value secrets."""

    def test_redacts_aws_access_key_id(self):
        redacted = _redact(_SPEC_WITH_SECRETS)
        self.assertNotIn(_AWS_ACCESS_KEY, redacted)
        self.assertIn('[MASKED]', redacted)

    def test_redacts_aws_secret_access_key(self):
        redacted = _redact(_SPEC_WITH_SECRETS)
        self.assertNotIn(_AWS_SECRET_KEY, redacted)
        self.assertIn('[MASKED]', redacted)

    def test_preserves_non_secret_content(self):
        redacted = _redact(_SPEC_WITH_SECRETS)
        self.assertIn('name: "test"', redacted)
        self.assertIn('image: amazon/aws-cli', redacted)
        self.assertIn('s3://testbucket', redacted)


class TestRedactSecretsAllowlist(unittest.TestCase):
    """redact_secrets preserves allowlisted credential field references."""

    _ALLOWLIST = frozenset({
        'aws-cred', 'data-credentials',
        _CRED_FIELD_ACCESS_KEY, _CRED_FIELD_SECRET_KEY, _CRED_FIELD_DATA,
        'aws_default_region', 'aws_endpoint_url',
    })

    def test_masks_credential_field_references_without_allowlist(self):
        # Without the allowlist, field references under sensitive env var names get masked.
        redacted = _redact(_SPEC_WITH_CREDENTIALS)
        self.assertNotIn(_CRED_FIELD_ACCESS_KEY, redacted)
        self.assertNotIn(_CRED_FIELD_SECRET_KEY, redacted)
        self.assertNotIn(_CRED_FIELD_DATA, redacted)

    def test_preserves_credential_field_references_with_allowlist(self):
        redacted = _redact(_SPEC_WITH_CREDENTIALS, self._ALLOWLIST)
        self.assertIn(_CRED_FIELD_ACCESS_KEY, redacted)
        self.assertIn(_CRED_FIELD_SECRET_KEY, redacted)
        self.assertIn(_CRED_FIELD_DATA, redacted)
        self.assertNotIn('[MASKED]', redacted)


class TestRedactSecretsEntropyThreshold(unittest.TestCase):
    """redact_secrets skips masking when value entropy is at or below the threshold."""

    def test_preserves_low_entropy_credential_field_references(self):
        # Credential field references have entropy well below 3.8 — not masked.
        redacted = _redact(_SPEC_WITH_CREDENTIALS, entropy_threshold=3.8)
        self.assertIn(_CRED_FIELD_ACCESS_KEY, redacted)
        self.assertIn(_CRED_FIELD_SECRET_KEY, redacted)
        self.assertIn(_CRED_FIELD_DATA, redacted)
        self.assertNotIn('[MASKED]', redacted)

    def test_still_masks_high_entropy_secrets(self):
        # The secret key (entropy ~4.8) is masked; the access key ID (entropy ~3.7)
        # is structured enough to fall below the threshold — an accepted best-effort trade-off.
        redacted = _redact(_SPEC_WITH_SECRETS, entropy_threshold=3.8)
        self.assertNotIn(_AWS_SECRET_KEY, redacted)


class TestRedactSecretsBase64(unittest.TestCase):
    """redact_secrets detects and redacts secrets hidden inside base64 blobs."""

    def test_redacts_base64_encoded_secret(self):
        encoded = base64.b64encode(f'AWS_ACCESS_KEY_ID={_AWS_ACCESS_KEY}'.encode()).decode()
        spec = f'workflow:\n  name: test\n  config: {encoded}\n'

        redacted = _redact(spec)

        self.assertNotIn(encoded, redacted)
        self.assertIn('[MASKED]', redacted)

    def test_leaves_safe_base64_untouched(self):
        safe_text = 'this is completely safe content with no credentials at all'
        encoded = base64.b64encode(safe_text.encode()).decode()
        spec = f'workflow:\n  name: test\n  data: {encoded}\n'

        redacted = _redact(spec)

        self.assertIn(encoded, redacted)


class TestRedactPodSpecEnv(unittest.TestCase):
    """redact_pod_spec_env masks high-entropy values and leaves low-entropy values untouched."""

    def _make_pod_spec(self, *containers: Any) -> dict:
        return {'containers': containers, 'initContainers': []}

    def test_masks_high_entropy_secret(self):
        # Neutral name ('FOO') so only the entropy rule can trigger masking.
        pod_spec = self._make_pod_spec(
            {'name': 'app', 'env': [{'name': 'FOO', 'value': _AWS_SECRET_KEY}]},
        )
        redacted = redact_pod_spec_env(pod_spec)
        self.assertEqual(redacted['containers'][0]['env'][0]['value'], '[MASKED]')

    def test_preserves_low_entropy_value(self):
        # Neutral name ('FOO') and a short benign value not in _NEVER_MASK_VALUES.
        pod_spec = self._make_pod_spec(
            {'name': 'app', 'env': [{'name': 'FOO', 'value': 'hello'}]},
        )
        redacted = redact_pod_spec_env(pod_spec)
        self.assertEqual(redacted['containers'][0]['env'][0]['value'], 'hello')

    def test_does_not_modify_original(self):
        pod_spec = self._make_pod_spec(
            {'name': 'app', 'env': [{'name': 'AWS_SECRET_ACCESS_KEY', 'value': _AWS_SECRET_KEY}]},
        )
        redact_pod_spec_env(pod_spec)
        self.assertEqual(pod_spec['containers'][0]['env'][0]['value'], _AWS_SECRET_KEY)

    def test_masks_in_init_containers(self):
        pod_spec = {
            'containers': [],
            'initContainers': [
                {'name': 'init', 'env': [
                    {'name': 'AWS_SECRET_ACCESS_KEY', 'value': _AWS_SECRET_KEY},
                ]},
            ],
        }
        redacted = redact_pod_spec_env(pod_spec)
        self.assertEqual(redacted['initContainers'][0]['env'][0]['value'], '[MASKED]')

    def test_masks_by_sensitive_name_regardless_of_entropy(self):
        # Low-entropy value but name contains 'token' — masked because of the name.
        pod_spec = self._make_pod_spec(
            {'name': 'app', 'env': [{'name': 'REFRESH_TOKEN_VALUE', 'value': 'abc123abc123'}]},
        )
        redacted = redact_pod_spec_env(pod_spec)
        self.assertEqual(redacted['containers'][0]['env'][0]['value'], '[MASKED]')

    def test_never_masks_boolean_and_numeric_literals(self):
        for literal in ('true', 'false', '0', '1'):
            with self.subTest(literal=literal):
                # Use a sensitive name to confirm the never-mask list takes precedence.
                pod_spec = self._make_pod_spec(
                    {'name': 'app', 'env': [{'name': 'SECRET_ENABLED', 'value': literal}]},
                )
                redacted = redact_pod_spec_env(pod_spec)
                self.assertEqual(redacted['containers'][0]['env'][0]['value'], literal)

    def test_leaves_value_from_untouched(self):
        pod_spec = self._make_pod_spec(
            {'name': 'app', 'env': [{'name': 'MY_SECRET', 'valueFrom': {'secretKeyRef': {'name': 'my-secret', 'key': 'value'}}}]},  # pylint: disable=line-too-long
        )
        redacted = redact_pod_spec_env(pod_spec)
        self.assertNotIn('value', redacted['containers'][0]['env'][0])


if __name__ == '__main__':
    unittest.main()
