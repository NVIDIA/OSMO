..
  SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

.. _authentication_flow:

================================================
Authentication Flow
================================================

This guide describes how authentication and authorization work in OSMO: how users and scripts prove who they are and how OSMO decides what they can do.

Architecture components
========================

The main pieces involved are:

1. **User or client** — A person (browser or CLI) or a script/automation that wants to call OSMO. They must present something that proves their identity: either a JWT (from an IdP or from OSMO) or a Personal Access Token (PAT).

2. **Envoy** — The API gateway in front of the OSMO service. It can be configured to:
   - **With an IdP:** Run an OAuth2 filter that redirects unauthenticated browser users to your identity provider and validates the JWT returned by the IdP. It then forwards the request to the OSMO service with headers like ``x-osmo-user`` and ``x-osmo-roles`` derived from the JWT.
   - **Without an IdP:** Allow requests that carry a valid PAT or service-issued JWT and set the same headers for the backend.

3. **Identity provider (IdP)** — Optional. Your organization’s login system (e.g., Microsoft Entra ID, Google, AWS IAM Identity Center). When used, Envoy talks to it directl and the IdP issues JWTs that Envoy validates.

4. **OSMO service** — The backend. It trusts the ``x-osmo-user`` and ``x-osmo-roles`` headers set by Envoy (or by an internal path that bypasses Envoy). It does **not** validate the original JWT itself; Envoy is responsible for that. The service uses the user and roles to resolve policies and allow or deny the request.

So in practice: the client gets a token (JWT from IdP or PAT), Envoy validates it and sets user/roles headers, and the OSMO service authorizes based on those headers and its role/policy database.

Operating without an identity provider
=====================================

When you do not configure an IdP, there is no browser “log in with SSO” flow. Access is token-based.

Default admin
--------------

You enable a **default admin** user via Helm (see :ref:`default_admin_setup`). On startup, the OSMO service:

- Creates a user with the configured username (e.g. ``admin``).
- Assigns that user the ``osmo-admin`` role.
- Creates a Personal Access Token for that user whose secret is the password you stored in a Kubernetes secret.

So the “password” you set for the default admin is effectively the PAT value. You use it with the CLI (e.g. ``osmo login``) or with the API as ``Authorization: Bearer <that-password>``.

Personal Access Tokens (PATs)
-----------------------------

After the default admin is in place (or if you have another admin), you can:

- Create more **users** via the user API (e.g. ``POST /api/auth/user``).
- Assign **roles** to users (e.g. ``POST /api/auth/user/{id}/roles``).
- Create **PATs** for users (e.g. ``POST /api/auth/access_token/{token_name}`` or the admin API to create a PAT for any user). Each PAT is tied to a user and gets a set of roles (by default, all of that user’s roles) at creation time.

Scripts and the CLI then authenticate by sending the PAT in the ``Authorization: Bearer <PAT>`` header. The OSMO service (or Envoy, if configured to accept PATs) validates the token, resolves the user and roles from the database, and sets the same ``x-osmo-user`` and ``x-osmo-roles`` headers for the backend. Authorization works the same as for IdP-issued JWTs.

Token-based login (service-issued JWT)
--------------------------------------

For compatibility with flows that expect a JWT (e.g. some CLI or internal callers), OSMO can issue its own JWTs. For example, a client can exchange a PAT for a short-lived JWT via the appropriate auth endpoint. Envoy must be configured to accept JWTs issued by OSMO (e.g. via ``osmoauth`` and the service’s public key). The resulting JWT carries the same user and roles; Envoy validates it and sets ``x-osmo-user`` and ``x-osmo-roles`` as before.

Operating with an identity provider
===================================

When you configure an IdP, Envoy uses OAuth 2.0 / OpenID Connect to let users log in with your organization’s identity system.

Browser login
-------------

