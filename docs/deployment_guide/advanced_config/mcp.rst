..
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

.. _mcp_deployment:

===
MCP
===

MCP is an optional feature deployed in the same Helm release as the OSMO
service. The chart creates an MCP Deployment, a ClusterIP Service, Gateway
routes, and an ingress NetworkPolicy. The recommended authentication mode passes
FastMCP's built-in ``OIDCProxy`` directly to the existing MCP server; it does
not deploy a second OAuth broker service.

Authentication Modes
====================

OSMO supports two MCP authentication modes:

.. list-table::
   :header-rows: 1
   :widths: 24 38 38

   * - Mode
     - Client configuration
     - Request authentication
   * - OIDC proxy (recommended)
     - The user configures only ``https://<osmo-host>/mcp``. FastMCP advertises
       Client ID Metadata Documents (CIMD) and retains Dynamic Client
       Registration (DCR) as a compatibility fallback.
     - FastMCP authenticates requests to the exact ``/mcp`` route in the MCP
       process and relays the verified upstream access token to normal OSMO API
       authorization.
   * - Direct identity provider
     - The user might need a public OAuth client ID, scopes, and callback
       settings supplied by the administrator.
     - Gateway validates the bearer token and enforces ``mcp:Access`` before
       forwarding requests to the exact ``/mcp`` route.

In both modes, every tool call re-enters the OSMO Gateway and is authorized by
the normal API action and pool scope. MCP never assumes a service identity and
cannot elevate the user. See :ref:`mcp_identity_permissions` and
:ref:`actions_resources_reference`.

Shared Prerequisites
====================

Before enabling either mode:

* Keep ``gateway.envoy.enabled`` and ``gateway.authz.enabled`` set to ``true``.
* Configure a ``gateway.envoy.jwt.providers`` entry that validates the bearer
  token used for downstream ``/api`` requests and resolves its identity and
  roles to the intended OSMO user.
* Publish the release Gateway on one HTTPS hostname. Set
  ``services.mcp.resourceUrl`` to that origin plus the exact ``/mcp`` path.
* Ensure that the MCP pod can resolve and reach the public Gateway origin.
* Grant users the API actions and pool-scoped permissions required by the
  tools they can call. Direct mode additionally requires ``mcp:Access``.
* Keep Gateway NetworkPolicy enforcement enabled and ensure that no broader
  policy unintentionally permits direct ingress to the MCP pod.

Configure OIDC Proxy Mode
=========================

OIDC proxy mode provides endpoint-only client setup. The deployment owns one
confidential upstream OIDC application. Individual MCP clients do not need to
configure its client ID and never receive its client secret.

Register the Upstream Application
---------------------------------

Configure one confidential application in the identity provider with:

* The exact redirect URL ``https://<osmo-host>/auth/callback``.
* Authorization code flow and the ``client_secret_post`` token authentication
  method.
* A delegated API scope whose full URI is
  ``https://<osmo-host>/mcp/access_as_user``.
* User or group assignments and administrator consent appropriate for the
  deployment.

``access_as_user`` permits delegated MCP access as the signed-in user. It does
not grant workflow, application, credential, or pool permissions; each tool's
normal OSMO authorization still applies.

The upstream access token must be an RS256 JWT with the configured issuer, the
exact ``https://<osmo-host>/mcp`` audience, and the short scope value
``access_as_user`` in its ``scp`` claim. Configure the existing Gateway JWT
provider for the same token and its OSMO identity or role mappings.

FastMCP's proxy is based on standard OIDC discovery, but this OSMO profile
currently supports one upstream provider and enforces the token contract above.
Microsoft Entra is the validated provider profile. Test claim and scope
compatibility before using another provider.

.. important::

   Do not confuse the fixed upstream ``/auth/callback`` URL with a native MCP
   client's temporary localhost callback. FastMCP accepts native loopback
   callbacks automatically. Browser-hosted clients require separately
   configured HTTPS redirect origins.

Provide Redis and Secrets
-------------------------

FastMCP stores client registrations, authorization transactions, and encrypted
upstream token state in Redis. Use a dedicated database number or key prefix.
The chart mounts externally managed credentials but does not generate them.

Create or inject the client secret and, when required, the Redis password at
their configured paths. The example below uses:

* The upstream OIDC client secret at
  ``/etc/osmo/mcp-auth/client-secret``.
* The Redis password at ``/etc/osmo/mcp-auth/redis-password`` when Redis
  requires one.

Use an external secret manager or an existing Kubernetes Secret. Never place
the client secret, Redis password, authorization code, access token, or refresh
token in Helm values, Git, or logs.

FastMCP deterministically derives its proxy-token signing key from the OIDC
client secret. OSMO derives the Redis encryption key from the same secret with
a separate salt. Rotating the client secret therefore invalidates active proxy
sessions and makes old encrypted state, including DCR registrations, unusable.
Users must authenticate again, and DCR clients might need to remove and re-add
the MCP entry before login.

