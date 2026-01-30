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

import logging
from typing import Optional

import fastapi
import fastapi.responses

from src.lib.utils import osmo_errors
from src.service.core.auth import objects as auth_objects
from src.service.core.scim import auth as scim_auth
from src.service.core.scim import objects
from src.utils import connectors


# SCIM 2.0 router with /scim/v2 prefix
router = fastapi.APIRouter(
    prefix="/api/scim/v2",
    tags=["SCIM 2.0 API"]
)


def get_base_url(request: fastapi.Request) -> str:
    """Extract base URL from request for building resource locations"""
    return str(request.base_url).rstrip('/')


# =============================================================================
# SCIM Service Provider Configuration
# =============================================================================

@router.get("/ServiceProviderConfig")
async def get_service_provider_config(request: fastapi.Request):
    """
    Returns SCIM Service Provider configuration.
    This endpoint is typically called by IdPs to discover SCIM capabilities.
    """
    base_url = get_base_url(request)
    return {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        "documentationUri": f"{base_url}/api/docs",
        "patch": {
            "supported": True
        },
        "bulk": {
            "supported": False,
            "maxOperations": 0,
            "maxPayloadSize": 0
        },
        "filter": {
            "supported": True,
            "maxResults": 200
        },
        "changePassword": {
            "supported": False
        },
        "sort": {
            "supported": False
        },
        "etag": {
            "supported": False
        },
        "authenticationSchemes": [
            {
                "type": "oauthbearertoken",
                "name": "OAuth Bearer Token",
                "description": "Authentication using OAuth Bearer Token",
                "specUri": "https://tools.ietf.org/html/rfc6750",
                "primary": True
            }
        ],
        "meta": {
            "resourceType": "ServiceProviderConfig",
            "location": f"{base_url}/scim/v2/ServiceProviderConfig"
        }
    }


@router.get("/ResourceTypes")
async def get_resource_types(request: fastapi.Request):
    """Returns supported SCIM resource types (Users and Groups)"""
    base_url = get_base_url(request)
    return {
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": 2,
        "Resources": [
            {
                "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
                "id": "User",
                "name": "User",
                "endpoint": "/Users",
                "schema": "urn:ietf:params:scim:schemas:core:2.0:User",
                "meta": {
                    "resourceType": "ResourceType",
                    "location": f"{base_url}/scim/v2/ResourceTypes/User"
                }
            },
            {
                "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
                "id": "Group",
                "name": "Group",
                "endpoint": "/Groups",
                "schema": "urn:ietf:params:scim:schemas:core:2.0:Group",
                "meta": {
                    "resourceType": "ResourceType",
                    "location": f"{base_url}/scim/v2/ResourceTypes/Group"
                }
            }
        ]
    }


@router.get("/Schemas")
async def get_schemas(request: fastapi.Request):
    """Returns SCIM schema definitions"""
    base_url = get_base_url(request)
    return {
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": 2,
        "Resources": [
            {
                "id": "urn:ietf:params:scim:schemas:core:2.0:User",
                "name": "User",
                "description": "User Account",
                "attributes": [
                    {"name": "userName", "type": "string", "required": True, "uniqueness": "server"},
                    {"name": "displayName", "type": "string", "required": False},
                    {"name": "emails", "type": "complex", "multiValued": True, "required": False},
                    {"name": "active", "type": "boolean", "required": False},
                    {"name": "name", "type": "complex", "required": False},
                    {"name": "externalId", "type": "string", "required": False},
                ],
                "meta": {
                    "resourceType": "Schema",
                    "location": f"{base_url}/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User"
                }
            },
            {
                "id": "urn:ietf:params:scim:schemas:core:2.0:Group",
                "name": "Group",
                "description": "Group (maps to OSMO Roles)",
                "attributes": [
                    {"name": "displayName", "type": "string", "required": True},
                    {"name": "members", "type": "complex", "multiValued": True, "required": False},
                    {"name": "externalId", "type": "string", "required": False},
                ],
                "meta": {
                    "resourceType": "Schema",
                    "location": f"{base_url}/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group"
                }
            }
        ]
    }


# =============================================================================
# User Endpoints
# =============================================================================

