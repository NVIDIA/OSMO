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
import collections
import copy
import math
import re
from typing import Dict, Generator, Iterable


# Regex to match secrets in the spec. While this is not a perfect solution, it solves the majority
# of cases. Regex from: https://lookingatcomputer.substack.com/p/regex-is-almost-all-you-need
# Proper secret management:
# https://nvidia.github.io/OSMO/main/user_guide/getting_started/credentials.html
SECRET_REDACTION_RE = re.compile(
    r'''(?i)[\w.-]{0,50}?(?:access|auth|(?-i:[Aa]pi|API)|credential|creds|key|passw(?:or)?d|secret|token)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([\w.=-]{10,150}|[a-z0-9][a-z0-9+/]{11,}={0,3})(?:[\x60'"\s;]|\\[nr]|$)'''  # pylint: disable=line-too-long
)

# Matches base64-encoded fragments: at least 16 chars of base64 alphabet with optional padding,
# not adjacent to other base64 characters (to capture complete tokens).
_BASE64_FRAGMENT_RE = re.compile(
    r'(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{16,}={0,2}(?![A-Za-z0-9+/=])'
)


_ENTROPY_THRESHOLD = 3.0
_NEVER_MASK_VALUES = frozenset({'true', 'false', 'True', 'False', 'TRUE', 'FALSE', '0', '1', ''})

# Env var names that always warrant masking regardless of value entropy.
_SENSITIVE_ENV_NAME_RE = re.compile(
    r'(?:access|auth|(?-i:[Aa]pi|API)|credential|creds|key|passwd|password|secret|token)',
    re.IGNORECASE,
)


def _shannon_entropy(data: str) -> float:
    """
    Calculate the Shannon entropy of a string (bits per character).
    https://en.wiktionary.org/wiki/Shannon_entropy
    """
    if not data:
        return 0.0
    inv_length = 1.0 / len(data)
    entropy = 0.0
    for count in collections.Counter(data).values():
        freq = count * inv_length
        entropy -= freq * math.log2(freq)
    return entropy


def redact_pod_spec_env(pod_spec: Dict) -> Dict:
    """
    Return a deep copy of pod_spec with sensitive env var values replaced by [MASKED].

    A value is masked if either:
    - the env var name matches _SENSITIVE_ENV_NAME_RE (e.g. contains 'key', 'secret', 'token'), or
    - the value's Shannon entropy exceeds _ENTROPY_THRESHOLD.

    Values in _NEVER_MASK_VALUES ('true', 'false', '0', '1') are always left untouched.
    Covers both 'containers' and 'initContainers'. Entries that use 'valueFrom' (i.e.
    have no 'value' key) are left untouched.
    """
    pod_spec = copy.deepcopy(pod_spec)
    for container_list_key in ('containers', 'initContainers'):
        for container in pod_spec.get('spec', pod_spec).get(container_list_key, []):
            for env_entry in container.get('env', []):
                if 'value' not in env_entry:
                    continue
                value = env_entry['value']
                if value in _NEVER_MASK_VALUES:
                    continue
                if _SENSITIVE_ENV_NAME_RE.search(env_entry['name']) or \
                        _shannon_entropy(value) > _ENTROPY_THRESHOLD:
                    env_entry['value'] = '[MASKED]'
    return pod_spec


def redact_secrets(lines: Iterable[str]) -> Generator[str, None, None]:
    """
    Yield lines with secrets redacted.

    Scans each line for key=value patterns that look like secrets and replaces
    the value with [MASKED]. Also detects base64-encoded fragments, decodes them,
    and replaces the whole fragment with [MASKED] if secrets are found inside.
    """
    def redact_base64_fragments(line: str) -> str:
        """
        Find base64-encoded fragments in a line, decode them, redact any secrets found inside,
        and replace the whole fragment with [MASKED].
        """
        def replace_if_secrets(m: re.Match) -> str:
            fragment = m.group(0)
            try:
                padded = fragment + '=' * (-len(fragment) % 4)
                decoded = base64.b64decode(padded, validate=True).decode('utf-8')
            except (ValueError, UnicodeDecodeError):
                return fragment
            redacted = SECRET_REDACTION_RE.sub(
                lambda sm: sm.group(0).replace(sm.group(1), '[MASKED]'),
                decoded,
            )
            if redacted == decoded:
                return fragment
            return '[MASKED]'
        return _BASE64_FRAGMENT_RE.sub(replace_if_secrets, line)

    for line in lines:
        line = redact_base64_fragments(line)
        yield SECRET_REDACTION_RE.sub(
            lambda m: m.group(0).replace(m.group(1), '[MASKED]'), line)
