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

# These tests intentionally exercise each surface's dependency-light mapping
# helpers without making network requests.
# pylint: disable=protected-access

import argparse
import inspect
import unittest
from typing import Any

from src.cli import app as cli_app
from src.cli import resources as cli_resources
from src.cli import workflow as cli_workflow
import src.lib.utils.workflow_labels as shared_labels
from src.lib.utils import resource_quantities, workflow as workflow_utils
from src.service.mcp import (
    app_submission,
    resources as mcp_resources,
    tool_registry,
    workflow_actions,
    workflow_submission,
    workflows,
)
from src.service.mcp import app_action_models, workflow_action_models, workflow_models


# CLI command mappings and the rationale for these classifications live in
# TOOLS.md#cli-semantic-parity. Keep this inventory independent of registration
# so every new tool requires an explicit compatibility decision.
_CLI_RELATIONSHIPS: dict[str, tuple[str, ...]] = {
    'shared_request': ('osmo_restart_workflow',),
    'semantic_projection': (
        'osmo_delete_app',
        'osmo_delete_credential',
        'osmo_get_app',
        'osmo_get_app_spec',
        'osmo_get_profile',
        'osmo_get_resource',
        'osmo_get_workflow',
        'osmo_get_workflow_events',
        'osmo_get_workflow_logs',
        'osmo_get_workflow_spec',
        'osmo_list_apps',
        'osmo_list_credentials',
        'osmo_list_resources',
        'osmo_list_tasks',
        'osmo_rename_app',
        'osmo_search_pools',
        'osmo_set_profile',
    ),
    'intentional_difference': (
        'osmo_cancel_workflow',
        'osmo_create_app',
        'osmo_list_workflows',
        'osmo_submit_app',
        'osmo_submit_workflow',
        'osmo_update_app',
        'osmo_validate_workflow',
    ),
    'no_cli_equivalent': ('osmo_health',),
}


class ToolParityManifestTest(unittest.TestCase):
    """Require exactly one CLI relationship for every external MCP tool."""

    def test_manifest_exactly_covers_the_tool_catalog(self) -> None:
        self.assertCountEqual(
            [
                name
                for names in _CLI_RELATIONSHIPS.values()
                for name in names
            ],
            [spec.name for spec in tool_registry.TOOL_SPECS],
        )


class ResourceQuantityParityTest(unittest.TestCase):
    """Lock real Core units and null platform maps across both surfaces."""

    @staticmethod
    def _resource() -> dict[str, Any]:
        return {
            'hostname': 'parity-node',
            'backend': 'parity-backend',
            'resource_type': 'SHARED',
            'usage_fields': {
                'storage': '20481Mi',
                'cpu': '2.1',
                'memory': 8589934592,
                'gpu': '1.2',
            },
            'allocatable_fields': {
                'storage': 107374182400,
                'cpu': '8.9',
                'memory': '33554432Ki',
                'gpu': '4.9',
            },
            'platform_allocatable_fields': None,
            'platform_available_fields': None,
            'pool_platform_labels': {'parity-pool': ['gpu']},
        }

    def test_heterogeneous_units_and_null_platform_maps_match(self) -> None:
        resource = self._resource()
        cli_result = cli_resources._normalized_quantities(
            resource,
            'parity-pool',
            'gpu',
        )
        upstream = mcp_resources._validate_resources_response(
            {'resources': [resource]}
        ).resources[0]
        mcp_result = mcp_resources._normalized_quantities(
            upstream,
            'parity-pool',
            'gpu',
        ).model_dump(mode='json')

        expected = {
            'storage': {
                'capacity': 100,
                'used': 21,
                'free': 79,
                'unit': 'Gi',
            },
            'cpu': {'capacity': 8, 'used': 3, 'free': 5},
            'memory': {
                'capacity': 32,
                'used': 8,
                'free': 24,
                'unit': 'Gi',
            },
            'gpu': {'capacity': 4, 'used': 2, 'free': 2},
        }
        self.assertEqual(cli_result, expected)
        self.assertEqual(mcp_result, expected)

    def test_cli_rounding_delegates_to_shared_semantics(self) -> None:
        self.assertEqual(
            cli_resources.round_resources(8.1, 2.9),
            resource_quantities.round_used_capacity(8.1, 2.9),
        )
        self.assertEqual(cli_resources.round_resources(8.1, 2.9), (2, 2))

    def test_capacity_only_projection_preserves_zero_gpu(self) -> None:
        resource = self._resource()
        resource['allocatable_fields'].pop('gpu')
        resource['usage_fields'].pop('gpu')

        capacities = resource_quantities.normalize_resource_capacities(
            resource,
            'parity-pool',
            'gpu',
            resource_names=resource_quantities.RESOURCE_UNITS,
        )

        self.assertEqual(capacities['gpu'], {'capacity': 0})