@router.get("/Users", response_model=objects.SCIMListResponse)
async def list_users(
    request: fastapi.Request,
    filter: Optional[str] = None,
    startIndex: int = 1,
    count: int = 100,
    token: auth_objects.AccessToken = fastapi.Depends(scim_auth.scim_auth_dependency)
):
    """
    List users with optional filtering.

    SCIM filter examples:
    - userName eq "john@example.com"
    - displayName sw "John"

    This endpoint is called by IdPs to sync users.
    """
    postgres = connectors.PostgresConnector.get_instance()
    base_url = get_base_url(request)

    try:
        users, total = objects.SCIMUser.list_from_db(
            postgres, filter_str=filter, start_index=startIndex, count=count
        )

        resources = [user.to_scim_response(base_url) for user in users]

        return objects.SCIMListResponse(
            totalResults=total,
            startIndex=startIndex,
            itemsPerPage=len(resources),
            Resources=resources
        )
    except Exception as e:
        logging.exception("Error listing SCIM users")
        raise fastapi.HTTPException(status_code=500, detail=str(e)) from e


@router.get("/Users/{user_id}", response_model=objects.SCIMUserResponse)
async def get_user(
    request: fastapi.Request,
    user_id: str,
    token: auth_objects.AccessToken = fastapi.Depends(scim_auth.scim_auth_dependency)
):
    """Get a specific user by ID"""
    postgres = connectors.PostgresConnector.get_instance()
    base_url = get_base_url(request)

    try:
        user = objects.SCIMUser.fetch_from_db(postgres, user_id)
        return user.to_scim_response(base_url)
    except osmo_errors.OSMOUserError as e:
        raise fastapi.HTTPException(status_code=404, detail=str(e)) from e


@router.post("/Users", response_model=objects.SCIMUserResponse, status_code=201)
async def create_user(
    request: fastapi.Request,
    user_request: objects.SCIMUserRequest,
    token: auth_objects.AccessToken = fastapi.Depends(scim_auth.scim_auth_dependency)
):
    """
    Create a new user.

    This endpoint is called by IdPs when a user is assigned to the OSMO application.
    """
    postgres = connectors.PostgresConnector.get_instance()
    base_url = get_base_url(request)

    logging.info("SCIM: Creating user %s (external_id: %s)",
                 user_request.userName, user_request.externalId)

    try:
        user = objects.SCIMUser.create_in_db(postgres, user_request)
        response = user.to_scim_response(base_url)

        return fastapi.responses.JSONResponse(
            status_code=201,
            content=response.dict(),
            headers={"Location": response.meta.location}
        )
    except osmo_errors.OSMOUserError as e:
        # User already exists - return 409 Conflict
        raise fastapi.HTTPException(status_code=409, detail=str(e)) from e


@router.put("/Users/{user_id}", response_model=objects.SCIMUserResponse)
async def replace_user(
    request: fastapi.Request,
    user_id: str,
    user_request: objects.SCIMUserRequest,
    token: auth_objects.AccessToken = fastapi.Depends(scim_auth.scim_auth_dependency)
):
    """
    Replace a user (full update).

    This endpoint replaces all user attributes with the provided values.
    """
    postgres = connectors.PostgresConnector.get_instance()
    base_url = get_base_url(request)

    logging.info("SCIM: Replacing user %s", user_id)

    try:
        user = objects.SCIMUser.update_in_db(postgres, user_id, user_request)
        return user.to_scim_response(base_url)
    except osmo_errors.OSMOUserError as e:
        raise fastapi.HTTPException(status_code=404, detail=str(e)) from e


@router.patch("/Users/{user_id}", response_model=objects.SCIMUserResponse)
async def patch_user(
    request: fastapi.Request,
    user_id: str,
    patch_request: objects.SCIMPatchRequest,
    token: auth_objects.AccessToken = fastapi.Depends(scim_auth.scim_auth_dependency)
):
    """
    Patch a user (partial update).

    This endpoint is commonly used by IdPs to:
    - Deactivate users: {"Operations": [{"op": "replace", "path": "active", "value": false}]}
    - Update attributes selectively
    """
    postgres = connectors.PostgresConnector.get_instance()
    base_url = get_base_url(request)

    logging.info("SCIM: Patching user %s with %d operations",
                 user_id, len(patch_request.Operations))

    try:
        user = objects.SCIMUser.patch_in_db(postgres, user_id, patch_request.Operations)
        return user.to_scim_response(base_url)
    except osmo_errors.OSMOUserError as e:
        raise fastapi.HTTPException(status_code=404, detail=str(e)) from e


