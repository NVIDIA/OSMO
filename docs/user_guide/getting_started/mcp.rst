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

.. _getting_started_mcp:

===
MCP
===

MCP lets a compatible client use a bounded set of tools against your OSMO
deployment. You sign in with your existing OSMO identity. MCP does not require
the OSMO CLI or the OSMO Agent Skill.

Before You Connect
==================

MCP must be enabled before you connect. If it is unavailable, ask your OSMO
administrator to follow :ref:`MCP deployment <mcp_deployment>`.

Ask your administrator for the MCP URL. It normally has the following form:

.. code-block:: text

   https://<osmo-host>/mcp

You need only this URL and a browser sign-in; there is no client ID, scope
list, or token to configure.

MCP acts on your behalf. Every tool call is authorized with your existing OSMO
roles, API actions, and accessible pools; MCP cannot elevate your access. See
:ref:`mcp_identity_permissions` for details.

Connect a Client
================

The following example uses Codex.
Replace ``osmo.example.com`` with your deployment hostname:

.. code-block:: bash

   $ codex mcp add osmo --url https://osmo.example.com/mcp
   $ codex mcp login osmo

Follow the browser prompts to approve access and sign in with your deployment's
identity provider, then return to the terminal.

Run ``codex mcp list`` to confirm that the entry is configured, then start or
restart Codex so it loads the authenticated server.

For another compatible client, select Streamable HTTP, enter only the MCP URL,
and leave headers, bearer token, client ID, and scopes unset. To use the
endpoint-only flow, the client must support OAuth discovery, PKCE S256, and
either Client ID Metadata Documents (CIMD) or Dynamic Client Registration
(DCR).

Verify Access
=============

First ask the client to perform a caller-bound health check:

.. code-block:: text

   Use only the osmo MCP server to call osmo_health. Do not make any changes.

Then inspect your identity and accessible pools:

.. code-block:: text

   Use only the osmo MCP server to call osmo_get_profile. Do not make any changes.

A successful result confirms the MCP login and the normal OSMO profile access
required by these tools. Other tools can still return ``HTTP 403`` when your
role lacks their API action or when the requested pool is outside your access.

Refresh or Replace a Login
==========================

Your MCP session normally refreshes automatically. Log out and sign
in again after an administrator changes your identity-provider assignment, or
when the session is expired, revoked, or cannot be refreshed:

.. code-block:: bash

   $ codex mcp logout osmo
   $ codex mcp login osmo

Remove and re-add the MCP entry when its URL changes, or when your
administrator asks you to reset the saved registration after a secret rotation:

.. code-block:: bash

   $ codex mcp logout osmo
   $ codex mcp remove osmo
   $ codex mcp add osmo --url https://osmo.example.com/mcp
   $ codex mcp login osmo

Troubleshooting
===============

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Symptom
     - Action
   * - OAuth discovery or registration fails
     - Confirm that the configured URL ends with the exact path ``/mcp``. If
       the error continues, ask the administrator to verify the FastMCP
       metadata and registration routes.
   * - The browser reports ``Approval required``
     - The identity-provider application or delegated MCP scope requires
       administrator approval. This is not an MCP client configuration error.
   * - The browser reports ``AADSTS50011`` or ``AADSTS900971``
     - Ask the administrator to verify that the confidential upstream
       application has the exact ``https://<osmo-host>/mcp/auth/callback`` redirect
       registered for the correct application type.
   * - MCP initialization returns ``HTTP 401``
     - Run ``codex mcp logout osmo`` and ``codex mcp login osmo``. If the error
       continues, contact the administrator.
   * - MCP initialization returns ``HTTP 403``
     - Ask the administrator to verify the advertised and issued MCP resource
       scope.
   * - A tool returns ``HTTP 403``
     - Login succeeded, but the user lacks the API action or pool access needed
       by that tool.
   * - Token refresh reports ``invalid_grant`` or cannot parse the response
     - Log out and authenticate once more. If it repeats, ask the administrator
       to inspect the FastMCP token route, Redis, and the upstream identity
       provider without logging tokens.
   * - Opening ``/mcp`` in a browser returns ``405``
     - This is expected. The endpoint accepts MCP protocol requests from a
       compatible client; it is not a browser page.
   * - Timeout or Gateway dependency error
     - Contact your administrator and refer them to
       :ref:`MCP deployment troubleshooting
       <mcp_deployment_troubleshooting>`.

Use MCP Safely
==============

.. warning::

   An MCP client can retain tool arguments in its transcript or logs,
   including secret values placed in inline workflow or application
   specifications. Use a client and retention policy approved for handling
   secrets. Reference OSMO credentials instead of embedding secrets in YAML.

State-changing tools are not automatically retried. If a write reports a
timeout or another ambiguous failure, inspect the current OSMO state before
retrying it.

For the capability model, permission behavior, and tool boundaries, see
:ref:`mcp_overview`.
