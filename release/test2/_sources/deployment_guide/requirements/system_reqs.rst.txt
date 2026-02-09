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

.. _deployment_guide_system_requirements:

====================
Instances
====================

Minimum system instance requirements to deploy OSMO and its related cloud components as below:

.. only:: html

  .. grid:: 1 2 2 3
      :gutter: 3

      .. grid-item-card:: :octicon:`server` OSMO Service
          :class-card: requirement-card

          **Node Configuration:**

          - **CPU**: 8 cores
          - **Memory**: 32 GB
          - **Storage**: 100 GB
          - **OS**: Ubuntu 22.04+ or equivalent enterprise Linux

      .. grid-item-card:: :octicon:`database` PostgreSQL
          :class-card: requirement-card

          **Database Configuration:**

          - **Version**: 15.0+
          - **CPU**: 2 cores
          - **Memory**: 4 GB
          - **Storage**: 32 GB

      .. grid-item-card:: :octicon:`cache` Redis
          :class-card: requirement-card

          **Cache Configuration:**

          - **Version**: 7.0+
          - **CPU**: 1 core
          - **Memory**: 4 GB

.. note::
    System instance can be a single node or cluster of nodes.
    For clusters, resources should aggregate to minimum requirements mentioned above.
