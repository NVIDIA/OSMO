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

from functools import partial
import json
import sys
import time
from typing import Iterable

import kombu  # type: ignore # pylint: disable=unused-import
import kombu.mixins  # type: ignore # pylint: disable=unused-import
import kombu.transport.redis  # type: ignore # pylint: disable=unused-import
import kombu.transport.virtual  # type: ignore # pylint: disable=unused-import
import opentelemetry.metrics as otelmetrics
import pydantic

import src.lib.utils.logging
from src.utils.job import jobs
from src.utils.metrics import metrics
from src.utils import connectors, static_config
from src.utils.progress_check import progress


class DelayedJobMonitorConfig(connectors.RedisConfig, connectors.PostgresConfig,
                              src.lib.utils.logging.LoggingConfig, static_config.StaticConfig,
                              metrics.MetricsCreatorConfig):
    """Configuration for DelayedJobMonitor."""
    # The amount of time the monitor waits before polling again (in seconds)
    poll_interval: int = pydantic.Field(
        command_line='poll_interval',
        env='OSMO_POLL_INTERVAL',
        default=5,
        description='How long to wait (In seconds) between checking the delayed job queue')
    progress_file: str = pydantic.Field(
        command_line='progress_file',
        env='OSMO_PROGRESS_FILE',
        default='/var/run/osmo/last_progress',
        description='The file to write progress timestamps to (For liveness/startup probes)')
    enable_metrics: bool = pydantic.Field(
        command_line='enable_metrics',
        env='OSMO_ENABLE_METRICS',
        action='store_true',
        description='Enable metrics collection')


class DelayedJobMonitor:
    """A DelayedJobMonitor subscribes to the job queue and executes jobs.
    """
    def __init__(self, config: DelayedJobMonitorConfig):
        self.config = config
        self.redis_client = connectors.RedisConnector.get_instance().client
        self.postgres = connectors.PostgresConnector(self.config)

    def run(self):
        current_timestamp = time.time()
        delayed_jobs = self.redis_client.zrangebyscore(jobs.DELAYED_JOB_QUEUE, '-inf',
            current_timestamp)
        for serialized_job in delayed_jobs:
            serialized_job_decoded = serialized_job.decode('utf-8')
            try:
                job_spec = json.loads(serialized_job_decoded)
                job = jobs.FRONTEND_JOBS[job_spec['job_type']](**job_spec)
                job.send_job_to_queue()
            except pydantic.ValidationError as error:
                print(f'Validation error caught, for this job spec: {job_spec}\n'
                      f'Validation error: {error}')
            # Remove from Zset after placing job in the queue
            self.redis_client.zrem(jobs.DELAYED_JOB_QUEUE, serialized_job_decoded)

# Instrumentation
def get_set_length(url, *args) -> Iterable[otelmetrics.Observation]:  # pylint: disable=unused-argument
    '''
    Callback to send set size for DELAYED_JOB_QUEUE named set.
    Args:
        url: redis url
    '''
    redis_client = connectors.RedisConnector.get_instance().client
    current_timestamp = time.time()
    yield otelmetrics.Observation(redis_client.zcount(jobs.DELAYED_JOB_QUEUE, '-inf',
                                                      current_timestamp), {})

def main():
    config = DelayedJobMonitorConfig.load()
    src.lib.utils.logging.init_logger('delayed-job-monitor', config)
    connectors.RedisConnector(config)

    if config.enable_metrics:
        delayed_job_monitor_metrics = metrics.MetricCreator(config=config).get_meter_instance()
        get_delayed_set_length_callable = partial(get_set_length, config.redis_url)
        delayed_job_monitor_metrics.send_observable_gauge('osmo_delayed_job_length',
                                             callbacks=get_delayed_set_length_callable,
                                             description='Set length for OSMO delayed jobs',
                                             unit='count')

    try:
        progress_writer = progress.ProgressWriter(config.progress_file)
        # Create the progress file immediately for startup probe
        progress_writer.report_progress()
        worker = DelayedJobMonitor(config)
        while True:
            time.sleep(config.poll_interval)
            worker.run()
            progress_writer.report_progress()

    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == '__main__':
    main()
