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
import io
import itertools
import json
import hashlib
import logging
import os
import re
import textwrap
from typing import Any, Dict, List
import yaml

import ijson
import shtab
from tqdm import tqdm  # type: ignore

from src.lib.data import (
    dataset as dataset_lib,
    storage as storage_lib,
)
from src.lib.utils import (
    client,
    client_configs,
    credentials,
    common,
    osmo_errors,
    validation,
)

HELP_TEXT = """
This CLI is used for storing, retrieving, querying a set of data to and from storage backends.
"""


def construct_download_api_path(dataset: common.DatasetStructure):
    return f'api/bucket/{dataset.bucket}/dataset/{dataset.name}'


def _run_info_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Details dataset information
    Args:
        args : Parsed command line arguments.
    """
    dataset = common.DatasetStructure(args.name)

    if not dataset.bucket:
        dataset.bucket = dataset_lib.get_user_bucket(service_client)

    params = {'tag': dataset.tag,
              'all_flag': args.all,
              'count': args.count,
              'order': args.order.upper()}
    result = service_client.request(
        client.RequestMethod.GET,
        f'api/bucket/{dataset.bucket}/dataset/{dataset.name}/info',
        params=params)

    if args.format_type == 'json':
        print(json.dumps(result, indent=common.JSON_INDENT_SIZE))
    else:
        print('-----------------------------------------------------\n')
        if result['type'] == 'COLLECTION':
            collection_sum = common.storage_convert(
                sum(element['size'] for element in result['versions']),
            )
            print(f'Name: {args.name}\n'
                  f'ID: {result["id"]}\n'
                  f'Bucket: {result["bucket"]}\n'
                  f'Type: {result["type"]}\n'
                  f'Created By: {result["created_by"]}\n'
                  f'Create Date: '
                  f'{common.convert_utc_datetime_to_user_zone(result["created_date"])}\n'
                  f'Size: {collection_sum}\n')

            if result['labels']:
                print('Labels:')
                print(textwrap.indent(yaml.dump(result['labels']), prefix='  '))

            collection_header = ['Dataset', 'Version']
            table = common.osmo_table(header=collection_header)
            columns = ['name', 'version']
            for version in result['versions']:
                table.add_row([version.get(column, '-') for column in columns])
            print(f'{table.draw()}\n')
        else:
            print(f'Name: {args.name}\n'
                  f'ID: {result["id"]}\n'
                  f'Bucket: {result["bucket"]}\n'
                  f'Type: {result["type"]}\n'
                  f'Stored Size: {common.storage_convert(result["hash_location_size"])}\n')
            if result['labels']:
                print('Labels:')
                print(textwrap.indent(yaml.dump(result['labels']), prefix='  '))

            tag_header = ['Version', 'Tags']
            table = common.osmo_table(header=tag_header)
            columns = ['version', 'tags']
            draw = False
            for version in result['versions']:
                if version['tags']:
                    draw = True
                    version['tags'] = ', '.join(version['tags'])
                    table.add_row([version.get(column, '-') for column in columns])
            if draw:
                print(f'{table.draw()}\n')

            collection_header = ['Version', 'Collections']
            table = common.osmo_table(header=collection_header)
            columns = ['version', 'collections']
            draw = False
            for version in result['versions']:
                if version['collections']:
                    draw = True
                    version['collections'] = ', '.join(version['collections'])
                    table.add_row([version.get(column, '-') for column in columns])
            if draw:
                print(f'{table.draw()}\n')

            header = ['Version', 'Status', 'Created By', 'Created Date', 'Last Used',
                      'Size', 'Checksum', 'Retention Policy']
            table = common.osmo_table(header=header)
            columns = ['version', 'status', 'created_by', 'created_date', 'last_used',
                       'size', 'checksum', 'retention_policy']
            for version in result['versions']:
                version['size'] = common.storage_convert(version['size'])
                version['created_date'] = common.convert_utc_datetime_to_user_zone(
                    version['created_date'])
                version['last_used'] = common.convert_utc_datetime_to_user_zone(
                    version['last_used'])
                table.add_row([version.get(column, '-') for column in columns])
            print(table.draw())


def upload_dataset(
    service_client: client.ServiceClient,
    name: str,
    input_paths: List[str],
    *,
    description: str = '',
    metadata: List[str] | None = None,
    labels: List[str] | None = None,
    regex: str | None = None,
    resume: bool = False,
    start_only: bool = False,
    quiet: bool = False,
    benchmark_out: str | None = None,
    executor_params: storage_lib.ExecutorParameters | None = None,
) -> dataset_lib.UploadResponse:
    """
    Upload a dataset
    Args:
        args : Parsed command line arguments.
    """
    # Start Upload
    dataset = common.DatasetStructure(name)

    if resume and not dataset.tag:
        raise osmo_errors.OSMOUserError('Specify specific version in order to resume.')

    metadata_to_set: Dict = {}
    if metadata:
        for metadata_file in metadata:
            metadata_to_set.update(_get_metadata_from_file(metadata_file))

    labels_to_set: Dict = {}
    if labels:
        for labels_file in labels:
            labels_to_set.update(_get_metadata_from_file(labels_file))

    dataset_manager = dataset_lib.Manager(
        dataset_input=dataset,
        service_client=service_client,
        metrics_dir=benchmark_out,
        enable_progress_tracker=not quiet,
        executor_params=executor_params or storage_lib.ExecutorParameters(),
        logging_level=logging.INFO if not quiet else logging.CRITICAL,
    )

    # Initiate a dataset upload operation
    upload_start_result: dataset_lib.UploadStartResult = dataset_manager.upload_start(
        input_paths,
        description=description,
        resume=resume,
        metadata=metadata_to_set,
    )

    upload_start_response: dataset_lib.UploadResponse = upload_start_result.upload_response

    if start_only:
        if not quiet:
            print(json.dumps(upload_start_response, indent=common.JSON_INDENT_SIZE))
        return upload_start_response

    # Proceed with the upload operation
    upload_result = dataset_manager.upload(
        upload_start_result,
        regex=regex,
        labels=labels_to_set,
    )

    return upload_result.upload_response


def _run_upload_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Upload a dataset
    Args:
        args : Parsed command line arguments.
    """
    upload_dataset(
        service_client,
        args.name,
        args.path,
        description=args.description,
        metadata=args.metadata,
        labels=args.labels,
        regex=args.regex,
        resume=args.resume,
        start_only=args.start_only,
        benchmark_out=args.benchmark_out,
        executor_params=storage_lib.ExecutorParameters(
            num_processes=args.processes,
            num_threads=args.threads,
        ),
    )


