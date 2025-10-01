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

.. _notifications:

================================================
Notifications
================================================


Use ``osmo profile list`` to list all notification and preferences.

.. code-block:: bash

  $ osmo profile list -h
  usage: osmo profile list [-h] [--format-type {json,text}]

  options:
    -h, --help            show this help message and exit
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text)

An Example output is:

.. code-block:: bash

  $ osmo profile list
  user:
    name: John Doe
    email: jdoe@nvidia.com
  notifications:
    email: False
    slack: True
  bucket:
    default: my-bucket
  pool:
    default: my-pool
    accessible:
    - my-pool
    - team-pool

Example notifications are as described below:

**Slack**:

.. image:: slack.png
	:alt: Alternative text

.. note::

  Slack will only work if the admin has set the Slack token

**Email**:

.. image:: email.png
	:alt: Alternative text

.. note::

  Email will only work if the admin has configured the email SMTP server

Use ``osmo profile set`` to set notification and default preferences.
By default, ``slack`` notifications are on and ``email`` notifications are off.
``bucket`` and ``pool`` are not set by default.

.. code-block:: bash

  $ osmo profile set -h
  usage: osmo profile set [-h] {notifications,bucket,pool} value [{true,false}]

  positional arguments:
    {notifications,bucket,pool}
                          Field to set
    value                 Type of notification, or name of bucket/pool
    {true,false}          Enable or disable, strictly for notifications.

  options:
    -h, --help            show this help message and exit

  Ex. osmo profile set bucket my_bucket
  Ex. osmo profile set pool my_pool
  Ex. osmo profile set notification email true # Enable only email notifications
  Ex. osmo profile set notification slack false # Disable slack notifications

Notifications
-------------

To set email notifications:

.. code-block:: bash

  $ osmo profile set notifications email true

To remove slack notifications:

.. code-block:: bash

  $ osmo profile set notifications slack false

Bucket
------------------

To set default bucket, use ``osmo bucket list`` to see the available buckets:

.. code-block:: bash

  $ osmo bucket list

  Bucket                Location
  ===========================================
  my_bucket             s3://<name_of_bucket>

Set the bucket using the profile CLI.

.. code-block:: bash

  $ osmo profile set bucket my_bucket


Pool (Optional)
------------------

To set default pool, use ``osmo profile list`` to view available pools and ``osmo resource list --pool <pool_name>`` to see what resources are in each pool.

Set the pool using the profile CLI.

.. code-block:: bash

  $ osmo profile set pool my_pool
