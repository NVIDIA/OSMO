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

.. _whats_next:

=============
What's Next
=============

Now that you understand the OSMO deployment architecture, you're ready to begin deploying OSMO.

Ready to Begin?
===============

Select the deployment model that fits your needs and environment.

.. only:: html

  .. grid:: 1 2 2 2
      :gutter: 3

      .. grid-item-card:: :octicon:`rocket` Quickstart
          :link: ../appendix/deploy_local
          :link-type: doc
          :class-card: tool-card

          Run the complete OSMO control plane, compute plane, and a GPU
          workflow on a local NVIDIA GPU workstation.

      .. grid-item-card:: :octicon:`server` Single-plane Deployment
          :link: ../appendix/deploy_minimal
          :link-type: doc
          :class-card: tool-card

          Deploy the service and backend operator in the same Kubernetes
          cluster for testing, development, or evaluation.

      .. grid-item-card:: :octicon:`workflow` Split-plane Infrastructure
          :link: ../getting_started/infrastructure_setup
          :link-type: doc
          :class-card: tool-card

          Prepare infrastructure for control and compute planes deployed on
          separate clusters.