def _run_download_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Download a dataset
    Args:
        args : Parsed command line arguments.
    """
    dataset = common.DatasetStructure(args.name)

    dataset_manager = dataset_lib.Manager(
        dataset_input=dataset,
        service_client=service_client,
        metrics_dir=args.benchmark_out,
        enable_progress_tracker=True,
        executor_params=storage_lib.ExecutorParameters(
            num_processes=args.processes,
            num_threads=args.threads,
        ),
        logging_level=args.log_level.value,
    )

    dataset_manager.download(
        args.path,
        regex=args.regex,
        resume=args.resume,
    )


def _run_update_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Update a dataset
    Args:
        args : Parsed command line arguments.
    """
    # Parse and validate metadata and labels
    metadata_to_set: Dict = {}
    for metadata_file in args.metadata:
        metadata_to_set.update(_get_metadata_from_file(metadata_file))

    labels_to_set: Dict = {}
    for labels_file in args.labels:
        labels_to_set.update(_get_metadata_from_file(labels_file))

    dataset_manager = dataset_lib.Manager(
        dataset_input=common.DatasetStructure(args.name),
        service_client=service_client,
        metrics_dir=args.benchmark_out,
        enable_progress_tracker=True,
        executor_params=storage_lib.ExecutorParameters(
            num_processes=args.processes,
            num_threads=args.threads,
        ),
        logging_level=args.log_level.value,
    )

    # Start update operation
    update_start_result: dataset_lib.UpdateStartResult = dataset_manager.update_start(
        add_paths=args.add,
        remove_regex=args.remove,
        resume_tag=args.resume,
        metadata=metadata_to_set,
    )

    if args.start_only:
        print(json.dumps(update_start_result.upload_response, indent=common.JSON_INDENT_SIZE))
        return

    # Update the dataset
    dataset_manager.update(
        update_start_result,
        labels=labels_to_set,
    )


def _run_delete_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Delete an existing Dataset/Collection
    Args:
        args: Parsed command line arguments.
    """
    dataset = common.DatasetStructure(args.name)
    if args.all:
        tag = ''
    elif dataset.tag:
        tag = dataset.tag
    else:
        tag = 'latest'

    if not dataset.bucket:
        dataset.bucket = dataset_lib.get_user_bucket(service_client)

    params = {'tag': tag,
              'all_flag': args.all,
              'order': 'DESC'}
    result = service_client.request(
        client.RequestMethod.GET,
        f'api/bucket/{dataset.bucket}/dataset/{dataset.name}/info',
        params=params)

    if not args.force:
        if result['type'] == 'DATASET':
            collection_header = ['Version', 'Collections']
            table = common.osmo_table(header=collection_header)
            columns = ['version', 'collections']
            draw = False
            for version in result['versions']:
                if version['collections']:
                    draw = True
                    version['collections'] = ', '.join(version['collections'])
                    table.add_row([version.get(column, '-') for column in columns])
            if draw:
                print('These versions have connections to collections.\nDeleting each version ' +
                      'would DELETE these collections.')
                print(f'{table.draw()}\n')

        if result['type'] == 'COLLECTION':
            confirm = common.prompt_user('Are you sure you want to delete Collection '
                                         f'{dataset.name} from bucket {dataset.bucket}?')
        else:
            if args.all:
                prompt_info = f'all versions in Dataset {dataset.name} from bucket {dataset.bucket}'
            elif dataset.tag:
                prompt_info = f'Dataset {dataset.name} version/tag {tag} from bucket ' +\
                              f'{dataset.bucket}'
            else:
                prompt_info = f'the latest version of Dataset {dataset.name} from bucket ' +\
                              f'{dataset.bucket}'
            confirm = common.prompt_user(f'Are you sure you want to mark {prompt_info} '
                                         'as PENDING_DELETE? The storage objects will not be '
                                         'deleted yet.')
        if not confirm:
            return

    params = {'name': dataset.name,
              'tag': tag,
              'all_flag': args.all}
    delete_result = service_client.request(
        client.RequestMethod.DELETE,
        f'api/bucket/{dataset.bucket}/dataset/{dataset.name}',
        params=params)

    delete_objects = len(delete_result['delete_locations']) != 0

    confirm_delete_objects = False
    if delete_objects and not args.force:
        confirm_delete_objects = common.prompt_user(
            f'All versions of {dataset.name} has been marked as PENDING_DELETE.'
            'Do you want to delete the storage objects and wipe the dataset?\n'
            'Note: Any concurrent uploads to this dataset may be effected.'
        )
    elif delete_objects and args.force:
        confirm_delete_objects = True

    json_output: Dict[str, Any]
    if not confirm_delete_objects:
        if result['type'] == 'COLLECTION':
            if args.format_type == 'json':
                json_output = {
                    'name': dataset.name,
                }
                print(json.dumps(json_output, indent=common.JSON_INDENT_SIZE))
            else:
                print(f'Collection {dataset.name} from bucket {dataset.bucket} has been deleted')
        else:
            if args.format_type == 'json':
                json_output = {
                    'name': dataset.name,
                    'versions': list(delete_result['versions'])
                }
                print(json.dumps(json_output, indent=common.JSON_INDENT_SIZE))
            else:
                for version in delete_result['versions']:
                    print(f'Dataset {dataset.name} version ' +
                          f'{version} bucket {dataset.bucket} has been marked as '
                          f'PENDING_DELETE.')
        return

    # Run Delete Objects operation if all versions are deleted
    storage_client = storage_lib.Client.create(
        storage_uri=result['hash_location'],
        scope_to_container=True,
    )
    for location in delete_result['delete_locations']:
        storage_client.delete_objects(
            prefix=location,
        )

    # Send notification to service that dataset is deleted
    params = {'name': dataset.name,
              'finish': True}
    service_client.request(
        client.RequestMethod.DELETE,
        f'api/bucket/{dataset.bucket}/dataset/{dataset.name}',
        params=params)

    if args.format_type == 'json':
        json_output = {
            'name': dataset.name,
            'versions': [version['version'] for version in delete_result['versions']],
            'cleaned_size': common.storage_convert(delete_result['cleaned_size'])
        }
        print(json.dumps(json_output, indent=common.JSON_INDENT_SIZE))
    else:
        print(f'Dataset {dataset.name} in bucket {dataset.bucket} has been deleted.\n'
              f'Cleaned up {common.storage_convert(delete_result["cleaned_size"])}.')


def _run_tag_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Update Dataset Version tags
    Args:
        args: Parsed command line arguments.
    """

    dataset = common.DatasetStructure(args.name)

    if not dataset.bucket:
        dataset.bucket = dataset_lib.get_user_bucket(service_client)

    params = {'tag': dataset.tag,
              'set_tag': args.set,
              'delete_tag': args.delete}
    result = service_client.request(
        client.RequestMethod.POST,
        f'api/bucket/{dataset.bucket}/dataset/{dataset.name}/attribute',
        params=params)['tag_response']
    print('-----------------------------------------------------\n')
    header = ['Version_id', 'Tags']
    table = common.osmo_table(header=header)
    columns = ['version_id', 'tags']
    result['tags'] = ', '.join(result['tags'])
    table.add_row([result.get(column, '-') for column in columns])
    print(table.draw())