1. The user opens the OSMO UI or an API URL that requires authentication.
2. Envoy’s OAuth2 filter sees that the user is not authenticated (no valid session cookie or ``x-osmo-auth`` header).
3. Envoy redirects the browser to the IdP’s authorization endpoint. The user signs in at the IdP (e.g. Microsoft, Google).
4. The IdP redirects back to Envoy with an authorization code (e.g. to ``/api/auth/getAToken``).
5. Envoy exchanges the code for tokens (access token, ID token, optionally refresh token) at the IdP’s token endpoint.
6. Envoy sets session cookies (e.g. ``OAuthHMAC``, ``IdToken``, ``BearerToken``) and forwards the user to the original URL.
7. On subsequent requests, Envoy reads the ``IdToken`` (JWT) from the cookie, validates it (signature, expiry, issuer, audience), and sets ``x-osmo-user`` and ``x-osmo-roles`` from the JWT claims (and/or from OSMO’s database after syncing the user).
8. The OSMO service receives the request with those headers and authorizes using its role/policy database.

So the IdP is the source of “who is this?”; OSMO is the source of “what can they do?” (roles and policies), possibly combined with role information from the IdP (e.g. groups mapped to OSMO roles).

CLI / device flow
-----------------

For the CLI, a device-authorization or similar flow can be used: the CLI calls an endpoint (e.g. ``GET /api/auth/login``) to get the IdP’s device-auth URL, the user completes login in a browser, and the CLI receives tokens. The exact endpoints depend on your Envoy and service configuration (e.g. device endpoint and client IDs in ``services.service.auth``). Once the CLI has an ID token, it sends it in the ``x-osmo-auth`` header; Envoy validates it and sets ``x-osmo-user`` and ``x-osmo-roles`` as for browser requests.

Role resolution with an IdP
---------------------------

When a request carries an IdP-issued JWT:

1. Envoy validates the JWT and extracts a user identifier (e.g. ``preferred_username`` or ``email``) and, if present, group/role claims.
2. The OSMO service (or middleware) may **sync** the user and roles:
   - Ensure the user exists in OSMO (just-in-time provisioning).
   - Map IdP group/role claims to OSMO role names (via ``role_external_mappings``).
   - Merge roles from the IdP with roles stored in OSMO’s ``user_roles`` table and apply role ``sync_mode`` (e.g. ``import`` vs ``force``).
3. The final list of roles for the request is used to load policies and allow or deny the action.

So roles can come from the IdP (mapped into OSMO role names) and/or from OSMO’s user/role tables. See the PROJ-148 user management and direct IdP integration design docs for details (e.g. ``external/projects/PROJ-148-auth-rework/``).

Token validation and headers
============================

Envoy (or the component in front of the OSMO service) is responsible for:

- **Signature verification** — The JWT was signed by the expected IdP or by OSMO.
- **Expiration** — The token is not expired.
- **Claims** — ``iss`` (issuer), ``aud`` (audience), and the claim used as username (e.g. ``preferred_username``, ``email``) match the configuration.

The OSMO service does **not** validate the raw JWT. It trusts the ``x-osmo-user`` and ``x-osmo-roles`` headers. Therefore, in production you must only expose the OSMO service through Envoy (or another gateway) that:

- Validates the JWT or PAT.
- Strips or ignores any downstream ``x-osmo-user`` and ``x-osmo-roles`` from the client.
- Sets ``x-osmo-user`` and ``x-osmo-roles`` from the validated token.

Troubleshooting
===============

**User cannot log in (with IdP)**
Verify IdP configuration (redirect URIs, client ID/secret), Envoy OAuth2 and JWT provider settings (issuer, audience, JWKS URI), and that the IdP is reachable from the cluster.

**User has no permissions (403)**
Check that the user has roles in OSMO (user/role APIs or IdP mapping). Verify ``x-osmo-user`` and ``x-osmo-roles`` in Envoy logs. Ensure the role has policies that allow the requested action (see :doc:`roles_policies`).

**Token validation failures**
Ensure issuer and audience in Envoy match the JWT. Check JWKS URI connectivity from Envoy. For PATs, ensure the token exists and is not expired.

.. seealso::

   - :doc:`identity_provider_setup` for configuring Envoy with Microsoft Entra ID, Google, or AWS IAM Identity Center
   - :doc:`roles_policies` for roles and policies
   - :doc:`index` for overview of with/without IdP and default admin
