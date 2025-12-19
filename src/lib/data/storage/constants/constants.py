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

DEFAULT_BOTO3_REGION = 'us-east-1'
DEFAULT_GS_REGION = 'us-east1'
DEFAULT_TOS_REGION = 'cn-beijing'
DEFAULT_AZURE_REGION = 'eastus'
DEFAULT_GS_HOST = 'storage.googleapis.com'
DEFAULT_AZURE_HOST = 'blob.core.windows.net'


# Regex rules for uris
URI_COMPONENT = r'[^/,;*]+'
SWIFT_REGEX = fr'^swift://{URI_COMPONENT}(/{URI_COMPONENT}){{2,}}/*$'
S3_REGEX = fr'^s3://{URI_COMPONENT}(/{URI_COMPONENT})*/*$'
GS_REGEX = fr'^gs://{URI_COMPONENT}(/{URI_COMPONENT})*/*$'
TOS_REGEX = fr'^tos://{URI_COMPONENT}(/{URI_COMPONENT})+/*$'
AZURE_REGEX = fr'^azure://{URI_COMPONENT}(/{URI_COMPONENT})+/*$'
STORAGE_BACKEND_REGEX = fr'({SWIFT_REGEX}|{S3_REGEX}|{GS_REGEX}|{TOS_REGEX}|{AZURE_REGEX})'
StorageBackendPattern = Annotated[str, pydantic.Field(regex=STORAGE_BACKEND_REGEX)]


# Regex rules for storage profiles
SWIFT_PROFILE_REGEX = fr'^swift://{URI_COMPONENT}(/{URI_COMPONENT})/*'
S3_PROFILE_REGEX = fr'^s3://{URI_COMPONENT}/*'
GS_PROFILE_REGEX = fr'^gs://{URI_COMPONENT}/*'
TOS_PROFILE_REGEX = fr'^tos://{URI_COMPONENT}(/{URI_COMPONENT})/*'
AZURE_PROFILE_REGEX = fr'^azure://{URI_COMPONENT}/*'
STORAGE_PROFILE_REGEX = fr'({SWIFT_PROFILE_REGEX}|{S3_PROFILE_REGEX}|' \
    fr'{GS_PROFILE_REGEX}|{TOS_PROFILE_REGEX}|' \
    fr'{AZURE_PROFILE_REGEX})'
StorageProfilePattern = Annotated[str, pydantic.Field(regex=STORAGE_PROFILE_REGEX)]

STORAGE_CREDENTIAL_REGEX = fr'({STORAGE_PROFILE_REGEX}|{STORAGE_BACKEND_REGEX})'
StorageCredentialPattern = Annotated[str, pydantic.Field(regex=STORAGE_CREDENTIAL_REGEX)]
