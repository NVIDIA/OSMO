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

.. _profile:

=============
Setup Profile
=============

Viewing Settings
----------------

You can use the :ref:`Profile List CLI command <cli_reference_profile_list>` to view your current
profile, including bucket and pool defaults.

.. code-block:: bash

  $ osmo profile list
  user:
    name: John Doe
    email: jdoe@nvidia.com
  notifications:
    email: False
    slack: True
  bucket:
    default: my-bucket
  pool:
    default: my-pool
    accessible:
    - my-pool
    - team-pool
  roles:
  - osmo-user
  - osmo-ml-team

Token Expiration
----------------

When using an access token, ``osmo profile list`` shows its expiration date,
``never`` for a Secret-backed credential with no scheduled expiration,
or ``unknown`` when expiration metadata is unavailable (including older servers).
A credential shown as ``never`` can still be rotated or removed. The short-lived
JWT issued at login has its own expiration and is refreshed independently.
The default temporary admin bootstrap token has a scheduled expiration; its
issued JWT expiration is capped at the credential deadline. Gateway validation
allows an additional 60 seconds of clock skew for already-issued sessions.

API clients can request ``GET /api/profile/settings?include_token_expiration=true``
to receive ``token.expiration_status`` as ``scheduled``, ``never``, or ``unknown``.
``expires_at`` remains a timestamp or null; clients that omit this option retain
the existing response shape.

Default Pool
------------

.. auto-include:: ../resource_pools/what_is_a_pool.in.rst

To choose a default pool, use the :ref:`Profile List CLI command <cli_reference_profile_list>` to
view available pools and :ref:`Resource List CLI command <cli_reference_resource_list>` to see what
resources are in each pool.

Set the default pool using the profile CLI.

.. code-block:: bash

  $ osmo profile set pool my_pool
