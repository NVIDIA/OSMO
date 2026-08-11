"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
# pylint: disable=protected-access

import argparse
import asyncio
import contextlib
import io
import json
import os
import signal
import struct
import tempfile
import unittest
from typing import Any, Dict
from unittest import mock

import requests  # type: ignore
import websockets.exceptions

from src.cli import workflow
from src.lib import rsync
from src.lib.utils import client, osmo_errors, validation


WARN_MISSING_PROJECT_MESSAGE = (
    "Workflow is missing label 'project'; add it now to avoid rejected "
    'submissions once it is required.'
)

PLAIN_WORKFLOW_SPEC = 'version: 2\nworkflow:\n  name: sample\n  tasks:\n  - name: main\n'


def _joined_print_output(mock_print: mock.Mock) -> str:
    """Join every positional argument passed to a mocked print into one string."""
    return ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)


def _make_list_args(**overrides) -> argparse.Namespace:
    """Build a 'workflow list' namespace, overriding only the fields under test."""
    defaults: Dict[str, Any] = {
        'user': [],
        'status': None,
        'name': None,
        'order': 'asc',
        'all_users': False,
        'tags': None,
        'pool': [],
        'app': None,
        'priority': None,
        'labels': [],
        'no_labels': [],
        'submitted_after': None,
        'submitted_before': None,
        'count': 20,
        'offset': 0,
        'format_type': 'json',
    }
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


def _make_daemon_info() -> rsync.RsyncDaemonInfo:
    """Build a running rsync daemon record for status/stop rendering tests."""
    rsync_request = rsync.RsyncRequest(
        workflow_id='wf-1',
        task_name='trainer',
        direction=rsync.RsyncDirection.UPLOAD,
        local_path='/local/data',
        remote_module='osmo',
        remote_path='/osmo/run/workspace/data',
        original_remote_path='/data',
    )
    metadata = rsync.RsyncDaemonMetadata(
        pid=4242,
        rsync_request=rsync_request,
        start_time='2026-01-01T00:00:00',
        last_synced='2026-01-01T00:05:00',
    )
    return rsync.RsyncDaemonInfo(
        metadata=metadata,
        status=rsync.RsyncDaemonStatus.RUNNING,
        log_file='/tmp/rsync-wf-1.log',
    )


class TestWorkflowLabelParser(unittest.TestCase):
    """Label flag parsing and forwarding for submit, validate, and list."""

    def _build_parser(self) -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        workflow.setup_parser(subparsers)
        return parser

    def test_submit_accepts_repeatable_labels(self):
        args = self._build_parser().parse_args([
            'workflow', 'submit', 'workflow.yaml',
            '--label', 'team=alpha', '--label', 'run=42',
        ])

        self.assertEqual(args.labels, ['team=alpha', 'run=42'])

    def test_validate_accepts_repeatable_labels(self):
        args = self._build_parser().parse_args([
            'workflow', 'validate', 'workflow.yaml',
            '--label', 'team=alpha', '--label', 'run=42',
        ])

        self.assertEqual(args.labels, ['team=alpha', 'run=42'])

    def test_list_accepts_present_and_missing_label_filters(self):
        args = self._build_parser().parse_args([
            'workflow', 'list',
            '--label', 'team=alpha', '--label', 'run=42',
            '--no-label', 'project', '--no-label', 'owner',
        ])

        self.assertEqual(args.labels, ['team=alpha', 'run=42'])
        self.assertEqual(args.no_labels, ['project', 'owner'])

    def test_fresh_submit_forwards_label_overrides(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            pool='pool-1',
            priority=None,
            workflow_file='workflow.yaml',
            set=[],
            set_string=[],
            labels=['team=alpha', 'run=42'],
        )
        template_data = mock.Mock()

        with mock.patch.object(workflow, '_load_wf_file', return_value=template_data), \
             mock.patch.object(workflow, 'submit_workflow_helper') as submit_helper:
            workflow._submit_workflow(service_client, args)

        params = submit_helper.call_args.args[4]
        self.assertEqual(params['label'], ['team=alpha', 'run=42'])

    def test_resubmit_by_id_forwards_label_overrides(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'name': 'new-workflow',
            'overview': 'https://example/workflows/new-workflow',
        }
        args = argparse.Namespace(
            pool='pool-1',
            priority=None,
            workflow_file='parent-12345',
            set=[],
            set_string=[],
            labels=['team=alpha'],
            dry=False,
            format_type='json',
            rsync=None,
        )

        with mock.patch.object(
                workflow, '_load_wf_file', side_effect=FileNotFoundError), \
             mock.patch.object(workflow, 'is_workflow_id', return_value=True), \
             mock.patch('builtins.print'):
            workflow._submit_workflow(service_client, args)

        request = service_client.request.call_args
        self.assertEqual(request.kwargs['params']['workflow_id'], 'parent-12345')
        self.assertEqual(request.kwargs['params']['label'], ['team=alpha'])

    def test_validate_forwards_label_overrides_and_prints_warnings(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'name': 'workflow',
            'logs': 'Workflow validation succeeded.',
            'warnings': [WARN_MISSING_PROJECT_MESSAGE],
        }
        template_data = workflow.TemplateData(
            file='version: 2\nworkflow:\n  name: workflow\n',
            set_variables=[],
            set_string_variables=[],
            is_templated=False,
        )
        args = argparse.Namespace(
            pool='pool-1',
            workflow_file='workflow.yaml',
            set=[],
            set_string=[],
            labels=['team=alpha'],
        )

        output = io.StringIO()
        with mock.patch.object(workflow, '_load_wf_file', return_value=template_data), \
             mock.patch.object(
                 workflow, '_load_workflow_text', return_value=template_data.file), \
             mock.patch.object(workflow, 'load_local_files'), \
             contextlib.redirect_stdout(output):
            workflow._validate_workflow(service_client, args)

        request = service_client.request.call_args
        self.assertEqual(request.kwargs['params']['label'], ['team=alpha'])
        self.assertIn(
            f'WARNING: {WARN_MISSING_PROJECT_MESSAGE}',
            output.getvalue(),
        )

    def test_list_forwards_label_filters(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'workflows': [], 'more_entries': False}
        args = argparse.Namespace(
            user=[],
            status=None,
            name=None,
            order='asc',
            all_users=False,
            tags=None,
            pool=[],
            app=None,
            priority=None,
            labels=[
                'team=alpha',
                'project=(sim_*|hil_*)',
                'team=robotics_(a|b)',
            ],
            no_labels=['project'],
            submitted_after=None,
            submitted_before=None,
            count=20,
            offset=0,
            format_type='json',
        )

        with mock.patch('builtins.print'):
            workflow._list_workflows(service_client, args)

        params = service_client.request.call_args.kwargs['params']
        self.assertEqual(
            params['label'],
            [
                'team=alpha',
                'project=(sim_*|hil_*)',
                'team=robotics_(a|b)',
            ])
        self.assertEqual(params['no_label'], ['project'])

    def test_list_rejects_oversized_label_before_request(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            user=[],
            status=None,
            name=None,
            order='asc',
            all_users=False,
            tags=None,
            pool=[],
            app=None,
            priority=None,
            labels=[
                'project='
                + 'x' * validation.MAX_WORKFLOW_LABEL_SELECTOR_BYTES
            ],
            no_labels=[],
            submitted_after=None,
            submitted_before=None,
            count=20,
            offset=0,
            format_type='json',
        )

        with self.assertRaisesRegex(
                osmo_errors.OSMOUserError, 'at most 4096 bytes'):
            workflow._list_workflows(service_client, args)

        service_client.request.assert_not_called()


