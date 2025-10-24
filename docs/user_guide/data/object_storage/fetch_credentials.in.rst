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

Refer to the setup guide to configure storage and manage the user access for datasets with ACL.
For Data credentials, you would need

* S3 ACL Access User for  ``access_key_id``
* S3 Secret Key for ``access_key``

AWS Credentials
---------------------

1. Follow the instructions `here <https://www.msp360.com/resources/blog/how-to-find-your-aws-access-key-id-and-secret-access-key/>`_
and go to the section labeled **How to Retrieve IAM Access Keys** on how to retrieve the
secret access id and key.

2. The generated ``Access key ID`` corresponds to OSMO ``access_key_id`` and the
``Secret access key`` corresponds to OSMO ``access_key``.

3. Once the IAM user is created, message your ``Storage Bucket admin`` to add the account to
   your team's group.

Azure Blob Storage Credentials
------------------------------------

Your admin will need to add you to the Azure Blob Storage account in order for you to access
the containers within that storage account.

Once your admin added you, go to ``Storage center`` and click on the right ``Storage account``.

After landing on the storage account page, click on ``Security + Networking`` > ``Shared Access Signature`` on the left side bar.

From this page:

- Choose the permissions that you want for your credentials
- Click on ``Object`` for ``Allowed resource types``
- Choose the expiration date for your credentials.

.. note::

  Be sure to give ample time for the expiration date for your credentials. When the credentials expires, this could impact any
  data or dataset operation.

After clicking on ``Generate SAS and connection string``, save the ``Connection string``.
You will use the ``Connection string`` for ``access_key`` field of your OSMO data credentials.

You can choose to leave out the ``access_key_id`` and ``region`` fields when setting up the credentials.

TOS Credentials
--------------------------

To fetch the name of the bucket, use the ``osmo bucket list`` to select the bucket name.
For example:

.. code:: bash

  $ osmo bucket list

  Bucket                Location
  ==========================================
  my_bucket (default)   tos://<endpoint>/<name_of_bucket>

Contact your admin for user access key and secret key for this bucket.

The given ``Access key`` corresponds to OSMO ``access_key_id`` and ``Secret Key`` corresponds
to OSMO ``access_key``.

To recap, for Data credentials you would need:

  * ``Access key`` for  ``access_key_id``
  * ``Secret Key`` for ``access_key``
  * ``Location`` from ``osmo bucket list`` for ``endpoint``
