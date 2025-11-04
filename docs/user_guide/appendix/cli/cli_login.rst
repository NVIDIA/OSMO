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

.. _cli_reference_login:

:tocdepth: 3

================================================
osmo login
================================================

.. code-block::

   usage: osmo login [-h] [--device-endpoint DEVICE_ENDPOINT] [--method {code,password,token,dev}] [--username USERNAME]
                  [--password PASSWORD | --password-file PASSWORD_FILE] [--token TOKEN | --token-file TOKEN_FILE]
                  url

Positional Arguments
====================

:kbd:`url`
   The url of the osmo server to connect to


Named Arguments
===============

--device-endpoint
   The url to use to completed device flow authentication. If not provided, it will be fetched from the service.

--method
   Possible choices: code, password, token, dev

   code: Get a device code and url to log in securely through browser. password: Provide username and password directly through CLI. token: Read an idToken directly from a file.

   Default: ``'code'``

--username
   Username if logging in with credentials. This should only be used for service accounts that cannot authenticate via web browser.

--password
   Password if logging in with credentials.

--password-file
   File containing password if logging in with credentials.

--token
   Token if logging in with credentials.

--token-file
   File containing the refresh token URL, with all parameters appended.