class TestWorkflowLabelOutput(unittest.TestCase):
    """Label rendering in list tables, query output, and warning lines."""

    def test_submission_text_prints_server_warnings(self):
        result = {
            'name': 'workflow-1',
            'overview': 'https://example/workflows/workflow-1',
            'warnings': [WARN_MISSING_PROJECT_MESSAGE],
        }
        args = argparse.Namespace(format_type='text', priority=None)

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            workflow.print_submission_results(result, args)

        self.assertIn(
            f'WARNING: {WARN_MISSING_PROJECT_MESSAGE}',
            output.getvalue(),
        )

    def test_workflow_table_displays_sorted_generic_labels(self):
        table = workflow._workflow_table_generator({
            'user': 'user',
            'name': 'workflow-1',
            'submit_time': '2026-01-01T00:00:00',
            'status': 'RUNNING',
            'priority': 'NORMAL',
            'labels': {'zeta': 'last', 'alpha': 'first'},
            'overview': 'https://example/workflows/workflow-1',
        })

        rendered = table.draw()
        self.assertIn('Labels', rendered)
        self.assertIn('alpha=first, zeta=last', rendered)

    def test_workflow_table_tolerates_older_response_without_labels(self):
        table = workflow._workflow_table_generator({
            'user': 'user',
            'name': 'workflow-1',
            'submit_time': '2026-01-01T00:00:00',
            'status': 'RUNNING',
            'priority': 'NORMAL',
            'overview': 'https://example/workflows/workflow-1',
        })

        self.assertIn('Labels', table.draw())


class WorkflowTemplateDetectionTest(unittest.TestCase):
    """Test CLI workflow template detection."""

    def test_control_block_only_workflow_is_templated(self) -> None:
        workflow_contents = """\
version: 2
{% if enabled %}
workflow:
  name: control-block-only
{% endif %}
"""

        result = workflow.parse_file_for_template(
            workflow_contents,
            [],
            [],
        )

        self.assertTrue(result.is_templated)
        self.assertEqual(result.file, workflow_contents)
        self.assertEqual(result.set_variables, [])
        self.assertEqual(result.set_string_variables, [])


class WorkflowRestartTest(unittest.TestCase):
    """Test CLI workflow restart request mapping."""

    def test_uses_source_workflow_pool_when_pool_is_omitted(self) -> None:
        service_client = mock.Mock()
        service_client.request.side_effect = (
            {'pool': 'source-pool'},
            {'name': 'restarted-workflow'},
        )
        args = argparse.Namespace(
            workflow_id='source-workflow',
            pool=None,
            format_type='json',
        )

        with mock.patch('builtins.print'):
            workflow._restart_workflow(service_client, args)

        self.assertEqual(
            service_client.request.call_args_list,
            [
                mock.call(
                    workflow.client.RequestMethod.GET,
                    'api/workflow/source-workflow',
                ),
                mock.call(
                    workflow.client.RequestMethod.POST,
                    (
                        'api/pool/source-pool/workflow/'
                        'source-workflow/restart'
                    ),
                ),
            ],
        )


class PortSpecParsingTest(unittest.TestCase):
    """Test the --port boundary parsing for workflow port-forward."""

    def test_parse_port_single_value_mirrors_local_and_remote(self):
        local_ports, remote_ports = workflow.parse_port('8000')

        self.assertEqual(local_ports, [8000])
        self.assertEqual(remote_ports, [8000])

    def test_parse_port_pair_maps_local_to_remote(self):
        local_ports, remote_ports = workflow.parse_port('8000:2000')

        self.assertEqual(local_ports, [8000])
        self.assertEqual(remote_ports, [2000])

    def test_parse_port_range_without_remote_mirrors_the_local_range(self):
        local_ports, remote_ports = workflow.parse_port('8000-8002')

        self.assertEqual(local_ports, [8000, 8001, 8002])
        self.assertEqual(remote_ports, [8000, 8001, 8002])

    def test_parse_port_range_pair_maps_each_local_port_to_a_remote_port(self):
        local_ports, remote_ports = workflow.parse_port('8000-8002:9000-9002')

        self.assertEqual(local_ports, [8000, 8001, 8002])
        self.assertEqual(remote_ports, [9000, 9001, 9002])

    def test_parse_port_comma_separated_intervals_are_concatenated(self):
        local_ports, remote_ports = workflow.parse_port('8000-8001:9000-9001,8015')

        self.assertEqual(local_ports, [8000, 8001, 8015])
        self.assertEqual(remote_ports, [9000, 9001, 8015])

    def test_parse_port_mismatched_range_sizes_raises_argument_type_error(self):
        with self.assertRaisesRegex(argparse.ArgumentTypeError, 'Invalid number of ports'):
            workflow.parse_port('8000-8010:9000-9001')

    def test_parse_range_port_returns_inclusive_range(self):
        ports = workflow.parse_range_port('9000-9003')

        self.assertEqual(ports, [9000, 9001, 9002, 9003])

    def test_parse_range_port_reversed_bounds_raises_argument_type_error(self):
        with self.assertRaisesRegex(argparse.ArgumentTypeError, 'Invalid port value: 9000-8000'):
            workflow.parse_range_port('9000-8000')

    def test_parse_range_port_above_maximum_raises_argument_type_error(self):
        with self.assertRaisesRegex(argparse.ArgumentTypeError, 'between 0 and 65535'):
            workflow.parse_range_port('1000-70000')

    def test_parse_single_port_non_numeric_value_raises_argument_type_error(self):
        with self.assertRaisesRegex(argparse.ArgumentTypeError, 'Invalid port format: http'):
            workflow.parse_single_port('http')

    def test_parse_single_port_above_maximum_raises_argument_type_error(self):
        with self.assertRaisesRegex(argparse.ArgumentTypeError, 'Invalid port value: 70000'):
            workflow.parse_single_port('70000')


class WorkflowIdDetectionTest(unittest.TestCase):
    """Test whether a submit argument is treated as a workflow ID."""

    def test_is_workflow_id_accepts_name_with_numeric_suffix(self):
        self.assertTrue(workflow.is_workflow_id('training-run-1234'))

    def test_is_workflow_id_rejects_a_yaml_filename(self):
        self.assertFalse(workflow.is_workflow_id('workflow.yaml'))


class SubmissionResultPrintingTest(unittest.TestCase):
    """Test the submit/restart confirmation output."""

    def test_restart_result_reports_the_parent_workflow(self):
        result = {'name': 'wf-2', 'overview': 'https://example/wf-2'}
        args = argparse.Namespace(format_type='text', priority=None)

        with mock.patch('builtins.print') as mock_print:
            workflow.print_submission_results(result, args, 'wf-1')

        self.assertIn('Workflow wf-1 restarted.', _joined_print_output(mock_print))

    def test_result_with_dashboard_url_prints_the_dashboard_line(self):
        result = {
            'name': 'wf-2',
            'overview': 'https://example/wf-2',
            'dashboard_url': 'https://example/dashboard/wf-2',
        }
        args = argparse.Namespace(format_type='text', priority=None)

        with mock.patch('builtins.print') as mock_print:
            workflow.print_submission_results(result, args)

        self.assertIn(
            'Workflow Dashboard - https://example/dashboard/wf-2',
            _joined_print_output(mock_print))

    def test_low_priority_submission_warns_about_preemption(self):
        result = {'name': 'wf-2', 'overview': 'https://example/wf-2'}
        args = argparse.Namespace(format_type='text', priority='LOW')

        with mock.patch('builtins.print') as mock_print:
            workflow.print_submission_results(result, args)

        self.assertIn('LOW priority can be preempted', _joined_print_output(mock_print))


class WorkflowSpecFileLoadingTest(unittest.TestCase):
    """Test reading workflow specs off local disk."""

    def test_load_wf_file_returns_file_contents_and_template_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            workflow_path = os.path.join(directory, 'workflow.yaml')
            with open(workflow_path, 'w', encoding='utf-8') as spec_file:
                spec_file.write(PLAIN_WORKFLOW_SPEC)

            template_data = workflow._load_wf_file(workflow_path, ['count=2'], ['tag=beta'])

        self.assertEqual(template_data.file, PLAIN_WORKFLOW_SPEC)
        self.assertEqual(template_data.set_variables, ['count=2'])
        self.assertEqual(template_data.set_string_variables, ['tag=beta'])
        self.assertFalse(template_data.is_templated)

    def test_load_workflow_text_returns_only_the_workflow_section(self):
        with tempfile.TemporaryDirectory() as directory:
            workflow_path = os.path.join(directory, 'workflow.yaml')
            with open(workflow_path, 'w', encoding='utf-8') as spec_file:
                spec_file.write(PLAIN_WORKFLOW_SPEC)

            workflow_text = workflow._load_workflow_text(workflow_path)

        self.assertIn('name: sample', workflow_text)
        self.assertNotIn('version: 2', workflow_text)


