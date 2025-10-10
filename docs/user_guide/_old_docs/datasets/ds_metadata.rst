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

.. _ds_metadata:

================================================
Metadata
================================================

Metadata is the additional information that can be assigned to each dataset version to help identify them uniquely. Metadata can be used to query the relevant versions inside a dataset or collection.


.. code-block:: bash

  $ osmo dataset metadata -h
  usage: osmo dataset metadata [-h] [--file] [--set SET [SET ...]] [--delete DELETE [DELETE ...]] [--format-type {json,text}] name

  positional arguments:
    name                  Dataset name to update. Specify bucket and tag/version with
                          [bucket/]DS[:tag/version].

  options:
    -h, --help            show this help message and exit
    --file, -f
    --set SET [SET ...], -s SET [SET ...]
                          Set metadata from dataset in the form "<key>:<type>:<value>" where type is string or numericor the file-path
    --delete DELETE [DELETE ...], -d DELETE [DELETE ...]
                          Delete metadata from dataset in the form "<key>"or the file-path
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).

  Ex.
  osmo dataset metadata DS1:latest --set key1:string:value1 --delete key2
  osmo dataset metadata Dataset1:v1 --set obj.rotation:numeric:10
  osmo dataset metadata Dataset1:v1 --set obj.color:string:red
  osmo dataset metadata Dataset1:v1 --set obj.numeric_array:numeric:1,2
  osmo dataset metadata Dataset1:v1 --set obj.string_array:string:a,b,c.

Example metadata:

.. code-block:: yaml

  obj:
    rotation: 10.0
    color: red
    numeric_array: [1.0, 2.0]
    string_array: ['a', 'b', 'c']

Metadata can be set using a YAML file. Sample YAML file with metadata:

.. code-block:: yaml

  # file.yaml with all the metadata
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


To delete a metadata using a file, list the metadata:

.. code-block::

  obj_model.name
  obj_textures
  obj_depth
  obj_count_per_frame_choice
