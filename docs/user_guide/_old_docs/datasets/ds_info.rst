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

.. _ds_info:

================================================
Info
================================================

Provides information about a dataset.

.. code-block:: bash

  $ osmo dataset info -h
  usage: osmo dataset info [-h] [--all] [--count COUNT] [--order {asc,desc}] [--format-type {json,text}] name

  positional arguments:
    name                  Dataset name. Specify bucket with [bucket/]DS.

  options:
    -h, --help            show this help message and exit
    --all, -a             Display all versions in any state.
    --count COUNT, -c COUNT
                          For Datasets. Display the given number of versions. Default 100.
    --order {asc,desc}, -o {asc,desc}
                          For Datasets. Display in the given order based on date created
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).

  Ex. osmo dataset info DS1 --format-type json

This would list all the READY versions of a dataset. Use ``--all`` to see all versions irrespective of status:

.. code-block:: bash

  $ osmo dataset info drivesim2_sdg_sample
  -----------------------------------------------------

  Name: drivesim2_sdg_sample
  ID: uIJ2t-XhQrSZKAR07So2og
  Bucket: osmo
  Type: DATASET
  Stored Size: 16.9 GiB

  Labels:
  default.created_by: user@email.com
  default.datetime: 1675474694.0
  default.type: dataset
  default.wfid: drivesim2-sdgyk8skWrDREeh34gguRZ_6Q
  osmo1_entry: true

  Version  Tags
  =================
  1        latest

  Version  Status  Created By        Created Date         Last Used            Size       Checksum                          Retention Policy
  ============================================================================================================================================
  1        READY   user@email.com    2023-02-04 01:38:15  2023-04-21 23:07:17  16.9 GiB   2147d51d64fc05238bd787cc31dc84b7  7776000


The output can also be output in JSON format using ``--format-type=json``:

.. code-block:: bash
  :substitutions:

  {
    "name": "drivesim2_sdg_sample",
    "id": "uIJ2t-XhQrSZKAR07So2og",
    "bucket": "osmo",
    "created_date": "2023-02-04T01:38:15",
    "labels": {
        "osmo1_entry": true,
        "default.type": "dataset",
        "default.wfid": "drivesim2-sdgyk8skWrDREeh34gguRZ_6Q",
        "default.datetime": 1675474694.0,
        "default.created_by": "user@email.com"
    },
    "type": "DATASET",
    "versions": [
        {
            "name": "drivesim2_sdg_sample",
            "version": "1",
            "status": "READY",
            "created_by": "user@email.com",
            "created_date": "2023-02-04T01:38:15",
            "last_used": "2023-04-21T23:07:17",
            "size": 202116902,
            "checksum": "2147d51d64fc05238bd787cc31dc84b7",
            "uri": \"|data_full_prefix|\ service-storage/production/datasets/drivesim2_sdg_sample/dataset_1/drivesim2_sdg_sample",
            "metadata": {
                "description": "",
                "osmo1_version": 1
            },
            "tags": [
                "latest"
            ],
            "collections": []
        }
    ]
  }
