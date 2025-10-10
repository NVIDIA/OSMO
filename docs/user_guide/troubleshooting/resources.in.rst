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

.. _troubleshooting_resources:

Resources
================================================

Please make change to the workflow resource specs based on the detailed error message. Please
also refer :ref:`concepts_resources_pools_platforms` to make sure your resource spec is correct. Set the labels,
cpu/gpu, memory, storage based on the current pool/platform availability ``osmo resource list``

Some common errors are listed below:

Too high for label memory
-------------------------------------

.. code-block:: bash
  :class: no-copybutton

  Resource memory error
  E.g. Value "1000000" too high for label memory

Please check the available memory and set it correctly.

Too high for label cpu
-------------------------------------

.. code-block:: bash
  :class: no-copybutton

  Resource cpu/gpu error
  E.g. Value "1000000" too high for label cpu

Please check the available cpu and set it correctly.

Too high for label storage
-------------------------------------

.. code-block:: bash
  :class: no-copybutton

  Resource storage error
  E.g. Value "1000000" too high for label storage

Please check the available storage and set it correctly.

Does not allow mount
-------------------------------------

.. code-block:: bash
  :class: no-copybutton

  Mount error:
  E.g. Mount /bad_mount not allowed for selected platform dgx-h100

If you need specific host mounts, reach out to admin to update the platform configs.
