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
Module for managing benchmark metrics.
"""

import dataclasses
import functools
import json
import logging
import os
from typing import (
    Callable,
    Concatenate,
    ParamSpec,
    Protocol,
    TypeVar,
)

import pydantic

from ...utils import common as utils_common


logger = logging.getLogger(__name__)

METRICS_FILE_SUFFIX = '.json'


R = TypeVar('R', bound='MetricsProducer')  # Return type of the decorated function
S = TypeVar('S', bound='MetricsWriter')  # Self type of the decorated function
P = ParamSpec('P')  # Parameter specification of the decorated function


###########################
#     Metrics schemas     #
###########################


class MetricsWriter(Protocol):
    """
    A protocol for objects that can write metrics to a file.
    """

    @property
    def metrics_dir(self) -> str | None:
        ...


class MetricsProducer(Protocol):
    """
    A protocol for objects that can produce metrics.
    """

    def to_metrics(self) -> 'OperationMetrics':
        ...


class MetricsProducingError(Exception, MetricsProducer):
    """
    An error that can produce metrics.
    """
    pass


@pydantic.dataclasses.dataclass(frozen=True, kw_only=True,)
class OperationMetrics:
    """
    A base class for all storage operation metrics.
    """
    start_time_ms: int = pydantic.Field(
        ...,
        description='The start time of the operation in milliseconds.',
    )

    end_time_ms: int = pydantic.Field(
        ...,
        description='The end time of the operation in milliseconds.',
    )

    duration_ms: int = pydantic.Field(
        ...,
        description='The duration of the operation in milliseconds.',
    )


@pydantic.dataclasses.dataclass(frozen=True)
class TransferMetrics(OperationMetrics):
    """
    A class for storing transfer metrics.

    :param int start_time_ms: The start time of the transfer in milliseconds.
    :param int end_time_ms: The end time of the transfer in milliseconds.
    :param int duration_ms: The duration of the transfer in milliseconds.
    :param int average_mbps: The average MBPS of the transfer.
    :param int total_bytes_transferred: The total bytes transferred.
    :param int total_number_of_files: The total number of files transferred.
    """

    average_mbps: int = pydantic.Field(
        ...,
        description='The average MBPS of the transfer.',
    )

    total_bytes_transferred: int = pydantic.Field(
        ...,
        description='The total bytes transferred.',
    )

    total_number_of_files: int = pydantic.Field(
        ...,
        description='The total number of files transferred.',
    )


##################################
#     Metrics implementation     #
##################################


def _write_metrics(
    operation_name: str,
    metrics_dir: str,
    metrics: OperationMetrics,
):
    """ Write the metric object to a file. """
    try:
        timestamp = str(int(utils_common.current_time().timestamp() * 1000))
        metrics_file_name = f'{operation_name}_{timestamp}{METRICS_FILE_SUFFIX}'

        target = os.path.join(metrics_dir, metrics_file_name)

        if not os.path.exists(metrics_dir):
            os.makedirs(metrics_dir, exist_ok=True)

        with open(target, 'w', encoding='utf-8') as metrics_file:
            json.dump(
                dataclasses.asdict(metrics),
                metrics_file,
                indent=4,
                separators=(',', ':'),
            )

    except (OSError, PermissionError, ValueError) as error:
        # Failure to write metrics should not interfere with the overall data operation
        logger.warning('Failed to create metrics file, skipping: %s', error)


###############################
#     Metrics public APIs     #
###############################


def calculate_mbps(num_bytes: int, num_secs: float) -> int:
    """
    Calculate megabits per second from the number of bytes and seconds.
    """
    if num_secs <= 0:
        return 0
    return int(round((num_bytes * 8) / (1_000_000 * num_secs)))


def metered(
    operation_name: str,
) -> Callable[[Callable[Concatenate[S, P], R]], Callable[Concatenate[S, P], R]]:
    """
    A decorator to meter storage operations. It preserves the original method signature
    and return type.

    IMPORTANT: This does not support stream operations (because metrics can only be read
    after the stream is complete).

    :param str operation_name: The name of the operation to meter.
    :return: The decorated function.
    :rtype: Callable[[Callable[Concatenate[S, P], R]], Callable[Concatenate[S, P], R]]
    """
    def decorate(func: Callable[Concatenate[S, P], R]) -> Callable[Concatenate[S, P], R]:

        @functools.wraps(func)
        def wrapper(self: S, *args: P.args, **kwargs: P.kwargs) -> R:
            metrics_dir = self.metrics_dir

            try:
                result = func(self, *args, **kwargs)
                if metrics_dir is None:
                    return result

                _write_metrics(
                    operation_name,
                    metrics_dir,
                    result.to_metrics(),
                )
                return result

            except MetricsProducingError as error:
                if metrics_dir is not None:
                    _write_metrics(
                        operation_name,
                        metrics_dir,
                        error.to_metrics(),
                    )
                raise error

        return wrapper

    return decorate
