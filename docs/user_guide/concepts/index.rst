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

.. _concepts:

================================================
Overview
================================================

When you want to submit a workflow, there are many different concepts you will want to understand
such as:

- How do I specify what machine to run on?
- How can I see what machines are available?
- What workflow configurations are possible?
- How can I interact with my workflow to debug it?
- How do I inject data and fetch the output of my workflow?

OSMO separates :ref:`resources <concepts_resources>` into :ref:`pools <concepts_pools>` and
:ref:`platforms <concepts_platforms>` allowing you to target a specific machine or gpu that you
want to run your workflow on.

From there, you can specify the :ref:`workflow definition <concepts_wf>`
and what inputs/outputs you want to use.

To capture the workflow output, :ref:`datasets <concepts_ds>` and
:ref:`collections <concepts_ds>` can help you manage and organize your data.