def _run_list_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    List all Datasets/Collections uploaded by the user
    Args:
        args: Parsed command line arguments.
    """
    params = {'name': args.name, 'user': args.user, 'all_users': args.all, 'buckets': args.bucket,
              'count': args.count, 'order': args.order.upper()}
    result = service_client.request(
        client.RequestMethod.GET,
        'api/bucket/list_dataset',
        params=params)
    if not result['datasets']:
        print('No Datasets fit your query.')
    if args.format_type == 'json':
        print(json.dumps(result, indent=common.JSON_INDENT_SIZE))
    elif result['datasets']:
        header = ['Bucket', 'Name', 'ID', 'Created Date', 'Last Version Created', 'Last Version',
                  'Storage Size', 'Type']
        table = common.osmo_table(header=header)
        table.set_header_align(['l' for i in header])
        columns = ['bucket', 'name', 'id', 'create_time', 'last_created', 'version_id',
                   'hash_location_size', 'type']
        for data in result['datasets']:
            data['version_id'] = data['version_id'] if data['version_id'] else 'N/A'
            data['create_time'] = common.convert_utc_datetime_to_user_zone(
                data['create_time'])
            data['last_created'] = common.convert_utc_datetime_to_user_zone(
                data['last_created']) if data['last_created'] else 'N/A'
            data['hash_location_size'] = common.storage_convert(data['hash_location_size'])\
                if data['type'] == 'DATASET' else 'N/A'
            table.add_row([data.get(column, '-') for column in columns])
        print(table.draw())


def _run_collect_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Create a Collection
    Args:
        args: Parsed command line arguments.
    """
    collection = common.DatasetStructure(args.name)
    if collection.tag:
        raise osmo_errors.OSMOUserError('Collections cannot have tags')

    if not collection.bucket:
        collection.bucket = dataset_lib.get_user_bucket(service_client)

    payload = {'datasets': [common.DatasetStructure(dataset).to_dict()
                            for dataset in args.datasets]}
    service_client.request(
        client.RequestMethod.POST,
        f'api/bucket/{collection.bucket}/dataset/{collection.name}/collect',
        payload=payload)
    print(f'Collection {args.name} in bucket {collection.bucket} has been created.')


def _run_recollect_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Update a collection
    Args:
        args : Parsed command line arguments.
    """
    collection = common.DatasetStructure(args.name)

    if collection.tag:
        raise osmo_errors.OSMOUserError('Collections cannot have tags')

    if not collection.bucket:
        collection.bucket = dataset_lib.get_user_bucket(service_client)

    remove_datasets = []
    if args.remove:
        remove_datasets = [common.DatasetStructure(dataset).to_dict()
                           for dataset in args.remove]
    payload = {'add_datasets': [common.DatasetStructure(dataset).to_dict()
                                for dataset in args.add],
               'remove_datasets': remove_datasets}
    result = service_client.request(
        client.RequestMethod.POST,
        f'api/bucket/{collection.bucket}/dataset/{collection.name}/recollect',
        payload=payload)

    if result['versions']:
        collection_header = ['Dataset', 'Version']
        table = common.osmo_table(header=collection_header)
        columns = ['dataset_name', 'version']
        for version in result['versions']:
            table.add_row([version.get(column, '-') for column in columns])
        print(f'{table.draw()}\n')
    else:
        print(f'Collection {collection.name} deleted')


def _get_metadata_from_file(file_path: str) -> Dict | List:
    """
    Reads the file and flatten the json in the file to create a set of key:value:type string to be
    added sent as metadata for this dataset.

    Args:
        file_path: path of the file

    Returns:
        Dict | List: list of metadata from the file
    """
    if not os.path.exists(file_path):
        raise argparse.ArgumentTypeError(f'The file {file_path} does not exist!')
    with open(file_path, 'r', encoding='utf-8') as set_file:
        try:
            content = yaml.safe_load(set_file)
        except yaml.YAMLError as yaml_error:
            raise osmo_errors.OSMOUserError(f'Metadata file is not properly formatted:{yaml_error}')

    if isinstance(content, dict):
        common.verify_dict_keys(content)
    elif isinstance(content, str):
        content = content.split(' ')

    if not content:
        raise osmo_errors.OSMOUserError(f'File {file_path} is empty.')
    if isinstance(content, list):
        if not all(isinstance(x, (int, float)) for x in content) and \
           not all(isinstance(x, str) for x in content):
            raise osmo_errors.OSMOError('All elements in an array should be of same type: str or'
                                        ' numeric.')
    elif isinstance(content, bool):
        content = [str(content)]

    return content


def _parse_label_metadata_set(set_items: List[str]):
    converter = {
        'string': str,
        'numeric': float
    }
    metadata_to_set: Dict = {}
    for items in set_items:
        key, convert_type, value = items.split(':', 2)
        parsed_keys = key.split('.')
        value_list = [converter[convert_type](x) for x in value.split(',')]
        nested_dict: Any = value_list if len(value_list) != 1 else value_list[0]
        for element in reversed(parsed_keys):
            nested_dict = {element: nested_dict}
        metadata_to_set = common.merge_dictionaries(metadata_to_set, nested_dict)
    return metadata_to_set


def _run_label_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Update Dataset label
    Args:
        args: Parsed command line arguments.
    """
    dataset = common.DatasetStructure(args.name)
    if dataset.tag:
        raise osmo_errors.OSMOUserError('Label does not work with dataset versions. Do you mean '
                                        'osmo dataset metadata?')

    if not dataset.bucket:
        dataset.bucket = dataset_lib.get_user_bucket(service_client)

    if not args.set and not args.delete:
        raise osmo_errors.OSMOUserError('Set or delete is required for the label CLI. To '
                                        'fetch the label, please use "osmo dataset info" '
                                        'instead')

    metadata_to_set: Dict = {}
    delete_keys: List = []
    if not args.is_file:
        metadata_to_set = _parse_label_metadata_set(args.set)
        delete_keys = args.delete
    else:
        for file_path in args.set:
            metadata_to_set.update(_get_metadata_from_file(file_path))
        for file_path in args.delete:
            delete_keys += _get_metadata_from_file(file_path)
    payload = {'set_label': metadata_to_set}
    params = {'delete_label': delete_keys}

    result = service_client.request(
        client.RequestMethod.POST,
        f'api/bucket/{dataset.bucket}/dataset/{dataset.name}/attribute',
        payload=payload,
        params=params)['label_response']
    if not result:
        return
    if args.format_type == 'json':
        print(json.dumps(result['metadata']))
    else:
        if result['metadata']:
            print(yaml.dump(result['metadata'], default_flow_style=False))
        else:
            print('No Labels')


