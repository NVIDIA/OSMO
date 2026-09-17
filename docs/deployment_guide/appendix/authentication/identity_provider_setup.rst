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

The unified ``osmo`` chart uses embedded Dex by default and bootstraps a static
admin account whose password is stored in a retained Secret. This configuration
uses volatile Dex storage and is intended only to speed up development and
evaluation. For production, disable embedded Dex and configure an external
**identity provider (IdP)** so users log in with your organization's credentials
(for example, Microsoft Entra ID, Google Workspace, or AWS IAM Identity
Center). OSMO connects directly to the IdP; there is no Keycloak or other
broker in the middle.

External OIDC configures two client IDs. ``browserClientId`` is used by both
OAuth2 Proxy's confidential browser flow and the CLI's default authorization
code flow with PKCE. Its application registration therefore needs the OSMO web
callback and a localhost loopback callback; OAuth2 Proxy uses its client secret,
but the CLI never receives that secret. ``cliClientId`` is used by the optional
device authorization flow (``osmo login --method code``). Some providers allow
one application registration to support all of these flows; others require a
separate public client for device authorization. If the browser registration
cannot also act as a public PKCE client, use the device authorization flow for
CLI login.

Choose a ``userClaim`` that is present in ID tokens from the browser, PKCE,
and device flows. The CLI requests ``openid``, ``profile``, and
``offline_access``, but not ``email``; use ``sub`` unless your provider always
includes the selected claim in those tokens. The CLI uses an available
localhost port for PKCE by default. If your provider requires an exact loopback
redirect URI, register a fixed port and pass it to ``osmo login`` with
``--callback-port``.

.. note::

   In the unified ``osmo`` chart, select
   ``authentication.provider: externalOidc``, disable the default local
   bootstrap user, and set ``embeddedDependencies.dex.enabled: false``. Supply
   browser and device client IDs, the issuer, authorization, token, device,
   and JWKS endpoints, ``jwksHost``, user/role claim names, scopes, and existing
   Secret references. ``logoutEndpoint`` is optional and may remain empty.
   HTTP endpoints are accepted for trusted development only. HTTPS JWKS
   connections use the system CA bundle, validate the exact ``jwksHost`` DNS
   name, and honor an explicit URI port. See
   :doc:`migrating_to_embedded_dex` for the complete migration contract.

External OIDC credentials remain operator-owned even when chart bootstrap is
enabled. Skip this setup for embedded Dex, whose browser-client and cookie
Secrets are generated automatically; see :ref:`deployment_secrets`.

Generate a random 32-byte cookie secret:

.. code-block:: bash

   $ openssl rand -base64 32

Save the browser client secret and command output as
``external-oidc-secret.yaml``. Restrict access to this file and do not commit
it to source control:

.. code-block:: yaml

   apiVersion: v1
   kind: Secret
   metadata:
     name: osmo-external-oidc
     namespace: osmo
   type: Opaque
   stringData:
     client_secret: <oidc-browser-client-secret>
     cookie_secret: <random-32-byte-cookie-secret>

.. code-block:: bash

   $ kubectl create --filename external-oidc-secret.yaml

When to use an IdP
==================

Use an IdP when:

- You want users to sign in via a browser with corporate SSO (e.g., Microsoft, Google, etc.).
- You want to map IdP groups or roles to OSMO roles so that access is controlled partly by your directory.
- You are deploying in production and already have an IdP.

For evaluation without an external IdP, use embedded Dex and its generated
administrator credentials (see :ref:`deploy_minimal`).

How it works
====================

1. Register OSMO's browser client in the IdP with the web and localhost
   callbacks. OAuth2 Proxy uses its client secret for the web flow, while the
   CLI uses the same client ID without the secret for PKCE. Register the device
   client separately when your provider requires it.
2. When a user visits the OSMO UI or API without a session, OAuth2 Proxy
   redirects them to the IdP. After login, Envoy validates the returned JWT and
   forwards the request to OSMO with ``x-osmo-user`` and ``x-osmo-roles`` set.
3. OSMO roles can be assigned from two sources: directly via the OSMO user/role APIs, or from an IdP. When using an IdP, external claims (e.g., LDAP groups, OIDC roles) are mapped to OSMO roles through the :ref:`idp_role_mapping`.

Identity Provider Configuration Reference
==============================================

