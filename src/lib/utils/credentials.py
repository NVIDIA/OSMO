"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

import pydantic

from ..data.storage import credentials

DataCredential = credentials.DataCredential
DefaultDataCredential = credentials.DefaultDataCredential
StaticDataCredential = credentials.StaticDataCredential
get_static_data_credential_from_config = credentials.get_static_data_credential_from_config


CREDNAMEREGEX = r'^[a-zA-Z]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$'


class RegistryCredential(pydantic.BaseModel, extra='forbid', populate_by_name=True):
    """ Authentication information for a Docker registry. """
    registry: str = pydantic.Field('', description='The Docker registry URL')
    username: str = pydantic.Field('', description='The username for the Docker registry')
    # Accepts both `auth` (legacy field name) and `password` (matches the
    # K8s Secret convention `kubectl create secret generic --from-literal=password=...`).
    # Internally always stored as `auth`; the worker base64s `username:auth`
    # to build the dockerconfigjson auth header at pod-creation time.
    auth: pydantic.SecretStr = pydantic.Field(
        pydantic.SecretStr(''),
        description='The authentication token (raw password) for the Docker registry',
        validation_alias=pydantic.AliasChoices('auth', 'password'),
    )
