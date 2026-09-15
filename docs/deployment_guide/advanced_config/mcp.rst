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

The unified ``osmo`` Helm chart supports MCP as an optional control-plane
feature. The ``service`` chart also supports it, with the Redis differences
described below. Enabling MCP creates a Deployment, a ClusterIP Service,
Gateway routes, and an ingress NetworkPolicy. Authentication is mandatory:
FastMCP's OIDC proxy runs in the MCP process and relays each user's verified
upstream token to the Gateway for normal API authorization.

This guide covers setup and operations. Give users the MCP URL and refer them
to :ref:`getting_started_mcp` for client setup. See
:ref:`mcp_identity_permissions` for the API actions each tool requires.

Prerequisites
=============

Before enabling MCP:

* Publish the Gateway on one HTTPS hostname that the MCP pod can resolve and
  reach. Set ``services.mcp.resourceUrl`` to that origin plus the exact
  ``/mcp`` path; the chart derives the outbound Gateway origin from it.
* In the unified ``osmo`` chart, enable ``planes.control.enabled``.
  For either chart, keep ``gateway.envoy.enabled`` and
  ``gateway.authz.enabled`` set to ``true``. The development quickstart does
  not provision the public HTTPS endpoint or confidential application needed
  for MCP.
* Configure a matching identity-provider JWT entry under
  ``gateway.envoy.jwt.providers``
  and role mappings for the upstream API token. The chart adds the MCP
  audience to the explicit entry matching the configured issuer. Grant users
  the API actions and pool-scoped permissions required by their tools.
* Provide shared Redis or Valkey storage and externally managed credentials.
  Keep MCP's ingress NetworkPolicy enforced by the cluster CNI; another policy
  selecting the same pod must not grant broader ingress.

Register the OIDC Application
=============================

Configure one confidential application in the identity provider with:

* Application ID URI: ``https://<osmo-host>/mcp``.
* Web redirect URL: ``https://<osmo-host>/mcp/auth/callback``.
* Authorization code flow with ``client_secret_post`` token authentication.
* Delegated API scope: ``https://<osmo-host>/mcp/access_as_user``.
* The intended user or group assignments and administrator consent.

The upstream API token must be an RS256 JWT with that audience and the short
``access_as_user`` value in its ``scp`` claim. MCP reads the issuer and JWKS
URL from OIDC discovery. Set ``oidc.accessTokenIssuer`` only when access
tokens use a different issuer, as Entra applications issuing v1-format tokens
do. The Gateway must validate the same token and resolve its OSMO identity and
roles. The delegated scope permits MCP access; it grants no additional OSMO
API or pool permissions.

Microsoft Entra is the validated provider profile. Verify this token contract
before using another OIDC provider.

.. important::

   Each hostname needs its exact audience and callback registered. Prefer a
   separate application for a new environment; inspect all consumers before
   changing a shared application's identifier URIs or redirect URIs.

   The registered upstream callback belongs to the deployment. Native clients
   receive a later redirect to their own temporary loopback URL. MCP accepts
   only loopback client redirects; administrators do not register those with
   the upstream identity provider.

Configure Credentials and Helm Values
======================================

Store the OIDC client secret in an existing Kubernetes Secret or inject it
through your secret manager. Never put client secrets, Redis passwords,
authorization codes, access tokens, or refresh tokens in Helm values, Git, or
logs. MCP requires a client secret of at least 32 characters because its
proxy-token signing and Redis encryption keys derive from that secret.

Layer this minimal MCP overlay onto your configured OSMO release:

.. code-block:: yaml

   services:
     mcp:
       enabled: true
       resourceUrl: https://osmo.example.com/mcp
       oidcProxy:
         oidc:
           configUrl: https://idp.example.com/.well-known/openid-configuration
           clientId: <confidential-oidc-client-id>
         existingSecret:
           name: osmo-mcp-oidc

