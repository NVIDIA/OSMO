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
import asyncio
import collections
import datetime
import fcntl
import logging
import json
import os
import re
import signal
import struct
import sys
import tempfile
import termios
import time
import tty
from typing import Any, Dict, List, Tuple, TypeAlias

import pydantic
import requests  # type: ignore
import shtab
import websockets
import websockets.client
import websockets.exceptions
import yaml
import texttable  # type: ignore

from src.cli import dataset, pool
from src.lib import rsync
from src.lib.data import storage
from src.lib.utils import (client, common, osmo_errors, paths, port_forward, priority as wf_priority,
                        validation, workflow as workflow_utils)


INTERACTIVE_COMMANDS = ['bash', 'sh', 'zsh', 'fish', 'tcsh', 'csh', 'ksh']


class TemplateData(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """Pydantic model representing parsed template data from workflow files."""
    file: str
    set_variables: List[str]
    set_string_variables: List[str]
    uploaded_templated_spec: str | None = None
    is_templated: bool

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for backwards compatibility."""
        return {
            'file': self.file,
            'set_variables': self.set_variables,
            'set_string_variables': self.set_string_variables,
            'uploaded_templated_spec': self.uploaded_templated_spec
        }


def setup_parser(parser: argparse._SubParsersAction):
    '''
    Workflow parser setup and run command based on parsing.

    Args:
        parser: The parser to be configured.
    '''
    workflow_parser = parser.add_parser('workflow',
        help='Manage workflows submitted to the workflow service.')
    subparsers = workflow_parser.add_subparsers(dest='command')
    subparsers.required = True

    # Handle 'submit' command
    submit_parser = subparsers.add_parser('submit',
                                          help='Submit a workflow to the workflow service.')
    submit_parser.add_argument('workflow_file',
                               type=str,
                               help='The workflow file to submit, or the spec of a workflow ID '
                                    'to submit. If using a workflow ID, --dry-run and --set are '
                                    'not supported.').complete = shtab.FILE
    submit_parser.add_argument('--format-type', '-t',
                               dest='format_type',
                               choices=('json', 'text'), default='text',
                               help='Specify the output format type (Default text).')
    submit_parser.add_argument('--set',
                               nargs='+',
                               default=[],
                               help='Assign fields in the workflow file with desired elements '
                                    'in the form "<field>=<value>". These values will override '
                                    'values set in the "default-values" section. Overridden fields'
                                    ' in the yaml file should be in the form {{ field }}. '
                                    'Values will be cast as int or float if applicable')
    submit_parser.add_argument('--set-string',
                               dest='set_string',
                               nargs='+',
                               default=[],
                               help='Assign fields in the workflow file with desired elements '
                                    'in the form "<field>=<value>". These values will override '
                                    'values set in the "default-values" section. Overridden fields'
                                    ' in the yaml file should be in the form {{ field }}. '
                                    'All values will be cast as string')
    submit_parser.add_argument('--set-env',
                               dest='set_env',
                               nargs='+',
                               default=[],
                               help='Assign environment variables to the workflow. '
                                    'The value should be in the format <key>=<value>. '
                                    'Multiple key-value pairs can be passed. If an environment '
                                    'variable passed here is already defined in the workflow, the '
                                    'value declared here will override the value in the workflow.')
    submit_parser.add_argument('--dry-run',
                               action='store_true',
                               dest='dry',
                               help='Does not submit the workflow and prints the workflow into '
                                    'the console.')
    submit_parser.add_argument('--pool', '-p',
                               help='The target pool to run the workflow with. If no pool is '
                                    'specified, the default pool assigned in the profile will '
                                    'be used.')
    submit_parser.add_argument('--rsync',
                               type=str,
                               help='Start a background rsync daemon to continuously upload data '
                                    'from local machine to the lead task of the workflow. '
                                    'The value should be in the format <local_path>:<remote_path>. '
                                    'The daemon process will automatically exit when the workflow '
                                    'is terminated.')
    submit_parser.add_argument('--priority',
                               type=lambda x: x.upper(),
                               help='The priority to use when scheduling the workflow. If none is '
                                    'provided, NORMAL will be used. The scheduler will prioritize '
                                    'scheduling workflows in the order of HIGH, NORMAL, '
                                    'LOW. LOW workflows may be preempted to allow a '
                                    'higher priority workflow to run.',
                               choices=[p.value for p in wf_priority.WorkflowPriority])
    submit_parser.set_defaults(func=_submit_workflow)

    # Handle 'restart' command
    restart_parser = subparsers.add_parser('restart',
                                           help='Restart a failed workflow.')
    restart_parser.add_argument('workflow_id',
                                type=str,
                                help='The workflow ID or UUID to restart.').complete = shtab.FILE
    restart_parser.add_argument('--format-type', '-t',
                                dest='format_type',
                                choices=('json', 'text'), default='text',
                                help='Specify the output format type (Default text).')
    restart_parser.add_argument('--pool', '-p',
                                help='The target pool to run the workflow with.')
    restart_parser.set_defaults(func=_restart_workflow)

    # Handle 'validate' command
    validate_parser = subparsers.add_parser('validate',
                                            help='validate a workflow to the workflow server.')
    validate_parser.add_argument('workflow_file',
                                 type=lambda p: os.path.abspath(p),
                                 help='The workflow file to submit.').complete = shtab.FILE
    validate_parser.add_argument('--set',
                                 nargs='+',
                                 default=[],
                                 help='Assign fields in the workflow file with desired elements '
                                      'in the form "<field>=<value>". These values will override '
                                      'values set in the "default-values" section. Overridden '
                                      'fields in the yaml file should be in the form {{ field }}. '
                                      'Values will be cast as int or float if applicable')
    validate_parser.add_argument('--set-string',
                                 dest='set_string',
                                 nargs='+',
                                 default=[],
                                 help='Assign fields in the workflow file with desired elements '
                                      'in the form "<field>=<value>". These values will override '
                                      'values set in the "default-values" section. Overridden '
                                      'fields in the yaml file should be in the form {{ field }}. '
                                      'All values will be cast as string')
    validate_parser.add_argument('--pool', '-p',
                                 help='The target pool to run the workflow with. If no pool is '
                                      'specified, the default pool assigned in the profile will '
                                      'be used.')
    validate_parser.set_defaults(func=_validate_workflow)

    # Handle 'logs' command
    logs_parser = subparsers.add_parser('logs', help='Get the logs from a workflow.')
    logs_parser.add_argument('workflow_id',
                             help='The workflow ID or UUID for which to fetch the logs.')
    logs_parser.add_argument('--task', '-t',
                             type=str,
                             help='The task name for which to fetch the logs.')
    logs_parser.add_argument('--retry-id', '-r',
                             type=int,
                             help='The retry ID for the task which to fetch the logs. '
                                  'If not provided, the latest retry ID will be used.')
    logs_parser.add_argument('--error',
                             action='store_true',
                             help='Show task error logs instead of regular logs')
    logs_parser.add_argument('-n',
                             dest='last_n_lines',
                             type=int,
                             default=None,
                             help='Show last n lines of logs')
    logs_parser.set_defaults(func=_workflow_logs)

    # Handle 'cancel' command
    cancel_parser = subparsers.add_parser('cancel', help='Cancel a queued or running workflow.')
    cancel_parser.add_argument('workflow_ids', nargs='+',
                               help='The workflow IDs or UUIDs to cancel. '
                                    'Multiple IDs or UUIDs can be passed.')
    cancel_parser.add_argument('--message', '-m',
                               type=str,
                               help='Additional message describing reason for cancelation.')
    cancel_parser.add_argument('--force', '-f',
                               action='store_true',
                               help='Force cancel task group pods in the cluster.')
    cancel_parser.add_argument('--format-type', '-t',
                               dest='format_type',
                               choices=('json', 'text'), default='text',
                               help='Specify the output format type (Default text).')
    cancel_parser.set_defaults(func=_cancel_workflow)

    # Handle 'query' command
    query_parser = subparsers.add_parser('query', help='Query the status of a running workflow.')
    query_parser.add_argument('workflow_id',
                              help='The workflow ID or UUID to query the status of.')
    query_parser.add_argument('--verbose', '-v', action='store_true',
                              help='Whether to show all retried tasks.')
    query_parser.add_argument('--format-type', '-t',
                              dest='format_type',
                              choices=('json', 'text'), default='text',
                              help='Specify the output format type (Default text).')
    query_parser.set_defaults(func=_query_workflow)

    # Handle 'list' command
    list_parser = subparsers.add_parser('list', help='List workflows with different filters. ' + \
        'Without the --pool flag, workflows from all pools will be listed.')
    list_parser.add_argument('--count', '-c',
                             default=20,
                             type=validation.positive_integer,
                             help='Display the given count of workflows. Default value is 20.')
    list_parser.add_argument('--name', '-n',
                             type=str,
                             help='Display workflows which contains the string.')
    list_parser.add_argument('--order', '-o',
                             default='asc',
                             choices=('asc','desc'),
                             help='Display in the order in which workflows were submitted. ' +\
                                  'asc means latest at the bottom. desc means latest at the ' +\
                                  'top. Default is asc.')
    list_parser.add_argument('--status', '-s',
                             choices=('RUNNING','FAILED','COMPLETED','PENDING', 'WAITING',
                                      'FAILED_EXEC_TIMEOUT',
                                      'FAILED_SERVER_ERROR', 'FAILED_QUEUE_TIMEOUT',
                                      'FAILED_SUBMISSION', 'FAILED_CANCELED',
                                      'FAILED_BACKEND_ERROR', 'FAILED_IMAGE_PULL',
                                      'FAILED_EVICTED', 'FAILED_START_ERROR',
                                      'FAILED_START_TIMEOUT', 'FAILED_PREEMPTED'),
                             nargs='+',
                             metavar='STATUS',
                             help='Display all workflows with the given status(es). ' + \
                                  'Users can pass multiple values to this flag. ' + \
                                  'Acceptable values: RUNNING, FAILED, COMPLETED, PENDING, ' + \
                                  'WAITING, ' + \
                                  'FAILED_EXEC_TIMEOUT, FAILED_SERVER_ERROR, '
                                  'FAILED_QUEUE_TIMEOUT, FAILED_SUBMISSION, FAILED_CANCELED, ' + \
                                  'FAILED_BACKEND_ERROR, FAILED_IMAGE_PULL, FAILED_EVICTED, ' + \
                                  'FAILED_START_ERROR, FAILED_START_TIMEOUT, FAILED_PREEMPTED')
    list_parser.add_argument('--format-type', '-t',
                             dest='format_type',
                             choices=('json', 'text'), default='text',
                             help='Specify the output format type (Default text).')
    list_parser.add_argument('--submitted-after',
                             dest='submitted_after',
                             type=validation.date_str,
                             help='Filter for workflows that were submitted after AND including '\
                                  'this date. Must be in format YYYY-MM-DD.\n'
                                  'Example: --submitted-after 2023-05-03')
    list_parser.add_argument('--submitted-before',
                             dest='submitted_before',
                             type=validation.date_str,
                             help='Filter for workflows that were submitted before (NOT '\
                                  'including) this date. Must be in format YYYY-MM-DD.\n'
                                  'Example: --submitted-after 2023-05-02 --submitted-before '
                                  '2023-05-04 includes all workflows that were submitted any '
                                  'time on May 2nd and May 3rd only.')
    list_parser.add_argument('--tags',
                             nargs='+',
                             help='Filter for workflows that contain the tag(s).')
    list_parser.add_argument('--priority',
                             type=lambda x: x.upper(),
                             nargs='+',
                             choices=[p.value for p in wf_priority.WorkflowPriority],
                             help='Filter workflows by priority levels.')
    group = list_parser.add_mutually_exclusive_group()
    group.add_argument('--user', '-u',
                       nargs='+',
                       default=[],
                       help='Display all workflows by this user. Users can pass multiple ' + \
                            'values to this flag.')
    group.add_argument('--all-users', '-a',
                       action='store_true',
                       required=False,
                       dest='all_users',
                       help='Display all workflows with no filtering on users.')
    pool_group = list_parser.add_mutually_exclusive_group()
    pool_group.add_argument('--pool', '-p',
                            nargs='+',
                            default=[],
                            help='Display all workflows by this pool. Users can pass ' + \
                                 'multiple values to this flag.')
    list_parser.add_argument('--app', '-P',
                            help='Display all workflows created by this app. '
                                 'For a specific app or app version, use the format '
                                 '<app>:<version>.')
    list_parser.set_defaults(func=_list_workflows)

    # Handle 'tag' command
    tag_parser = subparsers.add_parser('tag',
                                       help='List or change tags from workflow(s) '
                                            'if no workflow is specified. '
                                            'Remove is applied before add')
    tag_parser.add_argument('--workflow', '-w',
                            nargs='+',
                            help='List of workflows to update. If not set, the CLI will '
                                 'return the list of available tags to assign.')
    tag_parser.add_argument('--add', '-a',
                            nargs='+',
                            default=[],
                            help='List of tags to add.')
    tag_parser.add_argument('--remove', '-r',
                            nargs='+',
                            default=[],
                            help='List of tags to remove.')
    tag_parser.set_defaults(func=_tag_workflows)

    # Handle 'exec' command
    exec_parser = subparsers.add_parser('exec', help='Exec into a task of a workflow.')
    exec_parser.add_argument('workflow_id', help='The workflow ID or UUID to exec in.')
    task_group = exec_parser.add_mutually_exclusive_group(required=True)
    task_group.add_argument('task', nargs='?', help='The task name to exec into.')
    task_group.add_argument('--group', help='Send command to all tasks in the group.')
    exec_parser.add_argument('--entry',
                             dest='exec_entry_command',
                             default='/bin/bash',
                             help='Specify the entry point for exec (Default /bin/bash).')
    exec_parser.add_argument('--connect-timeout',
                             dest='connect_timeout',
                             type=validation.positive_integer,
                             default=60,
                             help='The connection timeout period in seconds. ' + \
                                  'Default is 60 seconds.')
    exec_parser.add_argument('--keep-alive',
                             action='store_true',
                             help='Restart the exec command if connection is lost.')
    exec_parser.set_defaults(func=_exec_workflow)

    # Handle 'spec' command
    spec_parser = subparsers.add_parser('spec', help='Get workflow spec.')
    spec_parser.add_argument('workflow_id', help='The workflow ID or UUID to query the status of.')
    spec_parser.add_argument('--template', action='store_true',
                             help='Show the original templated spec')
    spec_parser.set_defaults(func=_get_spec)

    # Handle 'port-forward' command
    port_forward_parser = subparsers.add_parser('port-forward',
        help='Port-forward data from workflow to local machine.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples
========

Forward UDP traffic from a task to your local machine::

  osmo workflow port-forward wf-1 sim-task --port 47995-48012,49000-49007 --udp
        ''')
    port_forward_parser.add_argument('workflow_id',
                                     help='The ID or UUID of the workflow to port forward from')
    port_forward_parser.add_argument('task',
                                     help='Name of the task in the workflow to port forward from')
    port_forward_parser.add_argument('--host',
                                     default='localhost',
                                     help='The hostname used to bind the local port. ' + \
                                          'Default value is localhost.')
    port_forward_parser.add_argument('--port',
                                     type=parse_port,
                                     required=True,
                                     help='Port forward from task in the pool. ' \
                                     'Input value should be in format local_port[:task_port], ' \
                                     'or in range port1-port2,port3-port4 (right end inclusive). ' \
                                     'e.g. "8000:2000", "8000", "8000-8010:9000-9010,8015-8016". ' \
                                     'If using a single port value or range, the client will use ' \
                                     'that port value for both local port and task port.')
    port_forward_parser.add_argument('--udp', action='store_true', help='Use UDP port forward.')
    port_forward_parser.add_argument('--connect-timeout',
                                     dest='connect_timeout',
                                     type=validation.positive_integer,
                                     default=60,
                                     help='The connection timeout period in seconds. ' + \
                                          'Default is 60 seconds.')
    port_forward_parser.set_defaults(func=_port_forward)

    # Handle 'rsync' command
    rsync_parser = subparsers.add_parser(
        'rsync',
        help='Rsync data from local machine to a remote workflow task.',
        description='Syncs data from local machine to a remote workflow task via a persistent '
                    'background daemon. It will continuously monitors the source path and '
                    'automatically upload any changes to the remote task.\n\n'
                    '/osmo/run/workspace is always available as a remote path.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples
========

Upload to a task::

    osmo workflow rsync <workflow_id> <task_name> <local_path>:<remote_path>

Upload to lead task::

    osmo workflow rsync <workflow_id> <local_path>:<remote_path>

Run a single upload::

    osmo workflow rsync <workflow_id> <local_path>:<remote_path> --once

Get the status of daemons::

    osmo workflow rsync --status

Stop all daemons::

    osmo workflow rsync --stop

Stop a specific daemon::

    osmo workflow rsync <workflow_id> --stop
        ''')
    rsync_parser.add_argument('workflow_id',
                              nargs='?',
                              help='The ID or UUID of the workflow to rsync to/from')
    rsync_parser.add_argument('task',
                              nargs='?',
                              help='(Optional) The task to rsync upload to. If not provided, '
                                   'the upload will be to the lead task of the first group.')
    rsync_parser.add_argument('path',
                              nargs='?',
                              help='The src:dst path to rsync between.')
    rsync_parser.add_argument('--status', '-s',
                              action='store_true',
                              help='Show the status of all rsync daemons')
    rsync_parser.add_argument('--stop',
                              action='store_true',
                              help='Stop one or more rsync daemons')
    rsync_parser.add_argument('--timeout',
                              type=validation.positive_integer,
                              default=10,
                              help='The connection timeout period in seconds. '
                                   'Default is 10 seconds.')
    rsync_parser.add_argument('--upload-rate-limit',
                              type=validation.positive_integer,
                              help='Rate limit the upload speed in bytes per second. The upload '
                                   'speed is also subjected to admin configured rate-limit.')
    rsync_parser.add_argument('--poll-interval',
                              type=validation.positive_float,
                              help='The amount of time (seconds) between polling the task '
                                   'for changes in daemon mode. If not provided, the '
                                   'admin-configured default will be used.')
    rsync_parser.add_argument('--debounce-delay',
                              type=validation.positive_float,
                              help='The amount of time (seconds) of inactivity after last '
                                   'file change before a sync is triggered in daemon mode. If '
                                   'not provided, the admin-configured default will be used.')
    rsync_parser.add_argument('--reconcile-interval',
                              type=validation.positive_float,
                              help='The amount of time (seconds) between reconciling the upload '
                                   'in daemon mode. This is used to ensure that failed uploads '
                                   'during network interruptions will resume after connection is '
                                   'restored. If not provided, the admin-configured default will '
                                   'be used.')
    rsync_parser.add_argument('--max-log-size',
                              type=validation.positive_integer,
                              default=2 * 1024 * 1024,
                              help='The maximum log size in bytes for the daemon before log '
                                   'rotation. Default is 2MB.')
    rsync_parser.add_argument('--verbose',
                              action='store_true',
                              help='Enable verbose logging for the daemon.')
    rsync_parser.add_argument('--once',
                              action='store_true',
                              help='Run a single rsync upload to the workflow. The upload will '
                                   'be done in the foreground and will automatically exit once '
                                   'the upload completes.')
    rsync_parser.set_defaults(func=_rsync)


def parse_file_for_template(workflow_contents: str, set_variables: List[str],
                            set_string_variables: List[str]) -> TemplateData:
    # Check to see if the workflow is templated
    is_templated = (workflow_contents.find('{%%') != -1) or (workflow_contents.find('{{') != -1) \
        or (workflow_contents.find('{#') != -1) or (workflow_contents.find('default-values') != -1)

    return TemplateData(
        file=workflow_contents,
        set_variables=set_variables,
        set_string_variables=set_string_variables,
        is_templated=is_templated
    )


def _load_wf_file(workflow_path: str, set_variables: List[str],
                  set_string_variables: List[str]) -> TemplateData:
    with open(workflow_path, 'r', encoding='utf-8') as file:
        full_file_text = file.read()
    return parse_file_for_template(full_file_text, set_variables, set_string_variables)


def parse_port(port_input: str) -> Tuple[List[int], List[int]]:
    local_ports, remote_ports = [], []
    port_intervals = port_input.split(',')
    for interval in port_intervals:
        if re.fullmatch(r'^\d+-\d+(:\d+-\d+)?$', interval):
            intervals = interval.split(':')
            local_ports += parse_range_port(intervals[0])
            if len(intervals) == 1:
                remote_ports += parse_range_port(intervals[0])
            else:
                remote_ports += parse_range_port(intervals[1])
        else:
            local_port, remote_port = parse_single_port(interval)
            local_ports.append(local_port)
            remote_ports.append(remote_port)
    if len(local_ports) != len(remote_ports):
        raise argparse.ArgumentTypeError(
            'Invalid number of ports provided. ' \
            f'Local port are {len(local_ports)} and remote ports are {len(remote_ports)}')
    return local_ports, remote_ports


def parse_range_port(port_input: str) -> List[int]:
    start, end = map(int, port_input.split('-'))
    if start < 0 or end > 65535 or start >= end:
        raise argparse.ArgumentTypeError(
            f'Invalid port value: {port_input}. Port value must be between 0 and 65535.')
    return list(range(start, end + 1))


def parse_single_port(port_input: str) -> Tuple[int, int]:
    pattern = r'^\d+(:\d+)?$'
    if not re.fullmatch(pattern, port_input):
        raise argparse.ArgumentTypeError(
            f'Invalid port format: {port_input}. Please use format <integer>:<integer> or '
             '<integer>.')

    # Extract integers from the input string
    port_list = [int(x) for x in port_input.split(':')]

    # Validate the range of integers
    for port in port_list:
        if port < 0 or port > 65535:
            raise argparse.ArgumentTypeError(
                f'Invalid port value: {port}. Port value must be between 0 and 65535.')

    if len(port_list) == 1:
        return port_list[0], port_list[0]
    else:
        # With the regex above, the only case left is an input with two port values
        return port_list[0], port_list[1]


def is_workflow_id(potential_id: str):
    """ Check if a string is a workflow ID. """
    match = re.search(common.WFID_REGEX, potential_id)
    return bool(match)


def print_submission_results(result, args: argparse.Namespace, parent_workflow_id: str = ''):
    """ Print workflow submission results. """
    if args.format_type == 'json':
        print(json.dumps(result, indent=common.JSON_INDENT_SIZE))
    else:
        if parent_workflow_id:
            message = f'Workflow {parent_workflow_id} restarted.'
        else:
            message = 'Workflow submit successful.'
        print(f'{message}\n' \
              f'Workflow ID        - {result["name"]}\n' \
              f'Workflow Overview  - {result["overview"]}')
        dashboard_url = result.get('dashboard_url')
        if dashboard_url is not None:
            print(f'Workflow Dashboard - {result["dashboard_url"]}')
        priority = wf_priority.WorkflowPriority(args.priority) \
            if hasattr(args, 'priority') and args.priority else wf_priority.WorkflowPriority.NORMAL
        if priority.preemptible:
            print(f'\nWARNING: {priority.value} priority can be preempted during the run.')


def _submit_workflow(service_client: client.ServiceClient, args: argparse.Namespace):
    logging.debug('Submit workflow.')
    if not args.pool:
        args.pool = pool.fetch_default_pool(service_client)

    params = {}
    if args.priority:
        params['priority'] = args.priority
    try:
        workflow_path = os.path.abspath(args.workflow_file)
        template_dict = _load_wf_file(workflow_path, args.set, args.set_string)
    except FileNotFoundError as error:
        # If the argument is not a workflow ID, throw error
        if not is_workflow_id(args.workflow_file):
            raise osmo_errors.OSMOSubmissionError(str(error))

        if args.dry:
            print('Please remove the --dry-run flag when submitting a workflow using '
                  'a workflow ID.', file=sys.stderr)
            return

        if args.set:
            print('Please remove the --set flag when submitting a workflow using '
                  'a workflow ID.', file=sys.stderr)
            return

        # Interpret the workflow_file arg as a workflow ID
        params['workflow_id'] = args.workflow_file
        try:
            result = service_client.request(
                client.RequestMethod.POST,
                f'api/pool/{args.pool}/workflow',
                payload=None,
                params=params
            )
        except (osmo_errors.OSMOCredentialError, osmo_errors.OSMOSubmissionError) as err:
            workflow_string = \
                f'{err.workflow_id} ' if err.workflow_id is not None else ''
            raise osmo_errors.OSMOSubmissionError(
                f'Workflow {workflow_string}submit failed:\n'
                f'{err}', workflow_id=err.workflow_id)

        print_submission_results(result, args)

        if args.rsync:
            rsync.rsync_upload(
                service_client,
                result['name'],
                None,
                args.rsync,
                daemon=True,
                quiet=args.format_type == 'json',
            )
        return

    submit_workflow_helper(service_client, args, template_dict, args.workflow_file, params)


def submit_workflow_helper(service_client: client.ServiceClient, args: argparse.Namespace,
                           template_data: TemplateData, workflow_path: str,
                           params: Dict[str, Any]):
    result = None

    # Do a dry run if explicitly requested or if we need to expand templates
    if template_data.is_templated or args.dry:
        params['dry_run'] = True
        result = service_client.request(client.RequestMethod.POST, f'api/pool/{args.pool}/workflow',
                                        payload=template_data.to_dict(), params=params)

        if args.dry:
            print(f'{result["spec"]}')
            return

        # Not a dry run, so reset the flag for the actual submission
        params['dry_run'] = False

    if args.set_env:
        params['env_vars'] = args.set_env

    if template_data.is_templated:
        # Copy the templated spec from 'file' to a new key
        template_data.uploaded_templated_spec = template_data.file
        assert result is not None
        updated_workflow_dict = yaml.safe_load(result['spec'])
    else:
        updated_workflow_dict = yaml.safe_load(template_data.file)


    load_local_files(workflow_path, updated_workflow_dict)

    localpath_dataset_inputs = _parse_localpath_dataset_inputs(
        workflow_path,
        updated_workflow_dict,
    )

    if len(localpath_dataset_inputs) > 0:
        # Uploading localpath dataset is very expensive...
        # So we validate the workflow before the upload.
        params['validation_only'] = True
        result = service_client.request(client.RequestMethod.POST, f'api/pool/{args.pool}/workflow',
                                        payload=template_data.to_dict(), params=params)
        params['validation_only'] = False

        # The workflow is valid, upload localpath dataset inputs and update workflow spec
        _upload_localpath_dataset_inputs(
            service_client,
            localpath_dataset_inputs,
            updated_workflow_dict['workflow']['name'],
            args.format_type == 'json',
        )

    template_data.file = yaml.dump(updated_workflow_dict)

    try:
        result = service_client.request(client.RequestMethod.POST, f'api/pool/{args.pool}/workflow',
                                        payload=template_data.to_dict(), params=params)
    except (osmo_errors.OSMOCredentialError, osmo_errors.OSMOSubmissionError) as err:
        workflow_string = \
            f'{err.workflow_id} ' if err.workflow_id is not None else ''
        raise osmo_errors.OSMOSubmissionError(
            f'Workflow {workflow_string}submit failed:\n'
            f'{err}', workflow_id=err.workflow_id)

    print_submission_results(result, args)

    if args.rsync:
        rsync.rsync_upload(
            service_client,
            result['name'],
            None,
            args.rsync,
            daemon=True,
            quiet=args.format_type == 'json',
        )


def _restart_workflow(service_client: client.ServiceClient, args: argparse.Namespace):
    logging.debug('Restart workflow.')

    # Order is specified pool, then workflow pool, then default pool
    pool_name = None
    if args.pool:
        pool_name = args.pool
    else:
        workflow_result = service_client.request(
            client.RequestMethod.GET,
            f'api/workflow/{args.workflow_id}')
        pool_name = workflow_result.get(pool_name, None)

    if not pool_name:
        pool_name = pool.fetch_default_pool(service_client)

    try:
        result = service_client.request(
            client.RequestMethod.POST,
            f'api/pool/{pool_name}/workflow/{args.workflow_id}/restart')
    except (osmo_errors.OSMOCredentialError, osmo_errors.OSMOSubmissionError) as err:
        workflow_string = \
            f'{err.workflow_id} ' if err.workflow_id is not None else ''
        raise osmo_errors.OSMOSubmissionError(
            f'Workflow {workflow_string}submit failed:\n'
            f'{err}', workflow_id=err.workflow_id)

    print_submission_results(result, args, args.workflow_id)


def _validate_workflow(service_client: client.ServiceClient, args: argparse.Namespace):
    logging.debug('Validate workflow.')

    if not args.pool:
        args.pool = pool.fetch_default_pool(service_client)

    try:
        workflow_path = args.workflow_file
        template_data = _load_wf_file(workflow_path, args.set, args.set_string)
    except FileNotFoundError as error:
        raise osmo_errors.OSMOSubmissionError(str(error))

    template_dict = template_data.to_dict()
    params = {'validation_only': True}
    if template_data.is_templated:
        params['dry_run'] = True
        result = service_client.request(
            client.RequestMethod.POST,
            f'api/pool/{args.pool}/workflow',
            payload=template_dict,
            params=params)
        updated_workflow_dict = yaml.safe_load(result['spec'])
    else:
        workflow_text = _load_workflow_text(args.workflow_file)
        updated_workflow_dict = yaml.safe_load(workflow_text)

    load_local_files(args.workflow_file, updated_workflow_dict)
    template_dict['file'] = yaml.dump(updated_workflow_dict)
    params['dry_run'] = False
    result = service_client.request(
        client.RequestMethod.POST,
        f'api/pool/{args.pool}/workflow',
        payload=template_dict,
        params=params)
    print(f'{result["logs"]}')


def _workflow_logs(service_client: client.ServiceClient, args: argparse.Namespace):
    logging.debug('Fetch workflow logs for workflow %s.', args.workflow_id)
    if (args.error or args.retry_id) and not args.task:
        raise osmo_errors.OSMOUserError('Specify task for retry ID or error logs.')

    params = {}
    if args.last_n_lines:
        params['last_n_lines'] = args.last_n_lines
    if args.task:
        params['task_name'] = args.task
    if args.retry_id:
        params['retry_id'] = args.retry_id
    if not args.error:
        result = service_client.request(
            client.RequestMethod.GET,
            f'api/workflow/{args.workflow_id}/logs',
            mode=client.ResponseMode.STREAMING,
            params=params)
    else:
        result = service_client.request(
            client.RequestMethod.GET,
            f'api/workflow/{args.workflow_id}/error_logs',
            mode=client.ResponseMode.STREAMING,
            params=params)
    if args.error:
        print(f'Workflow {args.workflow_id} has error logs:')
    else:
        print(f'Workflow {args.workflow_id} has logs:')
    try:
        for line in result.iter_lines():
            print(line.decode('utf-8'))
    # Give friendly message on broken connection
    except requests.exceptions.ChunkedEncodingError as error:
        # Check if this is specifically the timeout case with InvalidChunkLength
        error_str = str(error)
        if 'InvalidChunkLength' in error_str and "got length b''" in error_str:
            print('\nLog stream has timed out or failed. '
                  'Please run the command again to continue viewing logs.')
            return
        raise osmo_errors.OSMOServerError(f'Failed to fetch logs: {error}') from error


def _cancel_workflow(service_client: client.ServiceClient, args: argparse.Namespace):
    logging.debug('Canceling workflow(s) %s.', ','.join(args.workflow_ids))
    params = {'force': args.force}
    if args.message:
        params['message'] = args.message
    for workflow_id in args.workflow_ids:
        try:
            result = service_client.request(
                client.RequestMethod.POST,
                f'api/workflow/{workflow_id}/cancel',
                params=params)
            if args.format_type == 'json':
                print(json.dumps(result, indent=common.JSON_INDENT_SIZE))
            else:
                print(f'Cancel job for workflow {result["name"]} is submitted!')
        except (osmo_errors.OSMOServerError, osmo_errors.OSMOUserError) as error:
            print(f'Workflow cancelation failed for workflow {workflow_id}: {error}')


def _get_tasks_from_workflow(workflow: Any) -> list:
    tasks_result = []
    for group in workflow['groups']:
        tasks_result.extend(group['tasks'])
    return tasks_result


def _workflow_table_generator(workflow: Any, table: texttable.Texttable | None = None)\
                              -> texttable.Texttable:
    """ Generates the table for a given workflow"""
    key_mapping = {'User': 'user',
                  'Workflow ID': 'name',
                  'Submit Time': 'submit_time',
                  'Status': 'status',
                  'Priority': 'priority',
                  'Overview': 'overview'}
    keys = list(key_mapping.keys())
    if not table:
        table = common.osmo_table(header=keys)
        table.set_cols_dtype(['t' for _ in range(len(keys))])
    row = []
    for key in keys:
        value = workflow.get(key_mapping[key], '-')
        if key == 'Submit Time':
            value = common.convert_utc_datetime_to_user_zone(value)
        elif key == 'Overview':
            value = f'{value}' if value else '-'
        row.append(value)
    table.add_row(row)
    return table


def _query_workflow(service_client: client.ServiceClient, args: argparse.Namespace):
    logging.debug('Query workflow %s.', args.workflow_id)
    workflow_result = service_client.request(
        client.RequestMethod.GET,
        f'api/workflow/{args.workflow_id}',
        params={'verbose': args.verbose})
    tasks_result = _get_tasks_from_workflow(workflow_result)
    if args.format_type == 'json':
        print(json.dumps(workflow_result, indent=2))
    else:
        submit_time = common.convert_utc_datetime_to_user_zone(workflow_result.get('submit_time',
                                                                                    '-'))
        status, user = workflow_result['status'], workflow_result['submitted_by']
        overview = workflow_result['overview']
        print('--------------------------------------------------------------------\n'
              f'\nWorkflow ID : {args.workflow_id}'
              f'\nStatus      : {status}'
              f'\nUser        : {user}'
              f'\nSubmit Time : {submit_time}'
              f'\nOverview    : {overview}\n')
        keys = ['Task Name', 'Start Time', 'Status']
        if args.verbose:
            keys = ['Task Name', 'Retry ID', 'Start Time', 'Status']
        table = common.osmo_table(header=keys)
        table.set_cols_dtype(['t' for _ in range(len(keys))])
        for task in tasks_result:
            start_time = common.convert_utc_datetime_to_user_zone(task['start_time']) \
                                                                    if task['start_time'] else '-'
            name = task['name']
            task_row = [name, start_time, task['status']]
            if args.verbose:
                task_row = [name, task['retry_id'], start_time, task['status']]
            table.add_row(task_row)
        print(table.draw())


def _list_workflows(service_client: client.ServiceClient, args: argparse.Namespace):
    params: Dict[str, Any] = {}
    if args.user:
        params['users'] = args.user
    if args.status:
        params['statuses'] = args.status
    if args.name:
        params['name'] = args.name
    if args.order:
        params['order'] = args.order.upper()
    if args.all_users:
        params['all_users'] = True
    if args.tags:
        params['tags'] = args.tags
    if args.pool:
        params['pools'] = args.pool
    else:
        params['all_pools'] = True
    if args.app:
        params['app'] = args.app
    if args.priority:
        params['priority'] = args.priority

    if args.submitted_after:
        params['submitted_after'] = common.convert_timezone(f'{args.submitted_after}T00:00:00')
    if args.submitted_before:
        params['submitted_before'] = common.convert_timezone(f'{args.submitted_before}T00:00:00')
        if args.submitted_after:
            before_dt = datetime.datetime.strptime(params['submitted_before'],
                                                   '%Y-%m-%dT%H:%M:%S')
            after_dt = datetime.datetime.strptime(params['submitted_after'],
                                                  '%Y-%m-%dT%H:%M:%S')
            if after_dt > before_dt:
                raise osmo_errors.OSMOUserError(
                    f'Value submitted-before ({args.submitted_before}) needs to be later '
                    f'than submitted-after ({args.submitted_after}).')

    current_count = 0
    workflow_list: List[Dict[str, Any]] = []
    while True:
        count = min(args.count - current_count, 1000)
        params['limit'] = count
        params['offset'] = current_count

        workflow_result = service_client.request(
            client.RequestMethod.GET,
            'api/workflow',
            params=params)
        workflow_list = workflow_result['workflows'] + workflow_list
        current_count += count
        if args.count <= current_count or not workflow_result['more_entries']:
            break

    if args.format_type == 'json':
        print(json.dumps({'workflows': workflow_list}, indent=2))
    else:
        table = None
        for workflow in workflow_list:
            table = _workflow_table_generator(workflow, table)
        if table:
            print(table.draw())
        else:
            print('There are no workflows to view.')


def _tag_workflows(service_client: client.ServiceClient, args: argparse.Namespace):
    if (args.add or args.remove) and not args.workflow:
        raise osmo_errors.OSMOUserError('No workflow specified to add/remove tags from!')
    if args.workflow and not (args.add or args.remove):
        raise osmo_errors.OSMOUserError('No tags specified to add/remove!')

    # Add/remove tags
    if args.workflow:
        params = {'add': args.add, 'remove': args.remove}
        for workflow in args.workflow:
            try:
                service_client.request(
                    client.RequestMethod.POST,
                    f'api/workflow/{workflow}/tag',
                    params=params)
                print(f'Workflow {workflow} updated.')
            except osmo_errors.OSMOUserError as err:
                print(err)
        return

    # Get Tags
    tags_response = service_client.request(
        client.RequestMethod.GET,
        'api/tag')
    tags = tags_response.get('tags', [])
    if not tags:
        print('No tags have been set by admins.')
    print('Tags:')
    for tag in tags:
        print(f'- {tag}')


def _get_spec(service_client: client.ServiceClient, args: argparse.Namespace):
    logging.debug('Get spec for workflow %s.', args.workflow_id)
    params = {'use_template': args.template}
    result = service_client.request(
        client.RequestMethod.GET,
        f'api/workflow/{args.workflow_id}/spec',
        mode=client.ResponseMode.STREAMING,
        params=params)
    try:
        for line in result.iter_lines():
            print(line.decode('utf-8'))
    # Give friendly message on broken connection
    except requests.exceptions.ChunkedEncodingError as error:
        raise osmo_errors.OSMOServerError(f'Failed to fetch spec: {error}') from error


def _load_workflow_text(workflow_file: str) -> str:
    with open(workflow_file, 'r', encoding='utf-8') as file:
        file_text = file.read()

        workflow_spec, _ = workflow_utils.parse_workflow_spec(file_text)
        return workflow_spec


def _load_local_files_helper(workflow_file: str, section_dict: Dict):
    for each_file in section_dict.get('files', []):
        if 'localpath' in each_file and 'contents' in each_file:
            raise osmo_errors.OSMOSubmissionError(
                'Files tag dont support contents and localpath together')
        if 'localpath' in each_file:
            file_path = paths.get_absolute_path(
                each_file.get('localpath'),
                workflow_file,
            )
            if not os.path.exists(file_path):
                raise osmo_errors.OSMOSubmissionError(f'The file/path {file_path} does not exist!')
            with open(file_path, 'r', encoding='utf-8') as open_file:
                contents = open_file.read()
                each_file['contents'] = contents
                del each_file['localpath']


def load_local_files(workflow_file: str, workflow: Dict):
    # For v1 spec, and 'tasks' section of v2 spec
    tasks = workflow['workflow'].get('tasks', [])
    # For 'groups' section of v2 spec
    for group in workflow['workflow'].get('groups', []):
        tasks += group.get('tasks', [])
    # Substitute local file in all tasks
    for task in tasks:
        _load_local_files_helper(workflow_file, task)


DatasetName: TypeAlias = str
DatasetInput: TypeAlias = Dict
Localpath: TypeAlias = str
LocalpathInputs: TypeAlias = Dict[Localpath, List[DatasetInput]]
LocalpathDatasetInputs: TypeAlias = Dict[DatasetName, LocalpathInputs]


def _parse_localpath_dataset_inputs(
    workflow_file: str,
    workflow: Dict,
) -> LocalpathDatasetInputs:
    localpath_dataset_inputs: LocalpathDatasetInputs = \
        collections.defaultdict[DatasetName, LocalpathInputs](
            lambda: collections.defaultdict[Localpath, List[DatasetInput]](list))

    # For v1 spec, and 'tasks' section of v2 spec
    tasks = workflow['workflow'].get('tasks', [])
    # For 'groups' section of v2 spec
    for group in workflow['workflow'].get('groups', []):
        tasks += group.get('tasks', [])

    for task in tasks:
        for task_input in task.get('inputs', []):
            if 'dataset' not in task_input:
                continue

            input_dataset = task_input['dataset']
            if 'localpath' not in input_dataset:
                continue

            dataset_name = input_dataset['name']
            if ':' in dataset_name:
                raise osmo_errors.OSMOSubmissionError(
                    'Localpath Dataset name cannot contain tag or version id!')

            localpath = paths.get_absolute_path(
                input_dataset['localpath'],
                workflow_file,
            )

            if not os.path.exists(localpath):
                raise osmo_errors.OSMOSubmissionError(
                    f'The localpath {localpath} does not exist!')

            localpath_dataset_inputs[dataset_name][localpath].append(input_dataset)

    return localpath_dataset_inputs


def _upload_localpath_dataset_inputs(
    service_client: client.ServiceClient,
    localpath_dataset_inputs: LocalpathDatasetInputs,
    workflow_name: str,
    quiet: bool,
):
    """
    For each dataset name, localpath; create a dataset version.
    """
    for dataset_name, dataset_inputs in localpath_dataset_inputs.items():

        for local_path, input_datasets in dataset_inputs.items():

            # Create metadata file for the localpath dataset
            with tempfile.NamedTemporaryFile(suffix='.yaml', mode='w') as metadata_file:
                dataset_metadata_info = {
                    'default': {
                        'workflow_name': workflow_name,
                        'localpath_dataset': True,
                        'localpath': local_path,
                    }
                }
                yaml.dump(dataset_metadata_info, metadata_file)

                # TODO: Optimize this to not upload if there exists an existing version
                #       that has the same dataset digest as current upload.
                upload_results = dataset.upload_dataset(
                    service_client,
                    dataset_name,
                    [local_path],
                    metadata=[metadata_file.name],
                    quiet=quiet,
                    executor_params=storage.ExecutorParameters(
                        num_threads=storage.DEFAULT_NUM_THREADS,
                    ),
                )

            if not upload_results:
                raise osmo_errors.OSMOSubmissionError('Failed to upload localpath dataset inputs!')

            if 'version_id' in upload_results:
                uploaded_version = upload_results['version_id']
            else:
                raise osmo_errors.OSMOSubmissionError(
                    'Failed to get version of localpath dataset upload!')

            # Backfill dataset name and regex
            for input_dataset in input_datasets:
                if ':' in input_dataset['name']:
                    input_dataset['name'] = input_dataset['name'].split(':')[0]
                input_dataset['name'] += f':{uploaded_version}'
                del input_dataset['localpath']


async def _connect_stdin_stdout() -> Tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    """ Gets non-blocking reader and writer for stdin, stdout. """
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)

    # Set stdin file descriptorto be non-blocking
    stdin_fd = os.dup(sys.stdin.fileno())
    os.set_blocking(stdin_fd, False)
    stdin = os.fdopen(stdin_fd, 'rb', buffering=0)

    # Set stdout file descriptorto be non-blocking
    stdout_fd = os.dup(sys.stdout.fileno())
    os.set_blocking(stdout_fd, False)
    stdout = os.fdopen(stdout_fd, 'wb', buffering=0)

    # Connect the reader and writer to the event loop
    await loop.connect_read_pipe(lambda: protocol, stdin)
    w_transport, w_protocol = await loop.connect_write_pipe(
        asyncio.streams.FlowControlMixin, stdout)
    writer = asyncio.StreamWriter(w_transport, w_protocol, reader, loop)

    return reader, writer


async def send_terminal_size(ws: websockets.WebSocketClientProtocol):  # type: ignore
    s = struct.pack('HHHH', 0, 0, 0, 0)
    rows, cols = struct.unpack('HHHH', fcntl.ioctl(sys.stdin, termios.TIOCGWINSZ, s))[:2]
    size_message = json.dumps({'Rows': rows, 'Cols': cols}).encode('utf-8')
    await ws.send(size_message)


async def _run_exec_interactive(service_client: client.ServiceClient, args: argparse.Namespace,
                                result: Dict[str, str], keep_alive: bool = False):
    router_address = result['router_address']
    headers = {'Cookie': result['cookie']}
    endpoint = f'api/router/exec/{args.workflow_id}/client/{result["key"]}'

    old_tty = None
    try:
        ws = await service_client.create_websocket(
            router_address, endpoint, headers=headers, timeout=args.connect_timeout)

        await send_terminal_size(ws)

        # Backend user task connects to router
        data = await ws.recv()
        if not data:
            logging.error('Receve EOF from user task container.')
            return

        old_tty = termios.tcgetattr(sys.stdin)
        tty.setraw(sys.stdin.fileno())

        reader, writer = await _connect_stdin_stdout()

        # Write the first received data
        writer.write(data)
        await writer.drain()

        loop = asyncio.get_event_loop()
        coroutines = [
            loop.create_task(port_forward.write_data(writer, ws)),
            loop.create_task(port_forward.read_data(reader, ws))
        ]
        done, pending = await asyncio.wait(coroutines, return_when=asyncio.FIRST_COMPLETED)
        for i in pending:
            i.cancel()
        for i in done:
            if isinstance(i.result(), Exception):
                raise i.result()
    except websockets.exceptions.ConnectionClosedOK:
        pass
    except ConnectionRefusedError as err:
        logging.error(err)
        if keep_alive:
            raise
    except websockets.exceptions.ConnectionClosedError as err:
        print(f'\n\rConnection Closed: {err}', end='\n\r')
        if keep_alive:
            raise
    except KeyboardInterrupt:
        await ws.close()
    finally:
        if old_tty:
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_tty)


async def _run_exec_command(service_client: client.ServiceClient, args: argparse.Namespace,
                            task_name: str, result: Dict[str, str]):
    router_address = result['router_address']
    headers = {'Cookie': result['cookie']}
    endpoint = f'api/router/exec/{args.workflow_id}/client/{result["key"]}'

    try:
        ws = await service_client.create_websocket(
            router_address, endpoint, headers=headers, timeout=args.connect_timeout)

        await send_terminal_size(ws)
        while True:
            data = await ws.recv()
            if not data:
                break
            # Add prefix to each line of the output
            for line in data.decode('utf-8').splitlines(True):  # True preserves line endings
                print(f'[{task_name}] {line}', end='')
    except websockets.exceptions.ConnectionClosedOK:
        pass
    except ConnectionRefusedError as err:
        logging.error(err)
    except websockets.exceptions.ConnectionClosedError as err:
        logging.error('Connection Closed: %s', err)
    except KeyboardInterrupt:
        await ws.close()


def _exec_workflow(service_client: client.ServiceClient, args: argparse.Namespace):
    logging.debug('Exec into for workflow %s.', args.workflow_id)
    if args.group:
        if any(args.exec_entry_command.endswith(i) for i in INTERACTIVE_COMMANDS):
            raise osmo_errors.OSMOUserError(
                'Interactive commands are not supported for exec groups.' \
                'Use "--entry" to specify a non-interactive command.')
        if args.keep_alive:
            raise osmo_errors.OSMOUserError('Keep-alive is not supported for exec groups.')

    params = {'entry_command': args.exec_entry_command}
    loop = asyncio.get_event_loop()
    if args.task:
        endpoint = f'api/workflow/{args.workflow_id}/exec/task/{args.task}'
        if args.keep_alive:
            while True:
                try:
                    result = service_client.request(
                        client.RequestMethod.POST, endpoint, params=params)
                    loop.run_until_complete(
                        _run_exec_interactive(
                            service_client,
                            args,
                            result,
                            keep_alive=args.keep_alive),
                    )
                    break
                except (osmo_errors.OSMOServerError, ConnectionRefusedError,
                        websockets.exceptions.ConnectionClosedError):
                    print('Reconnecting to the exec session...')
                    time.sleep(10)

        else:
            result = service_client.request(
                client.RequestMethod.POST, endpoint, params=params)
            loop.run_until_complete(_run_exec_interactive(service_client, args, result))
    else:
        endpoint = f'api/workflow/{args.workflow_id}/exec/group/{args.group}'
        result = service_client.request(
            client.RequestMethod.POST, endpoint, params=params)
        coroutines = [
            loop.create_task(_run_exec_command(service_client, args, i, result[i])) for i in result
        ]
        loop.run_until_complete(asyncio.wait(coroutines, return_when=asyncio.ALL_COMPLETED))


def _port_forward(service_client: client.ServiceClient, args: argparse.Namespace):
    logging.debug('Port forward for workflow %s, task %s.', args.workflow_id, args.task)
    local_ports, remote_ports = args.port[0], args.port[1]
    results = service_client.request(
        client.RequestMethod.POST,
        f'api/workflow/{args.workflow_id}/portforward/{args.task}',
        params={'task_ports': remote_ports, 'use_udp': args.udp})

    async def _run():
        task_list = []
        for local_port, remote_port, result in zip(local_ports, remote_ports, results):
            task_list.append(_single_port_forward(
                service_client, args, local_port, remote_port,
                result['router_address'], result['key'], result['cookie']))
        await asyncio.wait(task_list, return_when=asyncio.FIRST_COMPLETED)
    asyncio.get_event_loop().run_until_complete(_run())


async def _single_port_forward(service_client: client.ServiceClient, args: argparse.Namespace,
                               local_port: int, remote_port: int,
                               router_address: str, key: str, cookie: str):
    message = f'Starting port forwarding from {args.workflow_id}/{args.task} to {local_port}. '\
        f'Please visit http://{args.host}:{local_port} if a web application is hosted by the task.'

    async def _wait_for_reconnect(retry: int):
        delay = port_forward.get_exponential_backoff_delay(retry)
        print(f'Reconnect to remote port {remote_port} in {int(delay)} seconds...')
        await asyncio.sleep(delay)

    def _send_port_forward_request():
        result = service_client.request(
            client.RequestMethod.POST,
            f'api/workflow/{args.workflow_id}/portforward/{args.task}',
            params={'task_ports': remote_port, 'use_udp': args.udp},
        )[0]
        return result['router_address'], result['key'], result['cookie']

    retry = 0
    endpoint = f'api/router/portforward/{args.workflow_id}/client'
    while True:
        try:
            if args.udp:
                await port_forward.run_udp(
                    service_client,
                    args.host,
                    local_port,
                    message,
                    endpoint,
                    args.connect_timeout,
                    router_address,
                    key,
                    cookie,
                )
            else:
                await port_forward.run_tcp(
                    service_client,
                    args.host,
                    local_port,
                    message,
                    endpoint,
                    args.connect_timeout,
                    router_address,
                    key,
                    cookie,
                )
            await _wait_for_reconnect(retry)
            router_address, key, cookie = _send_port_forward_request()
        except osmo_errors.OSMOServerError:
            retry += 1
            await _wait_for_reconnect(retry)
            router_address, key, cookie = _send_port_forward_request()
        except KeyboardInterrupt:
            break


def _rsync_status():
    """
    Show the status of all rsync daemons
    """
    # Get a list of all rsync daemons
    daemons = rsync.rsync_status()

    if not daemons:
        print('No rsync daemons found')
        return

    # Print the status of each rsync daemon
    keys = [
        'Workflow ID',
        'Task Name',
        'PID',
        'Status',
        'Last Synced',
        'Source Path',
        'Destination Path',
        'Log File',
    ]
    table = common.osmo_table(header=keys)
    table.set_cols_dtype(['t' for _ in range(len(keys))])

    for daemon_info in daemons:
        daemon_metadata = daemon_info.metadata
        table.add_row([
            daemon_metadata.rsync_request.workflow_id,
            daemon_metadata.rsync_request.task_name,
            daemon_metadata.pid,
            daemon_info.status.name,
            daemon_metadata.last_synced,
            daemon_metadata.rsync_request.src,
            daemon_metadata.rsync_request.original_dst_path,
            daemon_info.log_file,
        ])

    print('\n' + table.draw() + '\n')


def _rsync_stop(args: argparse.Namespace):
    """
    Stop one or more running rsync daemons
    """
    running_daemons = rsync.rsync_status(
        workflow_id=args.workflow_id,
        task_name=args.task,
        statuses={rsync.RsyncDaemonStatus.RUNNING},
    )

    if not running_daemons:
        print('No running rsync daemons found')
        return

    if not args.workflow_id and not args.task:
        daemon_names = '\n\t* '.join([
            f'{daemon.metadata.rsync_request.workflow_id}/{daemon.metadata.rsync_request.task_name}'
            for daemon in running_daemons
        ])

        if not input(
            'Are you sure you want to stop all running daemons?'
            f'\n\n\t* {daemon_names}\n\n[y/N] '
        ).lower().startswith('y'):
            print('Aborted')
            return

    for daemon in running_daemons:
        try:
            print(
                f'Stopping rsync daemon {daemon.metadata.rsync_request.workflow_id}/'
                f'{daemon.metadata.rsync_request.task_name}',
            )
            os.kill(daemon.metadata.pid, signal.SIGTERM)
        except Exception as err:  # pylint: disable=broad-except
            print(
                f'Failed to stop rsync daemon {daemon.metadata.rsync_request.workflow_id}/'
                f'{daemon.metadata.rsync_request.task_name}: {err}',
            )


def _rsync(service_client: client.ServiceClient, args: argparse.Namespace):
    """
    Main entrypoint for the rsync command.
    """
    if args.status:
        _rsync_status()
        return

    if args.stop:
        _rsync_stop(args)
        return

    if not args.workflow_id:
        raise osmo_errors.OSMOUserError('Workflow ID is required for rsync.')

    if not args.path and not args.task:
        raise osmo_errors.OSMOUserError('Path is required for rsync.')

    if not args.path:
        # Only two arguments are provided (workflow_id and path)
        # Shift task argument to the path argument
        args.path = args.task
        args.task = None

    rsync.rsync_upload(
        service_client,
        args.workflow_id,
        args.task,
        args.path,
        daemon=not args.once,
        timeout=args.timeout,
        upload_rate_limit=args.upload_rate_limit,
        daemon_debounce_delay=args.debounce_delay,
        daemon_poll_interval=args.poll_interval,
        daemon_reconcile_interval=args.reconcile_interval,
        daemon_max_log_size=args.max_log_size,
        daemon_verbose_logging=args.verbose,
    )
