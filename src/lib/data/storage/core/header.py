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
Common definitions for extra HTTP headers to be passed to the storage backend.
"""

from typing import Dict

from pydantic import dataclasses


@dataclasses.dataclass(frozen=True)
class RequestHeaders:
    """
    A base class for request headers.
    """
    headers: Dict[str, str]


@dataclasses.dataclass(frozen=True)
class ClientHeaders(RequestHeaders):
    """
    A dataclass for client headers.
    """
    pass


@dataclasses.dataclass(frozen=True)
class UploadRequestHeaders(RequestHeaders):
    """
    A dataclass for upload request headers.
    """
    pass


@dataclasses.dataclass(frozen=True)
class DownloadRequestHeaders(RequestHeaders):
    """
    A dataclass for download request headers.
    """
    pass


@dataclasses.dataclass(frozen=True)
class CopyRequestHeaders(RequestHeaders):
    """
    A dataclass for copy request headers.
    """
    pass


@dataclasses.dataclass(frozen=True)
class DeleteRequestHeaders(RequestHeaders):
    """
    A dataclass for delete request headers.
    """
    pass


@dataclasses.dataclass(frozen=True)
class FetchRequestHeaders(RequestHeaders):
    """
    A dataclass for fetch request headers.
    """
    pass


@dataclasses.dataclass(frozen=True)
class ListRequestHeaders(RequestHeaders):
    """
    A dataclass for list request headers.
    """
    pass
