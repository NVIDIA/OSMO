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

.. _serial_tasks:

================================================
Running Tasks in Sequence
================================================

Concepts
---------

The main concept to understand for running tasks in sequence is the use of ``input`` field in the
spec.

In the example below, by specifying the ``inputs`` field ``- task: task1``,
``task2`` becomes dependent on ``task1``. ``task2`` will not start until ``task1`` has finished.

.. code-block:: yaml

  workflow:
    name: serial-tasks
    tasks:
    - name: task1
      ...
    - name: task2
      inputs:
      - task: task1
      ...

Example
-------

This workflow demonstrates running tasks in sequence with data dependencies.

It consists of two tasks:

1. task1: Writes "Hello from task1" and some test data to output files
2. task2: Reads the data written by task1 and verifies it exists

The tasks run serially because task2 depends on task1's output via the inputs field.
The workflow also shows how to:

- Pass data between tasks using {{output}} and {{input:0}} special tokens
- Save outputs to a dataset for later download
- Define default resources (CPU, memory, storage) for all tasks

.. literalinclude:: ../../../samples/serial_tasks/serial_tasks.yaml
  :language: yaml
