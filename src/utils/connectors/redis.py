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

import asyncio
import datetime
import enum
import logging
from typing import AsyncGenerator, Dict, Optional

import aiofiles  # type: ignore
import kombu  # type: ignore
import pydantic
import redis.asyncio  # type: ignore

from src.lib.utils import osmo_errors


EXCHANGE = kombu.Exchange('job_queue', type='direct', delivery_mode='persistent')
JOBS = [
    kombu.Queue('cancel_workflow', EXCHANGE, routing_key='CancelWorkflow'),
    kombu.Queue('submit_workflow', EXCHANGE, routing_key='SubmitWorkflow'),
    kombu.Queue('update_group', EXCHANGE, routing_key='UpdateGroup'),
    kombu.Queue('cleanup_workflow', EXCHANGE, routing_key='CleanupWorkflow'),
    kombu.Queue('check_run_timeout', EXCHANGE, routing_key='CheckRunTimeout'),
    kombu.Queue('check_queue_timeout', EXCHANGE, routing_key='CheckQueueTimeout'),
    kombu.Queue('reschedule_task', EXCHANGE, routing_key='RescheduleTask'),
    kombu.Queue('upload_workflow_files', EXCHANGE, routing_key='UploadWorkflowFiles'),
    kombu.Queue('upload_app', EXCHANGE, routing_key='UploadApp'),
    kombu.Queue('delete_app', EXCHANGE, routing_key='DeleteApp'),
]

BACKEND_JOBS = [
    kombu.Queue('backend_submit_group', EXCHANGE, routing_key='CreateGroup'),
    kombu.Queue('backend_cleanup_group', EXCHANGE, routing_key='CleanupGroup'),
    kombu.Queue('backend_reschedule_task', EXCHANGE, routing_key='RescheduleTask'),
    kombu.Queue('backend_label_node', EXCHANGE, routing_key='LabelNode'),
    kombu.Queue('backend_modify_queues', EXCHANGE, routing_key='BackendSynchronizeQueues'),
    kombu.Queue('backend_sync_test', EXCHANGE, routing_key='BackendSynchronizeBackendTest'),
]

JOB_QUEUE_PREFIX = '{osmo}:{job-queue}:{service}'
BACKEND_JOB_QUEUE_PREFIX = '{osmo}:{job-queue}:{backend}'

# Options to pass to the kombu redis transport. Here we set a global key prefix that is
# used to calculate the slot hash. This way, all queues made by kombu end up in the same
# slot and hence same shard. This is needed to avoid crossslot key errors when using a redis
# cluster
TRANSPORT_OPTIONS = {'global_keyprefix': f'{JOB_QUEUE_PREFIX}:'}

MAX_LOG_TTL = 20 * 24 * 60 * 60

class RedisConfig(pydantic.BaseModel):
    """Manages the configuration for the redis database"""
    redis_host: str = pydantic.Field(
        command_line='redis_host',
        env='OSMO_REDIS_HOST',
        default='localhost',
        description='The hostname of the redis server to connect to.')
    redis_port: int = pydantic.Field(
        command_line='redis_port',
        env='OSMO_REDIS_PORT',
        default=6379,
        description='The port of the redis server to connect to.')
    redis_password: Optional[str] = pydantic.Field(
        command_line='redis_password',
        env='OSMO_REDIS_PASSWORD',
        default=None,
        description='The password, if any, to authenticate with the redis server')
    redis_tls_enable: bool = pydantic.Field(
        command_line='redis_tls_enable',
        env='OSMO_REDIS_TLS_ENABLE',
        default=False,
        description='Flag to connect to redis server using TLS, false by default')
    redis_db_number: int = pydantic.Field(
        command_line='redis_db_number',
        env='OSMO_REDIS_DB_NUMBER',
        default=0,
        description='Redis database number to connect to. Default value is 0')

    @property
    def redis_url(self):
        protocol = 'rediss' if self.redis_tls_enable else 'redis'
        if self.redis_password:
            return f'{protocol}://:{self.redis_password}@{self.redis_host}:{self.redis_port}/' +\
                   f'{self.redis_db_number}'
        else:
            return f'{protocol}://{self.redis_host}:{self.redis_port}/{self.redis_db_number}'


class RedisConnector:
    """ Singleton instance of the Redis client object. """
    _instance = None

    @staticmethod
    def get_instance():
        """ Static access method. """
        if not RedisConnector._instance:
            raise osmo_errors.OSMOError(
                'Redis Connector has not been created!')
        return RedisConnector._instance

    def __init__(self, config: RedisConfig):
        if RedisConnector._instance:
            raise osmo_errors.OSMOError(
                'Only one instance of Redis Connector can exist!')

        logging.debug('Connecting to redis database at %s...', config.redis_host)
        self.config = config
        self.client = redis.from_url(config.redis_url)
        logging.debug('Finished connecting to redis database')
        RedisConnector._instance = self


