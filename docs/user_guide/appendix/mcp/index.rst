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

.. _mcp_overview:

===
MCP
===

MCP is an optional, self-hosted
`Model Context Protocol <https://modelcontextprotocol.io/>`_ service for OSMO
deployments. It gives compatible AI clients a structured way to inspect and
operate an OSMO deployment over HTTPS.

MCP exposes a curated set of OSMO operations. It does not replace the OSMO CLI.

.. important::

   MCP must be enabled by the administrator of your OSMO deployment. There is
   no universal MCP URL; the endpoint normally has the form
   ``https://<osmo-host>/mcp``.

   To connect a client, see :ref:`getting_started_mcp`.

.. _mcp_identity_permissions:

Identity and Permissions
========================

MCP uses the signed-in user's existing OSMO access. Users have the same roles,
accessible pools, and API permissions as when they use OSMO through the CLI.
MCP does not grant additional access or elevate permissions.

Authentication depends on the deployment mode:

* In the recommended OIDC proxy mode, the user configures only the MCP URL.
  FastMCP handles OAuth discovery, client identification with Client ID
  Metadata Documents (CIMD) or registration with Dynamic Client Registration
  (DCR), Proof Key for Code Exchange (PKCE), browser sign-in, token exchange,
  and refresh inside the existing MCP process.
* Every tool maps to a fixed OSMO API method and route. Tool input cannot select
  an alternate server, route, method, identity, token, or HTTP headers.
* Results are validated and bounded. Long logs or specifications can return a
  marked truncated prefix.
* Tool annotations distinguish read-only operations from state-changing and
  destructive operations.
* Workflow submission and restart consume real compute. Cancellation and
  deletion might not be reversible.
* State-changing operations are not automatically retried. If an error leaves
  the result uncertain, inspect OSMO state before retrying.
* Workflow validation is not completely side-effect free: a failed validation
  can create a ``FAILED_SUBMISSION`` record.
* Credential tools never accept or return secret payloads. Mutation responses
  do not echo newly submitted specifications, and MCP does not log them. Read
  tools can return bounded, redacted stored specifications. The calling client
  can retain mutation arguments in its transcript or logs, so reference OSMO
  credentials instead of embedding secrets in workflow or application YAML.
* Application descriptions can appear in service access logs and must not
  contain secrets.
* Workflow label overrides can appear in service access logs and must not
  contain secrets.

Capabilities Not Exposed
========================

The self-hosted MCP does not expose:

* OSMO CLI login, logout, or OSMO access-token management as MCP tools (the
  calling client can still manage its own MCP OAuth session);
* credential creation or replacement;
* local file expansion or data upload and download;
* workflow exec, port forwarding, or rsync;
* privileged user, backend, role, or service-configuration administration; or
* arbitrary access to OSMO REST routes.

Use the :ref:`CLI Reference <cli_reference>` or the OSMO Agent Skill when one
of these capabilities is required.

.. seealso::

   * :ref:`getting_started_mcp` for client configuration and connection
     verification.
   * :doc:`Install Client <../../getting_started/install/index>` for the OSMO
     CLI and Agent Skill.
   * :ref:`mcp_deployment` for enabling MCP in a self-hosted OSMO
     deployment.
