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

.. _workflow_spec_templates_and_special_tokens:

================================================
Templates and Special Tokens
================================================

.. _workflow_spec_templates:

Templates
=========

Workflows use `Jinja <https://jinja.palletsprojects.com/en/stable/>`_ to define variables inside a
workflow that can have default values or be overridden on the command line before workflow
submission.

Variable are denoted by two open and closed curly braces ``{{ }}``. Workflows submitted
with unspecified variables will result in a submission failure.

.. warning::

  Some variable names are reserved and cannot be used. Refer to :ref:`workflow_spec_special_tokens` for more information.

For example:

.. code-block:: yaml

  version: 2
  workflow:
    name: {{ workflow_name }} # (1)
    tasks:
    - name: ros
      environment:
        ISAAC_ROS_OVERRIDE_DATASET_ROOT: "{{input:0}}/{{ dataset_name }}" # (2)
        ISAAC_ROS_OVERRIDE_LOG_FILE: "{{output}}/kpi.json"
      image: "nvcr.io/nvidia/isaac-ros/aarch64-build:latest"
      command: ["/workspaces/isaac_ros-dev/docker/scripts/benchmark-entrypoint.sh"]
      args: ["{{ task_arg }}"] # (3)
      inputs:
      - dataset:
          name: {{ dataset_name }} # (4)
    resources:
      default:
        cpu: 7
        gpu: 1
        memory: 28Gi
        storage: 1Gi
        platform: agx-orin-jp6

  default-values:
    workflow_name: isaac_ros_bi3d_stereo_node_test
    dataset_name: isaac_ros_benchmark_bi3d_dataset
    task_arg: isaac_ros_bi3d_test.py

.. code-annotations::
  1. Has a default value of ``isaac_ros_bi3d_stereo_node_test``.
  2. Has a default value of ``isaac_ros_benchmark_bi3d_dataset``.
  3. Has a default value of ``isaac_ros_bi3d_test.py``.
  4. Has a default value of ``isaac_ros_benchmark_bi3d_dataset``.

These values can also be overridden in the submit command:

.. code-block:: bash

  $ osmo workflow submit /path/my_workflow.yaml --set workflow_name=another_workflow dataset_name=another_dataset task_arg=another_script.py

Variable naming conventions follow the `PEP8 style guide <https://peps.python.org/pep-0008/>`_.

The example below uses a for loop to create four tasks inside the group:

.. code-block:: bash

  workflow:
    name: {{ workflow_name }}
    groups:
    - name: group1
      tasks:
      {% for item in range(3) %} # (1)
      - name: "task_{{idx}}"
        image: my_container
        command: ["python3"]
        {% if item == 0 %} # (2)
        lead: true
        {% endif %}
        args: ["{{ task_arg }}"]
        inputs:
          - dataset:
              name: {{ dataset_name }}
      {% endfor %}

  default-values:
    workflow_name: my_workflow
    dataset_name: my_dataset
    task_arg: my_script.py

.. code-annotations::

  1. The ``range(3)`` function is used to create three tasks.
  2. The ``if`` statement is used to set the first task as the lead task.

.. _workflow_spec_special_tokens:

Special Tokens
==============

Special tokens are values denoted by two open and closed curly braces ``{{ }}`` and are
substituted with relevant values by the service.

If you try to set a value for a special token, it will be ignored.

The special tokens are:

.. include:: tokens_table.in.rst

.. dropdown:: Example with ``input``, ``output``, and ``workflow_id``
  :color: primary
  :icon: code
  :open:

  .. code-block:: yaml

    workflow:
      name: special-tokens
      tasks:
      - name: task1
        image: ubuntu
        command: [sh]
        args: [/tmp/run.sh]
        inputs:
        - dataset:
            name: first_input
        - dataset:
            name: second_input
        outputs:
        - dataset:
            name: my_dataset
        files:
        - contents: |
            echo "Hello from {{workflow_id}}"                                 # (1)
            cat {{input:0}}/file.txt                                          # (2)
            cat {{input:1}}/file2.txt                                         # (3)
            echo "Data from task 1: {{workflow_id}}" > {{output}}/my_file.txt # (4)
          path: /tmp/run.sh

  .. code-annotations::
    1. Prints out the workflow ID
    2. Reads a file called ``file.txt`` in the dataset ``first_input``
    3. Reads a file called ``file2.txt`` in the dataset ``second_input``
    4. Writes the workflow ID to the output folder

.. include:: group_communication_example.rst
