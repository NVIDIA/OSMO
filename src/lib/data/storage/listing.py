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
Top level module for listing data from a storage client.
"""

import datetime
import os
from typing import Generator

import pydantic

from . import common
from .core import provider


########################
#     List schemas     #
########################

@pydantic.dataclasses.dataclass(
    config=pydantic.ConfigDict(
        frozen=True,
    ),
)
class ListResult:
    """
    Dataclass for a single list result from :py:meth:`Client.list`.

    :param str storage_uri: The full storage URI of the object
    :param str key: The key/path of the object
    :param int size: The size in bytes of the object
    :param str checksum: The checksum of the object
    :param datetime last_modified: The last modified time of the object
    """

    storage_uri: str = pydantic.Field(
        ...,
        description='The full storage URI of the object.',
    )

    key: str = pydantic.Field(
        ...,
        description='The key/path of the object.',
    )

    size: int = pydantic.Field(
        ...,
        description='The size in bytes of the object.',
    )

    checksum: str | None = pydantic.Field(
        default=None,
        description='The checksum of the object.',
    )

    last_modified: datetime.datetime | None = pydantic.Field(
        default=None,
        description='The last modified time of the object.',
    )

    is_directory: bool = pydantic.Field(
        default=False,
        description='Whether the result is a directory.',
    )


@pydantic.dataclasses.dataclass(
    config=pydantic.ConfigDict(
        frozen=True,
    ),
)
class ListParams:
    """
    Dataclass for list parameters.
    """

    container_uri: str = pydantic.Field(
        ...,
        description='The URI of the container to use to construct the storage URI of the objects.',
    )

    container: str = pydantic.Field(
        ...,
        description='The container to list objects from.',
    )

    prefix: str | None = pydantic.Field(
        default=None,
        description='The prefix to list objects from.',
    )

    regex: str | None = pydantic.Field(
        default=None,
        description='The regular expression to filter objects.',
    )

    recursive: bool = pydantic.Field(
        default=True,
        description='Whether to list recursively.',
    )


@pydantic.dataclasses.dataclass(frozen=True, kw_only=True)
class ListSummary(common.OperationSummary):
    """
    Summary of a list operation.
    """

    count: int = pydantic.Field(
        default=0,
        description='The number of objects found.',
    )


ListStream = common.OperationStream[ListResult, ListSummary]


############################
#     List public APIs     #
############################


def list_objects(
    client_factory: provider.StorageClientFactory,
    list_params: ListParams,
) -> ListStream:
    """
    Top level entry point for listing objects from remote storage.

    :param client_factory: The client factory to use for the listing.
    :param list_params: The list parameters.

    :return: A generator of :py:class:`ListResult` found at the remote URI
    """
    def _list_response() -> Generator[ListResult, None, ListSummary]:

        with client_factory.to_provider() as client_provider:

            with client_provider.get() as storage_client:

                list_objects_response = storage_client.list_objects(
                    bucket=list_params.container,
                    prefix=list_params.prefix,
                    regex=list_params.regex,
                    recursive=list_params.recursive,
                ).result

                count = 0

                with list_objects_response.objects as object_iterator:
                    for obj in object_iterator:
                        count += 1
                        yield ListResult(
                            storage_uri=os.path.join(list_params.container_uri, obj.key),
                            key=obj.key,
                            size=obj.size,
                            checksum=obj.checksum,
                            last_modified=obj.last_modified,
                            is_directory=obj.is_directory,
                        )

                    return ListSummary(  # pylint: disable=unexpected-keyword-arg
                        start_time=object_iterator.context.start_time,
                        end_time=object_iterator.context.end_time,
                        retries=object_iterator.context.retries,
                        failures=[str(error) for error in object_iterator.context.errors],
                        count=count,
                    )

    return common.OperationStream[ListResult, ListSummary](
        _list_response(),
    )
