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

Embedded Dex Quickstart
=======================

The unified chart's default development deployment can enable MCP with one
setting:

.. code-block:: bash

   helm upgrade --install osmo deployments/charts/osmo \
     --namespace osmo --create-namespace \
     --set services.mcp.enabled=true \
     --wait --wait-for-jobs --timeout 20m

Use the chart quickstart prerequisites. Add ``--reset-then-reuse-values`` when
upgrading to merge existing overrides with the new chart defaults. Connect a
Streamable HTTP MCP client to
``http://127.0.0.1/mcp``, approve the client, and sign in with the same embedded
Dex account used for the UI. A different ``externalUrl`` produces the matching
``<externalUrl>/mcp`` endpoint. HTTP is supported only for local loopback
origins; use HTTPS for any other public hostname.

When ``authentication.provider`` is ``embeddedDex`` and MCP's
``oidc.configUrl`` is unset, the chart registers ``osmo-mcp`` as a confidential
Dex client and generates a retained ``osmo-embedded-dex-mcp`` Secret. The
bootstrap job manages this credential; it is never stored in Helm values.
The client ID is configurable through
``authentication.embeddedDex.mcpClientId``. MCP uses the release's Valkey and
in-cluster Dex and Gateway endpoints, so it does not call its public loopback
address from inside the pod. Keep Kubernetes Service links enabled on the MCP
Pod (``enableServiceLinks: true``) so it can validate the in-cluster HTTP
Gateway address.

Dex issues opaque access tokens. MCP verifies the signed ID token instead,
checking its issuer and MCP client audience, then forwards that verified token
to the Gateway. The Gateway applies the same OSMO identity, role, and pool
permissions as other clients. The external provider's delegated API scope is
not needed for embedded Dex. Authentication and client consent remain required.

Generated credentials survive Helm upgrades and uninstall. Deleting the MCP
credential Secret and reconciling the release creates a new secret and
restarts its Dex and MCP consumers; users must sign in again. Embedded Dex
stores sessions and signing keys in memory and is intended for development
and evaluation only.

To use a separately managed identity provider only for MCP, set
``services.mcp.oidcProxy.oidc.configUrl``, configure a matching Gateway JWT
provider, and supply the remaining explicit settings below. Leave
``authentication.provider`` set to ``embeddedDex`` to keep browser and CLI
login on embedded Dex.

External OIDC Prerequisites
===========================

Before enabling MCP:

* Publish the Gateway on one HTTPS hostname that the MCP pod can resolve and
  reach. Set ``services.mcp.resourceUrl`` to that origin plus the exact
  ``/mcp`` path; the chart derives the outbound Gateway origin from it.
* In the unified ``osmo`` chart, enable ``planes.control.enabled``.
  Gateway Envoy, OAuth2 Proxy, and authorization are mandatory and cannot be
  disabled. MCP can use its own operator-managed OIDC provider while browser
  and CLI login remain on embedded Dex. Setting
  ``authentication.provider: externalOidc`` switches browser and CLI login for
  the entire release; configure ``authentication.externalOidc`` for that option.
  Supply the public HTTPS endpoint and confidential application for external
  MCP OIDC.
* Configure a matching identity-provider JWT entry under
  ``gateway.envoy.jwt.providers`` or ``gateway.envoy.jwt.additionalProviders``
  and role mappings for the upstream API token. The chart adds the MCP
  audience to the explicit entry matching the configured issuer. Grant users
  the API actions and pool-scoped permissions required by their tools.
  In the ``service`` chart, enable ``gateway.envoy.enabled`` and
  ``gateway.authz.enabled``.
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

Microsoft Entra is the validated external provider profile. Verify this token
contract before using another external OIDC provider.

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

For private-CA Valkey TLS, the unified chart mounts
``externalDependencies.valkey.tls.caExistingSecret`` using ``caKey`` and sets
``SSL_CERT_FILE`` for MCP. Supply a complete PEM trust bundle, including the
public roots needed for outbound OIDC HTTPS connections.

Gateway requests use a separate, explicit TLS configuration and ignore
``SSL_CERT_FILE``. For a private-CA Gateway, set the unified chart's
``services.mcp.gatewayCaFile`` to a complete PEM trust bundle mounted through
``services.mcp.extraVolumeMounts`` and ``services.mcp.pod.extraVolumes``.
Certificate and hostname verification remain enabled. The selected MCP image
must support this Gateway CA setting and Redis-backed readiness.

Use ``services.mcp.oidcProxy.redis.dbNumber`` and ``keyPrefix`` to isolate
proxy state from other Redis users. Replicas share the same storage and client
secret, so ``services.mcp.replicas`` may exceed one. In external OIDC mode, the
chart references externally managed MCP credentials without creating them.

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

For external OIDC, FastMCP requests the full delegated scope plus
``openid profile email offline_access`` upstream. Embedded Dex uses only those
standard OIDC scopes and advertises ``openid`` to MCP clients. The client
discovers its required scope without
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

Check that the resource and issuer use the configured MCP URL,
``client_id_metadata_document_supported`` is ``true``, and
``registration_endpoint`` points to ``/mcp/register``. External OIDC advertises
the delegated API scope; embedded Dex advertises ``openid``. Complete a fresh
login
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
* The unified chart's readiness probe uses ``/health/ready`` to check OAuth
  Redis connectivity with a two-second deadline. It does not validate every
  Redis permission, OAuth operation, or Gateway connection. ``/health`` and
  ``/health/live`` report process health, so Redis outages do not trigger
  liveness restarts. Tool failures alone do not make the pod unhealthy.
* After an identity-provider role assignment changes, have the user log out
  and sign in again to obtain updated claims.

Rotating the client secret invalidates proxy tokens and makes old encrypted
Redis entries unusable, including DCR registrations. Users must sign in
again; DCR clients may need to remove and re-add the MCP entry first. All
replicas must use the new secret.

For the unified chart, update
``services.mcp.oidcProxy.existingSecret.rolloutNonce`` after rotating the
MCP client Secret to restart its consumers. This is separate from the
browser-OAuth Secret's rollout setting.

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
       exist at the configured absolute paths. For ``/health/ready`` failures,
       also check Redis connectivity, credentials, and TLS trust.
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
     - For embedded Dex with ``gateway.envoy.ssl.enabled: false``, check
       reachability of the in-cluster Gateway Service. For external OIDC or
       embedded Dex with Gateway Envoy TLS enabled, check the public Gateway
       origin derived from ``resourceUrl``. Then check Gateway and API health.
   * - Direct in-cluster requests fail
     - With NetworkPolicy enforced, only this release's Gateway Envoy pods may
       reach MCP.
