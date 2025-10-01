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

import abc
import datetime
import enum
import json
import logging
from typing import Dict, List, Optional
import uuid

import pydantic
import kombu # type: ignore
import kombu.pools  # type: ignore

from src.lib.utils import osmo_errors
from src.utils import connectors
from src.utils.progress_check import progress

# How long to keep uuids for deduplicating jobs
UNIQUE_JOB_TTL = 5 * 24 * 60 * 60


class JobStatus(enum.Enum):
    """Describes the execution status of a job"""
    # The job completed successfully and may be acknowledge
    SUCCESS = 'SUCCESS'
    # The job failed but due to some temporary issue (ie. network outage) and should be retried
    # later
    FAILED_RETRY = 'FAILED_RETRY'
    # The job failed and should not be retried
    FAILED_NO_RETRY = 'FAILED_NO_RETRY'


class JobResult(pydantic.BaseModel):
    """ Describes the result of a job """
    status: JobStatus = JobStatus.SUCCESS
    message: Optional[str]

    @property
    def retry(self):
        return self.status == JobStatus.FAILED_RETRY

    def __str__(self) -> str:
        if self.message:
            return f'{self.status.name}: {self.message}'
        else:
            return self.status.name



class Job(pydantic.BaseModel):
    """
    Represents some task that needs to be executed by a worker. Pydantic
    is used so the fields in a job can be easily serialized/deserialized
    from JSON to allow storage in a message queue.
    """
    super_type: str = 'frontend'
    job_type: str | None = None
    job_id: str | None = None
    job_uuid: str = ''

    @classmethod
    def _get_job_id(cls, values):
        """ Generate the Job ID, if its not provided """
        raise ValueError('No job_id provided!')

    @classmethod
    def _get_allowed_job_type(cls) -> List[str]:
        return []

    @classmethod
    def _get_allowed_super_type(cls) -> List[str]:
        return ['frontend', 'backend']

    @pydantic.root_validator(pre=True)
    @classmethod
    def validate_job_type_and_id(cls, values) -> str:
        """
        Validates job_type. Returns the value of job_type if valid.
        """
        # If no value is provided, then this is a newly created job. Set the job type based on the
        # class name
        if 'job_type' not in values or values['job_type'] is None:
            values['job_type'] = cls.__name__
        # If a value is provided, make sure it is correct.
        # values['job_type'] not in cls.__name__ and
        elif  not (values['job_type'] == cls.__name__ or \
                   values['job_type'] in cls._get_allowed_job_type()):
            raise osmo_errors.OSMOServerError(
                f'Tried to initialize a {cls.__name__} instance with ' \
                f'job_type as {values["job_type"]} or not in {cls._get_allowed_job_type()}')

        if 'job_id' not in values or values['job_id'] is None:
            values['job_id'] = cls._get_job_id(values)

        return values

    @pydantic.validator('super_type', always=True)
    @classmethod
    def validate_super_type(cls, value) -> str:
        """
        Validates super_type. Returns the value of super_type if valid.
        """
        if value not in cls._get_allowed_super_type():
            raise osmo_errors.OSMOServerError(
                f'Tried to initialize a {cls.__name__} instance with super_type as {value}')
        return value

    @pydantic.validator('job_uuid', always=True)
    @classmethod
    def validate_job_uuid(cls, value: str) -> str:
        """
        Returns the a uuid for the job.
        """
        return value or str(uuid.uuid4())

    def get_metadata(self) -> Dict[str, str]:
        """
        Returns job metadata for metrics
        """
        return {
            'job_type': self.job_type if self.job_type is not None else ''
        }

    def __str__(self) -> str:
        return f'(type={self.job_type}, id={self.job_id})'

    class Config:
        allow_extra = False
        ignore_extra = False

    def log_submission(self):
        logging.info('Submitted new job %s to the job queue', self)

    def log_delayed_submission(self, delay: datetime.timedelta):
        logging.info('Submitted new delayed job %s to the job queue with delay %s', self, delay)

    @abc.abstractmethod
    def get_redis_options(self):
        """
        Get redis options for frontend and backend jobs.
        """
        pass

    def send_job(self, redis_client, redis_config: connectors.RedisConfig, key_name: str):
        exchange, jobs, options = self.get_redis_options()
        with kombu.Connection(redis_config.redis_url,
            transport_options=options) as conn:
            with kombu.pools.producers[conn].acquire(block=True) as producer:
                producer.publish(json.loads(self.json()), exchange=exchange,
                                 declare=jobs, routing_key=self.job_type)
        self.log_submission()

        # If this is the first copy of the job, store the uuid in the database.
        redis_client.setnx(key_name, self.job_uuid)
        redis_client.expire(key_name, UNIQUE_JOB_TTL, nx=True)

    # TODO: Remove redis_config from function signature, and update all function
    # calls to stop passing redis_config
    def send_job_to_queue(self):
        """
        Sends a Job to the job queue.
        """
        redis_connector = connectors.RedisConnector.get_instance()
        redis_client = redis_connector.client

        key_name = f'dedupe:{self.job_id}'
        if redis_client.get(key_name):
            logging.info('Skipping enqueuing job %s because it is a duplicate', self)
            return

        self.send_job(redis_client, redis_connector.config, key_name)

    def log_labels(self) -> Dict[str, str]:
        """
        Returns a dictionary of labels for the job to use when logging.
        """
        return {}


def update_progress_writer(progress_writer: progress.ProgressWriter,
                           last_timestamp: datetime.datetime,
                           progress_iter_freq: datetime.timedelta) -> datetime.datetime:
    '''
    Writes the progress writer if the time frequency has passed
    Returns the last_timestamp that the writer was written to
    '''
    current_timestamp = datetime.datetime.now()
    time_elapsed = last_timestamp - current_timestamp
    if time_elapsed > progress_iter_freq:
        progress_writer.report_progress()
        last_timestamp = current_timestamp

    return last_timestamp