def _run_metadata_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Update Dataset Version metadata
    Args:
        args: Parsed command line arguments.
    """

    dataset = common.DatasetStructure(args.name)
    if not dataset.tag:
        raise osmo_errors.OSMOUserError('Tag is required for setting metadata for dataset version. '
                                        'Do you mean osmo dataset label?')

    if not dataset.bucket:
        dataset.bucket = dataset_lib.get_user_bucket(service_client)
    if not args.set and not args.delete:
        raise osmo_errors.OSMOUserError('Set or delete is required for the metadata CLI. To '
                                        'fetch the metadata, please use "osmo dataset info '
                                        '--format-type json" instead')

    metadata_to_set: Dict = {}
    delete_keys: List[str] = []
    if not args.is_file:
        metadata_to_set = _parse_label_metadata_set(args.set)
        delete_keys = args.delete
    else:
        for file_path in args.set:
            metadata_to_set.update(_get_metadata_from_file(file_path))
        for file_path in args.delete:
            delete_keys += _get_metadata_from_file(file_path)
    payload = {'set_metadata': metadata_to_set}
    params = {'tag': dataset.tag,
              'delete_metadata': delete_keys}
    result = service_client.request(
        client.RequestMethod.POST,
        f'api/bucket/{dataset.bucket}/dataset/{dataset.name}/attribute',
        payload=payload,
        params=params)['metadata_response']
    if not result:
        return
    if args.format_type == 'json':
        print(json.dumps(result['metadata']))
    else:
        if result['metadata']:
            print(yaml.dump(result['metadata'], default_flow_style=False))
        else:
            print('No Metadata')


def _run_rename_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Rename Dataset/Collection
    Args:
        args: Parsed command line arguments.
    """

    old_dataset = common.DatasetStructure(args.original_name)
    if old_dataset.tag:
        raise osmo_errors.OSMOUserError('Cannot rename a dataset version.')

    if not old_dataset.bucket:
        old_dataset.bucket = dataset_lib.get_user_bucket(service_client)

    new_dataset = common.DatasetStructure(args.new_name)
    if new_dataset.tag:
        raise osmo_errors.OSMOUserError('Cannot specify tag in new dataset.')

    params = {'new_name': new_dataset.name}
    service_client.request(
        client.RequestMethod.POST,
        f'api/bucket/{old_dataset.bucket}/dataset/{old_dataset.name}/attribute',
        params=params)
    print(f'{old_dataset.name} has been renamed to {new_dataset.name} in bucket ' +
          f'{old_dataset.bucket}')


def _run_query_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Queries Dataset names based on the submitted metadata
    Args:
        args: Parsed command line arguments.
    """
    bucket = args.bucket
    if not args.bucket:
        bucket = dataset_lib.get_user_bucket(service_client)

    with open(args.file, 'r', encoding='utf-8') as file:
        params = {'command': file.read()}
        result = service_client.request(
            client.RequestMethod.GET,
            f'api/bucket/{bucket}/query',
            params=params)

    if args.format_type == 'json':
        print(json.dumps(result, indent=common.JSON_INDENT_SIZE))
    else:
        if result['type'] == 'DATASET':
            header = ['Name', 'ID', 'Created Date', 'Type']
            table = common.osmo_table(header=header)
            columns = ['name', 'id', 'created_date', 'type']
            for version in result['datasets']:
                version['created_date'] = common.convert_utc_datetime_to_user_zone(
                    version['created_date'])
                table.add_row([version.get(column, '-') for column in columns])
            print(table.draw())
        else:
            header = ['Name', 'Version ID', 'Created By', 'Created Date',
                      'Last Used', 'Size']
            table = common.osmo_table(header=header)
            columns = ['name', 'version', 'created_by', 'created_date', 'last_used',
                       'size']
            for version in result['datasets']:
                version['size'] = common.storage_convert(version['size'])
                version['created_date'] = common.convert_utc_datetime_to_user_zone(
                    version['created_date'])
                version['last_used'] = common.convert_utc_datetime_to_user_zone(
                    version['last_used'])
                table.add_row([version.get(column, '-') for column in columns])
            print(table.draw())


def _run_checksum_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Calculate Checksum of local folder/file
    Args:
        args: Parsed command line arguments.
    """
    # pylint: disable=unused-argument

    path_checksums = []
    # Calculate total size for progress bar
    file_information = {}
    total_size = 0
    list_objects = []
    for path in args.path:
        path = path.rstrip('/')
        objs = common.collect_fs_objects(path)
        local_file_information, local_total_size = common.collect_file_sizes(objs)
        list_objects.append((path, objs))
        file_information.update(local_file_information)
        total_size += local_total_size

    if list_objects:
        with tqdm(total=total_size, unit='B', unit_scale=True, unit_divisor=1024) as t:
            # Calculate md5sum of local paths
            for path, objects in list_objects:
                for file in objects:
                    # Add Relative Path + checksum path_checksums
                    path_checksums.append(file[len(path.rsplit('/', 1)[0]) + 1:] +
                                          ' ' + common.etag_checksum(file))
                    file_size_uploaded = file_information.get(file, 0)
                    t.set_postfix(file_name=file.split('/')[-1],
                                  file_size=f'{file_size_uploaded} B', refresh=True)
                    t.update(file_size_uploaded)

    path_checksums.sort()
    md5sum = hashlib.md5()
    for checksum in path_checksums:
        md5sum.update(checksum.encode())
    print(md5sum.hexdigest())


