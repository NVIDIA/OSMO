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

.. _credentials_data:

================================================
Data
================================================

Fetch data credentials
================================================

Operate seamlessly with data from any of the below supported data storage solutions.

.. include:: fetch_credentials.rst

Setup the data credentials
================================================

You must pass your access key ID and access keys to create a credential, so that workflow data can
be stored and retrieved using this credential:

.. code-block:: bash
  :substitutions:

  $ osmo credential set <data_cred_name> --type DATA --payload access_key_id=<access_key_id> access_key=<access_key> endpoint=<endpoint> region=<region>

An example of setting the data credential is shown below:

.. code-block:: bash
  :substitutions:

  $ osmo credential set my_data_cred --type DATA --payload access_key_id=my_id access_key=my_key endpoint=s3://my_bucket region=us-east-1

.. note::

  ``region`` is **optional** for AWS and GCP backends.
