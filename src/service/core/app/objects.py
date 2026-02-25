"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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

import datetime
from typing import Annotated, List

import pydantic

from src.lib.utils import common


AppNamePattern = Annotated[str, pydantic.Field(regex=common.APP_NAME_VALIDATION_REGEX)]


class ListEntry(pydantic.BaseModel):
    uuid: str
    name: str
    description: str
    created_date: datetime.datetime
    owner: str
    latest_version: str


class ListResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    apps: List[ListEntry]
    more_entries: bool


class GetVersionEntry(pydantic.BaseModel):
    version: int
    created_by: str
    created_date: datetime.datetime
    status: str


class GetAppResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    uuid: str
    name: str
    description: str
    created_date: datetime.datetime
    owner: str
    versions: List[GetVersionEntry]


class EditResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    uuid: str
    version: int
    name: str
    created_by: str
    created_date: datetime.datetime
