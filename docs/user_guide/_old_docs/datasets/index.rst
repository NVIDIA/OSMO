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

.. _datasets:

================================================
Managing Datasets
================================================

Using the OSMO dataset CLI allows you to manage many aspects of your datasets.
There are several operations, such as info, tag, label, and metadata, that you can use to manage different levels of
categorization for your dataset. This categorization can be vital to finding the proper dataset to use or for
troubleshooting issues with your workflows.

.. note::
  The latest tag always refers to the most recent READY version and cannot be changed by you. Before performing any dataset operations, make sure that you have:

  * logged into OSMO
  * configured data credentials as described :ref:`Credentials <credentials>` section

To see a full listing of operations for the command, you can run it from the command line as follows:

.. code-block:: bash

  $ osmo dataset -h
  usage: osmo dataset [-h] {info,upload,delete,download,list,tag,label,metadata,query,collect,access,copy,inspect,checksum} ...

  positional arguments:
    {info,upload,delete,download,list,tag,label,metadata,query,collect,access,copy,inspect,checksum}
      info                Provide details of the dataset/collection
      upload              Upload a new dataset/collection
      delete              Delete an existing dataset/collection
      download            Download the dataset
      update              Creates a new dataset version from an existing version by adding or removing files. The remove operation happens before the add.
      recollect           Add or remove datasets from a collection.
      list                List all Datasets/Collections uploaded by the user
      tag                 Update Dataset Version tags
      label               Update Dataset labels.
                          Note: The dictionaries are set up to handle recursive merging of your input with the data stored labels.
      metadata            Update Dataset Version metadata.
                          Note: The dictionaries are set up to handle recursive merging of your input with the data stored metadata.
      rename              Rename dataset/collection
      query               Query datasets based on metadata
      collect             Create a Collection
      bucket              List available and default buckets
      inspect             Display Dataset Directory
      checksum            Calculate Directory Checksum

  options:
    -h, --help            show this help message and exit

For more information and examples for each of the individual operations, see the following:

.. toctree::
   :glob:
   :maxdepth: 1

   ds_upload
   ds_collection
   ds_download
   ds_update
   ds_recollect
   ds_info
   ds_list
   ds_inspect
   ds_delete
   ds_tag
   ds_labels
   ds_metadata
   ds_rename
   ds_query
   ds_bucket
   ds_workflow
