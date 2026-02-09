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

.. _tutorials_advanced_patterns:

=================
Advanced Patterns
=================

This tutorial covers advanced workflow patterns and optimization techniques for building
production-grade workflows in OSMO.

You'll learn:

- :ref:`Workflow templates with Jinja <tutorials_advanced_patterns_jinja>`
- :ref:`Injecting local files with localpath <tutorials_advanced_patterns_localpath>`
- :ref:`Periodic data checkpointing <tutorials_advanced_patterns_checkpointing>`
- :ref:`Error handling with exit actions <tutorials_advanced_patterns_exit_actions>`
- :ref:`Node exclusion <tutorials_advanced_patterns_node_exclusion>`

These patterns help you build scalable, maintainable, and efficient production workflows.

.. _tutorials_advanced_patterns_jinja:

Workflow Templates
==================

OSMO supports Jinja templates for creating reusable and configurable workflows. You can define
variables in your workflow and override them at submission time.

.. code-block:: jinja

  workflow:
    name: "{{workflow_name}}"

    resources:
      training:
        cpu: 8
        memory: 32Gi
        gpu: {{gpu_count}}

    tasks:
    {% for i in range(num_tasks) %}
    - name: train-model-{{i}}
      image: {{training_image}}
      command: ["python", "train.py"]
      args:
      - "--dataset={{dataset_name}}"
      - "--model={{model_type}}"
      - "--fold={{i}}"
      resource: training
      outputs:
      - dataset:
          name: "{{model_type}}_model_fold_{{i}}"
    {% endfor %}

  default-values:
    workflow_name: ml-training
    dataset_name: imagenet
    model_type: resnet50
    num_tasks: 3
    gpu_count: 1
    training_image: nvcr.io/nvidia/pytorch:24.01-py3

This template uses a Jinja ``{% for %}`` loop to create multiple training tasks dynamically.
Each task gets a unique name with an index (e.g., ``train-model-0``, ``train-model-1``) and
produces separate output datasets. This is useful for cross-validation, hyperparameter sweeps,
or parallel training runs.

Submit with custom values:

.. code-block:: bash

  # Use defaults (creates 3 tasks)
  $ osmo workflow submit template-workflow.yaml

  # Override values to create 5 tasks
  $ osmo workflow submit template-workflow.yaml \
      --set model_type=efficientnet \
      --set gpu_count=4 \
      --set num_tasks=5

.. seealso::

   See :ref:`workflow_spec_templates_and_special_tokens` for complete template documentation.

.. _tutorials_advanced_patterns_localpath:

Injecting Local Files with localpath
======================================

When developing workflows, you often need to inject local configuration files or scripts into
your tasks. OSMO supports the ``localpath`` attribute in the ``files`` section to inject files
from your local machine into the container.

This is particularly useful for:

- Including configuration files without hard coding them inline
- Reusing existing scripts across multiple workflows
- Keeping workflow specifications clean and readable

To inject a local file, use the ``localpath`` attribute in the ``files`` section:

.. code-block:: yaml

  tasks:
  - name: run-local-script
    image: ubuntu:24.04
    command: [sh]
    args: [/tmp/run.sh]
    files:
    - localpath: scripts/my_script.sh   # (1)
      path: /tmp/run.sh                 # (2)

.. code-annotations::

  1. The ``localpath`` field designates the path of the file on your local machine (relative to the workflow spec).
  2. The ``path`` field designates where to create this file in the task's container.

.. warning::

  The ``localpath`` field in the ``files`` section only supports **files**, NOT directories.
  If you need to transfer entire directories, follow :ref:`ds_localpath` for more information.

.. seealso::

   See :ref:`workflow_spec_file_injection` for complete file injection documentation, including
   how to inject directories using dataset inputs.

.. _tutorials_advanced_patterns_checkpointing:

Periodic Data Checkpointing
===========================

OSMO supports automatic checkpointing to periodically save your task's working data to a
remote data store. This is useful for long-running training tasks where you want to preserve
intermediate results.

Basic Checkpointing
-------------------

