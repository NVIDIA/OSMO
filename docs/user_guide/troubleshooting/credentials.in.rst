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

.. _troubleshooting_credentials:

Credentials
===========

Below are some common errors you might run into when using the credential CLI. Please follow the
suggested steps to troubleshoot. Please also refer to :ref:`credentials` for more information

Could not connect to the endpoint URL
-------------------------------------

.. code-block:: bash
  :class: no-copybutton

  client [ERROR] common: Server responded with status code 400
  Data validation failed with error: Could not connect to the endpoint URL: "{your_data_endpoint_url}"

Please confirm if the data endpoint URL is valid

Extra fields not permitted
-------------------------------------

.. code-block:: bash
  :class: no-copybutton

  client [ERROR] common: Server responded with status code 422
  {'detail': [{'loc': ['body', 'xxxx_credential', 'xxx'], 'msg': 'extra fields not permitted', 'type': 'value_error.extra'}]}

Please make sure you don’t provide extra field when setting credentials with payload. The
tabulated information illustrates the keys that are compulsory and those that are optional
for the payload corresponding to each type of credential.

SignatureDoesNotMatch
-------------------------------------

.. code-block:: bash
  :class: no-copybutton

  client [ERROR] common: Server responded with status code 400
  Data validation failed with error: An error occurred (SignatureDoesNotMatch) when calling the ListBuckets operation: The request signature we calculated does not match the signature you provided. Check your key and signing method.

Please check if you access_key_id and access_key are valid.

AuthorizationHeaderMalformed
-------------------------------------

.. code-block:: bash
  :class: no-copybutton

  client [ERROR] common: Server responded with status code 400
  Data validation failed with error: An error occurred (AuthorizationHeaderMalformed) when calling the ListBuckets operation: The authorization header is malformed; the region 'us-east-3' is wrong; expecting 'us-east-1'

Please correct the region based on the suggestion.

Max retries exceeded with url
-------------------------------------

.. code-block:: bash
  :class: no-copybutton

  client [ERROR] common: Server responded with status code 400
  Registry connection error for https://your_registry/v2/:
  HTTPSConnectionPool(host='your_registry', port=443): Max retries exceeded with url: /v2/ (Caused by NewConnectionError('<urllib3.connection.HTTPSConnection object at 0x7fe07c119e40>: Failed to establish a new connection: [Errno -2] Name or service not known'))

Please check if your registry is valid.

Registry authentication failed
-------------------------------------

.. code-block:: bash
  :class: no-copybutton

  client [ERROR] common: Server responded with status code 400
  Registry authentication failed.

Please check if you registry username and auth is valid.

Duplicate key value
-------------------------------------

.. code-block:: bash
  :class: no-copybutton

  client [ERROR] common: Server responded with status code 400
  {'message': ' duplicate key value violates unique constraint "credential_pkey"\nDETAIL:  Key (user_name, cred_name)=(your_user_name, your_cred_name) already exists.\n', 'error_code': 'USER'}

Please rename your credential or delete it with ``$ osmo credential delete <your_cred_name>``
and then reset it.
