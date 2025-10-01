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

.. _concepts_ds_version:

================================================
Version
================================================

A dataset can have multiple **versions** and each version is given an Universal Unique Identifier
(UUID). A given UUID of a dataset is immutable and always refers to the exact set of files and
directories in the dataset. To save space in object storage, older versions of a dataset can
be deleted.

The following status states are possible for a dataset version:

* ``PENDING``: A version number has been allocated for the dataset version and its files are in
  the process of being uploaded to object storage. It is not available for download yet.
* ``READY``: The dataset version has been successfully uploaded and is available for download.
* ``PENDING_DELETE``: The dataset version is in the process of being deleted and is no longer
  available for download.
