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
import dataclasses
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


_SHARED_REQUEST = 'shared_request'
_SEMANTIC_PROJECTION = 'semantic_projection'
_INTENTIONAL_DIFFERENCE = 'intentional_difference'
_NO_CLI_EQUIVALENT = 'no_cli_equivalent'
_CLASSIFICATIONS = frozenset((
    _SHARED_REQUEST,
    _SEMANTIC_PROJECTION,
    _INTENTIONAL_DIFFERENCE,
    _NO_CLI_EQUIVALENT,
))


@dataclasses.dataclass(frozen=True, slots=True)
class _ParityContract:
    classification: str
    cli_command: str | None = None
    rationale: str | None = None
    evidence: str | None = None


# This inventory forces an explicit decision for every public MCP tool. It does
# not claim that the command strings themselves are executable coverage; the
# high-risk shared behaviors have focused tests below.
_PARITY_CONTRACTS = {
    'osmo_health': _ParityContract(
        _NO_CLI_EQUIVALENT,
        rationale='The CLI has no caller-bound API health command.',
    ),
    'osmo_get_profile': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo profile list --format-type json',
    ),
    'osmo_set_profile': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo profile set <setting> <value>',
    ),
    'osmo_search_pools': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo pool list --format-type json',
    ),
    'osmo_list_resources': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo resource list --format-type json',
    ),
    'osmo_get_resource': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo resource info <node> --pool <pool> --platform <platform>',
        (
            'MCP requires explicit pool/platform selection when a node has '
            'multiple accessible assignments and omits resource kinds without '
            'positive allocatable capacity; CLI selects the first assignment '
            'and may render explicit zero capacity.'
        ),
    ),
    'osmo_list_workflows': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo workflow list --format-type json',
    ),
    'osmo_list_tasks': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo task list --node <node> --format-type json',
    ),
    'osmo_get_workflow': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo workflow query <workflow-id> --format-type json',
    ),
    'osmo_get_workflow_logs': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo workflow logs <workflow-id>',
    ),
    'osmo_get_workflow_events': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo workflow events <workflow-id>',
    ),
    'osmo_get_workflow_spec': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo workflow spec <workflow-id>',
    ),
    'osmo_submit_workflow': _ParityContract(
        _INTENTIONAL_DIFFERENCE,
        'osmo workflow submit <workflow-file>',
        (
            'MCP accepts bounded inline YAML while sharing per-run label '
            'overrides and policy-warning results with the CLI.'
        ),
    ),
    'osmo_validate_workflow': _ParityContract(
        _INTENTIONAL_DIFFERENCE,
        'osmo workflow validate <workflow-file>',
        (
            'MCP accepts bounded inline YAML instead of a local file while '
            'sharing label overrides and policy-warning results.'
        ),
    ),
    'osmo_restart_workflow': _ParityContract(
        _SHARED_REQUEST,
        'osmo workflow restart <workflow-id>',
        evidence=(
            'test_workflow.WorkflowRestartTest.'
            'test_uses_source_workflow_pool_when_pool_is_omitted '
            'and test_workflow_actions.test_restart_preflights_source_and_uses_its_pool'
        ),
    ),
    'osmo_cancel_workflow': _ParityContract(
        _INTENTIONAL_DIFFERENCE,
        'osmo workflow cancel <workflow-id>',
        'MCP deliberately omits the CLI free-form cancellation message.',
    ),
    'osmo_list_apps': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo app list --format-type json',
    ),
    'osmo_get_app': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo app info <app-id> --format-type json',
    ),
    'osmo_get_app_spec': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo app spec <app-id>',
    ),
    'osmo_create_app': _ParityContract(
        _INTENTIONAL_DIFFERENCE,
        'osmo app create <name> --description <description> --file <workflow-file>',
        'MCP accepts bounded inline YAML instead of a local file.',
    ),
    'osmo_update_app': _ParityContract(
        _INTENTIONAL_DIFFERENCE,
        'osmo app update <app-id> --file <workflow-file>',
        'MCP always creates a version and has no local editor flow.',
    ),
    'osmo_delete_app': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo app delete <app-id>',
    ),
    'osmo_rename_app': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo app rename <app-id> <new-name>',
    ),
    'osmo_submit_app': _ParityContract(
        _INTENTIONAL_DIFFERENCE,
        'osmo app submit <app-id>',
        (
            'MCP resolves and returns the concrete READY version it submits '
            'while sharing label overrides and policy-warning results.'
        ),
    ),
    'osmo_list_credentials': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo credential --format-type json list',
    ),
    'osmo_delete_credential': _ParityContract(
        _SEMANTIC_PROJECTION,
        'osmo credential delete <name>',
    ),
}


def _assert_complete_parity_contract(
    catalog_names: set[str],
    contracts: dict[str, _ParityContract],
) -> None:
    if set(contracts) != catalog_names:
        raise AssertionError(
            'Every MCP tool must have exactly one CLI parity classification.'
        )
    for contract in contracts.values():
        if contract.classification not in _CLASSIFICATIONS:
            raise AssertionError('Unknown CLI parity classification.')
        if contract.classification == _NO_CLI_EQUIVALENT:
            if contract.cli_command is not None or not contract.rationale:
                raise AssertionError(
                    'A tool without a CLI equivalent needs a rationale only.'
                )
        elif not contract.cli_command:
            raise AssertionError('CLI-equivalent tools need a CLI command.')
        if (
            contract.classification == _SHARED_REQUEST
            and not contract.evidence
        ):
            raise AssertionError(
                'Shared CLI request claims need executable test evidence.'
            )
        if (
            contract.classification == _INTENTIONAL_DIFFERENCE
            and not contract.rationale
        ):
            raise AssertionError(
                'Intentional CLI differences need a rationale.'
            )


class ToolParityManifestTest(unittest.TestCase):
    """Require an explicit CLI relationship for every external MCP tool."""

    def test_manifest_exactly_covers_the_tool_catalog(self) -> None:
        catalog_names = {spec.name for spec in tool_registry.TOOL_SPECS}

        self.assertEqual(len(catalog_names), 26)
        _assert_complete_parity_contract(
            catalog_names,
            _PARITY_CONTRACTS,
        )

    def test_missing_catalog_entry_is_rejected(self) -> None:
        catalog_names = {spec.name for spec in tool_registry.TOOL_SPECS}
        incomplete_contracts = dict(_PARITY_CONTRACTS)
        incomplete_contracts.pop('osmo_get_profile')

        with self.assertRaisesRegex(
            AssertionError,
            'Every MCP tool must have exactly one CLI parity classification',
        ):
            _assert_complete_parity_contract(
                catalog_names,
                incomplete_contracts,
            )

    def test_shared_request_without_evidence_is_rejected(self) -> None:
        catalog_names = {spec.name for spec in tool_registry.TOOL_SPECS}
        unsupported_contracts = dict(_PARITY_CONTRACTS)
        unsupported_contracts['osmo_restart_workflow'] = dataclasses.replace(
            unsupported_contracts['osmo_restart_workflow'],
            evidence=None,
        )

        with self.assertRaisesRegex(
            AssertionError,
            'Shared CLI request claims need executable test evidence',
        ):
            _assert_complete_parity_contract(
                catalog_names,
                unsupported_contracts,
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
