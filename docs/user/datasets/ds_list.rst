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

.. _ds_list:

================================================
List
================================================

Provides a list of all datasets by owned by a user. Use ``--all-users`` to see datasets from all users or ``--user`` to see a list from specific users.

.. code-block:: bash

  $ osmo dataset list -h
  usage: osmo dataset list [-h] [--name NAME] [--user USER [USER ...]] [--all-users] [--count COUNT] [--order {asc,desc}] [--format-type {json,text}]

  options:
    -h, --help            show this help message and exit
    --name NAME, -n NAME  Display datasets that have the given substring in their name
    --user USER [USER ...], -u USER [USER ...]
                          Display all datasets where the user has uploaded to.
    --bucket BUCKET [BUCKET ...], -b BUCKET [BUCKET ...]
                          Display all datasets from the given buckets.
    --all-users, -a       Display all datasets with no filtering on users
    --count COUNT, -c COUNT
                          Display the given number of datasets. Default 20. Max 1000.
    --order {asc,desc}, -o {asc,desc}
                          Display in the given order. asc means latest at the bottom. desc means latest at the top
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).

  Ex. osmo dataset list --all-users or osmo dataset list --user abc xyz

.. code-block:: bash

  $ osmo dataset list

  Bucket    Name                                          ID                      Created Date         Last Version Created  Last Version  Storage Size   Type
  =================================================================================================================================================================
  osmo      2023-02-13_00-26-18_sf_2023_02_12_3_35p_pod   WPkmHhOoQkiO7p1aYcX0MQ  2023-02-27 09:35:35  2023-02-27 09:35:35   1             17GiB          DATASET

  osmo      2022-09-08_10-09-39_sf_2023_02_15_11_20a_pod  YHxz-zSFQ3m9V_7x8etpjw  2023-02-27 09:35:40  2023-02-27 09:35:40   23            17GiB          DATASET

  osmo      2022-09-08_10-59-44_nv_2023_02_24_7_30a_pod   FLDaj27bTTWIPPtNLI2lSQ  2023-02-27 10:16:30  2023-02-27 10:16:30   21            17GiB          DATASET