class LoadLocalFilesTest(unittest.TestCase):
    """Test inlining local file contents into a workflow spec before submission."""

    def test_task_localpath_is_replaced_by_file_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            with open(os.path.join(directory, 'entry.sh'), 'w', encoding='utf-8') as script_file:
                script_file.write('echo hello\n')
            spec: Dict[str, Any] = {
                'workflow': {
                    'tasks': [{
                        'name': 'main',
                        'files': [{'path': '/opt/entry.sh', 'localpath': 'entry.sh'}],
                    }],
                },
            }

            workflow.load_local_files(os.path.join(directory, 'workflow.yaml'), spec)

        self.assertEqual(spec['workflow']['tasks'][0]['files'][0]['contents'], 'echo hello\n')
        self.assertNotIn('localpath', spec['workflow']['tasks'][0]['files'][0])

    def test_group_task_localpath_is_replaced_by_file_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            with open(os.path.join(directory, 'entry.sh'), 'w', encoding='utf-8') as script_file:
                script_file.write('echo grouped\n')
            spec: Dict[str, Any] = {
                'workflow': {
                    'groups': [{
                        'name': 'trainers',
                        'tasks': [{
                            'name': 'trainer-0',
                            'files': [{'path': '/opt/entry.sh', 'localpath': 'entry.sh'}],
                        }],
                    }],
                },
            }

            workflow.load_local_files(os.path.join(directory, 'workflow.yaml'), spec)

        group_task = spec['workflow']['groups'][0]['tasks'][0]
        self.assertEqual(group_task['files'][0]['contents'], 'echo grouped\n')

    def test_contents_and_localpath_together_raises_submission_error(self):
        spec = {
            'workflow': {
                'tasks': [{
                    'name': 'main',
                    'files': [{
                        'path': '/opt/entry.sh',
                        'localpath': 'entry.sh',
                        'contents': 'echo hello\n',
                    }],
                }],
            },
        }

        with self.assertRaisesRegex(
                osmo_errors.OSMOSubmissionError, 'contents and localpath together'):
            workflow.load_local_files('/workspace/workflow.yaml', spec)

    def test_missing_local_file_raises_submission_error(self):
        spec = {
            'workflow': {
                'tasks': [{
                    'name': 'main',
                    'files': [{'path': '/opt/entry.sh', 'localpath': 'absent.sh'}],
                }],
            },
        }

        with self.assertRaisesRegex(osmo_errors.OSMOSubmissionError, 'does not exist'):
            workflow.load_local_files('/workspace/workflow.yaml', spec)

    def test_group_tasks_are_not_appended_to_the_top_level_task_list(self):
        spec = {
            'workflow': {
                'tasks': [{'name': 'standalone'}],
                'groups': [{'name': 'trainers', 'tasks': [{'name': 'trainer-0'}]}],
            },
        }

        workflow.load_local_files('/workspace/workflow.yaml', spec)

        self.assertEqual(spec['workflow']['tasks'], [{'name': 'standalone'}])


