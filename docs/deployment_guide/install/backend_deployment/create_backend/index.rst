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

.. _create_cb:

================================================
Create Backend Cluster
================================================

Create a Kubernetes cluster to be used as a backend for job execution. Choose the deployment option that best fits your infrastructure requirements and organizational policies.

Deployment Options
==================

.. toctree::
   :maxdepth: 2

   onprem_setup
   cloud_setup

On-Premises Deployment
======================

Deploy Osmo backend on your own infrastructure with full control over hardware, networking, and security policies. This option is ideal for:

* Organizations with existing on-premises infrastructure
* Strict data residency and compliance requirements
* Custom hardware configurations
* Air-gapped or highly secure environments

:ref:`Learn more about on-premises deployment requirements <onprem_cb>`

Cloud Deployment
================

Deploy Osmo backend using managed Kubernetes services in the cloud for simplified operations and elastic scaling. This option is ideal for:

* Rapid deployment and scaling
* Reduced infrastructure management overhead
* Cost optimization through auto-scaling and spot instances
* Global deployment across multiple regions

:ref:`Learn more about cloud deployment requirements <cloud_cb>`

Next Steps
==========

After creating your backend cluster, proceed with:

1. Installing the backend operator
2. Configuring storage and networking
3. Setting up monitoring and logging
4. Connecting the backend to your Osmo service
