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

.. _concepts_workflows_tasks_apps:

================================================
Apps
================================================

If you have a workflow that you like to reuse or would like to share to other users, you can convert
it into an **app**.

An **app** is a versioned workflow spec that any user can fetch to submit. Each version of the app
is immutable, but a new version of the app can be created with updated fields.

.. note::

  When you create an app, it doesn't upload any localpath files which are specified in the task spec.
  Learn more about localpath files at :ref:`concepts_wf_file_injection`.

To learn more about how to use apps, follow :ref:`apps`.