class SubmitWorkflowTest(unittest.TestCase):
    """Test the 'workflow submit' command handler."""

    def test_missing_pool_is_filled_from_the_profile_default(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            pool=None,
            priority=None,
            workflow_file='workflow.yaml',
            set=[],
            set_string=[],
            labels=[],
        )

        with mock.patch.object(
                workflow.pool, 'fetch_default_pool', return_value='default-pool'), \
             mock.patch.object(workflow, '_load_wf_file', return_value=mock.Mock()), \
             mock.patch.object(workflow, 'submit_workflow_helper'):
            workflow._submit_workflow(service_client, args)

        self.assertEqual(args.pool, 'default-pool')

    def test_priority_flag_is_forwarded_as_a_request_param(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            pool='pool-1',
            priority='HIGH',
            workflow_file='workflow.yaml',
            set=[],
            set_string=[],
            labels=[],
        )

        with mock.patch.object(workflow, '_load_wf_file', return_value=mock.Mock()), \
             mock.patch.object(workflow, 'submit_workflow_helper') as submit_helper:
            workflow._submit_workflow(service_client, args)

        self.assertEqual(submit_helper.call_args.args[4]['priority'], 'HIGH')

    def test_missing_file_that_is_not_a_workflow_id_raises_submission_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            pool='pool-1',
            priority=None,
            workflow_file='workflow.yaml',
            set=[],
            set_string=[],
            labels=[],
        )

        with mock.patch.object(
                workflow, '_load_wf_file',
                side_effect=FileNotFoundError('workflow.yaml not found')):
            with self.assertRaisesRegex(
                    osmo_errors.OSMOSubmissionError, 'workflow.yaml not found'):
                workflow._submit_workflow(service_client, args)

    def test_workflow_id_submission_with_dry_run_prints_guidance_and_skips_request(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            pool='pool-1',
            priority=None,
            workflow_file='training-run-1234',
            set=[],
            set_string=[],
            labels=[],
            dry=True,
            format_type='text',
            rsync=None,
        )

        with mock.patch.object(
                workflow, '_load_wf_file', side_effect=FileNotFoundError('missing')), \
             mock.patch('builtins.print') as mock_print:
            workflow._submit_workflow(service_client, args)

        self.assertIn('remove the --dry-run flag', _joined_print_output(mock_print))
        service_client.request.assert_not_called()

    def test_workflow_id_submission_with_set_prints_guidance_and_skips_request(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            pool='pool-1',
            priority=None,
            workflow_file='training-run-1234',
            set=['count=2'],
            set_string=[],
            labels=[],
            dry=False,
            format_type='text',
            rsync=None,
        )

        with mock.patch.object(
                workflow, '_load_wf_file', side_effect=FileNotFoundError('missing')), \
             mock.patch('builtins.print') as mock_print:
            workflow._submit_workflow(service_client, args)

        self.assertIn('remove the --set flag', _joined_print_output(mock_print))
        service_client.request.assert_not_called()

    def test_workflow_id_submission_failure_is_wrapped_with_the_workflow_id(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = osmo_errors.OSMOSubmissionError(
            'quota exceeded', workflow_id='training-run-1234')
        args = argparse.Namespace(
            pool='pool-1',
            priority=None,
            workflow_file='training-run-1234',
            set=[],
            set_string=[],
            labels=[],
            dry=False,
            format_type='text',
            rsync=None,
        )

        with mock.patch.object(
                workflow, '_load_wf_file', side_effect=FileNotFoundError('missing')):
            with self.assertRaisesRegex(
                    osmo_errors.OSMOSubmissionError,
                    'Workflow training-run-1234 submit failed'):
                workflow._submit_workflow(service_client, args)

    def test_workflow_id_submission_with_rsync_starts_a_background_daemon(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'name': 'wf-2', 'overview': 'https://example/wf-2'}
        args = argparse.Namespace(
            pool='pool-1',
            priority=None,
            workflow_file='training-run-1234',
            set=[],
            set_string=[],
            labels=[],
            dry=False,
            format_type='json',
            rsync='/local/data:/osmo/run/workspace/data',
        )

        with mock.patch.object(
                workflow, '_load_wf_file', side_effect=FileNotFoundError('missing')), \
             mock.patch.object(workflow.rsync, 'rsync_upload') as mock_rsync_upload, \
             mock.patch('builtins.print'):
            workflow._submit_workflow(service_client, args)

        self.assertEqual(mock_rsync_upload.call_args.args[1], 'wf-2')


class SubmitWorkflowHelperTest(unittest.TestCase):
    """Test the shared submit path used by file-based submissions."""

    def test_dry_run_prints_the_expanded_spec_without_submitting(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'spec': 'workflow:\n  name: expanded\n'}
        template_data = workflow.TemplateData(
            file=PLAIN_WORKFLOW_SPEC,
            set_variables=[],
            set_string_variables=[],
            is_templated=False,
        )
        args = argparse.Namespace(
            pool='pool-1', dry=True, set_env=[], rsync=None, format_type='text', priority=None)
        params: Dict[str, Any] = {}

        with mock.patch('builtins.print') as mock_print:
            workflow.submit_workflow_helper(
                service_client, args, template_data, '/workspace/workflow.yaml', params)

        self.assertIn('name: expanded', _joined_print_output(mock_print))
        self.assertEqual(service_client.request.call_count, 1)

    def test_plain_spec_submission_forwards_env_vars_and_dumped_spec(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'name': 'wf-1', 'overview': 'https://example/wf-1'}
        template_data = workflow.TemplateData(
            file=PLAIN_WORKFLOW_SPEC,
            set_variables=[],
            set_string_variables=[],
            is_templated=False,
        )
        args = argparse.Namespace(
            pool='pool-1', dry=False, set_env=['DEBUG=1'], rsync=None,
            format_type='text', priority=None)
        params: Dict[str, Any] = {}

        with mock.patch('builtins.print'):
            workflow.submit_workflow_helper(
                service_client, args, template_data, '/workspace/workflow.yaml', params)

        self.assertEqual(params['env_vars'], ['DEBUG=1'])
        self.assertIn('name: sample', service_client.request.call_args.kwargs['payload']['file'])

    def test_templated_spec_submission_uploads_the_original_template(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            {'spec': 'version: 2\nworkflow:\n  name: expanded\n  tasks: []\n'},
            {'name': 'wf-1', 'overview': 'https://example/wf-1'},
        ]
        templated_spec = 'version: 2\nworkflow:\n  name: {{ name }}\n'
        template_data = workflow.TemplateData(
            file=templated_spec,
            set_variables=['name=expanded'],
            set_string_variables=[],
            is_templated=True,
        )
        args = argparse.Namespace(
            pool='pool-1', dry=False, set_env=[], rsync=None, format_type='text', priority=None)

        with mock.patch('builtins.print'):
            workflow.submit_workflow_helper(
                service_client, args, template_data, '/workspace/workflow.yaml', {})

        self.assertEqual(template_data.uploaded_templated_spec, templated_spec)
        self.assertIn('name: expanded', service_client.request.call_args.kwargs['payload']['file'])

    def test_credential_failure_is_wrapped_as_a_submission_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = osmo_errors.OSMOCredentialError('bad registry secret')
        template_data = workflow.TemplateData(
            file=PLAIN_WORKFLOW_SPEC,
            set_variables=[],
            set_string_variables=[],
            is_templated=False,
        )
        args = argparse.Namespace(
            pool='pool-1', dry=False, set_env=[], rsync=None, format_type='text', priority=None)

        with self.assertRaisesRegex(
                osmo_errors.OSMOSubmissionError, 'bad registry secret'):
            workflow.submit_workflow_helper(
                service_client, args, template_data, '/workspace/workflow.yaml', {})

    def test_rsync_flag_starts_a_background_daemon_after_submission(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'name': 'wf-1', 'overview': 'https://example/wf-1'}
        template_data = workflow.TemplateData(
            file=PLAIN_WORKFLOW_SPEC,
            set_variables=[],
            set_string_variables=[],
            is_templated=False,
        )
        args = argparse.Namespace(
            pool='pool-1', dry=False, set_env=[], rsync='/local/data:/remote/data',
            format_type='json', priority=None)

        with mock.patch.object(workflow.rsync, 'rsync_upload') as mock_rsync_upload, \
             mock.patch('builtins.print'):
            workflow.submit_workflow_helper(
                service_client, args, template_data, '/workspace/workflow.yaml', {})

        self.assertEqual(mock_rsync_upload.call_args.kwargs['daemon'], True)


class RestartWorkflowTest(unittest.TestCase):
    """Test the 'workflow restart' command handler."""

    def test_explicit_pool_flag_is_used_without_querying_the_workflow(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'name': 'wf-2'}
        args = argparse.Namespace(
            workflow_id='wf-1', pool='explicit-pool', format_type='json')

        with mock.patch('builtins.print'):
            workflow._restart_workflow(service_client, args)

        self.assertEqual(
            service_client.request.call_args.args[1],
            'api/pool/explicit-pool/workflow/wf-1/restart')

    def test_workflow_without_a_pool_falls_back_to_the_profile_default(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [{'pool': None}, {'name': 'wf-2'}]
        args = argparse.Namespace(workflow_id='wf-1', pool=None, format_type='json')

        with mock.patch.object(
                workflow.pool, 'fetch_default_pool', return_value='default-pool'), \
             mock.patch('builtins.print'):
            workflow._restart_workflow(service_client, args)

        self.assertEqual(
            service_client.request.call_args.args[1],
            'api/pool/default-pool/workflow/wf-1/restart')

    def test_restart_failure_is_wrapped_with_the_workflow_id(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = osmo_errors.OSMOSubmissionError(
            'no capacity', workflow_id='wf-1')
        args = argparse.Namespace(workflow_id='wf-1', pool='pool-1', format_type='json')

        with self.assertRaisesRegex(
                osmo_errors.OSMOSubmissionError, 'Workflow wf-1 submit failed'):
            workflow._restart_workflow(service_client, args)


class ValidateWorkflowTest(unittest.TestCase):
    """Test the 'workflow validate' command handler."""

    def test_missing_pool_is_filled_from_the_profile_default(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'logs': 'validation ok'}
        template_data = workflow.TemplateData(
            file=PLAIN_WORKFLOW_SPEC,
            set_variables=[],
            set_string_variables=[],
            is_templated=False,
        )
        args = argparse.Namespace(
            pool=None, workflow_file='workflow.yaml', set=[], set_string=[], labels=[])

        with mock.patch.object(
                workflow.pool, 'fetch_default_pool', return_value='default-pool'), \
             mock.patch.object(workflow, '_load_wf_file', return_value=template_data), \
             mock.patch.object(
                 workflow, '_load_workflow_text', return_value=PLAIN_WORKFLOW_SPEC), \
             mock.patch.object(workflow, 'load_local_files'), \
             mock.patch('builtins.print'):
            workflow._validate_workflow(service_client, args)

        self.assertEqual(args.pool, 'default-pool')

    def test_missing_workflow_file_raises_submission_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            pool='pool-1', workflow_file='workflow.yaml', set=[], set_string=[], labels=[])

        with mock.patch.object(
                workflow, '_load_wf_file',
                side_effect=FileNotFoundError('workflow.yaml not found')):
            with self.assertRaisesRegex(
                    osmo_errors.OSMOSubmissionError, 'workflow.yaml not found'):
                workflow._validate_workflow(service_client, args)

    def test_templated_spec_is_expanded_by_the_server_before_validation(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            {'spec': 'workflow:\n  name: expanded\n'},
            {'logs': 'validation ok'},
        ]
        template_data = workflow.TemplateData(
            file='version: 2\nworkflow:\n  name: {{ name }}\n',
            set_variables=['name=expanded'],
            set_string_variables=[],
            is_templated=True,
        )
        args = argparse.Namespace(
            pool='pool-1', workflow_file='workflow.yaml', set=[], set_string=[], labels=[])

        with mock.patch.object(workflow, '_load_wf_file', return_value=template_data), \
             mock.patch.object(workflow, 'load_local_files'), \
             mock.patch('builtins.print') as mock_print:
            workflow._validate_workflow(service_client, args)

        self.assertEqual(service_client.request.call_count, 2)
        self.assertIn('validation ok', _joined_print_output(mock_print))


class WorkflowLogsTest(unittest.TestCase):
    """Test the 'workflow logs' command handler."""

    def test_error_logs_without_a_task_raises_user_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            workflow_id='wf-1', task=None, retry_id=None, error=True, last_n_lines=None)

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'Specify task for retry ID'):
            workflow._workflow_logs(service_client, args)

    def test_log_filters_are_forwarded_and_streamed_lines_are_printed(self):
        response = mock.Mock()
        response.iter_lines.return_value = [b'first log line']
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = response
        args = argparse.Namespace(
            workflow_id='wf-1', task='trainer', retry_id=2, error=False, last_n_lines=50)

        with mock.patch('builtins.print') as mock_print:
            workflow._workflow_logs(service_client, args)

        self.assertEqual(
            service_client.request.call_args.kwargs['params'],
            {'last_n_lines': 50, 'task_name': 'trainer', 'retry_id': 2})
        self.assertIn('first log line', _joined_print_output(mock_print))

    def test_error_flag_with_a_task_reads_the_error_logs_endpoint(self):
        response = mock.Mock()
        response.iter_lines.return_value = [b'traceback line']
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = response
        args = argparse.Namespace(
            workflow_id='wf-1', task='trainer', retry_id=None, error=True, last_n_lines=None)

        with mock.patch('builtins.print') as mock_print:
            workflow._workflow_logs(service_client, args)

        self.assertEqual(
            service_client.request.call_args.args[1], 'api/workflow/wf-1/error_logs')
        self.assertIn('has error logs', _joined_print_output(mock_print))

    def test_truncated_log_stream_prints_a_retry_hint(self):
        response = mock.Mock()
        response.iter_lines.side_effect = requests.exceptions.ChunkedEncodingError(
            "InvalidChunkLength(got length b'', 0 bytes read)")
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = response
        args = argparse.Namespace(
            workflow_id='wf-1', task=None, retry_id=None, error=False, last_n_lines=None)

        with mock.patch('builtins.print') as mock_print:
            workflow._workflow_logs(service_client, args)

        self.assertIn('Log stream has timed out', _joined_print_output(mock_print))

    def test_unexpected_log_stream_failure_raises_server_error(self):
        response = mock.Mock()
        response.iter_lines.side_effect = requests.exceptions.ChunkedEncodingError(
            'connection reset by peer')
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = response
        args = argparse.Namespace(
            workflow_id='wf-1', task=None, retry_id=None, error=False, last_n_lines=None)

        with mock.patch('builtins.print'):
            with self.assertRaisesRegex(osmo_errors.OSMOServerError, 'Failed to fetch logs'):
                workflow._workflow_logs(service_client, args)


