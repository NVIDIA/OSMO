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

:tocdepth: 3

.. _cli_reference_login:

================================================
osmo login
================================================

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=login | ref-prefix=cli_reference_login | flags=argument-anchor

.. code-block:: text

   [1;34musage: [0m[1;35mosmo login[0m [[32m-h[0m] [[36m--device-endpoint [33mDEVICE_ENDPOINT[0m]
                     [[36m--method [33m{code,password,token,dev}[0m]
                     [[36m--username [33mUSERNAME[0m] [[36m--password [33mPASSWORD[0m |
                     [36m--password-file [33mPASSWORD_FILE[0m] [[36m--token [33mTOKEN[0m |
                     [36m--token-file [33mTOKEN_FILE[0m]
                     [32m[url][0m

.. _cli_reference_login_positional_arguments:

Positional Arguments
--------------------

``url``
    The url of the osmo server to connect to. If not provided, uses the last used url.

.. _cli_reference_login_named_arguments:

Named Arguments
---------------

``--device-endpoint``
    The url to use to completed device flow authentication. If not provided, it will be fetched from the service.

``--method``
    Possible choices: code, password, token, dev

    code: Get a device code and url to log in securely through browser. password: Provide username and password directly through CLI. token: Read an idToken directly from a file.

    Default: ``'code'``

``--username``
    Username if logging in with credentials. This should only be used for service accounts that cannot authenticate via web browser.

``--password``
    Password if logging in with credentials.

``--password-file``
    File containing password if logging in with credentials.

``--token``
    Token if logging in with credentials.

``--token-file``
    File containing the refresh token.
