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

.. _setup_concepts:

=======================================================
Advanced Configuration
=======================================================

This section contains high-level overview of important concepts used in OSMO.

.. only:: html

  .. grid:: 1 2 2 2
      :gutter: 3

      .. grid-item-card:: :octicon:`checklist` Resource Validation
          :link: ./resource_validation
          :link-type: doc

          Pre-flight checks that validate workflow resource requests before submission.

      .. grid-item-card:: :octicon:`package` Pod Template
          :link: ./pod_template
          :link-type: doc

          Reusable Kubernetes pod specifications for defining workflow task execution.

      .. grid-item-card:: :octicon:`database` Pool
          :link: ./pool
          :link-type: doc

          Abstraction layer for compute backends with fine-grained access control.

      .. grid-item-card:: :octicon:`workflow` Scheduler
          :link: ./scheduler
          :link-type: doc

          Task orchestration components including KAI, Volcano, and Default schedulers.

      .. grid-item-card:: :octicon:`sync` Rsync Setup
          :link: ./rsync
          :link-type: doc

          File synchronization configuration for seamless data transfer in workflows.

      .. grid-item-card:: :octicon:`file` Dataset Buckets
          :link: ./dataset_buckets
          :link-type: doc

          Configure additional data buckets for managing team datasets and isolated storage.

.. toctree::
   :hidden:
   :maxdepth: 1

   resource_validation
   pod_template
   pool
   scheduler
   rsync
   dataset_buckets
