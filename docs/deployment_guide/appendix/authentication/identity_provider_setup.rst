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

.. _identity_provider_setup:

================================================
Identity Provider (IdP) Setup
================================================

This guide explains how to use OSMO with an external **identity provider (IdP)** so that users log in with your organization’s credentials (e.g., Microsoft Entra ID, Google Workspace, AWS IAM Identity Center). OSMO connects **directly** to the IdP; there is no Keycloak or other broker in the middle.

When to use an IdP
==================

Use an IdP when:

- You want users to sign in via a browser with corporate SSO (e.g., Microsoft, Google, Okta).
- You want to map IdP groups or roles to OSMO roles so that access is controlled partly by your directory.
- You are deploying in production and already have an IdP.

If you are evaluating OSMO or running in an environment without an IdP, use the **default admin** and **Personal Access Tokens** instead (see :ref:`default_admin_setup`).

How it works (short)
====================

1. You register OSMO as an application (OAuth2 / OIDC client) in your IdP and get a client ID and client secret.
2. You configure the **Envoy** sidecar (in front of the OSMO service) with the IdP’s token and authorization endpoints, JWKS URI, and issuer. You also create a Kubernetes secret with the client secret and an HMAC secret for session cookies.
3. When a user hits the OSMO UI or API without a session, Envoy redirects them to the IdP to log in. After login, the IdP returns a JWT. Envoy validates the JWT and forwards the request to the OSMO service with ``x-osmo-user`` and ``x-osmo-roles`` set.
4. Roles can come from OSMO’s database (user/role APIs) and/or from IdP claims (e.g., groups) mapped to OSMO roles via ``role_external_mappings``.

Placeholders used below
=======================

| Placeholder       | Meaning                     | Example |
|-------------------|-----------------------------|--------|
| ``<your-domain>`` | OSMO service hostname       | ``osmo.example.com`` |
| ``<tenant-id>``   | Microsoft tenant ID         | ``12345678-1234-1234-1234-123456789abc`` |
| ``<client-id>``   | OAuth2 client/application ID| From IdP app registration |
| ``<client-secret>`` | OAuth2 client secret      | From IdP app registration |
| ``<instance-id>`` | AWS Identity Center instance ID | ``ssoins-abc123def456`` |
| ``<region>``      | AWS region                   | ``us-east-1`` |

Create Kubernetes secrets
===========================

Before deploying with an IdP, create the secret that Envoy will use for the OAuth2 client secret and for signing session cookies:

.. code-block:: bash

   # Generate an HMAC secret (e.g. 32 bytes, base64)
   HMAC_SECRET=$(openssl rand -base64 32)

   kubectl create secret generic oidc-secrets \
     --namespace <your-namespace> \
     --from-literal=client_secret='<client-secret>' \
     --from-literal=hmac_secret="${HMAC_SECRET}"

Use the same ``oidc-secrets`` name and keys (e.g. ``client_secret``, ``hmac_secret``) in your Helm values under the Envoy OAuth2 filter configuration (e.g. ``secretName: oidc-secrets``, ``clientSecretKey: client_secret``, ``hmacSecretKey: hmac_secret``).

Microsoft Entra ID (Azure AD)
=============================

1. **Register an application** in Azure Portal → Microsoft Entra ID → App registrations → New registration. Set redirect URI (Web) to ``https://<your-domain>/api/auth/getAToken``.
2. **Create a client secret** under Certificates & secrets and copy the value.
3. **Configure API permissions** (e.g. OpenID, profile, email, User.Read).
4. **Optional:** Under Token configuration, add a “Groups” claim so group IDs (or names) are in the token for role mapping.

**Endpoints:**

| Purpose   | URL |
|-----------|-----|
| Token     | ``https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`` |
| Authorize | ``https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/authorize`` |
| JWKS      | ``https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys`` |
| Issuer    | ``https://login.microsoftonline.com/<tenant-id>/v2.0`` |

**Example Envoy-related Helm values:**