.. warning::

   OSMO currently relies on FastMCP's default derived signing key to avoid a
   second operator-managed secret. FastMCP documents that default as a
   development or local-testing convenience and recommends an explicit
   independent signing key for production. The current OSMO chart does not
   expose that independent-key option. Assess this limitation before a
   production rollout and require a high-entropy upstream client secret. See
   the `FastMCP OIDC proxy signing-key guidance
   <https://gofastmcp.com/servers/auth/oidc-proxy#param-jwt-signing-key>`_.

Configure Helm Values
---------------------

The following example uses an existing Secret. Adapt the OIDC and Redis values
to the deployment:

.. code-block:: yaml

   services:
     mcp:
       enabled: true
       replicas: 1
       resourceUrl: https://osmo.example.com/mcp
       oidcProxy:
         enabled: true
         scope: https://osmo.example.com/mcp/access_as_user
         oidc:
           configUrl: https://idp.example.com/.well-known/openid-configuration
           clientId: <confidential-oidc-client-id>
           clientSecretFile: /etc/osmo/mcp-auth/client-secret
           accessTokenIssuer: https://issuer.example.com/
           accessTokenAudience: https://osmo.example.com/mcp
           accessTokenJwksUrl: https://idp.example.com/jwks
           accessTokenRequiredScope: access_as_user
         redis:
           dbNumber: 0
           keyPrefix: osmo:mcp-fastmcp
           passwordFile: /etc/osmo/mcp-auth/redis-password
         existingSecret:
           name: osmo-mcp-oidc
           mountPath: /etc/osmo/mcp-auth
           clientSecretKey: client-secret
           redisPasswordKey: redis-password

Blank OIDC proxy Redis host and port values inherit ``services.redis``.
``services.mcp.authorizationServers`` and ``services.mcp.scopes`` are ignored
while the proxy is enabled. Keep ``services.mcp.replicas`` at ``1`` because
the current refresh lock is process-local and does not serialize refreshes
across replicas.

Native clients normally omit ``Origin`` and need neither of the following
settings. For a browser-hosted MCP client, configure both concepts separately:

* ``services.mcp.allowedOrigins`` controls which browser origins can call
  ``/mcp`` through CORS.
* ``services.mcp.oidcProxy.trustedHttpsRedirectOrigins`` controls which exact
  HTTPS origins can receive OAuth callbacks for browser-hosted clients.

How the Proxy Flow Works
------------------------

FastMCP serves OAuth and MCP from the same process:

#. The client discovers protected-resource and authorization-server metadata.
#. The client uses CIMD or falls back to DCR through ``POST /register``.
#. FastMCP obtains user consent, runs authorization code flow with Proof Key for
   Code Exchange (PKCE), and sends the user to the upstream OIDC provider.
#. The provider returns to the fixed ``/auth/callback`` URL.
#. FastMCP exchanges the upstream authorization code for tokens, stores the
   resulting token state encrypted in Redis, and redirects the browser to the
   MCP client with a FastMCP authorization code.
#. The client sends that code and its PKCE verifier to ``POST /token``. FastMCP
   validates them and issues a short-lived resource token.
#. FastMCP authenticates the resource token on ``/mcp`` and exposes the
   verified upstream bearer to the tool request.
#. The tool relays that upstream bearer to ``/api``, where Gateway JWT,
   semantic RBAC, and pool authorization remain authoritative.

FastMCP requests the full delegated MCP scope plus ``openid``, ``profile``,
``email``, and ``offline_access`` upstream. Clients discover the delegated MCP
scope and do not supply these upstream scopes manually. Proxy access tokens
default to 600 seconds. ``refreshTokenTtlSeconds`` is a fallback only when the
upstream provider omits refresh-token expiry.

``offline_access`` lets the proxy request a refresh token so a session can
renew without another browser sign-in. It does not grant additional OSMO
permissions.

Configure Direct Identity-Provider Mode
=======================================

Use direct mode when clients are already registered with the identity provider
and the deployment does not need endpoint-only setup.

Register a public or native OAuth client with authorization code flow and PKCE
with ``S256``. Do not create or distribute a client secret for that public
client. Then configure:

.. code-block:: yaml

   services:
     mcp:
       enabled: true
       resourceUrl: https://osmo.example.com/mcp
       oidcProxy:
         enabled: false
       authorizationServers:
       - https://issuer.example.com/
       scopes:
       - api://<resource-id>/access_as_user
       # Browser-hosted clients only:
       # allowedOrigins:
       # - https://client.example.com

``authorizationServers`` contains issuer identifiers, not authorization or
token endpoints. ``scopes`` contains the resource scopes advertised to
clients. Configure Gateway JWT validation from the access token's actual
issuer and audience; the public client ID is not a Helm value and is not
necessarily the token audience.

Deploy or Upgrade
=================

Save the values overlay, then use the normal OSMO service install or upgrade in
:ref:`Step 5: Deploy Components <deploy_service_deploy_components>`. MCP is
part of that Helm release when ``services.mcp.enabled`` is ``true``. Enabling
OIDC proxy changes the existing MCP Deployment and Gateway routes; it does not
create another application service.

Verify MCP
==========

Verify the chart-created resources:

