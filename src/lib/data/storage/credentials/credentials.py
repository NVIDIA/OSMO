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

import abc
import re

import pydantic

from .. import constants
from ....utils import osmo_errors


class DataCredential(pydantic.BaseModel, abc.ABC, extra=pydantic.Extra.forbid):
    """
    Base class for data credentials (i.e. credentials with endpoint and region).
    """
    endpoint: str = pydantic.Field(
        ...,
        description='The endpoint URL for the data service',
    )
    region: str | None = pydantic.Field(
        default=None,
        description='The region for the data service',
    )

    @pydantic.validator('endpoint')
    @classmethod
    def validate_endpoint(cls, value: str) -> constants.StorageCredentialPattern:
        """
        Validates endpoint. Returns the value of parsed job_id if valid.
        """
        if not re.fullmatch(constants.STORAGE_CREDENTIAL_REGEX, value):
            raise osmo_errors.OSMOUserError(f'Invalid endpoint: {value}')
        return value.rstrip('/')


class StaticDataCredential(DataCredential, abc.ABC, extra=pydantic.Extra.forbid):
    """
    Static data credentials (i.e. credentials with access_key_id and access_key).
    """
    access_key_id: str = pydantic.Field(
        ...,
        description='The authentication key for the data service',
    )


class EncryptedStaticDataCredential(StaticDataCredential, extra=pydantic.Extra.forbid):
    """
    Authentication information for a data service using static keys (encrypted).
    """
    access_key: pydantic.SecretStr = pydantic.Field(
        ...,
        description='The encrypted authentication secret for the data service',
    )


class DecryptedStaticDataCredential(StaticDataCredential, extra=pydantic.Extra.forbid):
    """
    Authentication information for a data service using static keys (decrypted).
    """
    access_key: str = pydantic.Field(
        ...,
        description='The decrypted authentication secret for the data service',
    )


class EnvironmentDataCredential(DataCredential, extra=pydantic.Extra.forbid):
    """
    Authentication information for a data service using environment variables.

    Intentionally left empty. This indicates that we should resolve the credentials
    from the environment.
    """
    pass