.. code-block:: yaml

   sidecars:
     envoy:
       enabled: true
       service:
         hostname: <your-domain>
       oauth2Filter:
         enabled: true
         tokenEndpoint: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token
         authEndpoint: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/authorize
         clientId: <client-id>
         redirectPath: api/auth/getAToken
         logoutPath: logout
         forwardBearerToken: true
         secretName: oidc-secrets
         clientSecretKey: client_secret
         hmacSecretKey: hmac_secret
       jwt:
         user_header: x-osmo-user
         providers:
         - issuer: https://login.microsoftonline.com/<tenant-id>/v2.0
           audience: <client-id>
           jwks_uri: https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys
           user_claim: preferred_username
           cluster: oauth

Google OAuth2
=============

1. In Google Cloud Console, create OAuth 2.0 credentials (Web application). Set authorized redirect URI to ``https://<your-domain>/api/auth/getAToken``.
2. Configure the OAuth consent screen and add scopes such as ``openid``, ``email``, ``profile``.

**Endpoints:**

| Purpose   | URL |
|-----------|-----|
| Token     | ``https://oauth2.googleapis.com/token`` |
| Authorize | ``https://accounts.google.com/o/oauth2/v2/auth`` |
| JWKS      | ``https://www.googleapis.com/oauth2/v3/certs`` |
| Issuer    | ``https://accounts.google.com`` |

Use ``email`` as the user claim for Google. Audience is typically the full client ID (e.g. ``<client-id>.apps.googleusercontent.com``).

AWS IAM Identity Center (AWS SSO)
=================================

1. Enable AWS IAM Identity Center and note the instance ID and region.
2. Create a “Customer managed” OAuth 2.0 application with redirect URI ``https://<your-domain>/api/auth/getAToken`` and scopes ``openid``, ``email``, ``profile``. Record client ID and client secret.
3. Assign users/groups to the application as needed.

**Endpoints:**

| Purpose   | URL |
|-----------|-----|
| Token     | ``https://oidc.<region>.amazonaws.com/token`` |
| Authorize | ``https://<instance-id>.awsapps.com/start/authorize`` |
| JWKS      | ``https://oidc.<region>.amazonaws.com/keys`` |
| Issuer    | ``https://identitycenter.<region>.amazonaws.com/ssoins-<instance-id>`` |

Replace ``<region>`` and ``<instance-id>`` with your values. User claim is often ``email`` or ``sub``.

Managing users and roles with an IdP
=====================================

- **Users** can be created in OSMO automatically when they first log in (just-in-time provisioning), or via the user API (e.g. ``POST /api/auth/user``).
- **Roles** can be assigned in OSMO via the role APIs (e.g. ``POST /api/auth/user/{id}/roles``). They can also be derived from IdP claims: configure ``role_external_mappings`` so that IdP group or role names map to OSMO role names. The OSMO service then merges IdP-derived roles with roles stored in the database (see sync modes in the user management design).

For full API and schema details, see the design docs under ``external/projects/PROJ-148-auth-rework/`` (e.g. PROJ-148-user-management.md and PROJ-148-direct-idp-integration.md).

Verification
============

- **Browser:** Open ``https://<your-domain>`` in a private window. You should be redirected to the IdP, then back to OSMO with a session.
- **API:** After logging in, call an API with the session cookie or the token in ``Authorization: Bearer <token>`` and confirm you get the expected user and permissions (e.g. check ``x-osmo-user`` / ``x-osmo-roles`` in Envoy logs if needed).

Troubleshooting
===============

- **Invalid token / 401:** Check issuer and audience in Envoy match the JWT. Ensure the IdP’s JWKS URI is reachable from the cluster and the signing key is present.
- **Redirect fails:** Ensure the redirect URI in the IdP exactly matches (scheme, host, path, no trailing slash).
- **User has no roles / 403:** Ensure the user exists in OSMO and has roles (via user/role APIs or IdP mapping). Verify the user claim (e.g. ``preferred_username``, ``email``) matches what OSMO expects.

.. seealso::

   - :doc:`index` for overview of authentication with and without an IdP
   - :doc:`authentication_flow` for request flow
   - :doc:`roles_policies` for roles and policies
   - Design docs: ``external/projects/PROJ-148-auth-rework/PROJ-148-direct-idp-integration.md`` and ``PROJ-148-user-management.md``