class WorkflowEventsTest(unittest.TestCase):
    """Test the 'workflow events' command handler."""

    def test_retry_id_without_a_task_raises_user_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(workflow_id='wf-1', task=None, retry_id=3)

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'Specify task for retry ID.'):
            workflow._workflow_events(service_client, args)

    def test_event_filters_are_forwarded_and_streamed_lines_are_printed(self):
        response = mock.Mock()
        response.iter_lines.return_value = [b'Scheduled pod']
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = response
        args = argparse.Namespace(workflow_id='wf-1', task='trainer', retry_id=3)

        with mock.patch('builtins.print') as mock_print:
            workflow._workflow_events(service_client, args)

        self.assertEqual(
            service_client.request.call_args.kwargs['params'],
            {'task_name': 'trainer', 'retry_id': 3})
        self.assertIn('Scheduled pod', _joined_print_output(mock_print))

    def test_prematurely_ended_event_stream_prints_a_retry_hint(self):
        response = mock.Mock()
        response.iter_lines.side_effect = requests.exceptions.ChunkedEncodingError(
            'Response ended prematurely')
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = response
        args = argparse.Namespace(workflow_id='wf-1', task=None, retry_id=None)

        with mock.patch('builtins.print') as mock_print:
            workflow._workflow_events(service_client, args)

        self.assertIn('Event stream has timed out', _joined_print_output(mock_print))

    def test_unexpected_event_stream_failure_raises_server_error(self):
        response = mock.Mock()
        response.iter_lines.side_effect = requests.exceptions.ChunkedEncodingError(
            'connection reset by peer')
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = response
        args = argparse.Namespace(workflow_id='wf-1', task=None, retry_id=None)

        with mock.patch('builtins.print'):
            with self.assertRaisesRegex(osmo_errors.OSMOServerError, 'Failed to fetch events'):
                workflow._workflow_events(service_client, args)


class CancelWorkflowTest(unittest.TestCase):
    """Test the 'workflow cancel' command handler."""

    def test_text_output_confirms_each_cancelation(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'name': 'wf-1'}
        args = argparse.Namespace(
            workflow_ids=['wf-1'], message=None, force=False, format_type='text')

        with mock.patch('builtins.print') as mock_print:
            workflow._cancel_workflow(service_client, args)

        self.assertIn(
            'Cancel job for workflow wf-1 is submitted!', _joined_print_output(mock_print))

    def test_json_output_prints_the_server_payload(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'name': 'wf-1'}
        args = argparse.Namespace(
            workflow_ids=['wf-1'], message=None, force=True, format_type='json')

        with mock.patch('builtins.print') as mock_print:
            workflow._cancel_workflow(service_client, args)

        self.assertIn('"name": "wf-1"', _joined_print_output(mock_print))

    def test_cancelation_message_is_forwarded_as_a_request_param(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'name': 'wf-1'}
        args = argparse.Namespace(
            workflow_ids=['wf-1'], message='bad hyperparameters', force=False, format_type='text')

        with mock.patch('builtins.print'):
            workflow._cancel_workflow(service_client, args)

        self.assertEqual(
            service_client.request.call_args.kwargs['params'],
            {'force': False, 'message': 'bad hyperparameters'})

    def test_server_error_reports_the_failed_workflow_and_continues(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = osmo_errors.OSMOServerError('workflow already done')
        args = argparse.Namespace(
            workflow_ids=['wf-1'], message=None, force=False, format_type='text')

        with mock.patch('builtins.print') as mock_print:
            workflow._cancel_workflow(service_client, args)

        self.assertIn(
            'Workflow cancelation failed for workflow wf-1: workflow already done',
            _joined_print_output(mock_print))


class QueryWorkflowTest(unittest.TestCase):
    """Test the 'workflow query' command handler."""

    def test_json_output_prints_the_full_workflow_payload(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'status': 'RUNNING',
            'submitted_by': 'alice',
            'overview': 'https://example/wf-1',
            'submit_time': '2026-01-01 00:00:00',
            'groups': [{'tasks': [{'name': 'main', 'start_time': None, 'status': 'PENDING'}]}],
        }
        args = argparse.Namespace(workflow_id='wf-1', verbose=False, format_type='json')

        with mock.patch('builtins.print') as mock_print:
            workflow._query_workflow(service_client, args)

        self.assertIn('"submitted_by": "alice"', _joined_print_output(mock_print))

    def test_text_output_lists_tasks_from_every_group(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'status': 'RUNNING',
            'submitted_by': 'alice',
            'overview': 'https://example/wf-1',
            'submit_time': '2026-01-01 00:00:00',
            'labels': {'team': 'robotics'},
            'groups': [
                {'tasks': [{
                    'name': 'started-task',
                    'start_time': '2026-01-02 03:04:05',
                    'status': 'RUNNING',
                }]},
                {'tasks': [{'name': 'queued-task', 'start_time': None, 'status': 'PENDING'}]},
            ],
        }
        args = argparse.Namespace(workflow_id='wf-1', verbose=False, format_type='text')

        with mock.patch('builtins.print') as mock_print:
            workflow._query_workflow(service_client, args)

        output = _joined_print_output(mock_print)
        self.assertIn('team=robotics', output)
        self.assertIn('started-task', output)
        self.assertIn('queued-task', output)

    def test_verbose_output_adds_the_retry_id_column(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'status': 'FAILED',
            'submitted_by': 'alice',
            'overview': 'https://example/wf-1',
            'submit_time': '2026-01-01 00:00:00',
            'groups': [{'tasks': [{
                'name': 'main',
                'retry_id': 3,
                'start_time': '2026-01-02 03:04:05',
                'status': 'FAILED',
            }]}],
        }
        args = argparse.Namespace(workflow_id='wf-1', verbose=True, format_type='text')

        with mock.patch('builtins.print') as mock_print:
            workflow._query_workflow(service_client, args)

        self.assertIn('Retry ID', _joined_print_output(mock_print))


class ListWorkflowsTest(unittest.TestCase):
    """Test the request params and rendering of 'workflow list'."""

    def _run_list(self, args: argparse.Namespace) -> mock.Mock:
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'workflows': [], 'more_entries': False}
        with mock.patch('builtins.print'):
            workflow._list_workflows(service_client, args)
        return service_client

    def test_user_filter_sets_the_users_param(self):
        service_client = self._run_list(_make_list_args(user=['alice', 'bob']))

        self.assertEqual(
            service_client.request.call_args.kwargs['params']['users'], ['alice', 'bob'])

    def test_status_filter_sets_the_statuses_param(self):
        service_client = self._run_list(_make_list_args(status=['RUNNING', 'FAILED']))

        self.assertEqual(
            service_client.request.call_args.kwargs['params']['statuses'], ['RUNNING', 'FAILED'])

    def test_name_filter_sets_the_name_param(self):
        service_client = self._run_list(_make_list_args(name='training'))

        self.assertEqual(service_client.request.call_args.kwargs['params']['name'], 'training')

    def test_all_users_flag_sets_the_all_users_param(self):
        service_client = self._run_list(_make_list_args(all_users=True))

        self.assertEqual(service_client.request.call_args.kwargs['params']['all_users'], True)

    def test_tag_filter_sets_the_tags_param(self):
        service_client = self._run_list(_make_list_args(tags=['nightly']))

        self.assertEqual(service_client.request.call_args.kwargs['params']['tags'], ['nightly'])

    def test_pool_filter_sets_the_pools_param_instead_of_all_pools(self):
        service_client = self._run_list(_make_list_args(pool=['pool-1']))

        params = service_client.request.call_args.kwargs['params']
        self.assertEqual(params['pools'], ['pool-1'])
        self.assertNotIn('all_pools', params)

    def test_app_filter_sets_the_app_param(self):
        service_client = self._run_list(_make_list_args(app='simulator:v2'))

        self.assertEqual(
            service_client.request.call_args.kwargs['params']['app'], 'simulator:v2')

    def test_priority_filter_sets_the_priority_param(self):
        service_client = self._run_list(_make_list_args(priority=['HIGH']))

        self.assertEqual(service_client.request.call_args.kwargs['params']['priority'], ['HIGH'])

    def test_submitted_after_is_converted_to_a_utc_timestamp(self):
        service_client = self._run_list(_make_list_args(submitted_after='2026-05-02'))

        self.assertRegex(
            service_client.request.call_args.kwargs['params']['submitted_after'],
            r'^2026-05-0[123]T\d{2}:\d{2}:\d{2}$')

    def test_submitted_before_is_converted_to_a_utc_timestamp(self):
        service_client = self._run_list(_make_list_args(submitted_before='2026-05-04'))

        self.assertRegex(
            service_client.request.call_args.kwargs['params']['submitted_before'],
            r'^2026-05-0[345]T\d{2}:\d{2}:\d{2}$')

    def test_submitted_after_later_than_submitted_before_raises_user_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = _make_list_args(submitted_after='2026-05-10', submitted_before='2026-05-01')

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'needs to be later'):
            workflow._list_workflows(service_client, args)

    def test_text_output_renders_a_table_row_per_workflow(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'workflows': [{
                'user': 'alice',
                'name': 'workflow-1',
                'submit_time': '2026-01-01 00:00:00',
                'status': 'RUNNING',
                'priority': 'NORMAL',
                'labels': {'team': 'robotics'},
                'overview': 'https://example/workflow-1',
            }],
            'more_entries': False,
        }
        args = _make_list_args(format_type='text')

        with mock.patch('builtins.print') as mock_print:
            workflow._list_workflows(service_client, args)

        self.assertIn('workflow-1', _joined_print_output(mock_print))

    def test_text_output_reports_when_no_workflows_match(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'workflows': [], 'more_entries': False}
        args = _make_list_args(format_type='text')

        with mock.patch('builtins.print') as mock_print:
            workflow._list_workflows(service_client, args)

        self.assertIn('There are no workflows to view.', _joined_print_output(mock_print))


