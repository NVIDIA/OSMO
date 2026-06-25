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

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=credential | ref-prefix=cli_reference_credential | flags=argument-anchor

.. code-block:: text

   usage: osmo credential [-h] [--format-type {json,text}]
                          {set,list,delete} ...

.. _cli_reference_credential_positional_arguments:

Positional Arguments
--------------------

``command``
    Possible choices: set, list, delete

.. _cli_reference_credential_named_arguments:

Named Arguments
---------------

``--format-type``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``

Sub-commands
------------

.. _cli_reference_credential_set:

set
~~~

Create or update a credential

.. code-block:: text

   osmo credential set [-h] [--type {REGISTRY,DATA,GENERIC}]
                       (--payload PAYLOAD [PAYLOAD ...] | --payload-file PAYLOAD_FILE [PAYLOAD_FILE ...])
                       name

.. _cli_reference_credential_set_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``name``
    Name of the credential.

.. _cli_reference_credential_set_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--type``
    Possible choices: REGISTRY, DATA, GENERIC

    Type of the credential.

    Default: ``'GENERIC'``

``--payload``
    List of key-value pairs.
    The tabulated information illustrates the mandatory and optional keys for the payload corresponding to each type of credential:

    +-----------------+-------------------------------------+-----------------------------+
    | Credential Type | Mandatory keys                      | Optional keys               |
    +-----------------+-------------------------------------+-----------------------------+
    | REGISTRY        | auth                                | registry, username          |
    +-----------------+-------------------------------------+-----------------------------+
    | DATA            | access_key_id, access_key, endpoint | region (default: us-east-1) |
    +-----------------+-------------------------------------+-----------------------------+
    | GENERIC         |                                     |                             |
    +-----------------+-------------------------------------+-----------------------------+


``--payload-file``
    List of key-value pairs, but the value provided needs to be a path to a file.
    Retrieves the value of the secret from a file.


Ex. osmo credential set registry_cred_name --type REGISTRY --payload registry=your_registry username=your_username auth=xxxxxx 
Ex. osmo credential set data_cred_name --type DATA --payload access_key_id=your_s3_username access_key=xxxxxx endpoint=s3://bucket 
Ex. osmo credential set generic_cred_name --type GENERIC --payload omni_user=your_omni_username omni_pass=xxxxxx 
Ex. osmo credential set generic_cred_name --type GENERIC --payload-file ssh_public_key=<path to file>

.. _cli_reference_credential_list:

list
~~~~

List all credentials

.. code-block:: text

   osmo credential list [-h]


Ex. osmo credential list

.. _cli_reference_credential_delete:

delete
~~~~~~

Delete an existing credential

.. code-block:: text

   osmo credential delete [-h] name

.. _cli_reference_credential_delete_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``name``
    Delete credential with name.


Ex. osmo credential delete omni_cred