The existing Secret must be in the Helm release namespace and contain
``client-secret`` by default. The default mount is
``/etc/osmo/mcp-auth/client-secret``; the chart derives the mounted path.
Change ``existingSecret.clientSecretKey`` if the Secret uses another key,
or ``existingSecret.mountPath`` for another mount directory. When a secret
manager supplies the file directly, omit ``existingSecret.name`` and set
``oidc.clientSecretFile`` to its mounted absolute path.

Redis connection and password sources follow the selected chart:

.. list-table::
   :header-rows: 1
   :widths: 22 78

   * - Chart
     - Redis or Valkey settings
   * - ``osmo``
     - Connection settings come from ``embeddedDependencies.valkey`` or
       ``externalDependencies.valkey``. The chart mounts the password from
       ``secrets.valkey`` automatically, using ``secrets.valkey.keys.password``.
       Set ``oidcProxy.existingSecret.redisPasswordKey`` to use a password key
       in the OIDC Secret instead. This chart does not use
       ``oidcProxy.redis.passwordFile``.
   * - ``service``
     - Host, port, and TLS come from ``services.redis``. If Redis requires a
       password, name ``oidcProxy.existingSecret.redisPasswordKey`` in the
       OIDC Secret. A mounted ``oidcProxy.redis.passwordFile`` is used only
       when ``existingSecret.name`` is unset and the OIDC client secret is
       also supplied as a mounted file.

Use ``services.mcp.oidcProxy.redis.dbNumber`` and ``keyPrefix`` to isolate
proxy state from other Redis users. Replicas share the same storage and client
secret, so ``services.mcp.replicas`` may exceed one. The chart references
externally managed MCP credentials without creating them.

Native clients normally omit ``Origin``. If a compatible client sends a
browser origin, permit it through ``services.mcp.allowedOrigins``. This
setting does not expand the loopback-only client redirect policy.

OAuth and Gateway Routing
=========================

The MCP URL is also the OAuth issuer. The main login and token-exchange
endpoints are:

.. code-block:: text

   GET  /.well-known/oauth-protected-resource/mcp
   GET  /.well-known/oauth-authorization-server/mcp
   GET  /mcp/authorize
   POST /mcp/authorize
   GET  /mcp/auth/callback
   POST /mcp/register
   POST /mcp/token
   GET  /mcp/consent
   POST /mcp/consent

Gateway forwards the MCP and OAuth endpoints to the MCP process without
Gateway JWT or semantic authorization. Process health endpoints remain private.
FastMCP authenticates ``POST /mcp``. Every resulting ``/api`` call re-enters
the Gateway with the verified upstream token and receives normal JWT,
API-action, and pool authorization checks.

The unified chart matches the supported OAuth paths and methods explicitly;
unknown ``/mcp/`` paths and unsupported OAuth methods return ``404``.
The service chart forwards the ``/mcp/`` prefix to FastMCP while blocking
public health paths. Both publish the same login and token-exchange flow.

The client discovers the metadata, identifies itself through Client ID
Metadata Documents (CIMD) or Dynamic Client Registration (DCR), and starts a
consent and browser sign-in flow. The identity provider returns to
``/mcp/auth/callback``. FastMCP stores the upstream tokens encrypted in Redis
and returns an authorization code to the client's loopback URL. The client
exchanges that code and its Proof Key for Code Exchange (PKCE) verifier at
``/mcp/token`` for a resource token.

FastMCP requests the full delegated scope plus ``openid profile email
offline_access`` upstream. The client discovers its required scope without
manual configuration. ``offline_access`` allows session refresh without
granting additional OSMO permissions. Proxy access tokens default to 600
seconds; ``refreshTokenTtlSeconds`` is a fallback when the upstream provider
omits refresh-token expiry.

Deploy and Verify
=================

Apply the overlay through the normal install or upgrade of your chosen chart.
For the service chart, see
:ref:`Step 5: Deploy Components <deploy_service_deploy_components>`.
Verify the MCP resources in the release namespace:

.. code-block:: bash

   $ kubectl rollout status deployment \
       -l app.kubernetes.io/component=mcp -n osmo
   $ kubectl get deployment,service,networkpolicy \
       -l app.kubernetes.io/component=mcp -n osmo

