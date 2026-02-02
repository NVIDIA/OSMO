#
# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0
#

"""
Credentials for the data module.
"""

import abc
import os
import re
from typing import Union

import pydantic
import yaml

from .. import constants
from ....utils import client_configs, osmo_errors


class DataCredentialBase(pydantic.BaseModel, abc.ABC, extra=pydantic.Extra.forbid):
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


class StaticDataCredential(DataCredentialBase, abc.ABC, extra=pydantic.Extra.forbid):
    """
    Static data credentials (i.e. credentials with access_key_id and access_key) for a data backend.
    """
    access_key_id: str = pydantic.Field(
        ...,
        description='The authentication key for a data backend',
    )

    access_key: pydantic.SecretStr = pydantic.Field(
        ...,
        description='The encrypted authentication secret for a data backend',
    )

    def to_decrypted_dict(self) -> dict[str, str]:
        output = {
            'access_key_id': self.access_key_id,
            'access_key': self.access_key.get_secret_value(),
            'endpoint': self.endpoint,
        }

        if self.region:
            output['region'] = self.region

        return output


class DefaultDataCredential(DataCredentialBase, extra=pydantic.Extra.forbid):
    """
    Data credential that delegates resolution to the underlying SDK.

    Uses the SDK's default credential chain (e.g., Azure's DefaultAzureCredential,
    boto3's credential resolution) which may include environment variables,
    workload identity, instance metadata, and other provider-specific methods.

    Intentionally left empty as all credential resolution is handled by the SDK.
    """

    def to_decrypted_dict(self) -> dict[str, str]:
        """Return credential dict for SDK-based authentication.

        For DefaultDataCredential, only endpoint and region are provided.
        The actual credential resolution occurs at runtime via the SDK's
        default credential chain (workload identity, managed identity, etc.).
        """
        output = {
            'endpoint': self.endpoint,
        }

        if self.region:
            output['region'] = self.region

        return output


DataCredential = Union[
    StaticDataCredential,
    DefaultDataCredential,
]


def get_static_data_credential_from_config(
    url: str,
    config_file: str | None = None,
) -> StaticDataCredential | None:
    """
    Get a matching static data credential from the config file.

    Args:
        url: The URL of the data service.
        config_file: The path to the config file to use for the access check. If not provided,
                     the default config file will be used.
    Returns:
        The static data credential or None if not found.
    """
    if config_file is None:
        config_dir = client_configs.get_client_config_dir(create=False)
        config_file = os.path.join(config_dir, 'config.yaml')

    if not os.path.exists(config_file):
        return None

    with open(config_file, 'r', encoding='utf-8') as file:
        configs = yaml.safe_load(file.read())

        if 'auth' in configs and 'data' in configs['auth'] and url in configs['auth']['data']:
            data_cred_dict = configs['auth']['data'][url]
            data_cred = StaticDataCredential(
                access_key_id=data_cred_dict['access_key_id'],
                access_key=pydantic.SecretStr(data_cred_dict['access_key']),
                endpoint=url,
                region=data_cred_dict['region'],
            )

            return data_cred

    return None