def _print_manifest(
    file: io.IOBase,
    format_type: str,
    regex: str | None,
    prefix: str = '',
    count: int = 1000,
) -> None:
    """
    Displays the manifest file in the specified format.
    """
    level = 0
    header = ''
    file_count = 0

    regex_check: re.Pattern | None = re.compile(regex) if regex else None

    # Create Generator for all the json items
    objs_generator = ijson.items(file, 'item')
    if format_type == 'json':
        print('[')
    for obj, next_obj in itertools.pairwise(itertools.chain(objs_generator, [None])):
        path = obj['relative_path']
        if regex_check and not regex_check.match(path):
            continue
        if file_count >= count:
            break
        if format_type == 'tree':
            if prefix:
                path = f'{prefix}/{path}'
            if path.startswith(header):
                path = path[len(header):]
                while '/' in path:
                    header += path.split('/', 1)[0] + '/'
                    print('│  ' * level + '├──' + path.split('/', 1)[0])
                    path = path.split('/', 1)[1]
                    level += 1
            else:
                while not path.startswith(header):
                    level -= 1
                    if header.count('/') == 1:
                        header = ''
                    else:
                        header = header.rsplit('/', 2)[0] + '/'
                path = path[len(header):]
                while '/' in path:
                    header += path.split('/', 1)[0] + '/'
                    print('│  ' * level + '├──' + path.split('/', 1)[0])
                    path = path.split('/', 1)[1]
                    level += 1
            # Based on the next object, determine the tree print
            if next_obj and next_obj['relative_path'].startswith(header[len(prefix):]):
                print('│  ' * level + '├──' + path)
            else:
                print('│  ' * level + '└──' + path)
        elif format_type == 'text':
            print(obj['relative_path'])
        elif format_type == 'json':
            json_dump = json.dumps(obj, indent=4)
            if next_obj:
                json_dump += ','
            print(json_dump)
        else:
            raise osmo_errors.OSMOError(f'Invalid format type: {format_type}')
        file_count += 1
    if format_type == 'json':
        print(']')


def _run_inspect_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Print File structure in Dataset
    Args:
        args: Parsed command line arguments.
    """
    dataset = common.DatasetStructure(args.name)

    dataset_manager = dataset_lib.Manager(
        dataset_input=dataset,
        service_client=service_client,
        logging_level=args.log_level.value,
    )

    dataset_response: dataset_lib.DownloadResponse = dataset_manager.validate_download()

    for dataset_name, manifest_path in zip(
        dataset_response['dataset_names'],
        dataset_response['locations'],
        strict=True,
    ):
        manifest_client = storage_lib.SingleObjectClient.create(storage_uri=manifest_path)
        with manifest_client.get_object_stream(as_io=True) as bytes_io:
            _print_manifest(
                bytes_io,
                args.format_type,
                args.regex,
                prefix=dataset_name if dataset_response['is_collection'] else '',
                count=args.count,
            )


def _run_migrate_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Migrate a legacy (non-manifest based) dataset to a new manifest based dataset.
    """
    dataset = common.DatasetStructure(args.name)

    dataset_manager = dataset_lib.Manager(
        dataset_input=dataset,
        service_client=service_client,
        metrics_dir=args.benchmark_out,
        enable_progress_tracker=True,
        executor_params=storage_lib.ExecutorParameters(
            num_processes=args.processes,
            num_threads=args.threads,
        ),
        logging_level=args.log_level.value,
    )

    dataset_manager.migrate()


