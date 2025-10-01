..
  SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

.. _access_token:

================================================
Access Tokens
================================================


Creating an Access Token
------------------------

.. code-block:: bash

  $ osmo token set -h
  usage: osmo token set [-h] [--expires-at EXPIRES_AT] [--description DESCRIPTION] [--service] [--roles ROLES [ROLES ...]] [--format-type {json,text}] name

  positional arguments:
    name                  Name of the token.

  options:
    -h, --help            show this help message and exit
    --expires-at EXPIRES_AT, -e EXPIRES_AT
                          Expiration date of the token. The date is based on UTC time. Format: YYYY-MM-DD
    --description DESCRIPTION, -d DESCRIPTION
                          Description of the token.
    --service, -s         Create a service token.
    --roles ROLES [ROLES ...], -r ROLES [ROLES ...]
                          Roles for the token. Only applicable for service tokens.
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).

  Ex. osmo token set my-token --expires-at 2026-05-01 --description "My token description"

.. note::

  Assigning roles to personal tokens is not supported.

.. note::

  Workflow submissions are **NOT** supported with personal access tokens.

An Example output is:

.. code-block:: bash

  $ osmo token set --expires-at 2026-05-01 --description "My Token" my-token
  Note: Save the token in a secure location as it will not be shown again
  Access token: <token to be used to login to OSMO>

Once you have the token, you can use it to login to OSMO.

.. code-block:: bash
  :substitutions:

  $ osmo login |osmo_url| --method token --token <token>

Listing Access Tokens
------------------------

.. code-block:: bash

  $ osmo token list -h
  usage: osmo token list [-h] [--service] [--format-type {json,text}]

  options:
    -h, --help            show this help message and exit
    --service, -s         List all service tokens.
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).

  Ex. osmo token list

An Example output is:

.. code-block:: bash

  $ osmo token list
  Name               Description             Roles    Active    Expires At (UTC)
  =====================================================================
  my-token           My access token         user     Active    2026-02-23
  my-second-token    My second access token  user     Expired   2025-02-23

Deleting an Access Token
------------------------

.. code-block:: bash

  $ osmo token delete -h
  usage: osmo token delete [-h] [--service] name

  positional arguments:
    name           Name of the token.

  options:
    -h, --help     show this help message and exit
    --service, -s  Delete a service token.

  Ex. osmo token delete my-token

An Example output is:

.. code-block:: bash

  $ osmo token delete my-token
  Access token my-token deleted


Knowing Access Token Information
--------------------------------

To figure out the information about an access token when logged in with the token,
you can use ``osmo profile list``.

.. code-block:: bash

  $ osmo profile list
  user:
    email: testuser
  notifications:
    email: False
    slack: True
  bucket:
    default: osmo
  pool:
    default: my_pool
    accessible:
    - my_pool
  token roles:
    name: my-token
    expires_at: XXXX-XX-XX
    roles: user

When trying to access an api you don't have access to, you will get a 403 error.

.. code-block:: bash

  $ osmo token list --service
  2025-05-13T10:27:00+0000 client [ERROR] client: Server responded with status code 403
