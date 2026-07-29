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
service. It uses the existing OSMO Gateway and does not require a separate
chart or load balancer. When enabled, the chart creates the MCP Deployment,
ClusterIP Service, Gateway routes, protected-resource metadata, and an ingress
NetworkPolicy for this release's Gateway Envoy pods.

Identity and Permissions
========================

MCP acts on behalf of the signed-in user and has the same effective OSMO
identity, roles, accessible pools, and API permissions as the equivalent
authenticated CLI request. It does not assume a service identity or elevate
access. MCP relays the caller's bearer token unchanged rather than performing
an OAuth token exchange. See :ref:`mcp_identity_permissions` for the complete
permission model.

Before You Enable MCP
=====================

* Keep ``gateway.envoy.enabled`` and ``gateway.authz.enabled`` set to ``true``.
* Configure at least one ``gateway.envoy.jwt.providers`` entry for the token
  used by the MCP client. Match the token's actual issuer and audience, and
  ensure its claims or mappings resolve to an OSMO user and role.
* Register a public/native OAuth client for MCP client sign-in. Enable the
  authorization-code flow with PKCE using ``S256``, register the exact client
  callback URI, and do not create or distribute a client secret.
* Grant the public client the delegated scope for the MCP resource.
* Ensure that the public OSMO hostname resolves to this release's Gateway over
  HTTPS. The MCP pod must also be able to resolve and reach that hostname.
* Add ``mcp:Access`` and the required tool permissions to the OSMO roles that
  can use MCP. The default ``osmo-user`` role already includes
  ``mcp:Access``; custom roles might not.

Configure MCP
=============

Add the following values to ``osmo_values.yaml``:

.. code-block:: yaml

   services:
     mcp:
       enabled: true
       resourceUrl: https://<your-domain>/mcp
       authorizationServers:
       - <idp-issuer-url>
       scopes:
       - <delegated-mcp-scope>
       requestTimeoutSeconds: 10
       # Browser-hosted clients only:
       # allowedOrigins:
       # - https://<mcp-client-origin>

``resourceUrl`` must be the public HTTPS URL ending in exact ``/mcp``.
``authorizationServers`` contains OAuth or OIDC issuer identifiers, not
authorize or token endpoints. ``scopes`` contains the MCP resource scopes
advertised to clients. The complete client scope list can also contain
identity-provider scopes such as ``openid``, ``profile``, ``email``, or
``offline_access``.

The public client ID is not a Helm value and is not necessarily the access
token audience. Configure the Gateway JWT provider from the token's actual
issuer and audience. Native clients such as Codex normally omit the ``Origin``
header and do not need ``allowedOrigins``.

See the `MCP sign-in requirements
<https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>`_
for sign-in discovery, PKCE, and redirect URI requirements.

Deploy or Upgrade
=================

Save ``osmo_values.yaml``, then use the normal OSMO service install or upgrade
in :ref:`Step 5: Deploy Components <deploy_service_deploy_components>`. MCP is
included in that Helm release when ``services.mcp.enabled`` is ``true``.

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

Confirm that the NetworkPolicy named
``<services.mcp.serviceName>-allow-gateway-envoy`` is present. With the default
service name, it is ``osmo-mcp-allow-gateway-envoy``.

After DNS is configured, verify the public protected-resource metadata:

.. code-block:: bash

   $ curl --fail --silent --show-error \
       https://<your-domain>/.well-known/oauth-protected-resource/mcp

Confirm that the response contains the expected ``resource``,
``authorization_servers``, and ``scopes_supported`` values. This confirms the
deployment and client discovery configuration. User access is verified after
the user connects.

Provide Connection Details
==========================

Give users:

* The MCP URL from ``services.mcp.resourceUrl``.
* The non-secret public OAuth client ID.
* The complete OAuth scope list, including any required identity-provider
  scopes.
* The client-specific redirect URI requirements.

Direct users to :ref:`getting_started_mcp` to connect and run the read-only
verification. If a client reveals its exact callback URI only during sign-in,
register that URI and have the user repeat the sign-in.

.. _mcp_deployment_troubleshooting:

Troubleshooting
===============

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Symptom
     - Action
   * - Metadata returns ``404`` or unexpected values
     - Verify that ``services.mcp.enabled`` is ``true``, DNS points to this
       release's Gateway, and the resource URL, issuer, and scopes match the
       expected values.
   * - Sign-in succeeds but MCP returns ``HTTP 401``
     - Verify that the token's issuer and audience match a
       ``gateway.envoy.jwt.providers`` entry.
   * - A tool returns ``HTTP 403``
     - Verify that the user's OSMO role contains ``mcp:Access`` and the normal
       API permission required by the tool.
   * - Tools time out or report a Gateway dependency failure
     - Verify that ``services.mcp.resourceUrl`` ends in exact ``/mcp`` and that
       the MCP pod can resolve and reach its public Gateway origin.
   * - Direct in-cluster requests to MCP fail
     - This is expected when NetworkPolicy is enforced. The chart permits
       ingress from this release's Gateway Envoy pods, not arbitrary pods.
