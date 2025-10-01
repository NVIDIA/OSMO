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

.. _install:

================================================
Install Client
================================================


Download the installation script and install the client:

.. code-block:: bash
  :substitutions:

  $ curl -fsSL |osmo_client_install_url| | bash

After running the command above, you will be prompted to authenticate with the following message:

.. code-block:: bash
  :substitutions:

  Installation complete. Logging in...
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

.. note::

  To install the client in non-interactive mode, use the following command:

  .. code-block:: bash
    :substitutions:

    $ curl -fsSL |osmo_client_install_url| | sudo bash -s -- -y

Login
------

CLI
~~~~

To login to the client, can use the following command:

.. code-block:: bash
  :substitutions:

  $ osmo login |osmo_url|

  Successfully logged in. Welcome <Your ID>.

UI
~~~~

To login to the UI, go to the login page |osmo_url| and login to Keycloak:

Logout
------

CLI
~~~~

To logout from the client, can use the following command:

.. code-block:: bash

  $ osmo logout

  Successfully logged out.

.. _logout_ui:

UI
~~~~

To logout from the UI, click the sign out button and logout from Keycloak:

.. image:: ui_sign_out.png
  :width: 400

.. image:: ui_sign_out2.png
  :width: 1100

Update
------

Some client updates are optional and some are mandatory. The client will let you know when it is time to update.

.. code-block:: bash

  $ osmo dataset list

  2023-04-21T16:02:33-0700 client [ERROR] common: Server responded with status code 400
  {'message': "Your client is out of date. Client version is 1.0.0 but the service's version 1.1.0 ."}

To update the client, rerun the install command:

.. code-block:: bash
  :substitutions:

  $ curl -fsSL |osmo_client_install_url| | bash
