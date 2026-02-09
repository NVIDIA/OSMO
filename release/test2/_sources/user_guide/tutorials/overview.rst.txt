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

.. _tutorials_overview:

=================
Overview
=================

Welcome to OSMO tutorials! This section will guide you through learning OSMO step by step,
from your first workflow to advanced patterns.

.. note::

   **New to OSMO workflows?** These tutorials dive straight into hands-on examples.
   If you'd like to understand the concepts behind workflows, tasks, and groups first,
   we recommend reading the :ref:`Workflows Overview <workflow_overview>` section before starting.

   However, if you prefer learning by doing, you can jump right in and refer back to the
   :ref:`Workflows <workflow_overview>` section as needed!

What You'll Learn
==================

These tutorials are designed to be completed in order, building your knowledge layer by layer:

----

.. topic:: 📖 **Fundamentals**
   :class: highlight

   Master the basics of OSMO workflows

   **1.** :ref:`Your First Workflow <tutorials_hello_world>`
      Submit and run your first "Hello World" workflow

   **2.** :ref:`Requesting Resources <tutorials_requesting_resources>`
      Learn how to specify CPU, GPU, memory, and storage requirements

   **3.** :ref:`Template and Tokens <tutorials_template_and_tokens>`
      Learn how to use templates and special tokens in a workflow spec

   **4.** :ref:`Working with Data <tutorials_working_with_data>`
      Understand datasets, inputs, outputs, and data management

----

.. topic:: ⚙️ **Workflow Patterns**
   :class: highlight

   Learn to orchestrate tasks in different execution patterns

   **5.** :ref:`Serial Workflows <tutorials_serial_workflows>`
      Create workflows where tasks run sequentially with dependencies

   **6.** :ref:`Parallel Workflows <tutorials_parallel_workflows>`
      Build workflows that execute multiple tasks simultaneously

   **7.** :ref:`Combination Workflows <tutorials_combination_workflows>`
      Combine serial and parallel patterns by creating groups with dependencies

----

.. topic:: 🤖 **Advanced Topics**
   :class: highlight

   Explore sophisticated patterns and hardware orchestration

   **8.** :ref:`Hardware In The Loop (HIL) <tutorials_gang_scheduling>`
      Run tasks across different hardware platforms (x86, ARM, GPU) simultaneously

   **9.** :ref:`Advanced Patterns <tutorials_advanced_patterns>`
      Explore complex workflow patterns and optimization techniques

Ready to Start?
===============

Let's begin with your first workflow! Head over to :ref:`Your First Workflow <tutorials_hello_world>` to get started.