@router.delete("/Users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    token: auth_objects.AccessToken = fastapi.Depends(scim_auth.scim_auth_dependency)
):
    """
    Delete a user.

    This endpoint is called by IdPs when a user is unassigned from the OSMO application
    or when they leave the organization.
    """
    postgres = connectors.PostgresConnector.get_instance()

    logging.info("SCIM: Deleting user %s", user_id)

    try:
        objects.SCIMUser.delete_from_db(postgres, user_id)
        return fastapi.Response(status_code=204)
    except osmo_errors.OSMOUserError as e:
        raise fastapi.HTTPException(status_code=404, detail=str(e)) from e


# =============================================================================
# Group Endpoints (map to OSMO Roles)
# =============================================================================

@router.get("/Groups", response_model=objects.SCIMListResponse)
async def list_groups(
    request: fastapi.Request,
    filter: Optional[str] = None,
    startIndex: int = 1,
    count: int = 100,
    token: auth_objects.AccessToken = fastapi.Depends(scim_auth.scim_auth_dependency)
):
    """
    List groups (OSMO roles).

    SCIM Groups map to OSMO Roles. This allows IdPs to sync group membership
    which translates to role assignments in OSMO.
    """
    postgres = connectors.PostgresConnector.get_instance()
    base_url = get_base_url(request)

    try:
        groups, total = objects.SCIMGroup.list_from_db(
            postgres, filter_str=filter, start_index=startIndex, count=count
        )

        resources = [group.to_scim_response(base_url, postgres) for group in groups]

        return objects.SCIMListResponse(
            totalResults=total,
            startIndex=startIndex,
            itemsPerPage=len(resources),
            Resources=resources
        )
    except Exception as e:
        logging.exception("Error listing SCIM groups")
        raise fastapi.HTTPException(status_code=500, detail=str(e)) from e


@router.get("/Groups/{group_id}", response_model=objects.SCIMGroupResponse)
async def get_group(
    request: fastapi.Request,
    group_id: str,
    token: auth_objects.AccessToken = fastapi.Depends(scim_auth.scim_auth_dependency)
):
    """Get a specific group (role) by ID"""
    postgres = connectors.PostgresConnector.get_instance()
    base_url = get_base_url(request)

    try:
        group = objects.SCIMGroup.fetch_from_db(postgres, group_id)
        return group.to_scim_response(base_url, postgres)
    except osmo_errors.OSMOUserError as e:
        raise fastapi.HTTPException(status_code=404, detail=str(e)) from e


@router.patch("/Groups/{group_id}", response_model=objects.SCIMGroupResponse)
async def patch_group(
    request: fastapi.Request,
    group_id: str,
    patch_request: objects.SCIMPatchRequest,
    token: auth_objects.AccessToken = fastapi.Depends(scim_auth.scim_auth_dependency)
):
    """
    Patch a group (partial update).

    This endpoint is used by IdPs to manage group membership:
    - Add members: {"Operations": [{"op": "add", "path": "members", "value": [{"value": "user-id"}]}]}
    - Remove members: {"Operations": [{"op": "remove", "path": "members[value eq \"user-id\"]"}]}

    Note: OSMO roles are created via the config API, not SCIM. This endpoint only manages membership.
    """
    postgres = connectors.PostgresConnector.get_instance()
    base_url = get_base_url(request)

    logging.info("SCIM: Patching group %s with %d operations",
                 group_id, len(patch_request.Operations))

    try:
        objects.SCIMGroup.patch_members(postgres, group_id, patch_request.Operations)
        group = objects.SCIMGroup.fetch_from_db(postgres, group_id)
        return group.to_scim_response(base_url, postgres)
    except osmo_errors.OSMOUserError as e:
        raise fastapi.HTTPException(status_code=404, detail=str(e)) from e


# =============================================================================
# Error Handlers
# =============================================================================

@router.exception_handler(scim_auth.SCIMAuthError)
async def scim_auth_error_handler(
    request: fastapi.Request, exc: scim_auth.SCIMAuthError
):
    """Handle SCIM authentication errors with proper SCIM error format"""
    return scim_auth.create_scim_error_response(exc)
