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

import pydantic


class ClientRegistration(pydantic.BaseModel):
    """A short-lived public OAuth client created through DCR."""

    model_config = pydantic.ConfigDict(frozen=True, extra='forbid')

    client_id: str
    client_name: str
    redirect_uris: tuple[str, ...]
    grant_types: tuple[str, ...]
    created_at: int
    expires_at: int


class BrokerIdentity(pydantic.BaseModel):
    """Identity accepted from the configured upstream OIDC provider."""

    model_config = pydantic.ConfigDict(frozen=True, extra='forbid')

    subject: str
    username: str
    roles: tuple[str, ...]


class AuthorizationTransaction(pydantic.BaseModel):
    """State kept while the user's browser is at the upstream provider."""

    model_config = pydantic.ConfigDict(frozen=True, extra='forbid')

    client_id: str
    redirect_uri: str
    client_state: str
    code_challenge: str
    scope: str
    resource: str
    upstream_nonce: str
    upstream_code_verifier: str
    created_at: int


class AuthorizationCode(pydantic.BaseModel):
    """One-use authorization code bound to the client's PKCE challenge."""

    model_config = pydantic.ConfigDict(frozen=True, extra='forbid')

    client_id: str
    redirect_uri: str
    code_challenge: str
    scope: str
    resource: str
    identity: BrokerIdentity
    expires_at: int


class RefreshSession(pydantic.BaseModel):
    """Absolute-lifetime session referenced by an opaque refresh token."""

    model_config = pydantic.ConfigDict(frozen=True, extra='forbid')

    family_id: str
    client_id: str
    scope: str
    resource: str
    identity: BrokerIdentity
    expires_at: int


class RefreshFamily(pydantic.BaseModel):
    """Server-side refresh family with exactly one active token digest."""

    model_config = pydantic.ConfigDict(frozen=True, extra='forbid')

    active_token_digest: str
    session: RefreshSession