def _run_check_command(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Check the access to a dataset for various operations
    Args:
        args: Parsed command line arguments.
    """
    dataset = common.DatasetStructure(args.name)

    if not dataset.bucket:
        dataset.bucket = dataset_lib.get_user_bucket(service_client)

    try:
        location_result = service_client.request(
            client.RequestMethod.GET,
            dataset_lib.common.construct_location_api_path(dataset),
        )

        storage_backend = storage_lib.construct_storage_backend(
            location_result['path'],
            cache_config=client_configs.get_cache_config(),
        )

        data_cred = credentials.get_static_data_credential_from_config(
            storage_backend.profile,
            args.config_file,
        )

        match args.access_type:
            case storage_lib.AccessType.WRITE.name:
                storage_backend.data_auth(
                    data_cred=data_cred,
                    access_type=storage_lib.AccessType.WRITE,
                )
            case storage_lib.AccessType.DELETE.name:
                storage_backend.data_auth(
                    data_cred=data_cred,
                    access_type=storage_lib.AccessType.DELETE,
                )
            case storage_lib.AccessType.READ.name:
                storage_backend.data_auth(
                    data_cred=data_cred,
                    access_type=storage_lib.AccessType.READ,
                )
            case _:
                storage_backend.data_auth(
                    data_cred=data_cred,
                )

        # Auth check passed
        print(json.dumps({'status': 'pass'}))

    except osmo_errors.OSMOCredentialError as err:
        # Auth check failed (credentials issue)
        print(json.dumps({'status': 'fail', 'error': str(err)}))


def setup_parser(parser: argparse._SubParsersAction):
    """
    Dataset parser setup and run command based on parsing
    Args:
        parser: Reads the CLI to handle which command gets executed.
    """
    dataset_parser = parser.add_parser('dataset',
                                       help='Dataset CLI.')
    subparsers = dataset_parser.add_subparsers(dest='command')
    subparsers.required = True

    # Handle 'info' command
    info_parser = subparsers.add_parser('info',
                                        help='Provide details of the dataset/collection',
                                        epilog='Ex. osmo dataset info DS1 --format-type json')
    info_parser.add_argument(dest='name',
                             help='Dataset name. Specify bucket with [bucket/]DS.')
    info_parser.add_argument('--all', '-a',
                             dest='all',
                             action='store_true',
                             help='Display all versions in any state.')
    info_parser.add_argument('--count', '-c',
                             dest='count',
                             type=validation.positive_integer,
                             default=100,
                             help='For Datasets. Display the given number of versions. '
                                  'Default 100.')
    info_parser.add_argument('--order', '-o',
                             dest='order',
                             default='asc',
                             choices=('asc', 'desc'),
                             help='For Datasets. Display in the given order based on date created')
    info_parser.add_argument('--format-type', '-t',
                             dest='format_type',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    info_parser.set_defaults(func=_run_info_command)

    # Handle 'upload' command
    upload_parser = subparsers.add_parser('upload', help='Upload a new Dataset/Collection',
                                          epilog='Ex. osmo dataset upload DS1:latest '
                                                 '/path/to/file --desc "My description"')
    upload_parser.add_argument('name',
                               help='Dataset name. Specify bucket and tag with [bucket/]DS[:tag].'
                                    'If you want to continue an upload, then '
                                    'the most recent PENDING version is chosen')
    upload_parser.add_argument('path',
                               nargs='+',
                               help='Path where the dataset lies.').complete = shtab.FILE
    upload_parser.add_argument('--desc', '-d',
                               dest='description',
                               default='',
                               help='Description of dataset.')
    upload_parser.add_argument('--metadata', '-m',
                               nargs='+',
                               default=[],
                               help='Yaml files of metadata to '
                                    'assign to dataset version').complete = shtab.FILE
    upload_parser.add_argument('--labels', '-l',
                               nargs='+',
                               default=[],
                               help='Yaml files of labels to '
                                    'assign to dataset').complete = shtab.FILE
    upload_parser.add_argument('--regex', '-x',
                               type=validation.is_regex,
                               help='Regex to filter which types of files to upload')
    upload_parser.add_argument('--resume', '-r',
                               action='store_true',
                               help='Resume a canceled/failed upload. To resume, there must be a'
                                    'tag.')
    upload_parser.add_argument('--start-only',
                               dest='start_only',
                               action='store_true',
                               help=argparse.SUPPRESS)
    upload_parser.add_argument('--processes', '-p',
                               default=storage_lib.DEFAULT_NUM_PROCESSES,
                               help='Number of processes. '
                                    f'Defaults to {storage_lib.DEFAULT_NUM_PROCESSES}')
    upload_parser.add_argument('--threads', '-T',
                               default=storage_lib.DEFAULT_NUM_THREADS,
                               help='Number of threads per process. '
                                    f'Defaults to {storage_lib.DEFAULT_NUM_THREADS}')
    upload_parser.add_argument('--benchmark-out', '-b',
                               help='Path to folder where benchmark data will be written to.')
    upload_parser.set_defaults(func=_run_upload_command)

    # Handle 'delete' command
    delete_parser = subparsers.add_parser('delete',
                                          help='Marks a Dataset version(s) as PENDING_DELETE. '
                                               'If all versions are marked, prompts the user to '
                                               'delete the dataset from storage. Collection are '
                                               'deleted',
                                          epilog='Ex. osmo dataset delete DS1:latest '
                                                 '--force --format-type json')
    delete_parser.add_argument('name',
                               help='Dataset name. Specify bucket and tag/version with ' +
                                    '[bucket/]DS[:tag/version].')
    delete_parser.add_argument('--all', '-a',
                               action='store_true',
                               dest='all',
                               help='Deletes all versions.')
    delete_parser.add_argument('--force', '-f',
                               action='store_true',
                               dest='force',
                               help='Deletes without confirmation.')
    delete_parser.add_argument('--format-type', '-t',
                               dest='format_type',
                               choices=('json', 'text'), default='text',
                               help='Specify the output format type (Default text).')
    delete_parser.set_defaults(func=_run_delete_command)

    # Handle 'download' command
    download_parser = subparsers.add_parser('download',
                                            help='Download the dataset',
                                            epilog='Ex. osmo dataset download DS1:latest '
                                                   '/path/to/folder')
    download_parser.add_argument('name',
                                 help='Dataset name. Specify bucket and tag/version with ' +
                                      '[bucket/]DS[:tag/version].')
    download_parser.add_argument('path', type=validation.valid_path,
                                 help='Location where the dataset is downloaded to.').complete = \
        shtab.FILE
    download_parser.add_argument('--regex', '-x',
                                 type=validation.is_regex,
                                 help='Regex to filter which types of files to download')
    download_parser.add_argument('--resume', '-r',
                                 action='store_true',
                                 help='Resume a canceled/failed download.')
    download_parser.add_argument('--processes', '-p',
                                 default=storage_lib.DEFAULT_NUM_PROCESSES,
                                 help='Number of processes. '
                                      f'Defaults to {storage_lib.DEFAULT_NUM_PROCESSES}')
    download_parser.add_argument('--threads', '-T',
                                 default=storage_lib.DEFAULT_NUM_THREADS,
                                 help='Number of threads per process. '
                                      f'Defaults to {storage_lib.DEFAULT_NUM_THREADS}')
    download_parser.add_argument('--benchmark-out', '-b',
                                 help='Path to folder where benchmark data will be written to.')
    download_parser.set_defaults(func=_run_download_command)

    # Handle 'update' command
    update_parser = subparsers.add_parser('update',
                                          help='Creates a new dataset version from an existing '
                                               'version by adding or removing files.',
                                          formatter_class=argparse.RawTextHelpFormatter,
                                          epilog='Ex. osmo dataset update DS1 --add '
                                                 'relative/path:remote/path /other/local/path '
                                                 's3://path:remote/path\n'
                                                 'Ex. osmo dataset update DS1 --remove '
                                                 '".*\\.(yaml|json)$"\n')
    update_parser.add_argument('name',
                               help='Dataset name. Specify bucket and tag/version ' +
                                    'with [bucket/]DS[:tag/version].')
    update_parser.add_argument('--add', '-a',
                               nargs='+',
                               default=[],
                               help='Local paths/Remote URIs to append to the '
                                    'dataset. To specify path in the dataset where the files '
                                    'should be stored, use ":" to delineate '
                                    'local/path:remote/path. Files in the local path will be '
                                    'stored with the prefix of the '
                                    r'remote path. If the path contains ":", use "\:" '
                                    'in the path.').complete = shtab.FILE
    update_parser.add_argument('--remove', '-r',
                               type=validation.is_regex,
                               help='Regex to filter which types of files to remove.')
    update_parser.add_argument('--metadata', '-m',
                               nargs='+',
                               default=[],
                               help='Yaml files of metadata to assign to the newly '
                                    'created dataset version').complete = shtab.FILE
    update_parser.add_argument('--labels', '-l',
                               nargs='+',
                               default=[],
                               help='Yaml files of labels to assign to the '
                                    'dataset').complete = shtab.FILE
    update_parser.add_argument('--resume',
                               type=str,
                               help='Resume a canceled/failed update. To resume, specify the '
                                    'PENDING version to continue.')
    update_parser.add_argument('--start-only',
                               dest='start_only',
                               action='store_true',
                               help=argparse.SUPPRESS)
    update_parser.add_argument('--processes', '-p',
                               default=storage_lib.DEFAULT_NUM_PROCESSES,
                               help='Number of processes. '
                                    f'Defaults to {storage_lib.DEFAULT_NUM_PROCESSES}')
    update_parser.add_argument('--threads', '-T',
                               default=storage_lib.DEFAULT_NUM_THREADS,
                               help='Number of threads per process. '
                                    f'Defaults to {storage_lib.DEFAULT_NUM_THREADS}')
    update_parser.add_argument('--benchmark-out', '-b',
                               help='Path to folder where benchmark data will be written to.')
    update_parser.set_defaults(func=_run_update_command)

    # Handle 'recollect' command
    recollect_parser = subparsers.add_parser('recollect',
                                             help='Add or remove datasets from a collection.',
                                             formatter_class=argparse.RawTextHelpFormatter,
                                             epilog='Ex. osmo dataset recollect C1 --remove DS1 '
                                                    '--add DS2:4')
    recollect_parser.add_argument('name',
                                  help='Collection name. Specify bucket with [bucket/]Collection.')
    recollect_parser.add_argument('--add', '-a',
                                  nargs='+',
                                  default=[],
                                  help='Datasets to add to collection.')
    recollect_parser.add_argument('--remove', '-r',
                                  nargs='+',
                                  default=[],
                                  help='Datasets to remove from collection. '
                                       'The remove operation happens before the add.')
    recollect_parser.set_defaults(func=_run_recollect_command)

    # Handle 'list' command
    list_parser = subparsers.add_parser('list', help='List all Datasets/Collections uploaded by '
                                                     'the user',
                                        epilog='Ex. osmo dataset list --all-users '
                                               'or osmo dataset list --user abc xyz')
    list_parser.add_argument('--name', '-n',
                             dest='name',
                             default='',
                             help='Display datasets that have the given substring in their name')
    list_parser.add_argument('--user', '-u',
                             dest='user',
                             nargs='+',
                             default=[],
                             help='Display all datasets where the user has uploaded to.')
    list_parser.add_argument('--bucket', '-b',
                             nargs='+',
                             default=[],
                             help='Display all datasets from the given buckets.')
    list_parser.add_argument('--all-users', '-a',
                             dest='all',
                             action='store_true',
                             help='Display all datasets with no filtering on users')
    list_parser.add_argument('--count', '-c',
                             dest='count',
                             type=validation.positive_integer,
                             default=20,
                             help='Display the given number of datasets. Default 20. Max 1000.')
    list_parser.add_argument('--order', '-o',
                             dest='order',
                             default='asc',
                             choices=('asc', 'desc'),
                             help='Display in the given order. asc means latest at the bottom. '
                                  'desc means latest at the top')
    list_parser.add_argument('--format-type', '-t',
                             dest='format_type',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    list_parser.set_defaults(func=_run_list_command)

    # Handle "tag" command
    tag_parser = subparsers.add_parser('tag',
                                       help='Update Dataset Version tags',
                                       epilog='Ex. osmo dataset tag DS1 --set tag1 --delete tag2')
    tag_parser.add_argument('name',
                            help='Dataset name to update. Specify bucket and tag/version with ' +
                                 '[bucket/]DS[:tag/version].')
    tag_parser.add_argument('--set', '-s',
                            dest='set',
                            nargs='+',
                            default=[],
                            help='Set tag to dataset version.')
    tag_parser.add_argument('--delete', '-d',
                            dest='delete',
                            nargs='+',
                            default=[],
                            help='Delete tag from dataset version.')
    tag_parser.set_defaults(func=_run_tag_command)

    # Handle 'label' command
    label_parser = subparsers.add_parser('label',
                                         help='Update Dataset labels.',
                                         epilog='Ex. osmo dataset label DS1 --set'
                                                ' key1:string:value1 --delete key2')
    label_parser.add_argument('name', help='Dataset name to update. Specify bucket ' +
                                           'with [bucket/][DS].')
    label_parser.add_argument('--file', '-f',
                              dest='is_file',
                              action='store_true',
                              help='If enabled, the inputs to set and delete must be files.')
    label_parser.add_argument('--set', '-s',
                              dest='set',
                              nargs='+',
                              default=[],
                              help='Set label for dataset in the form '
                                   '"<key>:<type>:<value>" where type is '
                                   'string or numeric'
                                   'or the file-path').complete = shtab.FILE
    label_parser.add_argument('--delete', '-d',
                              dest='delete',
                              nargs='+',
                              default=[],
                              help='Delete labels from dataset in the form "<key>"'
                                   'or the file-path').complete = shtab.FILE
    label_parser.add_argument('--format-type', '-t',
                              dest='format_type',
                              choices=('json', 'text'), default='text',
                              help='Specify the output format type (Default text).')
    label_parser.set_defaults(func=_run_label_command)

    # Handle 'metadata' command
    metadata_parser = subparsers.add_parser('metadata',
                                            help='Update Dataset Version metadata. A tag/version '
                                                 'is required.',
                                            epilog='Ex. osmo dataset metadata DS1:latest --set'
                                                   ' key1:string:value1 --delete key2')
    metadata_parser.add_argument('name', help='Dataset name to update. Specify bucket and ' +
                                              'tag/version with [bucket/]DS[:tag/version].')
    metadata_parser.add_argument('--file', '-f',
                                 dest='is_file',
                                 action='store_true',
                                 help='If enabled, the inputs to set and delete must be files.')
    metadata_parser.add_argument('--set', '-s',
                                 dest='set',
                                 nargs='+',
                                 default=[],
                                 help='Set metadata from dataset in the form '
                                      '"<key>:<type>:<value>" where type is '
                                      'string or numeric'
                                      'or the file-path').complete = shtab.FILE
    metadata_parser.add_argument('--delete', '-d',
                                 dest='delete',
                                 nargs='+',
                                 default=[],
                                 help='Delete metadata from dataset in the form "<key>"'
                                      'or the file-path').complete = shtab.FILE
    metadata_parser.add_argument('--format-type', '-t',
                                 dest='format_type',
                                 choices=('json', 'text'), default='text',
                                 help='Specify the output format type (Default text).')
    metadata_parser.set_defaults(func=_run_metadata_command)

    # Handle 'rename' command
    rename_parser = subparsers.add_parser('rename',
                                          help='Rename dataset/collection',
                                          epilog='Ex. osmo dataset rename original_name new_name')
    rename_parser.add_argument('original_name',
                               help='Old dataset/collection name. Specify bucket ' +
                                    'with [bucket/][DS].')
    rename_parser.add_argument('new_name', help='New dataset/collection name.')
    rename_parser.set_defaults(func=_run_rename_command)

    # Handle 'query' command
    query_parser = subparsers.add_parser('query',
                                         help='Query datasets based on metadata',
                                         epilog='Ex. osmo dataset query file.yaml')
    query_parser.add_argument('file',
                              help='The Query file to submit').complete = shtab.FILE
    query_parser.add_argument('--bucket', '-b',
                              type=validation.is_bucket,
                              help='bucket to query.')
    query_parser.add_argument('--format-type', '-t',
                              dest='format_type',
                              choices=('json', 'text'), default='text',
                              help='Specify the output format type (Default text).')
    query_parser.set_defaults(func=_run_query_command)

    # Handle 'collect' command
    collect_parser = subparsers.add_parser('collect', help='Create a Collection',
                                           epilog='Ex. osmo dataset collect CName C1 DS1 DS2 '
                                                  'DS3:latest')
    collect_parser.add_argument(dest='name',
                                help='Collection name. Specify bucket and with [bucket/][C]. ' +
                                     'All datasets and collections added to this collection ' +
                                     'are based off of this bucket')
    collect_parser.add_argument('datasets',
                                nargs='+',
                                help='Each Dataset to add to collection. To create a '
                                     'collection from another collection, add the '
                                     'collection name.')
    collect_parser.set_defaults(func=_run_collect_command)

    # Handle 'inspect' command
    inspect_parser = subparsers.add_parser('inspect',
                                           help='Display Dataset Directory',
                                           epilog='Ex. osmo dataset inspect DS1:latest ' +
                                           '--format-type json')
    inspect_parser.add_argument('name',
                                help='Dataset name. Specify bucket and ' +
                                     'tag/version with [bucket/]DS[:tag/version].')
    inspect_parser.add_argument('--format-type', '-t',
                                dest='format_type',
                                choices=('text', 'tree', 'json'), default='text',
                                help='Type text is that files are just printed out. Type tree '
                                     'displays a better representation of the directory '
                                     'structure. Type json prints out the list of json '
                                     'objects with both URI and URL links.')
    inspect_parser.add_argument('--regex', '-x',
                                type=validation.is_regex,
                                help='Regex to filter which types of files to inspect')
    inspect_parser.add_argument('--count', '-c',
                                type=int, default=1000,
                                help='Number of files to print. Default 1,000.')
    inspect_parser.set_defaults(func=_run_inspect_command)

    # Handle 'checksum' command
    checksum_parser = subparsers.add_parser('checksum',
                                            help='Calculate Directory Checksum',
                                            epilog='Ex. osmo dataset checksum /path/to/folder')
    checksum_parser.add_argument('path',
                                 nargs='+',
                                 help='Paths where the folder lies.').complete = shtab.FILE
    checksum_parser.set_defaults(func=_run_checksum_command)

    # Handle 'migrate' command
    migrate_parser = subparsers.add_parser('migrate',
                                           help='Migrate a legacy (non-manifest based) dataset to '
                                                'a new manifest based dataset.',
                                           epilog='Ex. osmo dataset migrate DS1:latest')
    migrate_parser.add_argument('name',
                                help='Dataset name. Specify bucket and tag/version with ' +
                                     '[bucket/]DS[:tag/version].')
    migrate_parser.add_argument('--processes', '-p',
                                default=storage_lib.DEFAULT_NUM_PROCESSES,
                                help='Number of processes. '
                                     f'Defaults to {storage_lib.DEFAULT_NUM_PROCESSES}')
    migrate_parser.add_argument('--threads', '-T',
                                default=storage_lib.DEFAULT_NUM_THREADS,
                                help='Number of threads per process. '
                                     f'Defaults to {storage_lib.DEFAULT_NUM_THREADS}')
    migrate_parser.add_argument('--benchmark-out', '-b',
                                help='Path to folder where benchmark data will be written to.')
    migrate_parser.set_defaults(func=_run_migrate_command)

    # Handle 'check' command (add after migrate_parser in setup_parser function)
    check_parser = subparsers.add_parser(
        'check',
        help='Check access permissions for dataset operations',
        description='Check access permissions for dataset operations',
    )
    check_parser.add_argument('name',
                              help='Dataset name. Specify bucket and tag/version with ' +
                              '[bucket/]DS[:tag/version].')
    check_parser.add_argument('--access-type', '-a',
                              choices=list(storage_lib.AccessType.__members__.keys()),
                              help='Access type to check access to the dataset.')
    check_parser.add_argument('--config-file', '-c',
                              type=validation.valid_path,
                              help='Path to the config file to use for the access check.')
    check_parser.set_defaults(func=_run_check_command)
