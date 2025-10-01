"""
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
"""

import logging
import os
import time
from typing import Dict, Iterable, List, Tuple

# Import with type: ignore to avoid import errors in linting
import opentelemetry.metrics as otelmetrics  # type: ignore

from src.lib.utils import osmo_errors
from src.utils.metrics import metrics
from src.service.core.workflow import helpers
from src.utils import connectors


# Cache for metric results
_metric_cache: List[otelmetrics.Observation] = []
_last_refresh_time: float = 0
_CACHE_TTL_SECONDS: int = 30  # Refresh cache every 30 seconds


def _is_task_metrics_disabled() -> bool:
    """Check if task metrics are disabled via environment variable"""
    return os.getenv('OSMO_DISABLE_TASK_METRICS', '').lower() in (
        'true', '1', 'yes'
    )


def get_task_metrics(
    *args,  # pylint: disable=unused-argument
    minutes_ago: int = 5
) -> Iterable[otelmetrics.Observation]:
    """
    Callback to send task metrics for OSMO service tasks.
    Captures metrics for tasks that are either:
    - Currently active (no end_time)
    - Recently completed (end_time within the last N minutes)

    Uses caching to prevent running expensive queries too frequently.

    Args:
        args: Additional arguments passed by the metrics system
        minutes_ago: How many minutes back to look for completed tasks

    Returns:
        Iterable of metric observations
    """
    # Check if task metrics are disabled
    if _is_task_metrics_disabled():
        return []

    global _metric_cache, _last_refresh_time  # pylint: disable=global-variable-not-assigned

    current_time = time.time()

    # Check if cache is valid and not expired
    cache_is_valid = (
        _metric_cache and  # Cache has data
        _last_refresh_time > 0 and  # Cache has been initialized
        (current_time - _last_refresh_time) < _CACHE_TTL_SECONDS
    )

    if cache_is_valid:
        logging.debug(
            'Using cached metrics (age: %.1fs)',
            current_time - _last_refresh_time
        )
        return _metric_cache

    # Cache expired or empty, refresh metrics data
    prev_age: float = 0
    if _last_refresh_time > 0:
        prev_age = current_time - _last_refresh_time

    logging.info(
        'Refreshing metrics cache (previous age: %.1fs)',
        prev_age
    )

    try:
        database = connectors.PostgresConnector.get_instance()
        rows = helpers.get_recent_tasks(database, minutes_ago)
    except osmo_errors.OSMODatabaseError as err:
        logging.debug(
            'No recent tasks found (query returned zero rows): %s',
            str(err)
        )
        rows = []

    # Count tasks by unique label combinations
    task_counts: Dict[Tuple[Tuple[str, str], ...], int] = {}
    for row in rows:
        labels = {
            'pool': row['pool'] or 'unknown',
            'user': row['user'],
            'workflow_uuid': row['workflow_uuid'],
            'status': row['status']
        }
        key = tuple(sorted(labels.items()))
        task_counts[key] = task_counts.get(key, 0) + 1

    # Generate observations
    _metric_cache.clear()
    for labels_tuple, count in task_counts.items():
        labels = dict(labels_tuple)
        _metric_cache.append(otelmetrics.Observation(count, labels))

    _last_refresh_time = current_time

    return _metric_cache


def register_task_metrics():
    """Register the task metrics with the metrics system"""
    # Check if task metrics are disabled
    if _is_task_metrics_disabled():
        return

    try:
        metric_creator = metrics.MetricCreator.get_meter_instance()

        # Register the observable gauge for task counts
        metric_creator.send_observable_gauge(
            name='osmo_tasks_count',
            callbacks=get_task_metrics,
            description='Count of OSMO tasks by status, pool, workflow',
            unit='count'
        )
    except (ValueError, AttributeError, TypeError) as err:
        # More specific exception handling
        logging.error('Failed to register task metrics: %s', str(err))
