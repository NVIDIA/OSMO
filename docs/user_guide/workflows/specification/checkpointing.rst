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


.. _workflow_spec_checkpointing:

================================================
Checkpointing
================================================

OSMO supports periodic data checkpointing from your workflow to data store.

The ``checkpoint`` field in the task spec can be used to specify the following parameters:

..  list-table::
    :header-rows: 1
    :widths: 30, 60

    * - **Field**
      - **Description**
    * - path (required)
      - The local path within the task to checkpoint.
    * - url (required)
      - The remote path in the data store to checkpoint to.
    * - frequency (required)
      - How long to wait _between_ one checkpoint ending and the next one beginning.
        This should be in the format of ``Xd, Xh, Xm, Xs``
        where ``X`` is a number. If no unit is specified, the value is assumed to be in seconds.
    * - regex (optional)
      - Regex for files to checkpoint.

.. note::

  Once the task is completed/failed, the checkpointing process will upload the data one more time
  to the data store.

.. code-block:: yaml

  workflow:
    name: sample-group
    tasks:
    - name: task1
      checkpoint:
      - path: /local/path/to/checkpoint
        url: s3://my-bucket/my-folder
        frequency: 30m
        regex: .*.json

You can view the checkpointing process as it runs in the workflow logs.

.. code-block:: bash

  $ osmo workflow logs <workflow_id>
  ...
  2025/04/22 23:57:13 [task1][osmo] Checkpointing data from /local/path/to/checkpoint to s3://my-bucket/my-folder...
  2025/04/22 23:57:14 [task1][osmo] 100%| 5.00M/5.00M [00:00<00:00, 6.73MB/s, file_name=/local/path/to/checkpoint/file_1.json]
  2025/04/22 23:57:14 [task1][osmo] 2025-04-22T23:57:14+0000 client [INFO] data: Data has been uploaded
  2025/04/22 23:57:15 [task1][osmo] Checkpointing data from /local/path/to/checkpoint to s3://my-bucket/my-folder finished
  ...
