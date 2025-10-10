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

import argparse
import shutil
import subprocess
import sys
from typing import IO, Iterable

import shtab

from src.lib.utils import client, client_configs, validation
from src.lib.data import storage


HELP_TEXT = """
This CLI is used for storing, retrieving, querying a set of data to and from storage backends.
"""


def _run_upload_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Upload Data
    Args:
        args : Parsed command line arguments.
    """
    # pylint: disable=unused-argument
    # Upload
    storage_client = storage.Client.create(
        storage_uri=args.remote_uri,
        metrics_dir=args.benchmark_out,
        enable_progress_tracker=True,
        executor_params=storage.ExecutorParameters(
            num_processes=args.processes,
            num_threads=args.threads,
        ),
        logging_level=args.log_level.value,
        cache_config=client_configs.get_cache_config(),
    )
    storage_client.upload_objects(
        args.local_path,
        regex=args.regex,
    )


def _run_download_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Download Data
    Args:
        args : Parsed command line arguments.
    """
    # pylint: disable=unused-argument
    storage_client = storage.Client.create(
        storage_uri=args.remote_uri,
        metrics_dir=args.benchmark_out,
        enable_progress_tracker=True,
        executor_params=storage.ExecutorParameters(
            num_processes=args.processes,
            num_threads=args.threads,
        ),
        logging_level=args.log_level.value,
        cache_config=client_configs.get_cache_config(),
    )
    storage_client.download_objects(
        args.local_path,
        regex=args.regex,
        resume=args.resume,
    )


def _run_list_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Download Data
    Args:
        args : Parsed command line arguments.
    """
    # pylint: disable=unused-argument
    storage_client = storage.Client.create(
        storage_uri=args.remote_uri,
        enable_progress_tracker=True,
        logging_level=args.log_level.value,
        cache_config=client_configs.get_cache_config(),
    )

    list_result_gen = storage_client.list_objects(
        prefix=args.prefix,
        regex=args.regex,
        recursive=args.recursive,
    )

    def _emit_list_results(
        list_results: Iterable[storage.ListResult],
        pipe: IO[str],
    ) -> None:
        """
        Emit list results to a pipe.
        """
        for obj in list_results:
            try:
                pipe.write(f'{obj.key}\n')
            except BrokenPipeError:
                # Pipe has closed, so we can exit
                break

    try:
        if args.local_path:
            # Write list results to a file
            with open(f'{args.local_path}', 'w+', encoding='utf-8') as file:
                _emit_list_results(list_result_gen, file)
                return

        if args.no_pager:
            # Print list results to stdout
            _emit_list_results(list_result_gen, sys.stdout)
            return

        pager = shutil.which('less') or shutil.which('more')

        # If `less` or `more` is not available, fallback to printing to stdout
        if not pager:
            _emit_list_results(list_result_gen, sys.stdout)
            return

        # Materialize results to avoid keeping client connection open
        list_results = list(list_result_gen)

        with subprocess.Popen([pager], stdin=subprocess.PIPE, text=True) as proc:
            # If the pager has stdin, pipe the list results to it
            if proc.stdin:
                try:
                    _emit_list_results(list_results, proc.stdin)
                    return

                finally:
                    # Close the pager's stdin
                    try:
                        proc.stdin.close()
                    except (BrokenPipeError, OSError):
                        pass

        # The pager has no stdin, fallback to printing to stdout
        _emit_list_results(list_results, sys.stdout)

    finally:
        if list_result_gen.summary is not None:
            print(f'\nTotal {list_result_gen.summary.count} objects found')


def _run_delete_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Delete Data
    Args:
        args : Parsed command line arguments.
    """
    # pylint: disable=unused-argument
    storage_client = storage.Client.create(
        storage_uri=args.remote_uri,
        enable_progress_tracker=True,
        logging_level=args.log_level.value,
        cache_config=client_configs.get_cache_config(),
    )
    storage_client.delete_objects(
        regex=args.regex
    )


