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

.. _troubleshooting_dataset:

Dataset
================================================

Below are some common errors you might run into when using the dataset CLI. Please follow the
suggested steps to troubleshoot. Please also refer to :ref:`credentials_data` or :ref:`concepts_ds`
for more information

Validation error
----------------

.. code-block:: bash
  :class: no-copybutton

  Data upload failed with error:

  Data key validation error: access_key_id <> not valid for <>
  Data key validation error: access_key_id has no read access for <>
  Data key validation error: access_key_id has no write access for <>

Please confirm if the ``access_key_id`` set for your data credentials is the same as the Shared
Storage S3 ACL Access User found at :ref:`credentials_data`
If the access_key_id does not have the correct permissions, ask an admin for permission.

No default bucket
-----------------

.. code-block:: bash
  :class: no-copybutton

  No default bucket set. Specify default bucket using the "osmo profile set" CLI.

Please set a default bucket as specified at :ref:`credentials_data`
