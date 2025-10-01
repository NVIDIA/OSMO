# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

"""
The storage module provides classes and functions for working with data in a remote storage.

It includes classes and methods for handling data (i.e. uploading, downloading, listing,
and deleting) across various storage backends.
"""

from .backends import construct_storage_backend
from .backends.common import AccessType, StorageBackend, StoragePath
from .client import Client, SingleObjectClient
from .common import list_local_files
from .copying import CopySummary
from .core.executor import ExecutorParameters, DEFAULT_NUM_PROCESSES, DEFAULT_NUM_THREADS
from .core.header import RequestHeaders
from .deleting import DeleteSummary
from .downloading import DownloadWorkerInput, DownloadSummary
from .streaming import BytesStream, BytesIO, LinesStream, StreamSummary
from .listing import ListResult, ListStream, ListSummary
from .uploading import UploadCallback, UploadWorkerInput, UploadSummary
