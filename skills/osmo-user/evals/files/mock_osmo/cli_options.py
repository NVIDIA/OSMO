"""Offline CLI subset for option-coverage evals; never contacts an OSMO service.

SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

import argparse
import datetime
import fnmatch
import json
import os
from pathlib import Path
import re
import sys


WORKFLOW_STATUSES = (
    'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'FAILED_CANCELED',
    'FAILED_SERVER_ERROR', 'FAILED_BACKEND_ERROR', 'FAILED_EXEC_TIMEOUT',
    'FAILED_QUEUE_TIMEOUT', 'FAILED_IMAGE_PULL', 'FAILED_EVICTED',
    'FAILED_SUBMISSION', 'FAILED_START_ERROR', 'FAILED_START_TIMEOUT',
    'WAITING', 'FAILED_PREEMPTED',
)
TASK_STATUSES = tuple(status for status in WORKFLOW_STATUSES
                      if status not in ('PENDING', 'FAILED_SUBMISSION')) + (
    'PROCESSING', 'SCHEDULING', 'INITIALIZING', 'FAILED_UPSTREAM',
)


def date_string(value):
    """Validate the documented date format without depending on the real CLI."""
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise argparse.ArgumentTypeError('Expected YYYY-MM-DD')
    try:
        datetime.date.fromisoformat(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from error
    return value


def create_parser():
    """Model only the commands exercised by the synthetic option scenarios."""
    parser = argparse.ArgumentParser(prog='osmo')
    modules = parser.add_subparsers(dest='module', required=True)
    for module, commands in {
        'workflow': ('list', 'query', 'logs', 'events', 'spec', 'submit', 'validate'),
        'task': ('list',),
        'app': ('submit', 'info', 'show', 'spec'),
        'data': ('list',),
        'profile': ('list',),
        'pool': ('list',),
    }.items():
        subcommands = modules.add_parser(module).add_subparsers(dest='command', required=True)
        for command in commands:
            subparser = subcommands.add_parser(command)
            if module != 'data':
                subparser.add_argument('--format-type', '-t', choices=('json', 'text'), default='text')
            if command == 'list' and module in ('workflow', 'task'):
                subparser.add_argument('--status', '-s', nargs='+',
                                       choices=WORKFLOW_STATUSES if module == 'workflow'
                                       else TASK_STATUSES)
                subparser.add_argument('--priority', nargs='+', type=str.upper,
                                       choices=('HIGH', 'NORMAL', 'LOW'))
                subparser.add_argument('--order', '-o', choices=('asc', 'desc'), default='asc')
                subparser.add_argument('--count', '-c', type=int, default=20)
                subparser.add_argument('--offset', '-f', type=int, default=0)
            if module == 'workflow' and command == 'list':
                subparser.add_argument('--label', action='append', default=[])
                subparser.add_argument('--no-label', action='append', default=[])
            if module == 'task':
                subparser.add_argument('--started-after', type=date_string)
                subparser.add_argument('--started-before', type=date_string)
                subparser.add_argument('--aggregate-by-workflow', '-W', action='store_true')
            if command in ('submit', 'validate'):
                subparser.add_argument('name')
                subparser.add_argument('--pool', '-p')
                subparser.add_argument('--label', action='append', default=[])
                if module == 'app':
                    subparser.add_argument('--local-path', '-l')
            if command in ('query', 'logs', 'events', 'spec', 'info', 'show'):
                subparser.add_argument('name')
            if command == 'logs':
                subparser.add_argument('-n', '--last-n-lines', type=int, default=1000)
            if command == 'spec':
                subparser.add_argument('--template', action='store_true')
            if module == 'data':
                subparser.add_argument('remote_uri')
                output = subparser.add_mutually_exclusive_group()
                output.add_argument('local_path', nargs='?')
                output.add_argument('--no-pager', action='store_true')
                subparser.add_argument('--prefix', '-p', default='')
                subparser.add_argument('--recursive', '-r', action='store_true')
                subparser.add_argument('--regex', '-x')
    return parser


def matches_label(labels, selector):
    """Support exact values, star wildcards, and parenthesized alternatives."""
    key, separator, value = selector.partition('=')
    if not separator or key not in labels:
        return False
    alternatives = value[1:-1].split('|') if value.startswith('(') and value.endswith(')') else [value]
    return any(fnmatch.fnmatchcase(labels[key], pattern) for pattern in alternatives)


def filtered_records(records, args):
    """Apply filters to world data instead of returning a success oracle."""
    if args.status:
        records = [record for record in records if record['status'] in args.status]
    if args.priority:
        records = [record for record in records if record['priority'] in args.priority]
    if args.order == 'desc':
        records = list(reversed(records))
    return records


def run(args, state, fixtures):
    """Return synthetic results or write listing keys to a new local file."""
    if args.module == 'app' and args.command in ('info', 'show', 'spec'):
        if args.name not in ('training', 'training:2'):
            raise ValueError('Unknown synthetic app')
        if args.command == 'spec':
            return (fixtures / 'cli_options/training.yaml').read_text()
        return {'name': 'training', 'version': 2, 'status': 'READY',
                'labels': state['app_labels'], 'description': 'Read a local training input'}
    if args.module == 'workflow' and args.command in ('query', 'logs', 'events', 'spec'):
        if args.name != 'gr00t-app-run-1':
            raise ValueError('Unknown synthetic workflow')
        if args.command == 'query':
            return json.loads((fixtures / 'cli_options/app_run_completed.json').read_text())
        if args.command == 'spec':
            return (fixtures / 'cli_options/training.yaml').read_text()
        return 'Read training.txt successfully. Workflow completed.'
    if args.module in ('profile', 'pool'):
        name = f'{args.module}_list.json'
        return json.loads((fixtures / 'default' / name).read_text())
    if args.module == 'workflow' and args.command == 'list':
        records = filtered_records(state['workflows'], args)
        records = [record for record in records
                   if all(matches_label(record['labels'], selector) for selector in args.label)
                   and all(key not in record['labels'] for key in args.no_label)]
        return {'workflows': records[args.offset:args.offset + args.count]}
    if args.module == 'task':
        if args.status is None:
            args.status = ['PROCESSING', 'SCHEDULING', 'INITIALIZING', 'RUNNING']
        records = filtered_records(state['tasks'], args)
        records = [record for record in records
                   if (not args.started_after or record['start_date'] is None
                       or record['start_date'] >= args.started_after)
                   and (not args.started_before or (record['start_date'] is not None
                                                    and record['start_date'] < args.started_before))]
        if not args.aggregate_by_workflow:
            return {'tasks': records[args.offset:args.offset + args.count]}
        summaries = {}
        for record in records:
            key = record['workflow_id']
            summary = summaries.setdefault(key, {'workflow_id': key, 'gpu': 0})
            summary['gpu'] += record['gpu']
        return {'summaries': list(summaries.values())[args.offset:args.offset + args.count]}
    if args.command in ('submit', 'validate'):
        labels = dict(state['app_labels']) if args.module == 'app' else {}
        for assignment in args.label:
            key, separator, value = assignment.partition('=')
            if not separator or not key:
                raise ValueError('Expected label KEY=VALUE')
            labels[key] = value
        if args.module == 'app':
            if args.name != 'training:2' or args.pool != 'h100-east':
                raise ValueError('Expected synthetic app training:2 in pool h100-east')
            directory = Path(args.local_path or os.getcwd())
            if not (directory / 'training.txt').is_file():
                raise ValueError('Local app file training.txt was not found')
        elif not Path(args.name).is_file():
            raise ValueError('Workflow file was not found')
        return {'workflow_id': 'gr00t-app-run-1' if args.module == 'app' else 'label-run-1',
                'labels': labels, 'submitted': args.command == 'submit'}
    if args.module == 'data':
        if args.remote_uri != state['remote_uri']:
            raise ValueError('Unknown synthetic storage URI')
        keys = [key for key in state['objects'] if key.startswith(args.prefix)
                and (args.recursive or '/' not in key.removeprefix(args.prefix))
                and (not args.regex or re.search(args.regex, key))]
        listing = ''.join(key + '\n' for key in keys)
        if args.local_path:
            # Match the real CLI's rejection of pre-existing output paths.
            with Path(args.local_path).open('x', encoding='utf-8') as output:
                output.write(listing)
        else:
            print(listing, end='')  # Noninteractive mock has no pager.
        return None
    raise ValueError('Unsupported synthetic command')


def main():
    """Run only against staged fixtures and the eval's local working directory."""
    if sys.argv[1:] in (['--version'], ['version'], ['-V']):
        print('mock-osmo 6.4 option-coverage')
        return
    parser = create_parser()
    args = parser.parse_args()
    fixtures = Path(os.environ.get('OSMO_MOCK_FIXTURES',
                                   str(Path(__file__).parent.parent / 'fixtures')))
    state = json.loads((fixtures / 'cli_options/state.json').read_text())
    try:
        result = run(args, state, fixtures)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    if result is not None:
        print(result if isinstance(result, str) else json.dumps(result))


if __name__ == '__main__':
    main()
