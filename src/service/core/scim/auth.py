"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import logging
from typing import Optional

import fastapi
from fastapi import security

from src.service.core.auth import objects as auth_objects
from src.utils import connectors


# OAuth2 Bearer token scheme for SCIM
oauth2_scheme = security.HTTPBearer(auto_error=False)


class SCIMAuthError(Exception):
    """Exception raised for SCIM authentication errors"""
    def __init__(self, detail: str, status_code: int = 401):
        self.detail = detail
        self.status_code = status_code
        super().__init__(detail)


def validate_scim_token(
    credentials: Optional[security.HTTPAuthorizationCredentials],
    postgres: connectors.PostgresConnector
) -> auth_objects.AccessToken:
    """
    Validate the SCIM bearer token and return the associated access token.

    Args:
        credentials: HTTP Authorization credentials from the request
        postgres: Database connector

    Returns:
        AccessToken object if valid

    Raises:
        SCIMAuthError: If token is invalid, expired, or missing
    """
    if not credentials:
        raise SCIMAuthError("Missing authorization header", 401)

    if credentials.scheme.lower() != "bearer":
        raise SCIMAuthError("Invalid authentication scheme. Use Bearer token.", 401)

    token = credentials.credentials
    access_token = auth_objects.AccessToken.validate_access_token(postgres, token)

    if not access_token:
        logging.warning("SCIM auth failed: Invalid token provided")
        raise SCIMAuthError("Invalid or unknown token", 401)

    # Check expiration
    if access_token.expires_at.date() <= datetime.datetime.utcnow().date():
        logging.warning("SCIM auth failed: Token expired for user %s", access_token.user_name)
        raise SCIMAuthError("Token has expired", 401)

    # Verify this is a service token (SCIM should use service tokens)
    if access_token.access_type != auth_objects.AccessTokenType.SERVICE:
        logging.warning(
            "SCIM auth warning: User token used instead of service token for %s",
            access_token.user_name
        )
        # Allow but log warning - some deployments may use user tokens

    logging.debug("SCIM auth successful for service: %s", access_token.user_name)
    return access_token


async def scim_auth_dependency(
    credentials: Optional[security.HTTPAuthorizationCredentials] = fastapi.Depends(oauth2_scheme)
) -> auth_objects.AccessToken:
    """
    FastAPI dependency for SCIM endpoint authentication.

    This validates the Bearer token provided by IdPs (Okta, Azure AD, etc.)
    when making SCIM provisioning requests.

    Usage:
        @router.get("/api/scim/v2/Users")
        async def list_users(token: AccessToken = Depends(scim_auth_dependency)):
            ...
    """
    postgres = connectors.PostgresConnector.get_instance()
    return validate_scim_token(credentials, postgres)


def create_scim_error_response(error: SCIMAuthError) -> fastapi.responses.JSONResponse:
    """Create a SCIM-compliant error response"""
    return fastapi.responses.JSONResponse(
        status_code=error.status_code,
        content={
            "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
            "status": str(error.status_code),
            "detail": error.detail
        }
    )
