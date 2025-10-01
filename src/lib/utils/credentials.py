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

import re

import pydantic

from . import osmo_errors
from ..data import constants


CREDNAMEREGEX = r'^[a-zA-Z]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$'


class RegistryCredential(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Authentication information for a Docker registry. """
    registry: str = pydantic.Field('', description='The Docker registry URL')
    username: str = pydantic.Field('', description='The username for the Docker registry')
    auth: pydantic.SecretStr = pydantic.Field(
        pydantic.SecretStr(''),
        description='The authentication token for the Docker registry',
    )


class BasicDataCredential(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Authentication information for a data service without endpoint and region info. """
    access_key_id: str = pydantic.Field(
        description='The authentication key for the data service')
    access_key: pydantic.SecretStr = pydantic.Field(
        description='The authentication secret for the data service')


class DataCredential(BasicDataCredential, extra=pydantic.Extra.forbid):
    """
    Authentication information for a data service.
    """

    endpoint: str = pydantic.Field(
        ...,
        description='The endpoint URL for the data service',
    )

    region: str = pydantic.Field(
        constants.DEFAULT_BOTO3_REGION,
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


class DecryptedDataCredential(BasicDataCredential, extra=pydantic.Extra.ignore):
    """
    Basic data cred with access_key decrypted.
    """

    access_key: str = pydantic.Field(  # type: ignore[assignment]
        ...,
        description='The authentication secret for the data service',
    )

    region: str = pydantic.Field(
        constants.DEFAULT_BOTO3_REGION,
        description='The region for the data service',
    )


def decrypt(base_cred: DataCredential) -> DecryptedDataCredential:
    cred_dict = base_cred.dict()
    cred_dict['access_key'] = cred_dict['access_key'].get_secret_value()
    return DecryptedDataCredential(**cred_dict)
