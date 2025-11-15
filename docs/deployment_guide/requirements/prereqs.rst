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


.. _prerequisites:


===================
Cloud
===================

Before deploying OSMO, ensure you have the following cloud components:

.. only:: html

  .. grid:: 1 2 2 2
      :gutter: 3

      .. grid-item-card:: :octicon:`stack` Kubernetes Cluster
          :class-card: tool-card

          **Version**: 1.27 or higher

          Container orchestration platform for deploying and managing OSMO services.

      .. grid-item-card:: :octicon:`database` PostgreSQL Database
          :class-card: tool-card

          **Version**: 15 or higher

          Primary database for storing OSMO application data and metadata.

      .. grid-item-card:: :octicon:`zap` Redis Instance
          :class-card: tool-card

          **Version**: 7.0 or higher

          In-memory data store for caching and session management.

      .. grid-item-card:: :octicon:`lock` Virtual Private Network (VPC)
          :class-card: tool-card

          Network with subnets for the Kubernetes cluster, PostgreSQL database, and Redis instance.

          **Required for**: Secure communication between components

.. image:: cloud_components.svg
   :width: 70%
   :align: center


.. note::
  A sample terraform setup on AWS and Azure is available in our repository: `AWS <https://github.com/NVIDIA/OSMO/tree/main/deployments/terraform/aws/example>`_ and `Azure <https://github.com/NVIDIA/OSMO/tree/main/deployments/terraform/azure/example>`_