class IOType(enum.Enum):
    """ Represents the io_type of a log line. """
    STDOUT = 'STDOUT'
    STDERR = 'STDERR'
    # The control message of ending a stream
    END_FLAG = 'END_FLAG'
    OSMO_CTRL = 'OSMO_CTRL'
    DOWNLOAD = 'DOWNLOAD'
    UPLOAD = 'UPLOAD'
    LOG_DONE = 'LOG_DONE'
    METRICS = 'METRICS'
    # Delimiter for Dumping Message
    DUMP = 'DUMP'
    # Use to synchronize tasks in a group
    BARRIER = 'BARRIER'

    def ctrl_logs(self) -> bool:
        """ Logs pertaining to OSMO control. """
        return self.name in ('OSMO_CTRL', 'DOWNLOAD', 'UPLOAD')

    def workflow_logs(self) -> bool:
        """ Logs pertaining to workflow execution output and data operations. """
        return self.name in ('STDOUT', 'STDERR', 'DOWNLOAD', 'UPLOAD')


class LogStreamBody(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the log stream body. """
    source: str
    retry_id: int
    time: datetime.datetime
    text: str
    io_type: IOType


async def redis_log_streamer(
    url: str, name: str, last_n_lines: int | None = None) -> AsyncGenerator[LogStreamBody, None]:
    """
    Streams logs from Redis.

    Args:
        url (str): The Redis url.
        name (str): The stream key.

    Yields:
        AsyncGenerator[connectors.LogStreamBody]: The logs line.
    """
    async with redis.asyncio.from_url(url) as redis_client:
        # Continue to fetch log lines until the end control message is met
        start_id = 0
        skip_streaming = False
        if last_n_lines:
            logs = await redis_client.xrevrange(name, count=last_n_lines)
            for start_id, log in reversed(logs):
                log = LogStreamBody(**{k.decode(): v.decode() for k, v in log.items()})
                if log.io_type == IOType.END_FLAG:
                    skip_streaming = True
                    break
                yield log

        while not skip_streaming:
            logs = None
            try:
                logs = await redis_client.xread({name: start_id}, 1)
                start_id, log = logs[0][-1][0]
                log = LogStreamBody(**{k.decode(): v.decode() for k, v in log.items()})
                if log.io_type == IOType.END_FLAG:
                    break
                yield log
            except IndexError:  # No new line
                await asyncio.sleep(1)  # Otherwise the stream will hang


async def redis_log_formatter(url: str, name: str, last_n_lines: int | None = None) -> \
    AsyncGenerator[str, None]:
    """
    Formats the log stream from Redis.

    Args:
        url (str): The Redis url.
        name (str): The stream key.

    Yields:
        Iterator[AsyncGenerator[str]]: Formatted logs.
    """
    async for line in redis_log_streamer(url, name, last_n_lines):
        # Align Lines
        date = str(line.time.replace(tzinfo=None, microsecond=0)).replace('-', '/')
        if line.io_type.ctrl_logs():
            # Occassionally CTRL may send an empty string due to tdqm
            if line.text:
                if line.retry_id > 0:
                    yield f'{date} [{line.source} retry-{line.retry_id}][osmo] {line.text}\n'
                else:
                    yield f'{date} [{line.source}][osmo] {line.text}\n'
        elif line.io_type == IOType.DUMP:
            yield f'{line.text}\n'
        else:
            if line.retry_id > 0:
                yield f'{date} [{line.source} retry-{line.retry_id}] {line.text}\n'
            else:
                yield f'{date} [{line.source}] {line.text}\n'


async def write_redis_log_to_disk(url: str, name: str, file_path: str):
    """
    Formats the log stream from Redis.

    Args:
        url (str): The Redis url.
        name (str): The stream key.
        file_path (str): The path to write the Redis logs to.

    """
    async with aiofiles.open(file_path, 'a', encoding='utf-8') as f:
        async for line in redis_log_formatter(url, name):
            await f.write(line)


def get_backend_option_name(backend: str) -> str:
    return f'{BACKEND_JOB_QUEUE_PREFIX}:{backend}:'


def get_backend_transport_option(backend: str) -> Dict:
    return {'global_keyprefix': get_backend_option_name(backend)}


def delete_redis_backend(backend: str, config: RedisConfig):
    r = redis.from_url(config.redis_url)
    for key in r.scan_iter(f'{get_backend_option_name(backend)}*'):
        r.delete(key)
