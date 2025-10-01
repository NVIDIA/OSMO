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

.. _data_dependencies:

================================================
Managing Data Dependencies
================================================

Concepts
---------

If there is any data/datasets that needs to be downloaded/mounted or uploaded, you can specify them
in the ``inputs`` or ``outputs`` field.

.. code-block:: yaml

  workflow:
    name: data-dependencies
    tasks:
    - name: task1
      ...
      files:
      - contents: |
          cat {{input:0}}/file_in_url
          cat {{input:1}}/file_in_dataset
          echo "Data from task 1" > {{output}}/test_read.txt # Data to be uploaded to url
        path: /tmp/run.sh
      inputs: # Data to be downloaded/mounted
      - url: s3://my_bucket/input/path
      - dataset:
          name: input_DS
      outputs: # Data to be uploaded
      - url: s3://my_bucket/output/path
      - dataset:
          name: output_DS
    - name: task2
      ...
      files:
      - contents: |
          cat {{input:0}}/test_read.txt # Data from task1
        path: /tmp/run.sh
      inputs:
      - task: task1 # Data from task1

Example
-------

This workflow demonstrates how to pass data between sequential tasks using inputs and outputs.

The workflow consists of two tasks that run in sequence:

* Task1:

  * Writes "Hello from task1" to a file
  * Creates test_read.txt with some data
  * Outputs are saved to a dataset named "serial_tasks_DS"

* Task2:

  * Depends on task1 and waits for it to complete
  * Reads the test_read.txt file created by task1
  * Creates its own test_read.txt file
  * Outputs are uploaded to an S3 bucket

.. literalinclude:: ../../../samples/serial_tasks/serial_tasks_with_data.yaml
  :language: yaml
