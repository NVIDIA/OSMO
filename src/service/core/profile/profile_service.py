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
from typing import Optional

import fastapi

from src.lib.utils import login
from src.service.core.profile import objects
from src.utils import connectors


router = fastapi.APIRouter(
    tags = ['Profile API']
)


@router.get('/api/profile/settings')
def get_notification_settings(
    user_header: Optional[str] =
        fastapi.Header(alias=login.OSMO_USER_HEADER, default=None),
    roles_header: Optional[str] =
        fastapi.Header(alias=login.OSMO_USER_ROLES, default=None)
    ) -> objects.ProfileResponse:
    user_name = connectors.parse_username(user_header)
    postgres = connectors.PostgresConnector.get_instance()
    return objects.ProfileResponse(
        profile=connectors.UserProfile.fetch_from_db(postgres, user_name),
        pools=connectors.Pool.get_pools(login.construct_roles_list(roles_header))
        )


@router.post('/api/profile/settings')
def set_notification_settings(
    preferences: connectors.UserProfile,
    set_default_backend: bool = False,
    user_header: Optional[str] = fastapi.Header(alias=login.OSMO_USER_HEADER, default=None)):
    fields = {}
    for key, value in preferences.dict().items():
        if value is not None:
            fields[key] = value
    if set_default_backend:
        fields['backend'] = None
    user_name = connectors.parse_username(user_header)
    postgres = connectors.PostgresConnector.get_instance()
    connectors.UserProfile.insert_into_db(postgres, user_name, fields)
