"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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

from typing import Literal

from fastmcp import Context
import pydantic

from src.service.mcp import access_scope


class HealthResult(pydantic.BaseModel):
    """Caller-bound OSMO API health result."""

    model_config = pydantic.ConfigDict(extra='forbid')

    status: Literal['healthy']


async def osmo_health(context: Context) -> HealthResult:
    """Verify that the active caller can reach and authenticate to OSMO."""
    await access_scope.request_access_scope(context)
    return HealthResult(status='healthy')
