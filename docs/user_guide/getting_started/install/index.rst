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

.. _cli_install:

==============
Install Client
==============

GitHub
------

.. important::

   Please visit the `GitHub Releases <https://github.com/NVIDIA/osmo/releases>`_ page to
   download the latest release version of the OSMO client.


Web Service
-----------

.. important::

    If you are using an existing OSMO web service, follow the instructions
    below to install the client that is compatible with your OSMO web service.

Download the installation script and install the client:

.. code-block:: bash
  :substitutions:

  $ curl -fsSL |osmo_client_install_url| | bash  # (1)

.. code-annotations::

  (1) Replace |osmo_client_install_url| with the URL of your OSMO web service.

Login
-----

To login to the client, can use the following command:

.. code-block:: bash
  :substitutions:

  $ osmo login |osmo_url|  # (1)

.. code-annotations::

  (1) Replace |osmo_url| with the URL of your OSMO web service.

After running the command above, you will be prompted to authenticate with the following message:

.. code-block:: bash
  :class: no-copybutton
  :substitutions:

  Visit |osmo_auth_url|/realms/osmo/device?user_code=HIIV-ECOD and complete authentication.


Follow the prompts that lead to the browser based OIDC authentication.

.. image:: login1.png
  :alt: Alternative text

Grant access for OSMO application to authenticate you.

.. image:: login2.png
  :alt: Alternative text

After successful authentication, you are logged in. Welcome to OSMO.

.. image:: login3.png
  :alt: Alternative text

.. code-block:: bash
  :class: no-copybutton

  Successfully logged in. Welcome <Your Full Name>.


================================================
Uninstall
================================================

To uninstall the client, run the following command:

.. code-block:: bash

  $ sudo rm -rf /usr/local/bin/osmo /usr/local/osmo