Confirm that the NetworkPolicy allows ingress only from this release's
Gateway Envoy pods. Then inspect both discovery documents:

.. code-block:: bash

   $ curl --fail --silent --show-error \
       https://osmo.example.com/.well-known/oauth-protected-resource/mcp
   $ curl --fail --silent --show-error \
       https://osmo.example.com/.well-known/oauth-authorization-server/mcp

Check that the resource, issuer, and delegated scope use the configured MCP
URL, ``client_id_metadata_document_supported`` is ``true``, and
``registration_endpoint`` points to ``/mcp/register``. Complete a fresh login
and run the read-only verification in :ref:`getting_started_mcp`.
Also confirm that a restricted user's tool call is denied when its API action
or target pool is outside that user's permissions.

Before promoting a deployment, verify CIMD and DCR clients, token expiry and
refresh, restart recovery, and client-secret rotation using disposable client
registrations. These checks exercise identity-provider and Redis behavior
that readiness and process health probes do not cover.

Operations and Rollback
=======================

* Monitor metadata, registration, authorization, callback, token, refresh,
  consent, Redis, and upstream identity-provider outcomes without recording
  credential or identity payloads.
* Keep FastMCP's CIMD URL validation and server-side request forgery (SSRF)
  protections enabled; metadata fetches use client-controlled HTTPS URLs.
* Add ingress or Gateway rate limits to the public OAuth routes, especially
  ``POST /mcp/register`` and ``POST /mcp/token``. Choose a trusted client-IP
  source and limits that do not let one caller block all users' logins.
* The ``/health``, ``/health/live``, and ``/health/ready`` endpoints report
  process health. They do not validate Redis connectivity, OAuth operations,
  or Gateway connections. Tool failures alone do not make the pod unhealthy.
* After an identity-provider role assignment changes, have the user log out
  and sign in again to obtain updated claims.

Rotating the client secret invalidates proxy tokens and makes old encrypted
Redis entries unusable, including DCR registrations. Users must sign in
again; DCR clients may need to remove and re-add the MCP entry first. All
replicas must use the new secret.

Restart every MCP pod after rotating the client Secret so all replicas load
the new value.

To disable MCP, set ``services.mcp.enabled`` to ``false`` and redeploy.
Clients lose the endpoint; other OSMO routes are unaffected.

.. _mcp_deployment_troubleshooting:

Troubleshooting
===============

.. list-table::
   :header-rows: 1
   :widths: 32 68

   * - Symptom
     - Action
   * - Discovery returns ``404`` or unexpected values
     - Verify MCP is enabled, DNS reaches this release's Gateway, and
       ``resourceUrl`` ends with the exact path ``/mcp``.
   * - Pod does not become ready
     - Inspect configuration and credential-file errors. Required files must
       exist at the configured absolute paths. Process readiness alone does
       not verify Redis connectivity, credentials, or TLS trust.
   * - Browser reports a redirect mismatch
     - Register the exact ``https://<osmo-host>/mcp/auth/callback`` URL on the
       confidential application's Web platform.
   * - Browser reports ``Approval required``
     - Verify administrator consent and user or group assignments for the
       application and delegated scope.
   * - Login or refresh fails
     - Check Redis connectivity, discovery, secret validity, upstream token
       responses, and the expected issuer, audience and scope. Never log tokens.
   * - MCP initialization returns ``HTTP 401``
     - Have the user authenticate again; inspect proxy token and session state
       if it persists.
   * - MCP initialization returns ``HTTP 403``
     - Check the advertised delegated scope and the issued resource token's scope.
   * - A tool returns ``HTTP 403``
     - Verify the user's API action and pool access for that tool.
   * - Tools time out or report a Gateway dependency failure
     - Check reachability of the public Gateway origin derived from
       ``resourceUrl``, then Gateway and API health.
   * - Direct in-cluster requests fail
     - With NetworkPolicy enforced, only this release's Gateway Envoy pods may
       reach MCP.