.. code-block:: bash

   $ kubectl rollout status deployment \
       -l app.kubernetes.io/component=mcp \
       -n osmo
   $ kubectl get deployment,service \
       -l app.kubernetes.io/component=mcp \
       -n osmo
   $ kubectl get networkpolicy -n osmo

Confirm that ``<services.mcp.serviceName>-allow-gateway-envoy`` is present.
With the default service name, it is
``osmo-mcp-allow-gateway-envoy``.

For either mode, verify protected-resource metadata:

.. code-block:: bash

   $ curl --fail --silent --show-error \
       https://osmo.example.com/.well-known/oauth-protected-resource/mcp

In OIDC proxy mode, also verify authorization-server metadata:

.. code-block:: bash

   $ curl --fail --silent --show-error \
       https://osmo.example.com/.well-known/oauth-authorization-server

Confirm the exact resource URL and full delegated scope. Proxy metadata must
also contain ``client_id_metadata_document_supported`` set to ``true`` and a
``registration_endpoint`` for DCR fallback. Complete a fresh endpoint-only
login and run the read-only verification in :ref:`getting_started_mcp`.

Provide Connection Details
==========================

For OIDC proxy mode, give users only the MCP URL. Clients discover scopes from
the proxy metadata, and the proxy accepts native loopback redirects
automatically.

For direct mode, also give users the public client ID, complete OAuth scope
list, and client-specific callback requirements. Direct users to
:ref:`getting_started_mcp`.

Operate OIDC Proxy Safely
=========================

* Monitor authorization, callback, token, refresh, Redis, and upstream OIDC
  outcomes without recording codes, tokens, client secrets, or identity
  payloads.
* Health probes report MCP process health; they do not prove Redis or upstream
  identity-provider connectivity.
* Keep FastMCP's CIMD URL validation and server-side request forgery (SSRF)
  protections enabled. CIMD causes the server to fetch client-controlled HTTPS
  metadata URLs.
* Add deliberate ingress or Gateway rate limits to the exact public OAuth
  routes, especially ``POST /register`` and ``POST /token``. Do not apply a
  shared limit to long-lived MCP traffic without considering denial-of-service
  effects.
* Keep the MCP ingress NetworkPolicy. It is additive, so audit other policies
  that select the same pod.

The public proxy surface is limited to exact protected-resource and
authorization-server metadata, ``/authorize``, ``/auth/callback``,
``/register``, ``/token``, and ``/consent`` routes. Gateway bypasses its own JWT
and semantic authorization filters only for these OAuth routes and exact
``/mcp`` in proxy mode. FastMCP authenticates ``/mcp``; all ``/api`` calls keep
normal Gateway validation and authorization.

.. _mcp_deployment_troubleshooting:

Troubleshooting
===============

.. list-table::
   :header-rows: 1
   :widths: 32 68

   * - Symptom
     - Action
   * - Metadata returns ``404`` or unexpected values
     - Verify that ``services.mcp.enabled`` is true, DNS points to this
       release's Gateway, and ``resourceUrl`` ends with the exact path
       ``/mcp``. In proxy mode, also verify ``oidcProxy.enabled`` and the
       authorization-server metadata route.
   * - MCP pod does not become ready
     - Inspect configuration and credential-file errors first. The client
       secret and optional Redis password must exist at the configured absolute
       paths.
   * - Browser reports a redirect mismatch or no reply address
     - Register exact ``https://<osmo-host>/auth/callback`` on the confidential
       upstream application. For Entra, use the Web platform for this
       server-side client.
   * - Browser reports ``Approval required``
     - Grant administrator consent and assign the intended users or groups to
       the upstream application and delegated MCP scope.
   * - Proxy login or refresh fails
     - Verify Redis connectivity, OIDC discovery, client-secret validity,
       upstream token endpoint responses, and the configured issuer, audience,
       JWKS URL, and short access-token scope. Never log response tokens.
   * - MCP initialization returns ``HTTP 401``
     - Have the user log out and authenticate again. If it persists, verify the
       FastMCP token route and proxy session state.
   * - MCP initialization returns ``HTTP 403``
     - In direct mode, verify ``mcp:Access``. In OIDC proxy mode, verify the
       advertised full MCP scope and the scope on the issued FastMCP resource
       token.
   * - A tool returns ``HTTP 403``
     - Authentication succeeded. Verify the user's OSMO API action and pool
       scope for that tool.
   * - Tools time out or report a Gateway dependency failure
     - Verify that the MCP pod can resolve and reach the public origin derived
       from ``resourceUrl``, and inspect Gateway and target API health.
   * - Direct in-cluster requests to MCP fail
     - This is expected when NetworkPolicy is enforced. The chart permits
       ingress from this release's Gateway Envoy pods, not arbitrary pods.

Rollback
========

To return to direct mode, disable ``services.mcp.oidcProxy.enabled``, restore
``authorizationServers`` and ``scopes``, and redeploy. Existing proxy sessions
will no longer authenticate; users must configure and log in through the
direct provider. The MCP tool catalog and API-specific permissions do not
change.
