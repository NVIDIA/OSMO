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
import datetime
import json
import sys

from typing import Any, Dict, List

from src.lib.utils import client, common, priority as wf_priority, validation


def setup_parser(parser: argparse._SubParsersAction):
    '''
    Task parser setup and run command based on parsing.

    Args:
        parser: The parser to be configured.
    '''
    resources_parser = parser.add_parser('task',
        help='Get information about tasks available.')
    subparsers = resources_parser.add_subparsers(dest='command')
    subparsers.required = True

    # Handle 'list' command
    status_choices = (
        'WAITING', 'PROCESSING', 'SCHEDULING', 'INITIALIZING', 'RUNNING', 'FAILED', 'COMPLETED',
        'FAILED_EXEC_TIMEOUT', 'FAILED_START_ERROR', 'FAILED_START_TIMEOUT', 'FAILED_SERVER_ERROR',
        'FAILED_BACKEND_ERROR', 'FAILED_QUEUE_TIMEOUT', 'FAILED_IMAGE_PULL', 'FAILED_UPSTREAM',
        'FAILED_EVICTED', 'FAILED_PREEMPTED', 'FAILED_CANCELED')
    list_parser = subparsers.add_parser('list', help='List tasks with different filters.')
    list_parser.add_argument('--status', '-s',
                             choices=status_choices,
                             nargs='+',
                             default=['PROCESSING', 'SCHEDULING', 'INITIALIZING', 'RUNNING'],
                             metavar='STATUS',
                             help='Display all tasks with the given status(es). '\
                                  'Users can pass multiple values to this flag. '\
                                  'Defaults to PROCESSING, SCHEDULING, INITIALIZING and RUNNING. '\
                                  f'Acceptable values: {", ".join(status_choices)}.')
    list_parser.add_argument('--workflow-id', '-w',
                             dest='workflow_id',
                             help='Display workflows which contains the string.')
    group = list_parser.add_mutually_exclusive_group()
    group.add_argument('--user', '-u',
                       nargs='+',
                       default=[],
                       help='Display all tasks by this user. Users can pass multiple '\
                            'values to this flag.')
    group.add_argument('--all-users', '-a',
                       action='store_true',
                       required=False,
                       dest='all_users',
                       help='Display all tasks with no filtering on users.')
    pool_group = list_parser.add_mutually_exclusive_group()
    pool_group.add_argument('--pool', '-p',
                            nargs='+',
                            default=[],
                            help='Display all tasks by this pool. Users can pass '\
                                 'multiple values to this flag. If not specified, all pools '\
                                 'will be selected.')
    pool_group.add_argument('--node', '-n',
                            nargs='+',
                            default=[],
                            help='Display all tasks which ran on this node. Users can pass '\
                                 'multiple values to this flag. If not specified, all nodes '\
                                 'will be selected.')
    list_parser.add_argument('--started-after',
                             dest='started_after',
                             type=validation.date_str,
                             help='Filter for tasks that were started after AND including '\
                                  'this date. Must be in format YYYY-MM-DD.\n'
                                  'Example: --started-after 2023-05-03.')
    list_parser.add_argument('--started-before',
                             dest='started_before',
                             type=validation.date_str,
                             help='Filter for tasks that were started before (NOT '\
                                  'including) this date. Must be in format YYYY-MM-DD.\n'
                                  'Example: --started-after 2023-05-02 --started-before '
                                  '2023-05-04 includes all tasks that were started any '
                                  'time on May 2nd and May 3rd only.')
    list_parser.add_argument('--count', '-c',
                             default=20,
                             type=validation.positive_integer,
                             help='Display the given count of tasks. Default value is 20. '
                                  'Max value of 1000.')
    list_parser.add_argument('--offset', '-f',
                             default=0,
                             type=validation.non_negative_integer,
                             help='Used for pagination. Returns starting tasks '
                                  'from the offset index.')
    list_parser.add_argument('--order', '-o',
                             default='asc',
                             choices=('asc','desc'),
                             help='Display in the order in which tasks were started. '\
                                  'asc means latest at the bottom. desc means latest at the top.')
    list_request = list_parser.add_mutually_exclusive_group()
    list_request.add_argument('--verbose', '-v',
                              action='store_true',
                              required=False,
                              help='Display storage, cpu, memory, and gpu request.')
    list_request.add_argument('--summary', '-S',
                              action='store_true',
                              required=False,
                              help='Displays resource request grouped by user and pool.')
    list_parser.add_argument('--aggregate-by-workflow', '-W',
                              action='store_true',
                              required=False,
                              help='Aggregate resource request by workflow.')
    list_parser.add_argument('--priority',
                             type=lambda x: x.upper(),
                             nargs='+',
                             choices=[p.value for p in wf_priority.WorkflowPriority],
                             help='Filter tasks by priority levels.')
    list_parser.add_argument('--format-type', '-t',
                             dest='format_type',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    list_parser.set_defaults(func=_list_tasks)


def _list_tasks(service_client: client.ServiceClient, args: argparse.Namespace):

    params: Dict[str, Any] = {
        'limit': args.count,
        'offset': args.offset,
        'all_users': args.all_users,
        'workflow_id': args.workflow_id,
        'nodes': args.node
    }
    if args.user:
        params['users'] = args.user
    if args.status:
        params['statuses'] = args.status
    if args.order:
        params['order'] = args.order.upper()
    if args.pool:
        params['pools'] = args.pool
    else:
        params['all_pools'] = True
    if args.summary:
        params['summary'] = True
    if args.aggregate_by_workflow:
        params['aggregate_by_workflow'] = True
    if args.priority:
        params['priority'] = args.priority

    if args.started_after:
        params['started_after'] = common.convert_timezone(f'{args.started_after}T00:00:00')
    if args.started_before:
        params['started_before'] = common.convert_timezone(f'{args.started_before}T00:00:00')
        if args.started_after:
            before_dt = datetime.datetime.strptime(params['started_before'],
                                                   '%Y-%m-%dT%H:%M:%S')
            after_dt = datetime.datetime.strptime(params['started_after'],
                                                  '%Y-%m-%dT%H:%M:%S')
            if after_dt > before_dt:
                print(f'Value started-before ({args.started_before}) needs to be later '
                      f'than started-after ({args.started_after}).')
                sys.exit(1)

    task_result = service_client.request(client.RequestMethod.GET, 'api/task', params=params)

    request_dict = {
        labels.name: 0
        for labels in common.ALLOCATABLE_RESOURCES_LABELS
    }
    if args.format_type == 'json':
        print(json.dumps(task_result, indent=2))
    elif args.summary:
        base_mapping = {'User': 'user',
                        'Pool': 'pool',
                        'Priority': 'priority'}
        request_mapping= {
            labels.name: labels.name.lower()
            for labels in common.ALLOCATABLE_RESOURCES_LABELS
        }
        request_sum = request_dict
        key_mapping = {**base_mapping, **request_mapping}
        keys = list(key_mapping.keys())
        table = common.osmo_table(header=keys)
        table.set_cols_dtype(['t' for _ in range(len(keys))])
        for summary_entry in task_result['summaries']:
            row = []
            for key in keys:
                value = summary_entry.get(key_mapping[key], '-')
                if key == 'Start Time' and value:
                    value = common.convert_utc_datetime_to_user_zone(value)
                if key in request_mapping:
                    request_sum[key] += value
                if value is None:
                    value = '-'
                row.append(value)
            table.add_row(row)
        if task_result['summaries']:
            total_row: List[Any] = ['']*len(base_mapping) + list(request_sum.values())
            print(common.create_table_with_sum_row(table, total_row))
        else:
            print('There are no summaries to view.')
    elif args.aggregate_by_workflow:
        base_mapping = {'User': 'user',
                        'Workflow ID': 'workflow_id',
                        'Pool': 'pool',
                        'Priority': 'priority'}
        request_mapping = {
            labels.name: labels.name.lower()
            for labels in common.ALLOCATABLE_RESOURCES_LABELS
        }
        request_sum = request_dict
        key_mapping = {**base_mapping, **request_mapping}
        keys = list(key_mapping.keys())
        table = common.osmo_table(header=keys)
        table.set_cols_dtype(['t' for _ in range(len(keys))])

        for workflow_entry in task_result['summaries']:
            row = []
            for key in keys:
                value = workflow_entry.get(key_mapping[key], '-')
                if key in request_mapping:
                    request_sum[key] += value
                if value is None:
                    value = '-'
                row.append(value)
            table.add_row(row)
        if task_result['summaries']:
            total_row = ['']*len(base_mapping) + list(request_sum.values())
            print(common.create_table_with_sum_row(table, total_row))
        else:
            print('There are no workflows to view.')
    else:
        base_mapping = {'User': 'user',
                        'Workflow ID': 'workflow_id',
                        'Task': 'task_name',
                        'Status': 'status',
                        'Pool': 'pool',
                        'Priority': 'priority',
                        'Node': 'node',
                        'Start Time': 'start_time'}
        request_mapping = {}
        request_sum = {}
        if args.verbose:
            request_mapping= {
                labels.name: labels.name.lower()
                for labels in common.ALLOCATABLE_RESOURCES_LABELS
            }
            request_sum = request_dict
        key_mapping = {**base_mapping, **request_mapping}
        keys = list(key_mapping.keys())
        table = common.osmo_table(header=keys)
        table.set_cols_dtype(['t' for _ in range(len(keys))])
        for task_entry in task_result['tasks']:
            row = []
            for key in keys:
                value = task_entry.get(key_mapping[key], '-')
                if key == 'Start Time' and value:
                    value = common.convert_utc_datetime_to_user_zone(value)
                if args.verbose and key in request_mapping:
                    request_sum[key] += value
                if value is None:
                    value = '-'
                row.append(value)
            table.add_row(row)
        if task_result['tasks']:
            if args.verbose:
                total_row = ['']*len(base_mapping) + list(request_sum.values())
                print(common.create_table_with_sum_row(table, total_row))
            else:
                print(table.draw())
        else:
            print('There are no tasks to view.')
