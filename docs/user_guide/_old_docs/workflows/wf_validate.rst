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

.. _wf_validate:

================================================
Validate
================================================

Validating your workflow means that OSMO will **NOT** run your workflow, but OSMO will ensure there are no usage errors in the spec,
resources that you are requesting are available, and credentials stored are valid for the tasks & data used in the workflow.
This saves a lot of time for users to identify issues before the submission.

.. code-block:: bash

  $ osmo workflow validate -h
  usage: osmo workflow validate [-h] [--set SET [SET ...]] [--set-string SET_STRING [SET_STRING ...]] [--pool POOL] workflow_file

  positional arguments:
    workflow_file         The workflow file to submit.

  options:
    -h, --help            show this help message and exit
    --set SET [SET ...]   Assign fields in the workflow file with desired elements in the form "<field>=<value>". These values will override values set in the "default-values" section. Overridden fields in the yaml file should be in the form {{ field }}. Values will be cast as int or float if applicable
    --set-string SET_STRING [SET_STRING ...]
                          Assign fields in the workflow file with desired elements in the form "<field>=<value>". These values will override values set in the "default-values" section. Overridden fields in the yaml file should be in the form {{ field }}. All values will be cast as string
    --pool POOL, -p POOL  The target pool to run the workflow with. If no pool is specified, the default pool assigned in the profile will be used.

.. code-block:: bash

  $ osmo workflow validate sample_wf.yaml
  Workflow validation succeeded.

.. note::

  If a usage, resource, or credential error code is encountered, the CLI will exit with error code 1, indicating that the workflow failed submission.
  Refer to :ref:`troubleshooting` for tips for debugging

To validate a working with templated variables, use the below command:

.. code-block:: bash

  $ osmo workflow validate sample_wf_2.yaml --set <field1>=<value1> <field2>=<value2>
