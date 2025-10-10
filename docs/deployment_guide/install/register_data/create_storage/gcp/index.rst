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

.. _gcp_gs_permissions:

=============================
Google Storage (GCP)
=============================

To handle who can access Datasets, the necessary AWS resources/policies must be created. This includes

- A GS Bucket
- An Special IAM Role (Optional)
- Linking Users to Bucket with a IAM Role
- An ACL (Optional)

.. note::

  For general bucket level access, it is recommended to just use IAM Policies.
  For object level access, Access Control Lists (ACLs) are required.


Setting up the bucket
=====================

For instructions on creating Google Storage Buckets, follow |bucket_create|.

.. |bucket_create| raw:: html

   <a href="https://cloud.google.com/storage/docs/creating-buckets" target="_blank">Create Bucket</a>


Enter Organization
==========================

1. Login to |Google_Storage_Console|.

.. |Google_Storage_Console| raw:: html

   <a href="https://console.cloud.google.com/" target="_blank">Google Storage Console</a>

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

Create IAM Role (Optional)
==========================

.. note::

  This section is for creating a special IAM Role and is **NOT** necessary to add users. If you
  do not want to use a special role, skip this section.

In the Google Storage Console, search ``IAM`` in the search bar and click on ``IAM`` in the suggested entries.

.. image:: ./iam.png
  :width: 500
  :alt: Alternative text

Click on ``Role`` in the left task bar.

.. image:: ./role1.png
  :width: 150
  :alt: Alternative text

Click on ``Create Role`` to create a custom role.

.. image:: ./role2.png
  :width: 500
  :alt: Alternative text

Title the role accordingly and set the ``ID`` to be the same as the ``Title``. Add the correct permissions:

- Upload and Delete Access requires the ``Storage Object User`` role.
- Download Access requires ``Storage Object Viewer`` role.

.. image:: ./role3.png
  :width: 300
  :alt: Alternative text

.. note::

  More information about roles can be found at |IAM_roles|.

.. |IAM_roles| raw:: html

   <a href="https://cloud.google.com/storage/docs/access-control/iam-roles" target="_blank">IAM Roles</a>

Link User and Bucket with IAM Policy Permissions
================================================

For instructions on linking IAM Policies to a principal (user), follow |IAM_create|. This will allow the user
to have all the permissions the role allows for that bucket.

- Upload and Delete Access requires the ``Storage Object User`` role.
- Download Access requires ``Storage Object Viewer`` role.

To use a created role from the previous section, simply enter that role instead.

.. |IAM_create| raw:: html

   <a href="https://cloud.google.com/storage/docs/access-control/using-iam-permissions#bucket-add" target="_blank">Create IAM</a>

.. note::

  Do **NOT** set the user to have the assigned Role in the ``IAM & Admin`` page as the user will get the access to **ALL**
  buckets with those Role permissions.

Create ACL (Optional)
=====================

Upload and Delete Access requires the ``Owner`` access.

Download Access requires ``Reader`` access.

For instructions on creating ACLs, follow |ACL_create|.

.. |ACL_create| raw:: html

   <a href="https://cloud.google.com/storage/docs/access-control/create-manage-lists" target="_blank">Create ACL</a>

Construct URI
=====================

URIs are constructed as follows with examples for bucket name ``my_bucket``:

.. code-block:: bash
  :class: no-copybutton

  gs://<bucket>

  # Example
  gs://my_bucket

Follow :ref:`ds_bucket` to add the bucket to OSMO.