class WorkflowTemplateParityTest(unittest.TestCase):
    """Keep CLI and MCP template detection on one shared marker contract."""

    def test_all_template_markers_and_plain_yaml_match(self) -> None:
        cases = (
            ('version: 2\nworkflow: {{ workflow_name }}\n', True),
            ('version: 2\n{% if enabled %}\nworkflow: {}\n{% endif %}\n', True),
            ('version: 2\n{# template comment #}\nworkflow: {}\n', True),
            ('version: 2\ndefault-values:\n  enabled: true\nworkflow: {}\n', True),
            ('version: 2\nworkflow:\n  name: plain\n', False),
        )

        for workflow_spec, expected in cases:
            with self.subTest(workflow_spec=workflow_spec):
                cli_detected = cli_workflow.parse_file_for_template(
                    workflow_spec,
                    [],
                    [],
                ).is_templated
                mcp_detected = (
                    workflow_submission.build_submission_payload(
                        workflow_spec,
                        set_variables=[],
                        set_string_variables=[],
                    ).uploaded_templated_spec
                    is not None
                )

                self.assertEqual(
                    workflow_utils.is_templated_workflow(workflow_spec),
                    expected,
                )
                self.assertEqual(cli_detected, expected)
                self.assertEqual(mcp_detected, expected)


def _cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest='resource')
    cli_workflow.setup_parser(subparsers)
    cli_app.setup_parser(subparsers)
    return parser


def _subcommand_parser(
    parser: argparse.ArgumentParser,
    *commands: str,
) -> argparse.ArgumentParser:
    current = parser
    for command in commands:
        subparser_action = next(
            action
            for action in current._actions
            if isinstance(action, argparse._SubParsersAction)
        )
        current = subparser_action.choices[command]
    return current


class WorkflowLabelParityTest(unittest.TestCase):
    """Guard the CLI/Core workflow-label surface represented by MCP."""

    def test_every_cli_label_option_has_an_mcp_argument(self) -> None:
        parser = _cli_parser()
        cases = (
            (
                ('workflow', 'submit'),
                workflow_actions.osmo_submit_workflow,
                {'labels'},
            ),
            (
                ('workflow', 'validate'),
                workflow_actions.osmo_validate_workflow,
                {'labels'},
            ),
            (
                ('workflow', 'list'),
                workflows.osmo_list_workflows,
                {'labels', 'no_labels'},
            ),
            (
                ('app', 'submit'),
                app_submission.osmo_submit_app,
                {'labels'},
            ),
        )

        for commands, mcp_tool, expected_arguments in cases:
            with self.subTest(commands=commands):
                command_parser = _subcommand_parser(parser, *commands)
                cli_arguments = {
                    action.dest
                    for action in command_parser._actions
                    if 'label' in action.dest
                }
                mcp_arguments = set(inspect.signature(mcp_tool).parameters)
                self.assertEqual(cli_arguments, expected_arguments)
                self.assertLessEqual(expected_arguments, mcp_arguments)

    def test_cli_label_values_map_to_exact_core_queries(self) -> None:
        parser = _cli_parser()
        submit_args = parser.parse_args([
            'workflow',
            'submit',
            'workflow.yaml',
            '--label',
            'project=sim_alpha',
            '--label',
            'team=robotics',
        ])
        labels = workflow_submission.validate_workflow_label_assignments(
            submit_args.labels
        )

        self.assertEqual(
            workflow_submission.build_submission_query(labels=labels),
            {
                'label': ['project=sim_alpha', 'team=robotics'],
            },
        )

        list_args = parser.parse_args([
            'workflow',
            'list',
            '--label',
            'project=(sim_*|hil_*)',
            '--no-label',
            'deprecated.example.com/owner',
        ])
        self.assertEqual(
            workflows._validate_label_selectors(list_args.labels),
            ['project=(sim_*|hil_*)'],
        )
        self.assertEqual(
            workflows._validate_missing_label_keys(list_args.no_labels),
            ['deprecated.example.com/owner'],
        )

    def test_all_label_paths_share_one_validation_implementation(self) -> None:
        self.assertIs(
            cli_workflow.validation.parse_workflow_label_assignment,
            shared_labels.parse_workflow_label_assignment,
        )
        self.assertIs(
            cli_workflow.validation.parse_workflow_label_selector,
            shared_labels.parse_workflow_label_selector,
        )

    def test_models_preserve_labels_and_policy_warnings(self) -> None:
        self.assertIn('labels', workflow_models.WorkflowSummary.model_fields)
        self.assertLessEqual(
            {'labels', 'warnings'},
            set(workflow_models.WorkflowDetail.model_fields),
        )
        for result_model in (
            workflow_action_models.ValidateWorkflowResult,
            workflow_action_models.SubmitWorkflowResult,
            workflow_action_models.RestartWorkflowResult,
            app_action_models.SubmitAppResult,
        ):
            with self.subTest(result_model=result_model):
                self.assertIn('warnings', result_model.model_fields)


if __name__ == '__main__':
    unittest.main()
