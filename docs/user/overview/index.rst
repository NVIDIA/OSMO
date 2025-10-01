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

.. _overview:

================================================
Overview
================================================

.. note::
  TODO:

  - Include target audience - Run:ai calls this "AI Practitioners"
  - What is it?
  - Why do I need it?
  - Where can I find it? (or install it)
  - "If you are a infrastructure administrator, you need to host OSMO for your team. Follow the setup docs here..."

OSMO is a cloud native platform that provides easy and efficient access to various types of compute and data storage solutions for robotics developers. It abstracts the complexity of various backend compute and data storage solutions. With OSMO, robotics developers can not only share the compute resources but also scale their workflows to medium sized compute clusters. OSMO enables you to:

* Run ML workflows, such as data generation, DNN training
* Evaluate the results in simulation
* Run benchmarks on the hardware used to build the robot

Developers can use either client :ref:`CLI <install>` or `web UI <osmo_ui_>`_ to submit workflows. OSMO orchestrates multiple containers as described in the workflow specification on the compute backend. Each OSMO backend is a Kubernetes cluster of compute nodes.

.. image:: intro.png
	:width: 800
	:alt: OSMO Overall Architecture

Developers can create a workflow specification (YAML file) that describes their workflow to be performed on the compute nodes. Developers can submit workflows once authenticated with OSMO. The workflow engine schedules the tasks based on the type of compute resource requested to perform the task. The lifecycle of an OSMO workflow from the perspective of developers is shown below. The details of each step is described in the :ref:`workflows` section.

.. image:: wf_lifecycle.gif
	:width: 800
	:alt: OSMO Workflow Lifecycle
	:align: center
