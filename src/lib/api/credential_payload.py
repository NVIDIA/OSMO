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

from collections.abc import Mapping
from typing import Literal


CredentialType = Literal['REGISTRY', 'DATA', 'GENERIC']


def build_credential_request_envelope(
    credential_type: CredentialType,
    payload: Mapping[str, str],
) -> dict[str, object]:
    """Wrap one validated credential in Core's request envelope.

    Validation stays with each caller because the CLI and MCP have different
    input and error contracts. This helper owns only the shared wire shape and
    DATA endpoint normalization.
    """
    normalized_payload = dict(payload)
    if credential_type == 'DATA':
        normalized_payload['endpoint'] = normalized_payload['endpoint'].rstrip(
            '/'
        )
        return {'data_credential': normalized_payload}
    if credential_type == 'REGISTRY':
        return {'registry_credential': normalized_payload}
    if credential_type == 'GENERIC':
        return {'generic_credential': {'credential': normalized_payload}}
    raise ValueError(f'Unsupported credential type: {credential_type}')
