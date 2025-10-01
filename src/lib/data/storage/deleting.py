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
Top level module for storage delete operations.
"""

import logging

import pydantic
from pydantic import dataclasses

from . import common
from .core import provider
from ...utils import common as utils_common


logger = logging.getLogger(__name__)


##########################
#     Delete schemas     #
##########################


@dataclasses.dataclass(frozen=True)
class DeleteParams:
    """
    Dataclass for delete parameters.
    """

    container: str = pydantic.Field(
        ...,
        description='The container to delete objects from.',
    )

    prefix: str | None = pydantic.Field(
        default=None,
        description='The prefix of the objects to delete. It can be a directory or a '
                    'single object. If not provided, all objects in the container will be '
                    'deleted.',
    )

    regex: str | None = pydantic.Field(
        default=None,
        description='The regex to filter the objects to delete.',
    )


@dataclasses.dataclass(frozen=True, kw_only=True)
class DeleteSummary(common.OperationSummary):
    """
    Summary of a delete operation.
    """

    success_count: int = pydantic.Field(
        default=0,
        description='The number of objects that were successfully deleted.',
    )


##############################
#     Delete public APIs     #
##############################

def delete_objects(
    client_factory: provider.StorageClientFactory,
    delete_params: DeleteParams,
) -> DeleteSummary:
    """
    Delete one or more objects in the object storage container.

    Args:
        client_factory: The factory to create the storage client.
        delete_params: The parameters for the delete operation.

    Returns:
        DeleteSummary: The summary of the delete operation.

    Raises:
        common.OperationError: If the delete fails.
    """
    start_time = utils_common.current_time()

    try:
        with client_factory.to_provider() as client_provider:

            with client_provider.get() as storage_client:

                response = storage_client.delete(
                    bucket=delete_params.container,
                    prefix=delete_params.prefix,
                    regex=delete_params.regex,
                )

                return DeleteSummary(  # pylint: disable=unexpected-keyword-arg
                    success_count=response.result.success_count,
                    start_time=start_time,
                    end_time=utils_common.current_time(),
                    retries=response.context.retries,
                    failures=[str(failure) for failure in response.result.failures],
                )

    except Exception as error:  # pylint: disable=broad-except
        raise common.OperationError(
            f'Error deleting objects: {error}',
            summary=DeleteSummary(  # pylint: disable=unexpected-keyword-arg
                start_time=start_time,
                end_time=utils_common.current_time(),
                failures=[str(error)],
            ),
        ) from error
