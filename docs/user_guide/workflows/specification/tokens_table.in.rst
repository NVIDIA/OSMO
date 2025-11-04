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
..

..  list-table::
  :header-rows: 1
  :widths: 50 150

  * - **Token**
    - **Description**
  * - ``{{input:<#>}}``
    - The directory where inputs are downloaded to. The ``<#>`` is the index of an input, starting at 0.
  * - ``{{output}}``
    - The directory where files will be uploaded from when the task finishes.
  * - ``{{workflow_id}}``
    - The workflow ID.
  * - ``{{host:<task_name>}}``
    - The hostname of a currently running task. Useful for tasks to communicate with each other.
