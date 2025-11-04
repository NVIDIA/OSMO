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

.. _cli_reference_credential:

:tocdepth: 3

================================================
osmo credential
================================================

.. code-block::

   usage: osmo credential [-h] [--format-type {json,text}] {set,list,delete} ...

Positional Arguments
====================

:kbd:`command`
   Possible choices: set, list, delete

Named Arguments
===============

--format-type
   Possible choices: json, text

   Specify the output format type (Default text).

   Default: ``'text'``

Sub-commands
============

set
---

Create or update a credential

.. code-block::

   osmo credential set [-h] [--type {REGISTRY,DATA,GENERIC}] (--payload PAYLOAD [PAYLOAD ...] | --payload-file PAYLOAD_FILE [PAYLOAD_FILE ...]) name

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Name of the credential.


Named Arguments
~~~~~~~~~~~~~~~

--type
   Possible choices: REGISTRY, DATA, GENERIC

   Type of the credential.

   Default: ``'GENERIC'``

--payload
   List of key-value pairs.
   The tabulated information illustrates the mandatory and optional keys for the payload corresponding to each type of credential:

   +-----------------+---------------------------+---------------------------------------+
   | Credential Type | Mandatory keys            | Optional keys                         |
   +-----------------+---------------------------+---------------------------------------+
   | REGISTRY        | auth                      | registry, username                    |
   +-----------------+---------------------------+---------------------------------------+
   | DATA            | access_key_id, access_key | endpoint, region (default: us-east-1) |
   +-----------------+---------------------------+---------------------------------------+
   | GENERIC         |                           |                                       |
   +-----------------+---------------------------+---------------------------------------+



--payload-file
   List of key-value pairs, but the value provided needs to be a path to a file.
   Retrieves the value of the secret from a file.


list
----

List all credentials

.. code-block::

   osmo credential list [-h]


delete
------

Delete an existing credential

.. code-block::

   osmo credential delete [-h] name

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Delete credential with name.
