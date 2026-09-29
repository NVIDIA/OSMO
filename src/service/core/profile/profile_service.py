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
from typing import Literal, Optional

import fastapi
import jwt

from src.lib.api import profile as profile_contract
from src.lib.utils import login, osmo_errors
from src.service.core.auth import objects as auth_objects
from src.utils import auth, connectors


router = fastapi.APIRouter(
    tags = ['Profile API']
)


def _bootstrap_token_identity(request: fastapi.Request, service_auth: auth.AuthenticationConfig,
                        username: str, token_name: str) -> profile_contract.TokenIdentity | None:
    """Verify credential provenance without changing gateway authentication policy."""
    authorization = request.headers.getlist(login.OSMO_AUTH_HEADER)
    alternate = request.headers.getlist('x-osmo-auth')
    # Do not guess which credential the gateway selected from ambiguous headers.
    if len(authorization) + len(alternate) != 1:
        return None
    if authorization:
        scheme, separator, token = authorization[0].partition(' ')
        if not separator or scheme.lower() != 'bearer':
            return None
    else:
        token = alternate[0]

    # OSMO JWTs have no kid; try all configured keys to support key rotation.
    for key_pair in service_auth.keys.values():
        try:
            claims = jwt.decode(
                token, key=jwt.PyJWK.from_json(key_pair.public_key).key,
                algorithms=['RS256'], issuer=service_auth.issuer,
                audience=service_auth.audience,
                options={'require': ['exp', 'iat', 'nbf', 'iss', 'aud']})
        except jwt.InvalidSignatureError:
            continue
        except jwt.InvalidTokenError:
            return None
        if (claims.get('unique_name') != username
                or claims.get('osmo_token_name') != token_name
                or claims.get('osmo_token_source') != 'bootstrap'):
            return None
        result = profile_contract.TokenIdentity(name=token_name, expires_at=None)
        if 'osmo_token_expires_at' not in claims:
            result.expiration_status = 'unknown'
        elif claims['osmo_token_expires_at'] is None:
            result.expiration_status = 'never'
        else:
            expiry = claims['osmo_token_expires_at']
            try:
                if (not isinstance(expiry, int) or isinstance(expiry, bool)
                        or expiry < claims['exp']):
                    raise ValueError()
                result.expires_at = datetime.datetime.fromtimestamp(expiry, datetime.timezone.utc)
                result.expiration_status = 'scheduled'
            except (ValueError, OverflowError, OSError):
                result.expiration_status = 'unknown'
        return result
    return None


@router.get('/api/profile/settings', response_model=profile_contract.ProfileResponse,
            response_model_exclude_unset=True)
def get_notification_settings(
    request: fastapi.Request,
    include_token_expiration: bool = False,
    user_header: Optional[str] =
        fastapi.Header(alias=login.OSMO_USER_HEADER, default=None),
    roles_header: Optional[str] =
        fastapi.Header(alias=login.OSMO_USER_ROLES, default=None),
    token_name_header: Optional[str] =
        fastapi.Header(alias=login.OSMO_TOKEN_NAME_HEADER, default=None),
    allowed_pools_header: Optional[str] =
        fastapi.Header(alias=login.OSMO_ALLOWED_POOLS, default=None),
) -> profile_contract.ProfileResponse:
    user_name = connectors.parse_username(user_header)
    postgres = connectors.PostgresConnector.get_instance()
    roles = login.construct_roles_list(roles_header)
    pools = login.parse_allowed_pools(allowed_pools_header)
    token_identity = None
    if token_name_header:
        expires_at = None
        expiration_status: Literal['scheduled', 'never', 'unknown'] = 'unknown'
        bootstrap_identity = _bootstrap_token_identity(
            request, postgres.get_service_configs().service_auth, user_name, token_name_header)
        if bootstrap_identity is not None:
            expires_at = bootstrap_identity.expires_at
            expiration_status = bootstrap_identity.expiration_status
        else:
            try:
                expires_at = auth_objects.AccessToken.fetch_from_db(
                    postgres, token_name_header, user_name).expires_at
                expiration_status = 'scheduled'
            except osmo_errors.OSMOUserError:
                pass
        token_identity = profile_contract.TokenIdentity(
            name=token_name_header, expires_at=expires_at)
        # Older MCP clients reject extra fields, so expose metadata only on request.
        if include_token_expiration:
            token_identity.expiration_status = expiration_status
    return profile_contract.ProfileResponse(
        profile=profile_contract.UserProfile.model_validate(
            connectors.UserProfile.fetch_from_db(postgres, user_name).model_dump()
        ),
        roles=roles,
        pools=pools,
        token=token_identity,
    )


@router.post('/api/profile/settings')
def set_notification_settings(
    preferences: profile_contract.UserProfile,
    set_default_backend: bool = False,
    user_header: Optional[str] = fastapi.Header(alias=login.OSMO_USER_HEADER, default=None)):
    fields = preferences.model_dump(exclude_none=True)
    if set_default_backend:
        fields['backend'] = None
    user_name = connectors.parse_username(user_header)
    postgres = connectors.PostgresConnector.get_instance()
    connectors.UserProfile.insert_into_db(postgres, user_name, fields)
