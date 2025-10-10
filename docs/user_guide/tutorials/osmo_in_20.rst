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

.. _osmo_in_20:

================================================
OSMO in 20 minutes
================================================

This tutorial will walk you through creating a complete serial workflow in OSMO,
demonstrating how to build multi-task workflows that process data sequentially.

By the end of this tutorial, you'll understand how to create workflows where tasks
depend on each other, pass data between tasks, and manage datasets.

Overview
========

A serial workflow is a sequence of tasks where each task depends on the output of previous tasks. This pattern is useful for:

- Data processing pipelines
- Multi-stage analysis workflows
- Sequential transformations
- Validation workflows

Our example workflow will consist of two tasks:

1. **Task 1**: Generate initial data and save to a dataset
2. **Task 2**: Process data from Task 1 and create a new dataset version

Building the Workflow
=====================

Let's build our serial workflow step by step. Create a new file called ``my_serial_workflow.yaml``.

Workflow Header and Structure
-----------------------------

Start with the basic workflow structure:

.. code-block:: yaml

   workflow:
     name: my-serial-workflow
     resources:
       default:
         cpu: 1
         storage: 1Gi
         memory: 1Gi
     tasks:  # (1)

.. code-annotations:
  1. We will fill out this portion in the next section

Creating the First Task
-----------------------

Add the first task that generates initial data:

.. code-block:: bash

   tasks:
   - name: task1
     image: ubuntu:24.04
     command: [sh]
     args: [/tmp/run.sh]
     files:
     - contents: |
         echo "Hello from task1 $(hostname)"
         echo "Hello from task1 $(hostname)" > {{output}}/hello1.txt
         echo "Data from task 1" > {{output}}/test_read.txt                  # (1)
       path: /tmp/run.sh
     - path: '{{output}}/metadata.yaml'
       contents: |
         id: {{workflow_id}}
     resource: default
     outputs:
     - dataset:
         name: workflow_test_DS
         metadata:
         - metadata.yaml

.. code-annotations::
  1. Creates a new file `test_read.txt` in the output directory,
     which will be uploaded to the output dataset.

As you can see in the outputs section, we are creating a dataset named
`workflow_test_DS`. Everything in the ``{{output}}`` folder will be
uploaded to the dataset.

Adding the Second Task
----------------------

Add a second downstream task that processes data from Task 1:

.. code-block:: bash

   - name: task2
     image: ubuntu:24.04
     command: ['sh']
     args: ['/tmp/run.sh']
     files:
     - contents: |
         echo "Hello from task2 {{output}}"
         if [ ! -f "{{input:1}}/workflow_test_DS/test_read.txt" ]; then          # (1)
             echo "Error: {{input:1}}/workflow_test_DS/test_read.txt does not exist"
             exit 1
         fi
         head -1 {{input:1}}/workflow_test_DS/test_read.txt
         echo "Data from task 2" > {{output}}/test_read.txt                      # (2)
       path: /tmp/run.sh
     resource: default
     inputs:
     - task: task1    # (3)
     - dataset:
         name: workflow_test_DS
     outputs:
     - dataset:
         name: workflow_test_DS:test

.. code-annotations::
  1. {{input:1}} references the second input defined in inputs section (because of zero-indexing).
     This is referring to the `workflow_test_DS` dataset created by task1.
  2. Creates a new file `test_read.txt` in the output directory.
  3. Defines a dependency on task1

This task establishes a dependency on task1, so that task2 will only run after task1 has
completed. This task also mounts the `workflow_test_DS` dataset created by task1 as an
input, and can access the `test_read.txt` file in the input directory. At the end of the
task, it creates a new dataset version named `workflow_test_DS:test`.

Submitting Your Workflow
========================

You can now submit the workflow using the following command:

.. code-block:: bash

  $ osmo workflow submit my_serial_workflow.yaml

You can check the workflow status using the following command:

.. code-block:: bash

  $ osmo workflow query <workflow-id>

To view the datasets created by the workflow, you can use the following command:

.. code-block:: bash

  $ osmo dataset list

To download the datasets created by the workflow, you can use the following command:

.. code-block:: bash

  $ osmo dataset download workflow_test_DS