def setup_parser(parser: argparse._SubParsersAction):
    """
    Dataset parser setup and run command based on parsing
    Args:
        parser: Reads the CLI to handle which command gets executed.
    """
    dataset_parser = parser.add_parser('data',
                                       help='Data CLI.')
    subparsers = dataset_parser.add_subparsers(dest='command')
    subparsers.required = True

    # Handle 'upload' command
    upload_parser = subparsers.add_parser('upload', help='Upload data to a backend URI',
                                          epilog='Ex. osmo data upload s3://' +
                                                 'bucket/ /path/to/file')
    upload_parser.add_argument('remote_uri',
                               type=validation.is_storage_path,
                               help='Location where data will be uploaded to.')
    upload_parser.add_argument('local_path', nargs='+',
                               help='Path(s) where the data lies.').complete = shtab.FILE
    upload_parser.add_argument('--regex', '-x',
                               type=validation.is_regex,
                               help='Regex to filter which types of files to upload')
    upload_parser.add_argument('--processes', '-p',
                               default=storage.DEFAULT_NUM_PROCESSES,
                               help='Number of processes. '
                                    f'Defaults to {storage.DEFAULT_NUM_PROCESSES}')
    upload_parser.add_argument('--threads', '-T',
                               default=storage.DEFAULT_NUM_THREADS,
                               help='Number of threads per process. '
                                    f'Defaults to {storage.DEFAULT_NUM_THREADS}')
    upload_parser.add_argument('--benchmark-out', '-b',
                               help='Path to folder where benchmark data will be written to.')
    upload_parser.set_defaults(func=_run_upload_command)

    # Handle 'download' command
    download_parser = subparsers.add_parser('download',
                                            help='Download a data from a backend URI',
                                            epilog='Ex. osmo data download s3://' +
                                                   'bucket/ /path/to/folder')
    download_parser.add_argument('remote_uri',
                                 type=validation.is_storage_path,
                                 help='URI where data will be downloaded from.')
    download_parser.add_argument('local_path', type=validation.valid_path,
                                 help='Path where data will be '
                                      'downloaded to.').complete = shtab.FILE
    download_parser.add_argument('--regex', '-x',
                                 type=validation.is_regex,
                                 help='Regex to filter which types of files to download')
    download_parser.add_argument('--resume', '-r',
                                 action='store_true',
                                 help='Resume a download.')
    download_parser.add_argument('--processes', '-p',
                                 default=storage.DEFAULT_NUM_PROCESSES,
                                 help='Number of processes. '
                                      f'Defaults to {storage.DEFAULT_NUM_PROCESSES}')
    download_parser.add_argument('--threads', '-T',
                                 default=storage.DEFAULT_NUM_THREADS,
                                 help='Number of threads per process. '
                                      f'Defaults to {storage.DEFAULT_NUM_THREADS}')
    download_parser.add_argument('--benchmark-out', '-b',
                                 help='Path to folder where benchmark data will be written to.')
    download_parser.set_defaults(func=_run_download_command)

    # Handel 'list' command
    list_parser = subparsers.add_parser('list',
                                        help='List a data from a backend URI',
                                        epilog='Ex. osmo data list s3://' +
                                               'bucket/ /path/with/file_name')
    list_parser.add_argument('remote_uri',
                             type=validation.is_storage_path,
                             help='URI where data will be listed for.')
    list_parser.add_argument('--regex', '-x',
                             type=validation.is_regex,
                             help='Regex to filter which types of files to list')
    list_parser.add_argument('--prefix', '-p',
                             default='',
                             type=str,
                             help='Prefix/directory to list from the remote URI.')
    list_parser.add_argument('--recursive', '-r',
                             action='store_true',
                             help='List recursively.')
    list_parser_output_group = list_parser.add_mutually_exclusive_group()
    list_parser_output_group.add_argument('local_path',
                                          nargs='?',
                                          type=validation.valid_file_path,
                                          help='Path where list data will be written to.',
                                          ).complete = shtab.FILE
    list_parser_output_group.add_argument('--no-pager',
                                          action='store_true',
                                          help='Do not use a pager to display the list results, '
                                               'print directly to stdout.')
    list_parser.set_defaults(func=_run_list_command)

    # Handel 'Delete' command
    delete_parser = subparsers.add_parser('delete',
                                          help='Delete a data from a backend URI',
                                          epilog='Ex. osmo data delete s3://' +
                                               'bucket/ ')
    delete_parser.add_argument('remote_uri',
                               type=validation.is_storage_path,
                               help='URI where data will be delete from.')
    delete_parser.add_argument('--regex', '-x',
                               type=validation.is_regex,
                               help='Regex to filter which types of files to delete')
    delete_parser.set_defaults(func=_run_delete_command)
