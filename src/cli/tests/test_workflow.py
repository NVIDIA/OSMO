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

import argparse
import contextlib
import io
import unittest
from unittest import mock

from src.cli import workflow
from src.lib.utils import client


WARN_MISSING_PROJECT_MESSAGE = (
    "Workflow is missing label 'project'; add it now to avoid rejected "
    "submissions once it is required."
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


if __name__ == '__main__':
    unittest.main()