.. code-block:: yaml

  workflow:
    name: train-with-checkpointing
    tasks:
    - name: train-with-checkpointing
      image: ubuntu:24.04
      command: [/bin/bash]
      args: [/tmp/run.sh]
      files:
      - path: /tmp/run.sh
        contents: |-
          #!/bin/bash
          set -ex

          mkdir -p /tmp/data
          for i in {1..30}; do
              filename="/tmp/data/file_$i.txt"
              dd if=/dev/urandom of=$filename bs=1M count=5
              sleep 1s
          done
          sleep 60s
      checkpoint:
      - path: /tmp/data
        url: s3://my-bucket/model-checkpoints
        frequency: 10s

This will automatically upload the contents of ``/tmp/data`` to S3 every 10 seconds
while the task is running. When the task completes, a final checkpoint is automatically uploaded.

Checkpointing Specific Files
-----------------------------

You can use regex patterns to checkpoint only specific files:

.. code-block:: yaml

  workflow:
    name: train-with-selective-checkpointing
    tasks:
    - name: train-with-selective-checkpointing
      image: ubuntu:24.04
      command: [/bin/bash]
      args: [/tmp/run.sh]
      files:
      - path: /tmp/run.sh
        contents: |-
          #!/bin/bash
          set -ex

          mkdir -p /tmp/data
          for i in {1..30}; do
              # Alternate file type for odd/even files
              if (( $i % 2 == 0 )); then
                  filename="/tmp/data/file_$i.bin"
              else
                  filename="/tmp/data/file_$i.txt"
              fi
              dd if=/dev/urandom of=$filename bs=1M count=5
              sleep 1s
          done
          sleep 60s
      checkpoint:
      - path: /tmp/data
        url: s3://my-bucket/model-selective-checkpoints
        frequency: 10s
        regex: .*\.(bin)$

This will checkpoint only binary files (`.bin`) every 10 seconds.

.. seealso::

   See :ref:`workflow_spec_checkpointing` for complete checkpointing documentation.

.. _tutorials_advanced_patterns_osmo_cli_wf:

Running OSMO CLI in a Workflow
==============================

Users can use the OSMO CLI from within their workflow. OSMO CLI is always injected into the workflow.

.. code-block:: yaml

  workflow:
    name: osmo-cli
    tasks:
    - name: task1
      resource: default
      image: ubuntu:24.04
      command: ['sh']
      args: ['/tmp/run.sh']
      files:
      - contents: |
          echo "Invoking OSMO client from a script"
          osmo version # (1)
        path: /tmp/run.sh

.. code-annotations::

  1. You can run any OSMO CLI command here.

.. _tutorials_advanced_patterns_exit_actions:

Error Handling with Exit Actions
==================================

OSMO supports exit actions that allow you to control task behavior based on exit codes.
This is useful for handling failures and retries.

.. code-block:: yaml

  tasks:
  - name: resilient-task
    image: ubuntu:24.04
    command: ["bash", "-c", "curl https://api.example.com/data"]
    exitActions:
      COMPLETE: 0
      RESCHEDULE: 1-255

This configuration will reschedule the task for any non-zero exit code.

.. seealso::

  See :ref:`workflow_spec_exit_actions` for complete exit actions documentation.


.. _tutorials_advanced_patterns_node_exclusion:

Excluding Specific Nodes
=========================

If some nodes have poor performance or network issues in your pool, you can exclude them
from scheduling using the ``nodesExcluded`` field:

.. code-block:: yaml

  workflow:
    name: exclude-nodes-demo
    resources:
      default:
        cpu: 1
        memory: 16Gi
        storage: 1Gi
        nodesExcluded:
        - worker1
        - worker2
    tasks:
    - name: my-task
      image: ubuntu:24.04
      command: ["bash", "-c", "echo 'Running on a good node'"]

.. warning::

  Excluding too many nodes can lead to tasks being stuck in PENDING forever! Only exclude
  nodes when absolutely necessary.

Next Steps
==========

Congratulations! You have completed the OSMO tutorials. Continue to our how-to guides for
more real-world examples.
