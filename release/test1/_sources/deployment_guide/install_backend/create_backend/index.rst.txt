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

.. _create_backend:

================================================
Create K8s Cluster
================================================

Each OSMO backend is a Kubernetes cluster of compute nodes that are dedicated to running AI workflows for development and testing purposes. You can create a K8s cluster in either a cloud or on-premises environment using the following guides.

.. only:: html

  .. grid:: 1 2 2 2
      :gutter: 3

      .. grid-item-card:: :octicon:`cloud` Cloud Setup
          :link: ./cloud_setup
          :link-type: doc

          Create a managed Kubernetes cluster on AWS, Azure, or GCP.

      .. grid-item-card:: :octicon:`server` On-Premises Setup
          :link: ./onprem_setup
          :link-type: doc

          Deploy Kubernetes on your own infrastructure using various distributions.

.. toctree::
   :hidden:
   :maxdepth: 1

   cloud_setup
   onprem_setup