.. list-table::
   :header-rows: 1
   :widths: 20 35 45

   * - Placeholder
     - Meaning
     - Example
   * - ``<your-domain>``
     - OSMO service hostname
     - ``osmo.example.com``
   * - ``<tenant-id>``
     - Microsoft tenant ID
     - ``12345678-1234-1234-1234-123456789abc``
   * - ``<browser-client-id>``
     - OAuth2 Proxy browser and CLI PKCE client/application ID
     - From IdP app registration
   * - ``<cli-client-id>``
     - CLI device-authorization client/application ID
     - From the same or a separate IdP app registration
   * - ``<client-secret>``
     - OAuth2 client secret
     - From IdP app registration
   * - ``<instance-id>``
     - AWS Identity Center instance ID
     - ``ssoins-abc123def456``
   * - ``<region>``
     - AWS region
     - ``us-east-1``

Microsoft Entra ID (Azure AD)
--------------------------------

You can use one app registration for OAuth2 Proxy, CLI PKCE, and device
authorization. In that case, use its application ID for both
``browserClientId`` and ``cliClientId``. Configure the flows explicitly:

1. Under **Authentication**, add a **Web** redirect URI of
   ``https://<your-domain>/oauth2/callback`` for OAuth2 Proxy.
2. Under **Authentication**, add ``http://localhost`` to **Mobile and desktop
   applications** for CLI PKCE, and enable **Allow public client flows** for
   PKCE and device authorization.
3. Create a client secret under **Certificates & secrets** for OAuth2 Proxy. Do not distribute that
   secret to the CLI; CLI PKCE uses an ``S256`` challenge and device authorization
   uses no client secret.
4. OSMO requests only the OpenID Connect ``openid``, ``email``, ``profile``, and
   ``offline_access`` scopes. The chart's ``scopes`` value configures OAuth2
   Proxy; the CLI independently requests ``openid``, ``offline_access``, and
   ``profile``. The CLI does not need Microsoft Graph
   ``User.Read`` or a delegated OSMO API permission for the current ID-token
   gateway contract. Add a delegated permission only when the client requests
   and uses that protected API's scope.
5. **Implicit grant and hybrid flows** settings are independent of authorization code with PKCE.
   PKCE does not require the implicit ID-token setting and does not replace delegated permissions.
   Do not disable an existing implicit or hybrid-flow setting as part of enabling PKCE.
6. **Optional:** Under Token configuration, add a “Groups” claim so group IDs (or names) are in the
   token for role mapping.

**Endpoints:**

.. list-table::
   :header-rows: 1
   :widths: 15 80

   * - Purpose
     - URL
   * - Token
     - ``https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token``
   * - Authorize
     - ``https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/authorize``
   * - Device authorization
     - ``https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/devicecode``
   * - JWKS
     - ``https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys``
   * - Issuer
     - ``https://login.microsoftonline.com/<tenant-id>/v2.0``
   * - Logout
     - ``https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/logout``

**Example Helm values:**

.. code-block:: yaml

   externalUrl: https://<your-domain>

   authentication:
     provider: externalOidc
     bootstrap:
       identities:
         admin:
           enabled: false
     externalOidc:
       issuer: https://login.microsoftonline.com/<tenant-id>/v2.0
       browserClientId: <browser-client-id>
       # Use the same ID when this registration also supports device authorization.
       cliClientId: <cli-client-id>
       authorizationEndpoint: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/authorize
       tokenEndpoint: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token
       deviceEndpoint: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/devicecode
       jwksUri: https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys
       jwksHost: login.microsoftonline.com
       userClaim: preferred_username
       rolesClaim: groups
       scopes:
       - openid
       - email
       - profile
       - offline_access
       logoutEndpoint: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/logout
       browserClientSecret:
         existingSecret: osmo-external-oidc
         key: client_secret
         rolloutNonce: ''
       cookieSecret:
         existingSecret: osmo-external-oidc
         key: cookie_secret
         rolloutNonce: ''

   embeddedDependencies:
     dex:
       enabled: false

Google OAuth2
--------------------------------

1. In Google Cloud Console, create OAuth 2.0 credentials for the browser flow.
   Set the authorized redirect URI to
   ``https://<your-domain>/oauth2/callback``.
2. If the same client supports CLI PKCE, also register the localhost loopback
   callback. Otherwise, configure a device client as ``cliClientId`` and use
   ``osmo login --method code``.
3. Configure the OAuth consent screen and add the ``openid``, ``email``, and
   ``profile`` scopes.

