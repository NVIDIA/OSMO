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

MCP lets a compatible client use predefined tools against your OSMO
deployment. You sign in with your existing OSMO identity.

Before You Connect
==================

MCP must be enabled before you connect. If it is unavailable, ask your OSMO
administrator to follow :ref:`MCP deployment <mcp_deployment>`.

.. note::

   This is separate from the Agent Skill described under
   :doc:`Install Client <install/index>`. MCP connects directly to a remote
   HTTPS endpoint and does not require the OSMO CLI or Agent Skill.

Ask your OSMO administrator for:

* The MCP URL, such as ``https://osmo.example.com/mcp``.
* The public OAuth client ID.
* The complete OAuth scope list to request, including any IdP/client scopes.
* Any redirect URI requirements for your identity provider.

MCP acts on your behalf with the same OSMO identity, roles, accessible pools,
and API permissions as the equivalent authenticated CLI request; it cannot
elevate your access. See :ref:`mcp_identity_permissions` for details.

Your role must include ``mcp:Access`` to connect to MCP. Each tool also
requires the normal OSMO permission for its API. For example,
``osmo_get_profile`` requires ``profile:Read``.

Connect Codex
=============

The following example uses Codex. Replace ``osmo.example.com`` and
``<mcp-public-client-id>`` with the values from your administrator.

.. code-block:: bash

   $ codex mcp add osmo \
       --url https://osmo.example.com/mcp \
       --oauth-client-id <mcp-public-client-id>
   $ codex mcp login \
       --scopes '<comma-separated-oauth-scopes>' \
       osmo

The login command starts a browser-based OAuth flow.

Use the exact scopes supplied by your administrator. If permitted by your
identity provider, adding ``offline_access`` lets Codex request a refresh token;
it does not need to be advertised by the MCP resource.

Configure a Fixed Redirect URI
==============================

If your identity provider requires a pre-registered redirect URI, start login
with a temporary callback configuration:

.. code-block:: bash

   $ codex mcp login \
       -c 'mcp_oauth_callback_port=53682' \
       -c 'mcp_oauth_callback_url="http://localhost:53682/oauth/callback"' \
       --scopes '<comma-separated-oauth-scopes>' \
       osmo

Codex appends a server-specific ID to the callback URL. Ask your administrator
to register the exact ``redirect_uri`` shown during login, then run the login
command again. These ``-c`` options apply only to this command.

Verify Access
=============

Ask your MCP client to perform a read-only check:

.. code-block:: text

   Use MCP to call osmo_get_profile. Do not make any changes.

A successful result confirms sign-in, ``mcp:Access``,
``profile:Read``, and the complete request path through OSMO. You can then try
other read-only tools permitted by your role.

Troubleshooting
===============

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Symptom
     - Action
   * - ``HTTP 401``
     - Run the same ``codex mcp login`` variant again with the full
       ``--scopes`` list. If you configured a fixed callback, preserve both
       ``-c`` callback options. If the error continues, contact your OSMO
       administrator.
   * - ``HTTP 403``
     - Ask your administrator to verify ``mcp:Access`` and the OSMO permission
       required by that tool.
   * - Redirect URI mismatch
     - Ask your administrator to register the exact ``redirect_uri`` displayed
       during login.
   * - Timeout or Gateway dependency error
     - Contact your administrator and refer them to
       :ref:`MCP deployment troubleshooting
       <mcp_deployment_troubleshooting>`.

Use MCP Safely
==============

.. warning::

   An MCP client can retain tool arguments in its transcript or logs,
   including credential payloads and inline workflow or application
   specifications. Use a client and retention policy approved for secret
   entry. Reference OSMO credentials instead of embedding secrets in YAML.

State-changing tools are not automatically retried. If a write reports a
timeout or another ambiguous failure, inspect the current OSMO state before
retrying it.

For the capability model, permission behavior, and tool boundaries, see
:ref:`mcp_overview`.
