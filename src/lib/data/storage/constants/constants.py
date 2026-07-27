# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

"""
Constants for the data module.
"""

from typing import Annotated

import pydantic

from src.lib.api.storage import (
    AZURE_PROFILE_REGEX,
    AZURE_REGEX,
    GS_PROFILE_REGEX,
    GS_REGEX,
    S3_PROFILE_REGEX,
    S3_REGEX,
    STORAGE_BACKEND_REGEX,
    STORAGE_BACKEND_SCHEMES,
    STORAGE_CREDENTIAL_REGEX,
    STORAGE_PROFILE_REGEX,
    SWIFT_PROFILE_REGEX,
    SWIFT_REGEX,
    TOS_PROFILE_REGEX,
    TOS_REGEX,
    URI_COMPONENT,
)

__all__ = [
    'AZURE_PROFILE_REGEX',
    'AZURE_REGEX',
    'DEFAULT_AZURE_HOST',
    'DEFAULT_AZURE_REGION',
    'DEFAULT_BOTO3_REGION',
    'DEFAULT_GS_HOST',
    'DEFAULT_GS_REGION',
    'DEFAULT_TOS_REGION',
    'GS_PROFILE_REGEX',
    'GS_REGEX',
    'S3_PROFILE_REGEX',
    'S3_REGEX',
    'STORAGE_BACKEND_REGEX',
    'STORAGE_BACKEND_SCHEMES',
    'STORAGE_CREDENTIAL_REGEX',
    'STORAGE_PROFILE_REGEX',
    'SWIFT_PROFILE_REGEX',
    'SWIFT_REGEX',
    'StorageBackendPattern',
    'StorageCredentialPattern',
    'StorageProfilePattern',
    'TOS_PROFILE_REGEX',
    'TOS_REGEX',
    'URI_COMPONENT',
]

DEFAULT_BOTO3_REGION = 'us-east-1'
DEFAULT_GS_REGION = 'us-east1'
DEFAULT_TOS_REGION = 'cn-beijing'
DEFAULT_AZURE_REGION = 'eastus'
DEFAULT_GS_HOST = 'storage.googleapis.com'
DEFAULT_AZURE_HOST = 'blob.core.windows.net'


StorageBackendPattern = Annotated[str, pydantic.Field(pattern=STORAGE_BACKEND_REGEX)]

StorageProfilePattern = Annotated[str, pydantic.Field(pattern=STORAGE_PROFILE_REGEX)]

StorageCredentialPattern = Annotated[str, pydantic.Field(pattern=STORAGE_CREDENTIAL_REGEX)]
