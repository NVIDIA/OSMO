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

.. _training:

==================
Training with OSMO
==================

These tutorials guide you through training deep learning models with OSMO, starting from
single-node training and progressing to distributed multi-node training and fault-tolerant setups:

:ref:`training_single_node`
  Learn the fundamentals of running DNN training jobs on OSMO,
  including launching training scripts, selecting resources, managing data with OSMO datasets,
  saving outputs and checkpoints, and monitoring training progress with TensorBoard or Weights & Biases.

:ref:`training_multi_node`
  Scale your training across multiple nodes using TorchRun.
  This tutorial covers configuring task groups for distributed training, using OSMO tokens to
  coordinate master and worker nodes, and templating workflows to easily scale to arbitrary numbers of nodes.

:ref:`training_reschedule`
  Implement production-ready training that can automatically recover from transient backend errors (e.g., NCCL failures).
  Learn how to configure checkpoint resumption, catch reschedulable errors, and use exit actions to automatically restart
  failed tasks without losing training progress.

.. toctree::
   :maxdepth: 1
   :hidden:

   training/single_node
   training/multi_node
   training/reschedule_backend_errors