class TagWorkflowsTest(unittest.TestCase):
    """Test the 'workflow tag' command handler."""

    def test_tag_changes_without_a_workflow_raises_user_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(workflow=None, add=['nightly'], remove=[])

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'No workflow specified'):
            workflow._tag_workflows(service_client, args)

    def test_workflow_without_tag_changes_raises_user_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(workflow=['wf-1'], add=[], remove=[])

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'No tags specified'):
            workflow._tag_workflows(service_client, args)

    def test_added_and_removed_tags_are_forwarded_per_workflow(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(workflow=['wf-1'], add=['nightly'], remove=['draft'])

        with mock.patch('builtins.print') as mock_print:
            workflow._tag_workflows(service_client, args)

        self.assertEqual(
            service_client.request.call_args.kwargs['params'],
            {'add': ['nightly'], 'remove': ['draft']})
        self.assertIn('Workflow wf-1 updated.', _joined_print_output(mock_print))

    def test_rejected_tag_update_prints_the_user_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = osmo_errors.OSMOUserError('unknown tag nightly')
        args = argparse.Namespace(workflow=['wf-1'], add=['nightly'], remove=[])

        with mock.patch('builtins.print') as mock_print:
            workflow._tag_workflows(service_client, args)

        self.assertIn('unknown tag nightly', _joined_print_output(mock_print))

    def test_no_workflow_lists_the_available_tags(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'tags': ['nightly', 'release']}
        args = argparse.Namespace(workflow=None, add=[], remove=[])

        with mock.patch('builtins.print') as mock_print:
            workflow._tag_workflows(service_client, args)

        output = _joined_print_output(mock_print)
        self.assertIn('- nightly', output)
        self.assertIn('- release', output)

    def test_empty_tag_list_reports_that_admins_set_no_tags(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'tags': []}
        args = argparse.Namespace(workflow=None, add=[], remove=[])

        with mock.patch('builtins.print') as mock_print:
            workflow._tag_workflows(service_client, args)

        self.assertIn('No tags have been set by admins.', _joined_print_output(mock_print))


class GetWorkflowSpecTest(unittest.TestCase):
    """Test the 'workflow spec' command handler."""

    def test_template_flag_is_forwarded_and_spec_lines_are_printed(self):
        response = mock.Mock()
        response.iter_lines.return_value = [b'workflow:', b'  name: sample']
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = response
        args = argparse.Namespace(workflow_id='wf-1', template=True)

        with mock.patch('builtins.print') as mock_print:
            workflow._get_spec(service_client, args)

        self.assertEqual(
            service_client.request.call_args.kwargs['params'], {'use_template': True})
        self.assertIn('name: sample', _joined_print_output(mock_print))

    def test_broken_spec_stream_raises_server_error(self):
        response = mock.Mock()
        response.iter_lines.side_effect = requests.exceptions.ChunkedEncodingError(
            'connection reset by peer')
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = response
        args = argparse.Namespace(workflow_id='wf-1', template=False)

        with self.assertRaisesRegex(osmo_errors.OSMOServerError, 'Failed to fetch spec'):
            workflow._get_spec(service_client, args)


class TerminalSizeTest(unittest.TestCase):
    """Test the terminal size messages sent to an exec session."""

    def test_terminal_size_is_encoded_as_rows_and_cols_json(self):
        packed_size = struct.pack('HHHH', 24, 80, 0, 0)

        with mock.patch.object(workflow.fcntl, 'ioctl', return_value=packed_size), \
             mock.patch.object(workflow.sys, 'stdin', mock.Mock()):
            encoded_size = workflow._get_terminal_size()

        self.assertEqual(json.loads(encoded_size), {'Rows': 24, 'Cols': 80})

    def test_send_terminal_size_sends_the_raw_size_payload(self):
        websocket = mock.AsyncMock()

        with mock.patch.object(workflow, '_get_terminal_size', return_value=b'{"Rows": 24}'):
            asyncio.run(workflow.send_terminal_size(websocket))

        self.assertEqual(websocket.send.await_args.args[0], b'{"Rows": 24}')

    def test_send_terminal_resize_prefixes_the_resize_marker(self):
        websocket = mock.AsyncMock()

        with mock.patch.object(workflow, '_get_terminal_size', return_value=b'{"Rows": 24}'):
            asyncio.run(workflow._send_terminal_resize(websocket))

        self.assertEqual(
            websocket.send.await_args.args[0], workflow.RESIZE_PREFIX + b'{"Rows": 24}')

    def test_resize_watcher_stops_when_the_connection_closes(self):
        websocket = mock.AsyncMock()
        websocket.send.side_effect = websockets.exceptions.ConnectionClosedOK(None, None)
        event_loop = mock.Mock()
        resize_event = mock.Mock()
        resize_event.wait = mock.AsyncMock()

        with mock.patch.object(workflow.asyncio, 'get_running_loop', return_value=event_loop), \
             mock.patch.object(workflow.asyncio, 'Event', return_value=resize_event), \
             mock.patch.object(workflow, '_get_terminal_size', return_value=b'{"Rows": 24}'):
            asyncio.run(workflow._watch_terminal_resize(websocket))

        event_loop.remove_signal_handler.assert_called_once_with(signal.SIGWINCH)


class RunExecInteractiveTest(unittest.TestCase):
    """Test the interactive exec websocket session."""

    def _exec_args(self) -> argparse.Namespace:
        return argparse.Namespace(workflow_id='wf-1', connect_timeout=60)

    def _exec_result(self) -> dict:
        return {'router_address': 'router-1', 'cookie': 'cookie-1', 'key': 'key-1'}

    def test_eof_from_the_task_container_ends_the_session(self):
        websocket = mock.AsyncMock()
        websocket.recv.return_value = b''
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.create_websocket = mock.AsyncMock(return_value=websocket)

        with mock.patch.object(workflow, '_get_terminal_size', return_value=b'{"Rows": 24}'), \
             mock.patch.object(workflow.logging, 'error') as mock_log_error:
            asyncio.run(workflow._run_exec_interactive(
                service_client, self._exec_args(), self._exec_result()))

        mock_log_error.assert_called_once()

    def test_first_payload_is_written_to_stdout_and_the_terminal_is_restored(self):
        websocket = mock.AsyncMock()
        websocket.recv.return_value = b'welcome'
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.create_websocket = mock.AsyncMock(return_value=websocket)
        writer = mock.Mock()
        writer.drain = mock.AsyncMock()

        with mock.patch.object(workflow, '_get_terminal_size', return_value=b'{"Rows": 24}'), \
             mock.patch.object(workflow.sys, 'stdin', mock.Mock()), \
             mock.patch.object(workflow.termios, 'tcgetattr', return_value=['saved-tty']), \
             mock.patch.object(workflow.termios, 'tcsetattr') as mock_restore_tty, \
             mock.patch.object(workflow.tty, 'setraw'), \
             mock.patch.object(
                 workflow, '_connect_stdin_stdout',
                 mock.AsyncMock(return_value=(mock.Mock(), writer))), \
             mock.patch.object(
                 workflow.port_forward, 'write_data', mock.AsyncMock(return_value=None)), \
             mock.patch.object(
                 workflow.port_forward, 'read_data', mock.AsyncMock(return_value=None)), \
             mock.patch.object(
                 workflow, '_watch_terminal_resize', mock.AsyncMock(return_value=None)):
            asyncio.run(workflow._run_exec_interactive(
                service_client, self._exec_args(), self._exec_result()))

        writer.write.assert_called_once_with(b'welcome')
        mock_restore_tty.assert_called_once()

    def test_clean_websocket_close_is_ignored(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.create_websocket = mock.AsyncMock(
            side_effect=websockets.exceptions.ConnectionClosedOK(None, None))

        asyncio.run(workflow._run_exec_interactive(
            service_client, self._exec_args(), self._exec_result()))

        service_client.create_websocket.assert_awaited_once()

    def test_refused_connection_is_reraised_when_keep_alive_is_requested(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.create_websocket = mock.AsyncMock(
            side_effect=ConnectionRefusedError('router unavailable'))

        with mock.patch.object(workflow.logging, 'error'):
            with self.assertRaises(ConnectionRefusedError):
                asyncio.run(workflow._run_exec_interactive(
                    service_client, self._exec_args(), self._exec_result(), keep_alive=True))

    def test_abnormal_websocket_close_is_reported_to_the_user(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.create_websocket = mock.AsyncMock(
            side_effect=websockets.exceptions.ConnectionClosedError(None, None))

        with mock.patch('builtins.print') as mock_print:
            asyncio.run(workflow._run_exec_interactive(
                service_client, self._exec_args(), self._exec_result()))

        self.assertIn('Connection Closed', _joined_print_output(mock_print))


class RunExecCommandTest(unittest.TestCase):
    """Test the non-interactive group exec websocket session."""

    def _exec_args(self) -> argparse.Namespace:
        return argparse.Namespace(workflow_id='wf-1', connect_timeout=60)

    def _exec_result(self) -> dict:
        return {'router_address': 'router-1', 'cookie': 'cookie-1', 'key': 'key-1'}

    def test_each_output_line_is_prefixed_with_the_task_name(self):
        websocket = mock.AsyncMock()
        websocket.recv.side_effect = [b'first\nsecond\n', b'']
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.create_websocket = mock.AsyncMock(return_value=websocket)

        with mock.patch.object(workflow, '_get_terminal_size', return_value=b'{"Rows": 24}'), \
             mock.patch('builtins.print') as mock_print:
            asyncio.run(workflow._run_exec_command(
                service_client, self._exec_args(), 'trainer-0', self._exec_result()))

        output = _joined_print_output(mock_print)
        self.assertIn('[trainer-0] first', output)
        self.assertIn('[trainer-0] second', output)

    def test_refused_connection_is_logged(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.create_websocket = mock.AsyncMock(
            side_effect=ConnectionRefusedError('router unavailable'))

        with mock.patch.object(workflow.logging, 'error') as mock_log_error:
            asyncio.run(workflow._run_exec_command(
                service_client, self._exec_args(), 'trainer-0', self._exec_result()))

        mock_log_error.assert_called_once()

    def test_abnormal_websocket_close_is_logged(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.create_websocket = mock.AsyncMock(
            side_effect=websockets.exceptions.ConnectionClosedError(None, None))

        with mock.patch.object(workflow.logging, 'error') as mock_log_error:
            asyncio.run(workflow._run_exec_command(
                service_client, self._exec_args(), 'trainer-0', self._exec_result()))

        self.assertEqual(mock_log_error.call_args.args[0], 'Connection Closed: %s')


class ExecWorkflowTest(unittest.TestCase):
    """Test the 'workflow exec' command handler."""

    def test_interactive_entry_command_for_a_group_raises_user_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            workflow_id='wf-1', group='trainers', task=None,
            exec_entry_command='/bin/bash', keep_alive=False, connect_timeout=60)

        with self.assertRaisesRegex(
                osmo_errors.OSMOUserError, 'Interactive commands are not supported'):
            workflow._exec_workflow(service_client, args)

    def test_keep_alive_for_a_group_raises_user_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            workflow_id='wf-1', group='trainers', task=None,
            exec_entry_command='nvidia-smi', keep_alive=True, connect_timeout=60)

        with self.assertRaisesRegex(
                osmo_errors.OSMOUserError, 'Keep-alive is not supported'):
            workflow._exec_workflow(service_client, args)

    def test_task_exec_requests_a_session_for_the_named_task(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'router_address': 'router-1', 'cookie': 'cookie-1', 'key': 'key-1'}
        args = argparse.Namespace(
            workflow_id='wf-1', group=None, task='trainer',
            exec_entry_command='/bin/bash', keep_alive=False, connect_timeout=60)

        with mock.patch.object(
                workflow, '_run_exec_interactive', mock.AsyncMock(return_value=None)):
            workflow._exec_workflow(service_client, args)

        self.assertEqual(
            service_client.request.call_args.args[1], 'api/workflow/wf-1/exec/task/trainer')

    def test_keep_alive_reconnects_after_a_server_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.side_effect = [
            osmo_errors.OSMOServerError('router restarting'),
            {'router_address': 'router-1', 'cookie': 'cookie-1', 'key': 'key-1'},
        ]
        args = argparse.Namespace(
            workflow_id='wf-1', group=None, task='trainer',
            exec_entry_command='/bin/bash', keep_alive=True, connect_timeout=60)

        with mock.patch.object(
                workflow, '_run_exec_interactive', mock.AsyncMock(return_value=None)), \
             mock.patch.object(workflow.time, 'sleep') as mock_sleep, \
             mock.patch('builtins.print') as mock_print:
            workflow._exec_workflow(service_client, args)

        mock_sleep.assert_called_once_with(10)
        self.assertIn('Reconnecting to the exec session...', _joined_print_output(mock_print))

    def test_group_exec_runs_a_command_for_every_returned_task(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'trainer-0': {'router_address': 'router-1', 'cookie': 'cookie-1', 'key': 'key-1'},
        }
        args = argparse.Namespace(
            workflow_id='wf-1', group='trainers', task=None,
            exec_entry_command='nvidia-smi', keep_alive=False, connect_timeout=60)

        with mock.patch.object(
                workflow, '_run_exec_command', mock.AsyncMock(return_value=None)) as mock_exec:
            workflow._exec_workflow(service_client, args)

        mock_exec.assert_awaited_once_with(
            service_client, args, 'trainer-0',
            {'router_address': 'router-1', 'cookie': 'cookie-1', 'key': 'key-1'})


class SinglePortForwardTest(unittest.TestCase):
    """Test the reconnect behaviour of a single forwarded port."""

    def _port_forward_args(self, use_udp: bool) -> argparse.Namespace:
        return argparse.Namespace(
            workflow_id='wf-1', task='sim', host='localhost',
            udp=use_udp, connect_timeout=60)

    def test_udp_forward_requests_a_new_session_after_a_clean_exit(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = [
            {'router_address': 'router-2', 'cookie': 'cookie-2', 'key': 'key-2'}]

        with mock.patch.object(
                workflow.port_forward, 'run_udp',
                mock.AsyncMock(side_effect=[None, KeyboardInterrupt])), \
             mock.patch.object(
                 workflow.port_forward, 'get_exponential_backoff_delay', return_value=0), \
             mock.patch('builtins.print') as mock_print:
            asyncio.run(workflow._single_port_forward(
                service_client, self._port_forward_args(True), 8000, 9000,
                'router-1', 'key-1', 'cookie-1'))

        self.assertIn('Reconnect to remote port 9000', _joined_print_output(mock_print))
        self.assertEqual(service_client.request.call_count, 1)

    def test_tcp_forward_backs_off_after_a_server_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = [
            {'router_address': 'router-2', 'cookie': 'cookie-2', 'key': 'key-2'}]

        with mock.patch.object(
                workflow.port_forward, 'run_tcp',
                mock.AsyncMock(side_effect=[
                    osmo_errors.OSMOServerError('router gone'), KeyboardInterrupt])), \
             mock.patch.object(
                 workflow.port_forward, 'get_exponential_backoff_delay',
                 return_value=0) as mock_backoff, \
             mock.patch('builtins.print'):
            asyncio.run(workflow._single_port_forward(
                service_client, self._port_forward_args(False), 8000, 9000,
                'router-1', 'key-1', 'cookie-1'))

        mock_backoff.assert_called_once_with(1)


class RsyncStatusTest(unittest.TestCase):
    """Test the 'workflow rsync status' command handler."""

    def test_status_reports_when_no_daemons_are_registered(self):
        service_client = mock.Mock(spec=client.ServiceClient)

        with mock.patch.object(workflow.rsync, 'rsync_status', return_value=[]), \
             mock.patch('builtins.print') as mock_print:
            workflow._rsync_status_cmd(service_client, argparse.Namespace())

        self.assertIn('No rsync daemons found', _joined_print_output(mock_print))

    def test_status_renders_a_row_for_each_daemon(self):
        service_client = mock.Mock(spec=client.ServiceClient)

        with mock.patch.object(
                workflow.rsync, 'rsync_status', return_value=[_make_daemon_info()]), \
             mock.patch('builtins.print') as mock_print:
            workflow._rsync_status_cmd(service_client, argparse.Namespace())

        output = _joined_print_output(mock_print)
        self.assertIn('trainer', output)
        self.assertIn('4242', output)


class RsyncStopTest(unittest.TestCase):
    """Test the 'workflow rsync stop' command handler."""

    def test_stop_reports_when_no_daemons_are_running(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(workflow_id=None, task=None)

        with mock.patch.object(workflow.rsync, 'rsync_status', return_value=[]), \
             mock.patch('builtins.print') as mock_print:
            workflow._rsync_stop_cmd(service_client, args)

        self.assertIn('No running rsync daemons found', _joined_print_output(mock_print))

    def test_stopping_every_daemon_is_aborted_when_the_user_declines(self):
        args = argparse.Namespace(workflow_id=None, task=None)

        with mock.patch.object(
                workflow.rsync, 'rsync_status', return_value=[_make_daemon_info()]), \
             mock.patch('builtins.input', return_value='n'), \
             mock.patch.object(workflow.os, 'kill') as mock_kill, \
             mock.patch('builtins.print') as mock_print:
            workflow._rsync_stop(args)

        self.assertIn('Aborted', _joined_print_output(mock_print))
        mock_kill.assert_not_called()

    def test_stopping_every_daemon_sends_sigterm_when_the_user_confirms(self):
        args = argparse.Namespace(workflow_id=None, task=None)

        with mock.patch.object(
                workflow.rsync, 'rsync_status', return_value=[_make_daemon_info()]), \
             mock.patch('builtins.input', return_value='y'), \
             mock.patch.object(workflow.os, 'kill') as mock_kill, \
             mock.patch('builtins.print'):
            workflow._rsync_stop(args)

        mock_kill.assert_called_once_with(4242, signal.SIGTERM)

    def test_filtered_stop_skips_the_confirmation_prompt(self):
        args = argparse.Namespace(workflow_id='wf-1', task='trainer')

        with mock.patch.object(
                workflow.rsync, 'rsync_status',
                return_value=[_make_daemon_info()]) as mock_status, \
             mock.patch.object(workflow.os, 'kill'), \
             mock.patch('builtins.print'):
            workflow._rsync_stop(args)

        self.assertEqual(mock_status.call_args.kwargs['workflow_id'], 'wf-1')

    def test_failure_to_signal_a_daemon_is_reported(self):
        args = argparse.Namespace(workflow_id='wf-1', task=None)

        with mock.patch.object(
                workflow.rsync, 'rsync_status', return_value=[_make_daemon_info()]), \
             mock.patch.object(
                 workflow.os, 'kill', side_effect=ProcessLookupError('no such process')), \
             mock.patch('builtins.print') as mock_print:
            workflow._rsync_stop(args)

        self.assertIn('Failed to stop rsync daemon wf-1/trainer', _joined_print_output(mock_print))


class RsyncTransferTest(unittest.TestCase):
    """Test the 'workflow rsync upload/download' command handlers."""

    def _upload_args(self, task: str | None, path: str | None) -> argparse.Namespace:
        return argparse.Namespace(
            workflow_id='wf-1', task=task, path=path, timeout=10, upload_rate_limit=None,
            debounce_delay=None, poll_interval=None, reconcile_interval=None,
            max_log_size=2048, verbose=False, daemon=False, no_progress=False)

    def test_upload_without_a_path_or_task_raises_user_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)

        with self.assertRaisesRegex(
                osmo_errors.OSMOUserError, 'Path is required for rsync upload.'):
            workflow._rsync_upload(service_client, self._upload_args(None, None))

    def test_upload_without_a_task_shifts_the_path_argument(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._upload_args('/local/data:/remote/data', None)

        with mock.patch.object(workflow.rsync, 'rsync_upload') as mock_rsync_upload:
            workflow._rsync_upload(service_client, args)

        self.assertEqual(args.path, '/local/data:/remote/data')
        self.assertIsNone(mock_rsync_upload.call_args.args[2])

    def test_upload_with_a_task_forwards_the_task_and_path(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._upload_args('trainer', '/local/data:/remote/data')

        with mock.patch.object(workflow.rsync, 'rsync_upload') as mock_rsync_upload:
            workflow._rsync_upload(service_client, args)

        self.assertEqual(mock_rsync_upload.call_args.args[2], 'trainer')
        self.assertEqual(mock_rsync_upload.call_args.kwargs['show_progress'], True)

    def test_download_without_a_path_or_task_raises_user_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            workflow_id='wf-1', task=None, path=None, timeout=10, no_progress=False)

        with self.assertRaisesRegex(
                osmo_errors.OSMOUserError, 'Path is required for rsync download.'):
            workflow._rsync_download(service_client, args)

    def test_download_without_a_task_shifts_the_path_argument(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            workflow_id='wf-1', task='/remote/data:/local/data', path=None,
            timeout=10, no_progress=True)

        with mock.patch.object(workflow.rsync, 'rsync_download') as mock_rsync_download:
            workflow._rsync_download(service_client, args)

        self.assertEqual(args.path, '/remote/data:/local/data')
        self.assertEqual(mock_rsync_download.call_args.kwargs['show_progress'], False)

    def test_download_with_a_task_forwards_the_task_and_path(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = argparse.Namespace(
            workflow_id='wf-1', task='trainer', path='/remote/data:/local/data',
            timeout=10, no_progress=False)

        with mock.patch.object(workflow.rsync, 'rsync_download') as mock_rsync_download:
            workflow._rsync_download(service_client, args)

        self.assertEqual(mock_rsync_download.call_args.args[2], 'trainer')


if __name__ == '__main__':
    unittest.main()
