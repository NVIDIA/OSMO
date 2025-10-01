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
File listing and chunking module for distributed data processing.

This module handles listing and chunking files for data transfer operations between
local and remote storage backends (S3, GS, TOS). It supports:
- Listing files from local and remote storage with regex filtering
- Chunking files based on size and count constraints
- Integration with message queues for distributed processing

Functions:
    chunk_files: Generates chunks of files based on size/count constraints

The module works with the worker.py module to enable distributed data transfer
operations with optional benchmarking capabilities.
"""

import argparse
import json
import os
import time
from typing import Dict, List, Generator, Tuple

from kombu import Connection, Consumer, Exchange, message, Queue  # type: ignore
import src.lib.data
from src.lib.utils import s3, storage_backends
from pydantic import dataclasses

import data_utils


def chunk_files(input_location: str, output_location: str, chunk_size: float, chunk_amount: int,
                regex: str)\
    -> Generator[Tuple[List[Dict], float], None, None]:
    file_chunk: List[Dict] = []
    current_chunk_size = 0.0

    def yield_chunk(file_obj: s3.DownloadQueueObject | s3.UploadEntry, file_size: int) -> bool:
        nonlocal current_chunk_size
        if current_chunk_size + data_utils.convert_to_gib(str(file_size)) > chunk_size \
            and file_chunk:
            return True

        file_chunk.append(file_obj.dict())
        current_chunk_size += data_utils.convert_to_gib(str(file_size))
        if len(file_chunk) >= chunk_amount:
            return True
        return False

    if data_utils.is_remote_path(input_location):
        input_location_components = storage_backends.construct_storage_backend(uri=input_location)
        for file in src.lib.data.list_files(input_location, regex=regex):
            if yield_chunk(file.download_queue_object(output_location,
                                                      input_location_components), file.size):
                yield file_chunk, current_chunk_size
                file_chunk = []
                current_chunk_size = 0
    else:
        for file in src.lib.data.list_local_files_for_upload(input_location, output_location,
                                                          regex=regex):
            if yield_chunk(file, file.size):
                yield file_chunk, current_chunk_size
                file_chunk = []
                current_chunk_size = 0

    if file_chunk:
        yield file_chunk, current_chunk_size


def process_benchmark(body: Dict, kombu_message: message.Message, benchmark_location: str | None):
    if benchmark_location:
        benchmark_result = data_utils.BenchmarkResult(**body)

        print(f'Saving benchmark results for chunk {benchmark_result.chunk_number}')

        # Create benchmark filename with timestamp
        benchmark_file = f'result_{benchmark_result.chunk_number}.json'
        benchmark_path = os.path.join(benchmark_location, benchmark_file)

        # Create directory if it doesn't exist
        os.makedirs(benchmark_location, exist_ok=True)

        # Write download result to json file
        with open(benchmark_path, 'w', encoding='utf-8') as f:
            json.dump(benchmark_result.dict(), f, indent=4)

    kombu_message.ack()


def combine_benchmark_results(folder_path: str):
    """
    Combines benchmark results from multiple json files in a folder into a single result file.

    Args:
        folder_path: Path to folder containing benchmark json files
    """
    total_retries = 0
    total_size = 0
    all_failed_messages = []
    all_benchmarks = []

    # Read all json files in directory
    for filename in os.listdir(folder_path):
        if filename.endswith('.json') and filename != 'result_all.json':
            file_path = os.path.join(folder_path, filename)
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                total_retries += data['retries']
                total_size += data['size']
                all_failed_messages.extend(data['failed_messages'])
                if 'benchmark_result' in data:
                    data['benchmark_result']['chunk_number'] = data['chunk_number']
                    all_benchmarks.append(data['benchmark_result'])

    # Create combined results
    combined_results = {
        'total_retries': total_retries,
        'total_size_gib': total_size,
        'failed_messages': all_failed_messages,
        'benchmark_results': all_benchmarks
    }

    # Write combined results
    output_path = os.path.join(folder_path, 'result_all.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(combined_results, f, indent=4)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Job producer script')
    parser.add_argument('input_location', type=str,
                        help='Input location of the data.')
    parser.add_argument('output_location', type=str,
                        help='Location to move data to.')
    parser.add_argument('--benchmark-location', type=str, default=None,
                        help='Location to write benchmark results.')
    parser.add_argument('--redis-url', type=str, default='redis://localhost:6379/0',
                        help='Redis URL (default: redis://localhost:6379/0)')
    parser.add_argument('--max-chunk-size', type=data_utils.validate_size, default='100Gi',
                        help='Max size per chunk (e.g. 100, 50Gi, 10GiB)')
    parser.add_argument('--max-chunk-amount', type=int, default=10000,
                        help='Max amount of files per chunk')
    parser.add_argument('--regex', default='', type=data_utils.is_regex,
                        help='Regex to filter which types of files to list')
    parser.add_argument('--max-queue-length', type=int, default=100,
                        help='Maximum number of messages in queue before waiting (default: 100)')

    args = parser.parse_args()

    if data_utils.is_remote_path(args.input_location) == \
            data_utils.is_remote_path(args.output_location):
        raise Exception('Data Express does not support moving data between the data storage '
                        'backends or moving data from local storage to local storage.')

    with data_utils.QueueProducer(args.redis_url, max_queue_length=args.max_queue_length) as producer:
        for chunk_number, chunk in enumerate(chunk_files(
            args.input_location, args.output_location,
            data_utils.convert_to_gib(args.max_chunk_size),
            args.max_chunk_amount,
            args.regex)):
            print(f'Sending chunk {chunk_number} with {len(chunk[0])} files ' \
                  f'and {chunk[1]:.3f}Gi size')
            producer.enqueue({'chunk_number': chunk_number, 'files': chunk[0]},
                             data_utils.QueueType.CHUNK)

        # Sleep to ensure all messages are sent
        time.sleep(10)

        with Connection(args.redis_url) as conn:
            exchange = Exchange(data_utils.EXCHANGE_NAME, type='direct')
            benchmark_queue = Queue(data_utils.BENCHMARK_QUEUE_NAME, exchange,
                                    routing_key='benchmark_chunks')

            # Create consumer
            with Consumer(conn, queues=benchmark_queue,
                          callbacks=[lambda body, message: process_benchmark(
                              body, message, args.benchmark_location)],
                          accept=['json']):
                print('Waiting for benchmark results...')
                while True:
                    try:
                        conn.drain_events(timeout=1)
                    except TimeoutError as e:
                        if producer.is_queue_empty():
                            break
                        time.sleep(5)

        print('Queue is empty. Combining benchmark results...')

    if args.benchmark_location:
        combine_benchmark_results(args.benchmark_location)

    print('Exiting...')
