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

.. _pl_usage:

================================================
Usage
================================================

.. _pl_usage_data_list:

Data List
=========

.. code-block:: python
  :substitutions:

  import osmo.data

  REMOTE_URI = '|data_path|'

  # Fetch all objects from the data path and print the results
  list_results = osmo.data.list_files(REMOTE_URI)
  for result in list_results:
    print(result)

  # Fetch all objects from the data path with prefix and print the results
  list_results = osmo.data.list_files(REMOTE_URI, prefix='my_prefix')
  for result in list_results:
    print(result)

.. _pl_usage_data_download:

Data Download
=============

.. code-block:: python
  :substitutions:

  import osmo.data

  REMOTE_URI = '|data_path|'
  DOWNLOAD_DIR = '/tmp/downloads'

  # Download specific objects from {REMOTE_URI}/my_folder to the download directory
  download_result = osmo.data.download_files(
      [REMOTE_URI + '/my_folder/a.txt', REMOTE_URI + '/my_folder/b.txt'],
      DOWNLOAD_DIR)

  # Download entire {REMOTE_URI}/my_folder_2 to the download directory
  download_result_2 = osmo.data.download_files(
      [REMOTE_URI + '/my_folder_2'],
      DOWNLOAD_DIR)

  # Download all objects from {REMOTE_URI} to the download directory
  download_result_all = osmo.data.download_files([REMOTE_URI], DOWNLOAD_DIR)

.. _pl_usage_data_upload:

Data Upload
===========

.. code-block:: python
  :substitutions:

  import osmo.data

  REMOTE_URI = '|data_path|'
  UPLOAD_DIR = '/tmp/client-library/uploads'

  # Upload objects from directory/folder to {REMOTE_URI}/folder
  upload_result = osmo.data.upload_files(REMOTE_URI, [UPLOAD_DIR + '/folder'])

  # Upload all objects from directory to {REMOTE_URI}
  upload_result_all = osmo.data.upload_files(REMOTE_URI, [UPLOAD_DIR])

.. _pl_usage_data_delete:

Data Delete
===========

.. code-block:: python
  :substitutions:

  import osmo.data

  REMOTE_URI = '|data_path|'

  # Delete all objects from {REMOTE_URI}/folder/
  osmo.data.delete_files(REMOTE_URI, prefix='folder/')

  # Delete all objects from {REMOTE_URI}
  osmo.data.delete_files(REMOTE_URI)
