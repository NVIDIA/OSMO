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
Utility functions and classes for data processing and queue management.

This module provides:
- Queue management for chunk processing and benchmarking using Redis and Kombu
- Path validation for local and remote storage backends (S3, GS, TOS)
- Size string parsing and conversion utilities
- Regular expression validation

Classes:
    BenchmarkResult: Dataclass for storing benchmark metrics
    QueueType: Enum for different queue types
    QueueProducer: Manages message queues for chunk processing

Functions:
    is_remote_path: Validates and checks if a path is remote
    validate_size: Validates size strings with units
    convert_to_gib: Converts size strings to GiB
    is_regex: Validates regular expressions
"""

import argparse
from enum import Enum
import os
import re
import time
from typing import Dict

import amqp.exceptions # type: ignore
from kombu import Connection, Exchange, Queue  # type: ignore
from pydantic import dataclasses

URI_COMPONENT = r'[^/,;*]+'
TWO_REGEX = r'{2,}'
SWIFT_REGEX = fr'^swift://{URI_COMPONENT}(/{URI_COMPONENT}){TWO_REGEX}/*$'
S3_REGEX = fr'^s3://{URI_COMPONENT}(/{URI_COMPONENT})*/*$'
GS_REGEX = fr'^gs://{URI_COMPONENT}(/{URI_COMPONENT})*/*$'
TOS_REGEX = fr'^tos://{URI_COMPONENT}(/{URI_COMPONENT})+/*$'
STORAGE_BACKEND_REGEX = fr'({SWIFT_REGEX}|{S3_REGEX}|{GS_REGEX}|{TOS_REGEX})'

EXCHANGE_NAME = 'chunk_exchange'
QUEUE_NAME = 'chunk_queue'
BENCHMARK_QUEUE_NAME = 'chunk_benchmark_queue'


@dataclasses.dataclass
class BenchmarkResult:
    """
    Dataclass for benchmark results.

    :param int chunk_number: The chunk number being processed
    :param int retries: Number of retry attempts made
    :param float size: Size of the data
    :param str size_unit: Unit of the size
    :param list failed_messages: List of any failed messages
    :param dict benchmark_result: Dictionary containing benchmark metrics
    """
    chunk_number: int
    retries: int
    size: float
    size_unit: str
    failed_messages: list
    benchmark_result: dict

    def dict(self) -> Dict:
        """Convert benchmark result to dictionary format."""
        return {
            'chunk_number': self.chunk_number,
            'retries': self.retries,
            'size': self.size,
            'size_unit': self.size_unit,
            'failed_messages': self.failed_messages,
            'benchmark_result': self.benchmark_result
        }


class QueueType(Enum):
    CHUNK = 'chunk'
    BENCHMARK = 'benchmark'


class QueueProducer:
    """
    Producer class for enqueueing messages to Redis-backed queues.

    This class handles publishing messages to two types of queues:
    - A main queue for chunk processing
    - A benchmark queue for performance metrics

    The producer connects to Redis and sets up the required exchanges and queues
    for message routing. Messages are published with JSON serialization.

    Args:
        redis_url: URL of the Redis server to connect to
        max_queue_length: Maximum number of messages allowed in the queue (default: 100)

    Attributes:
        redis_url: Redis connection URL
        connection: Kombu connection object
        channel: Kombu channel for publishing
        exchange: Direct exchange for routing messages
        queue: Main processing queue
        benchmark_queue: Queue for benchmark results
        producer: Kombu producer for publishing messages
        max_queue_length: Maximum queue length before waiting
    """
    def __init__(self, redis_url: str, max_queue_length: int = 100):
        self.redis_url = redis_url
        self.max_queue_length = max_queue_length
        self.connection = Connection(redis_url)
        self.channel = self.connection.channel()

        self.exchange = Exchange(EXCHANGE_NAME, type='direct', delivery_mode=1,
                                 channel=self.channel)
        self.queue = Queue(QUEUE_NAME, self.exchange, routing_key='chunks', channel=self.channel)
        self.benchmark_queue = Queue(BENCHMARK_QUEUE_NAME, self.exchange,
                                     routing_key='benchmark_chunks',
                                     channel=self.channel)

        # Ensure queue exists
        self.queue.declare()

        # Create producer
        self.producer = self.connection.Producer(serializer='json', channel=self.channel)

    def get_queue_length(self) -> int:
        """Get the current length of the main queue"""
        try:
            client = self.channel.client
            main_count = client.llen(self.queue.name)
            benchmark_count = client.llen(self.benchmark_queue.name)

            # Get unacked messages count
            unacked_messages_count = client.hlen(self.channel.unacked_key)
            unacked_index_count = client.zcard(self.channel.unacked_index_key)
            unacked_count = max(unacked_messages_count, unacked_index_count)

            return main_count + unacked_count + benchmark_count
        except amqp.exceptions.ChannelError:
            return 0

    def wait_for_queue_space(self, check_interval: float = 1.0):
        """Wait until there is space in the queue"""
        while True:
            current_length = self.get_queue_length()
            if current_length < self.max_queue_length:
                break
            print(f'Queue is full ({current_length}/{self.max_queue_length}). Waiting for space...')
            time.sleep(check_interval)

    def enqueue(self, body: Dict, queue_type: QueueType):
        # Wait for queue space if needed
        self.wait_for_queue_space()

        routing_key = self.queue.routing_key if queue_type == QueueType.CHUNK \
            else self.benchmark_queue.routing_key

        self.producer.publish(
            body,
            exchange=self.exchange,
            routing_key=routing_key,
            declare=[self.queue if queue_type == QueueType.CHUNK else self.benchmark_queue]
        )

    def wait_for_queue_empty(self, check_interval: float = 10.0):
        """Wait until the queue is empty by checking message count periodically"""
        count = 1
        while True:
            try:
                # Get Redis client from Kombu's channel
                client = self.channel.client

                # Get message counts using Kombu's Redis client
                main_count = client.llen(self.queue.name)
                benchmark_count = client.llen(self.benchmark_queue.name)

                # Kombu
                unacked_messages_count = client.hlen(self.channel.unacked_key)
                unacked_index_count = client.zcard(self.channel.unacked_index_key)
                unacked_count = max(unacked_messages_count, unacked_index_count)
                total = main_count + unacked_count + benchmark_count

                if total == 0:
                    break
                if count % 6 == 0:
                    print(f'Waiting for queue to empty... '
                          f'pending messages: {total} '
                          f'(chunks queued: {main_count}, kpis queued: {benchmark_count}, '
                          f'unacked: {unacked_count})')
                    count = 0

                time.sleep(check_interval)
                count += 1
            except amqp.exceptions.ChannelError:
                # Queue no longer exists, which means it's empty
                break

    def is_queue_empty(self) -> bool:
        """Check if the queue is empty"""
        try:
            # Get Redis client from Kombu's channel
            client = self.channel.client

            # Get message counts using Kombu's Redis client
            main_count = client.llen(self.queue.name)
            benchmark_count = client.llen(self.benchmark_queue.name)

            # Kombu
            unacked_messages_count = client.hlen(self.channel.unacked_key)
            unacked_index_count = client.zcard(self.channel.unacked_index_key)
            unacked_count = max(unacked_messages_count, unacked_index_count)
            total = main_count + unacked_count + benchmark_count

            if total == 0:
                return True
            print(f'Waiting for queue to empty... '
                  f'pending messages: {total} '
                  f'(queued: {main_count}, unacked: {unacked_count})')
        except amqp.exceptions.ChannelError:
            # Queue no longer exists, which means it's empty
            return True

        return False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.connection.close()


def is_remote_path(path: str) -> bool:

    def split_string(text):
        # Split on ':' once only if it is not '://'
        parts = re.split(r'(?<!\\):(?!//)', text, maxsplit=1)
        if len(parts) > 2:
            raise Exception(f'Too many ":" in path {text}. Use delimiter "\" to '
                            'allow ":" in folder or file')
        parts = [part.replace(r'\:', ':') for part in parts]
        return parts

    split_path = split_string(path)
    has_asterisk = split_path[0].endswith('/*')
    if has_asterisk:
        split_path[0] = split_path[0][:-2]
    if not re.fullmatch(STORAGE_BACKEND_REGEX, split_path[0]):
        # Validate local path
        abs_path = os.path.abspath(split_path[0])
        if has_asterisk and not os.path.isdir(abs_path):
            raise Exception(f'Path does not exist: {abs_path}/*.')
        if not os.path.isdir(abs_path) and not os.path.isfile(abs_path):
            raise Exception(f'Path does not exist: {abs_path}.')
        return False
    return True


def validate_size(size_str: str) -> str:
    # Check if it's just a number
    try:
        size = float(size_str)
        if size <= 0:
            raise argparse.ArgumentTypeError('Size must be positive')
        return size_str
    except ValueError:
        pass

    # Check if it has a valid suffix
    valid_suffixes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB',
                      'Bi', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB',
                      'Ki', 'Mi', 'Gi', 'Ti', 'Pi']

    # Extract number and suffix
    for i, char in enumerate(size_str):
        if not (char.isdigit() or char == '.'):
            number = size_str[:i]
            suffix = size_str[i:]
            break
    else:
        raise argparse.ArgumentTypeError('Invalid size format. Must be a positive number with '
                                         f'optional suffix: {", ".join(valid_suffixes)}')

    try:
        size = float(number)
        if size <= 0:
            raise argparse.ArgumentTypeError('Size must be positive')
    except ValueError as err:
        raise argparse.ArgumentTypeError('Invalid number format') from err

    if suffix not in valid_suffixes:
        raise argparse.ArgumentTypeError(
            f'Invalid suffix. Must be one of: {", ".join(valid_suffixes)}')

    return size_str


def convert_to_gib(size_str: str) -> float:
    # Convert size string to GiB float value
    # Handle plain number (assumed to be bytes)
    try:
        size = float(size_str)
        return size / (1024**3)  # Convert bytes to GiB
    except ValueError:
        pass

    # Extract number and suffix
    for i, char in enumerate(size_str):
        if not (char.isdigit() or char == '.'):
            number = float(size_str[:i])
            suffix = size_str[i:]
            break

    # Convert based on suffix
    # First convert everything to bytes, then to GiB
    multiplier = 1
    if suffix in ['B']:
        multiplier = 1
    elif suffix in ['KB']:
        multiplier = 1000
    elif suffix in ['KiB', 'Ki']:
        multiplier = 1024
    elif suffix in ['MB']:
        multiplier = 1000**2
    elif suffix in ['MiB', 'Mi']:
        multiplier = 1024**2
    elif suffix in ['GB']:
        multiplier = 1000**3
    elif suffix in ['GiB', 'Gi']:
        multiplier = 1024**3
    elif suffix in ['TB']:
        multiplier = 1000**4
    elif suffix in ['TiB', 'Ti']:
        multiplier = 1024**4
    elif suffix in ['PB']:
        multiplier = 1000**5
    elif suffix in ['PiB', 'Pi']:
        multiplier = 1024**5
    else:
        raise ValueError(f'Invalid suffix: {suffix}')

    # Convert to bytes then to GiB
    return number * (multiplier / (1024**3))


def is_regex(regex: str) -> str:
    try:
        re.compile(regex)
        return regex
    except re.error as _:
        raise argparse.ArgumentTypeError(f'Invalid regex: {regex}')