**Endpoints:**

.. list-table::
   :header-rows: 1
   :widths: 15 80

   * - Purpose
     - URL
   * - Token
     - ``https://oauth2.googleapis.com/token``
   * - Authorize
     - ``https://accounts.google.com/o/oauth2/v2/auth``
   * - Device authorization
     - ``https://oauth2.googleapis.com/device/code``
   * - JWKS
     - ``https://www.googleapis.com/oauth2/v3/certs``
   * - Issuer
     - ``https://accounts.google.com``

Use ``sub`` as the user claim for Google because it is present in tokens for
both browser and CLI login; the CLI does not request the ``email`` scope. The
browser audience is typically the full client ID (for example,
``<browser-client-id>.apps.googleusercontent.com``). Google does not publish an
OIDC logout endpoint, so leave ``logoutEndpoint`` empty. Set ``jwksHost`` to
``www.googleapis.com`` and configure ``rolesClaim`` only with a claim that your
Google identity configuration actually emits; standard Google ID tokens do not
include Workspace groups.

AWS IAM Identity Center (AWS SSO)
-----------------------------------

1. Enable AWS IAM Identity Center and note the instance ID and region.
2. Create a “Customer managed” OAuth 2.0 application for the browser flow with
   redirect URI ``https://<your-domain>/oauth2/callback`` and scopes
   ``openid``, ``email``, and ``profile``. Use its client ID as
   ``browserClientId`` and record its client secret.
3. Enable device authorization on that application and use the same client ID
   as ``cliClientId``, or create a separate public device client and use its ID.
   ``osmo login --method code`` uses ``cliClientId`` and no client secret.
4. If the browser application supports public PKCE, also register the localhost
   loopback callback for the default ``osmo login`` flow.
5. Assign users/groups to the application as needed.

**Endpoints:**

.. list-table::
   :header-rows: 1
   :widths: 15 80

   * - Purpose
     - URL
   * - Token
     - ``https://oidc.<region>.amazonaws.com/token``
   * - Authorize
     - ``https://<instance-id>.awsapps.com/start/authorize``
   * - Device authorization
     - ``https://oidc.<region>.amazonaws.com/device_authorization``
   * - JWKS
     - ``https://oidc.<region>.amazonaws.com/keys``
   * - Issuer
     - ``https://identitycenter.<region>.amazonaws.com/ssoins-<instance-id>``

Replace ``<region>`` and ``<instance-id>`` with your values. Set ``jwksHost``
to ``oidc.<region>.amazonaws.com``. Use ``sub`` as the user claim unless your
PKCE and device ID tokens are configured to include another stable claim.
Leave ``logoutEndpoint`` empty unless your configured provider exposes an OIDC
logout endpoint.

Managing users and roles with an IdP
=====================================

- **Users** can be created in OSMO automatically when they first log in (just-in-time provisioning), or via the CLI (e.g. ``osmo user create``).
- **Roles** can be assigned in OSMO via the CLI (for example,
  ``osmo user update <user_id> --add-roles <role_name>``). They can also be
  derived from IdP claims: configure :ref:`idp_role_mapping` so that IdP group
  or role names map to OSMO role names. OSMO merges IdP-derived roles with
  manually assigned roles.

For more details, see :doc:`idp_role_mapping`.

Verification
============

- **Browser:** Open ``https://<your-domain>`` in a private window. You should be redirected to the IdP, then back to OSMO with a session.
- **CLI PKCE:** Run ``osmo login https://<your-domain>``. For device
  authorization, add ``--method code``. Then run
  ``osmo profile list`` to confirm the user has the expected identity and roles.

Troubleshooting
===============

- **Invalid token / 401:** Check issuer and audience in Envoy match the JWT. Ensure the IdP’s JWKS URI is reachable from the cluster and the signing key is present.
- **Redirect fails:** Ensure the redirect URI in the IdP exactly matches (scheme, host, path, no trailing slash).
- **Missing ``x-osmo-user`` / 400:** Ensure ``userClaim`` names a claim present
  in the ID token for the login flow in use.
- **User has no roles / 403:** Ensure the user exists in OSMO and has roles (via ``osmo user get <user_id>`` or IdP mapping).

.. seealso::

   - :doc:`index` for overview of authentication with and without an IdP
   - :doc:`authentication_flow` for request flow
   - :doc:`roles_policies` for roles and policies
