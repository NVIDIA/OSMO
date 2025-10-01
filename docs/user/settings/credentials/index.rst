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

.. _credentials:

================================================
Credentials
================================================

Credentials are secrets required to run workflows or perform data operations in OSMO.

.. code-block:: bash

  $ osmo credential -h
  usage: osmo credential [-h] [--format-type {json,text}] {set,list,delete} ...

  positional arguments:
    {set,list,delete}
      set                 Create or update a credential
      list                List all credentials
      delete              Delete an existing credential

  options:
    -h, --help            show this help message and exit
    --format-type {json,text}
                          Specify the output format type (Default text).

The following types of credentials are supported:

* **Registry**  - where the containers are stored
* **Data**      - where workflow data is stored
* **Generic**   - where generic key value pairs are stored & de-referenced in the workflows

To run any form of workflow, you must host the Docker containers on a registry. If the workflow depends on input data to start or outputs any data that has to be stored, a data credential is required.

To store your credentials:

.. code-block:: bash

  $ osmo credential set <cred_name> --type .....

List all your credentials:

.. code-block:: bash

  $ osmo credential list
  Name                            Type       Profile        Local
  ===============================================================
  s3_cred                         DATA       s3://bucket1   Yes
  s3_cred_2                       DATA       s3://bucket2   No
  github_cred                     REGISTRY   github.io      N/A
  generic_cred_name               GENERIC    None           N/A

In the example above, ``s3_cred`` has the ``Local`` column value ``Yes`` while ``s3_cred_2`` has
value ``No``. This value refers to whether that credential is stored on your current machine.
The credential still exists in OSMO to be used in a workflow, but may not be stored locally if you
have switched devices. If the credential is not local, then you will not be able to run
dataset operations against that profile locally. To be able to use the credential locally,
you will need to set the data credential again.

Delete your credential one at a time:

.. code-block:: bash

  $ osmo credential delete <cred_name>

To update an existing credential, you must delete it and set it again:

.. code-block:: bash

  $ osmo credential delete <cred_name>
  $ osmo credential set <cred_name> --type .....

.. toctree::
  :hidden:

  registry
  data
  generic
