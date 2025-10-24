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

.. _data_object_storage_gcs:

====================
Google Cloud Storage
====================

To fetch the name of the bucket, use the ``osmo bucket list`` to select the bucket name.
For example:

.. code:: bash

  $ osmo bucket list

  Bucket                Location
  ==========================================
  my_bucket (default)   gs://<name_of_bucket>

.. note::

  The location field will correspond to the ``endpoint`` field when setting up credentials.

Notify your ``Storage Bucket admin`` to add your Google Cloud profile linked to your email to
your team's role and have them tell you the **Organization** and **Project** associated with
the bucket. The Organization and project are necessary for fetching credentials.

1. Once your account has been added, login to Google Cloud Console associated with the bucket you
are trying to access. Fill in the field ``<name_of_bucket>`` below.

.. code:: bash

  https://console.cloud.google.com/storage/browser/<name_of_bucket>


2. Click on the Organization field in the top left. The default value is ``No organization``.

.. image:: ./organization1.png
  :width: 300
  :alt: Alternative text

3. In the popup, Click on the drop down field to select your organization.

.. image:: ./organization2.png
  :width: 300
  :alt: Alternative text

3. Click on the ``ALL`` tab, search for your project, and click on it.

.. image:: ./organization3.png
  :width: 400
  :alt: Alternative text

4. Click on ``Settings`` in the left task bar.

.. image:: ./setting.png
  :width: 200
  :alt: Alternative text

5. Click on ``INTEROPERABILITY`` in the middle, and scroll down to the section labeled
``Access keys for your user account``.

.. image:: ./interoperability.png
  :width: 1100
  :alt: Alternative text

6. Click on ``CREATE A KEY``

.. image:: ./create.png
  :width: 500
  :alt: Alternative text

The generated ``Access key`` corresponds to OSMO ``access_key_id`` and ``Secret`` corresponds
to OSMO ``access_key``.

To recap, for Data credentials you would need:

  * ``Access key`` for  ``access_key_id``
  * ``Secret`` for ``access_key``
  * ``Location`` from ``osmo bucket list`` for ``endpoint``
