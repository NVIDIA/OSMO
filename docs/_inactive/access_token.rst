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

If you want to automate logging into OSMO and perform actions on behalf of a yourself, you can
create an **access token**.

.. warning::

  The access token can only be used with the CLI. Functionality with the UI is not supported.

Creating an Access Token
------------------------

You can use the :ref:`Token Set CLI command <cli_reference_token_set>` to create an access token.

By default, the token will be created with only the user role which does not allow you to submit,
exec, or port-forward workflows.

If you want to submit, exec, or port-forward workflows, you need to create a service access token
with the proper pool roles.

If you have administrative access, you can specify to create a service access token and the roles
you want to assign to the token.

.. note::

  Assigning roles to user access tokens is not supported.

Once you have the token, you can use it to :ref:`login to OSMO <cli_reference_login>` with the
``--method token`` and ``--token`` arguments.

You can verify that you are logged in with the token and its properties are by using the
:ref:`Profile List CLI command <cli_reference_profile_list>`.

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

Listing Access Tokens
------------------------

You can use the :ref:`Token List CLI command <cli_reference_token_list>` to
list all your access tokens.

Deleting an Access Token
------------------------

You can use the :ref:`Token Delete CLI command <cli_reference_token_delete>` to
delete an access token.
