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

.. _ds_labels:

================================================
Labels
================================================

Labels are a dictionary per dataset or collection. They describe the entire dataset and collection.

.. code-block:: bash

  $ osmo dataset label -h
  usage: osmo dataset label [-h] [--file] [--set SET [SET ...]] [--delete DELETE [DELETE ...]] [--format-type {json,text}] name

  positional arguments:
    name                  Dataset name to update. Specify bucket with [bucket/][DS].

  options:
    -h, --help            show this help message and exit
    --file, -f
    --set SET [SET ...], -s SET [SET ...]
                          Set labels for dataset in the form "<key>:<type>:<value>" where type is string or numericor the file-path
    --delete DELETE [DELETE ...], -d DELETE [DELETE ...]
                          Delete labels from dataset in the form "<key>"or the file-path
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).

  Ex.
  osmo dataset label DS1 --set key1:string:value1 --delete key2
  osmo dataset label Dataset1 --set obj.rotation:numeric:10
  osmo dataset label Dataset1 --set obj.color:string:red
  osmo dataset label Dataset1 --set obj.numeric_array:numeric:1,2
  osmo dataset label Dataset1 --set obj.string_array:string:a,b,c.

Labels are used to query the relevant dataset as needed.

Example label:

.. code-block:: yaml

  obj:
    rotation: 10.0
    color: red
    numeric_array: [1.0, 2.0]
    string_array: ['a', 'b', 'c']

Labels can be set using a YAML file. Sample YAML file with labels:

.. code-block:: yaml

  # file.yaml with all the labels
  obj_model:
    name: plane.usd
  obj_textures:
    - assets/apriltag_textures.txt
    - assets/apriltag_textures1.txt
  obj_depth: 20.5
  obj_count_per_frame_choice:
    - 1
    - 2
    - 3

To delete a label using a file, list the labels:

.. code-block::

  obj_model.name
  obj_textures
  obj_depth
  obj_count_per_frame_choice
