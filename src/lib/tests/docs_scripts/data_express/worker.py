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
Worker module for processing data chunks in a distributed system.

This module handles the processing of data chunks for download and upload operations,
including benchmarking capabilities. It works with both local and remote storage
backends (S3, GS, TOS) and integrates with message queues for distributed
processing.

Functions:
    process_chunk: Processes a chunk of files for download/upload with benchmarking
    get_benchmark_result: Parses benchmark results from JSON files

The worker consumes messages from a queue, processes the contained file chunks,
and optionally publishes benchmark results back to a separate queue.
"""

import argparse
import json
import os
import time
from typing import Dict

from kombu import Connection, Consumer, Exchange, message, Queue  # type: ignore
import src.lib.data
from src.lib.utils import s3, storage_backends
from pydantic import dataclasses

import data_utils


def process_chunk(body: Dict, kombu_message: message.Message,
                  kombu_producer: data_utils.QueueProducer,
                  input_location: str, output_location: str):
    print(f'Processing chunk {body["chunk_number"]} starting with {body["files"][0]}')

    benchmark_out_dir = f'/tmp/{body["chunk_number"]}'

    def get_benchmark_result(folder_path: str) -> Dict:
        """
        Gets the first json file in the folder and parses it as a dictionary.

        Args:
            folder_path: Path to folder containing json files

        Returns:
            Dictionary containing parsed json data
        """

        # Get first json file in directory
        json_files = [f for f in os.listdir(folder_path) if f.endswith('.json')]
        if not json_files:
            return {}

        json_path = os.path.join(folder_path, json_files[0])

        # Parse json file
        with open(json_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    if data_utils.is_remote_path(input_location):
        upload_result = src.lib.data.DataClient(
            storage_uri=input_location,
            benchmark_out=benchmark_out_dir).download_from_object_list(
            [s3.DownloadQueueObject(**file) for file in body['files']])

        benchmark_result = get_benchmark_result(benchmark_out_dir)

        kombu_producer.enqueue(data_utils.BenchmarkResult(
            chunk_number=body['chunk_number'],
            retries=upload_result.retries,
            size=data_utils.convert_to_gib(upload_result.size),
            size_unit='GiB',
            failed_messages=upload_result.failed_messages,
            benchmark_result=benchmark_result).dict(),
            data_utils.QueueType.BENCHMARK)
    else:
        base_storage_backend = storage_backends.construct_storage_backend(output_location)

        download_result = src.lib.data.DataClient(
            storage_uri=base_storage_backend.container_uri(),
            benchmark_out=benchmark_out_dir).upload_from_object_list(
            [s3.UploadEntry(**file) for file in body['files']])

        benchmark_result = get_benchmark_result(benchmark_out_dir)

        kombu_producer.enqueue(data_utils.BenchmarkResult(
            chunk_number=body['chunk_number'],
            retries=download_result.retries,
            size=data_utils.convert_to_gib(download_result.size),
            size_unit='GiB',
            failed_messages=download_result.failed_messages,
            benchmark_result=benchmark_result).dict(),
            data_utils.QueueType.BENCHMARK)
    kombu_message.ack()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Job consumer script')
    parser.add_argument('input_location', type=str,
                        help='Input location of the data.')
    parser.add_argument('output_location', type=str,
                        help='Location to move data to.')
    parser.add_argument('--redis-url', type=str, default='redis://localhost:6379/0',
                        help='Redis URL (default: redis://localhost:6379/0)')

    args = parser.parse_args()

    if data_utils.is_remote_path(args.input_location) == \
            data_utils.is_remote_path(args.output_location):
        raise Exception('Input and output locations cannot be both remote or both local paths.')

    # Setup connection and structures
    with data_utils.QueueProducer(args.redis_url) as producer:
        with Connection(args.redis_url) as conn:
            exchange = Exchange(data_utils.EXCHANGE_NAME, type='direct')
            queue = Queue(data_utils.QUEUE_NAME, exchange, routing_key='chunks')

            # Create consumer
            with Consumer(conn, queues=queue,
                          callbacks=[lambda body, message: process_chunk(body,
                                                                         message,
                                                                         producer,
                                                                         args.input_location,
                                                                         args.output_location)],
                          accept=['json']):
                print('Waiting for chunks...')
                while True:
                    try:
                        conn.drain_events(timeout=1)
                    except TimeoutError as e:
                        print('No jobs within the past 1 minute...')
                        time.sleep(5)
