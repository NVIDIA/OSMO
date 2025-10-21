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

.. _credentials_generic:

================================================
Generic Secrets
================================================

Setup the generic credentials
================================================

Any other secrets unrelated to registry and data can be stored as generic credentials (``type=GENERIC``).

For example, to access the Omniverse Nucleus server:

.. code-block:: bash

  $ osmo credential set omni-auth --type GENERIC --payload omni_user='$omni-api-token' omni_pass=<token>

Another example of setting a generic secret to be used in a workflow is shown below:

.. code-block:: bash

  $ osmo credential set server-secret --type GENERIC --payload server_user=user server_pass=pass

.. note::
  Your registry and data credentials are picked up automatically when you submit a workflow. To specify a generic credential in the workflow, refer to :ref:`concepts_wf_secrets`.
