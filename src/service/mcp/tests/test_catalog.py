"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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

from collections.abc import Callable, Mapping
from unittest import mock
import unittest

from src.service.mcp import (
    app_actions,
    app_submission,
    apps,
    credential_actions,
    credentials,
    health,
    pools,
    profile,
    protocol,
    resources,
    tool_registry,
    workflow_actions,
    workflows,
)


_ExpectedSpec = tuple[Callable[..., object], str, str, str]

_EXPECTED_SPECS: tuple[_ExpectedSpec, ...] = (
    (
        health.osmo_health,
        'osmo_health',
        'Check OSMO health',
        'Verify caller-bound Gateway authentication and OSMO API access. '
        'This is separate from the MCP process health endpoints.',
    ),
    (
        profile.osmo_get_profile,
        'osmo_get_profile',
        'Get OSMO profile',
        'Get the active user\'s OSMO profile settings, roles, accessible '
        'pools, and non-secret token identity metadata.',
    ),
    (
        profile.osmo_set_profile,
        'osmo_set_profile',
        'Update OSMO profile',
        'Update the active user\'s default pool or notification settings. '
        'This overwrites saved profile state and is not automatically retried.',
    ),
    (
        pools.osmo_search_pools,
        'osmo_search_pools',
        'Search OSMO pools',
        'Search compute pools accessible to the active user. Results retain '
        'node-set sharing information, GPU quota usage, and bounded output.',
    ),
    (
        resources.osmo_list_resources,
        'osmo_list_resources',
        'List OSMO resources',
        'List node capacity, usage, and available resources for selected '
        'pools and platforms with bounded output.',
    ),
    (
        resources.osmo_get_resource,
        'osmo_get_resource',
        'Get OSMO resource',
        'Get one node\'s resource quantities and task configuration for a '
        'selected pool/platform assignment.',
    ),
    (
        workflows.osmo_list_workflows,
        'osmo_list_workflows',
        'List OSMO workflows',
        'List the active user\'s workflows across accessible pools, newest first.',
    ),
    (
        workflows.osmo_get_workflow,
        'osmo_get_workflow',
        'Get OSMO workflow',
        'Get one workflow\'s status and optional task-group metadata; '
        'set skip_groups=true for a compact result.',
    ),
    (
        workflows.osmo_get_workflow_logs,
        'osmo_get_workflow_logs',
        'Get OSMO workflow logs',
        'Get bounded workflow or task logs; set last_n_lines for an explicit '
        'tail and select error logs explicitly.',
    ),
    (
        workflows.osmo_get_workflow_events,
        'osmo_get_workflow_events',
        'Get OSMO workflow events',
        'Get bounded scheduling and lifecycle events; use the logs tool for output.',
    ),
    (
        workflows.osmo_get_workflow_spec,
        'osmo_get_workflow_spec',
        'Get OSMO workflow spec',
        'Get the bounded, server-redacted resolved or template workflow YAML.',
    ),
    (
        workflow_actions.osmo_submit_workflow,
        'osmo_submit_workflow',
        'Submit an OSMO workflow',
        'Submit raw workflow YAML to run in OSMO. This consumes real '
        'compute and is not automatically retried.',
    ),
    (
        workflow_actions.osmo_validate_workflow,
        'osmo_validate_workflow',
        'Validate an OSMO workflow',
        'Validate workflow YAML with OSMO Core without submitting it. '
        'A failed validation may create a FAILED_SUBMISSION record.',
    ),
    (
        workflow_actions.osmo_restart_workflow,
        'osmo_restart_workflow',
        'Restart an OSMO workflow',
        'Restart one failed workflow as a new run. This consumes real '
        'compute and requires source-workflow read access.',
    ),
    (
        workflow_actions.osmo_cancel_workflow,
        'osmo_cancel_workflow',
        'Cancel an OSMO workflow',
        'Request cancellation of one workflow; force cancellation is '
        'destructive and not reversible.',
    ),
    (
        apps.osmo_list_apps,
        'osmo_list_apps',
        'List OSMO apps',
        'List a bounded page of OSMO apps newest first. By default, '
        'results are scoped to apps associated with the active user.',
    ),
    (
        apps.osmo_get_app,
        'osmo_get_app',
        'Get OSMO app',
        'Get stable metadata and newest-first version information for '
        'one OSMO app.',
    ),
    (
        apps.osmo_get_app_spec,
        'osmo_get_app_spec',
        'Get OSMO app spec',
        'Get the bounded plain-text workflow spec for one OSMO app. '
        'When version is omitted, resolve the newest READY version from '
        'bounded version history.',
    ),
    (
        app_actions.osmo_create_app,
        'osmo_create_app',
        'Create OSMO app',
        'Create an app from bounded inline workflow YAML and schedule '
        'version 1 for upload. The non-secret description is sent as a '
        'query parameter and may appear in Gateway logs.',
    ),
    (
        app_actions.osmo_update_app,
        'osmo_update_app',
        'Update OSMO app',
        'Always create and schedule upload of a new app version from bounded '
        'inline workflow YAML; unlike the CLI editor flow, this tool does not '
        'skip unchanged content.',
    ),
    (
        app_actions.osmo_delete_app,
        'osmo_delete_app',
        'Delete OSMO app',
        'Schedule deletion of one version or all non-deleted versions. '
        'Specify exactly one of version or all_versions=true.',
    ),
    (
        app_actions.osmo_rename_app,
        'osmo_rename_app',
        'Rename OSMO app',
        'Synchronously rename one active-user-owned app. This changes the '
        'app identifier and is not automatically retried.',
    ),
    (
        app_submission.osmo_submit_app,
        'osmo_submit_app',
        'Submit OSMO app',
        'Resolve and pin a READY app version, then submit it to run in '
        'OSMO. This consumes real compute and is not automatically retried.',
    ),
    (
        credentials.osmo_list_credentials,
        'osmo_list_credentials',
        'List OSMO credentials',
        'List only the active user\'s credential names and types. '
        'Profiles and credential payloads are never returned.',
    ),
    (
        credential_actions.osmo_delete_credential,
        'osmo_delete_credential',
        'Delete OSMO credential',
        'Delete one active-user credential without returning its payload '
        'or legacy profile value.',
    ),
)

_EXPECTED_REQUIRED_FIELDS = {
    'osmo_health': [],
    'osmo_get_profile': [],
    'osmo_set_profile': ['setting', 'value'],
    'osmo_search_pools': [],
    'osmo_list_resources': [],
    'osmo_get_resource': ['node_name'],
    'osmo_list_workflows': [],
    'osmo_get_workflow': ['workflow_id'],
    'osmo_get_workflow_logs': ['workflow_id'],
    'osmo_get_workflow_events': ['workflow_id'],
    'osmo_get_workflow_spec': ['workflow_id'],
    'osmo_submit_workflow': ['workflow_spec'],
    'osmo_validate_workflow': ['workflow_spec'],
    'osmo_restart_workflow': ['workflow_id'],
    'osmo_cancel_workflow': ['workflow_id'],
    'osmo_list_apps': [],
    'osmo_get_app': ['name'],
    'osmo_get_app_spec': ['name'],
    'osmo_create_app': ['name', 'description', 'spec_content'],
    'osmo_update_app': ['name', 'spec_content'],
    'osmo_delete_app': ['name'],
    'osmo_rename_app': ['original_name', 'new_name'],
    'osmo_submit_app': ['name'],
    'osmo_list_credentials': [],
    'osmo_delete_credential': ['name'],
}

_EXPECTED_DEFAULTS: dict[str, dict[str, object]] = {
    'osmo_set_profile': {'enabled': None},
    'osmo_search_pools': {'query': None, 'limit': 50, 'offset': 0},
    'osmo_list_resources': {
        'pool': None,
        'platform': None,
        'all_pools': False,
        'limit': 50,
        'offset': 0,
    },
    'osmo_get_resource': {'pool': None, 'platform': None},
    'osmo_list_workflows': {
        'status': None,
        'name': None,
        'pool': None,
        'tags': None,
        'app': None,
        'priority': None,
        'limit': 50,
        'offset': 0,
    },
    'osmo_get_workflow': {'verbose': False, 'skip_groups': False},
    'osmo_get_workflow_logs': {
        'task_name': None,
        'retry_id': None,
        'last_n_lines': None,
        'error_logs': False,
    },
    'osmo_get_workflow_events': {'task_name': None, 'retry_id': None},
    'osmo_get_workflow_spec': {'use_template': False},
    'osmo_submit_workflow': {
        'pool': None,
        'set_variables': None,
        'set_string_variables': None,
        'priority': 'NORMAL',
    },
    'osmo_validate_workflow': {
        'pool': None,
        'set_variables': None,
        'set_string_variables': None,
    },
    'osmo_restart_workflow': {'pool': None},
    'osmo_cancel_workflow': {'force': False},
    'osmo_list_apps': {
        'name': None,
        'users': None,
        'all_users': False,
        'limit': 50,
        'offset': 0,
    },
    'osmo_get_app': {'version': None, 'limit': 50},
    'osmo_get_app_spec': {'version': None},
    'osmo_delete_app': {'version': None, 'all_versions': False},
    'osmo_submit_app': {
        'pool': None,
        'version': None,
        'set_variables': None,
        'set_string_variables': None,
        'priority': 'NORMAL',
    },
}

_WRITE_TOOL_NAMES = frozenset({
    'osmo_cancel_workflow',
    'osmo_create_app',
    'osmo_delete_app',
    'osmo_delete_credential',
    'osmo_rename_app',
    'osmo_restart_workflow',
    'osmo_set_profile',
    'osmo_submit_workflow',
    'osmo_submit_app',
    'osmo_update_app',
    'osmo_validate_workflow',
})
_DESTRUCTIVE_TOOL_NAMES = frozenset({
    'osmo_cancel_workflow',
    'osmo_delete_app',
    'osmo_delete_credential',
    'osmo_rename_app',
    'osmo_restart_workflow',
    'osmo_set_profile',
})
_IDEMPOTENT_WRITE_TOOL_NAMES = frozenset({
    'osmo_delete_credential',
    'osmo_set_profile',
})
_OPEN_WORLD_TOOL_NAMES: frozenset[str] = frozenset()


class ToolCatalogContractTest(unittest.IsolatedAsyncioTestCase):
    """Lock the ordered, agent-facing external MCP tool contract."""

    def test_registry_has_exact_metadata_and_direct_unique_functions(self) -> None:
        self.assertEqual(
            len(tool_registry.TOOL_SPECS),
            len(_EXPECTED_SPECS),
        )
        self.assertEqual(
            [
                (spec.name, spec.title, spec.description)
                for spec in tool_registry.TOOL_SPECS
            ],
            [
                (name, title, description)
                for _, name, title, description in _EXPECTED_SPECS
            ],
        )

        registered_functions = [
            spec.function for spec in tool_registry.TOOL_SPECS
        ]
        self.assertEqual(
            len({id(function) for function in registered_functions}),
            len(_EXPECTED_SPECS),
        )
        for spec, (function, _, _, _) in zip(
            tool_registry.TOOL_SPECS,
            _EXPECTED_SPECS,
            strict=True,
        ):
            self.assertIs(spec.function, function)

    def test_registration_preserves_metadata_and_annotations(self) -> None:
        mcp_server = mock.Mock()

        tool_registry.register_tools(mcp_server)

        self.assertEqual(
            mcp_server.add_tool.call_count,
            len(_EXPECTED_SPECS),
        )
        for call, (function, name, title, description) in zip(
            mcp_server.add_tool.call_args_list,
            _EXPECTED_SPECS,
            strict=True,
        ):
            self.assertIs(call.args[0], function)
            self.assertEqual(call.kwargs['name'], name)
            self.assertEqual(call.kwargs['title'], title)
            self.assertEqual(call.kwargs['description'], description)
            self.assertTrue(call.kwargs['structured_output'])
            annotations = call.kwargs['annotations']
            is_write = name in _WRITE_TOOL_NAMES
            is_destructive = name in _DESTRUCTIVE_TOOL_NAMES
            self.assertIs(annotations.readOnlyHint, not is_write)
            self.assertIs(annotations.destructiveHint, is_destructive)
            self.assertIs(
                annotations.idempotentHint,
                name in _IDEMPOTENT_WRITE_TOOL_NAMES or not is_write,
            )
            self.assertIs(
                annotations.openWorldHint,
                name in _OPEN_WORLD_TOOL_NAMES,
            )

    async def test_all_tools_have_closed_schemas_and_stable_arguments(self) -> None:
        mcp_server = protocol.OSMOFastMCP(
            name='OSMO MCP catalog contract test'
        )
        tool_registry.register_tools(mcp_server)

        tools = await mcp_server.list_tools()
        self.assertEqual(
            [tool.name for tool in tools],
            [name for _, name, _, _ in _EXPECTED_SPECS],
        )
        for tool in tools:
            self.assertIsNotNone(tool.annotations)
            assert tool.annotations is not None
            is_write = tool.name in _WRITE_TOOL_NAMES
            is_destructive = tool.name in _DESTRUCTIVE_TOOL_NAMES
            self.assertIs(tool.annotations.readOnlyHint, not is_write)
            self.assertIs(
                tool.annotations.destructiveHint,
                is_destructive,
            )
            self.assertIs(
                tool.annotations.idempotentHint,
                (
                    tool.name in _IDEMPOTENT_WRITE_TOOL_NAMES
                    or not is_write
                ),
            )
            self.assertIs(
                tool.annotations.openWorldHint,
                tool.name in _OPEN_WORLD_TOOL_NAMES,
            )
            self._assert_recursively_closed(tool.inputSchema, tool.name)
            self.assertIsNotNone(tool.outputSchema)
            assert tool.outputSchema is not None
            self._assert_recursively_closed(tool.outputSchema, tool.name)

            self.assertEqual(
                tool.inputSchema.get('required', []),
                _EXPECTED_REQUIRED_FIELDS[tool.name],
            )
            properties = tool.inputSchema['properties']
            for field, expected_default in _EXPECTED_DEFAULTS.get(
                tool.name,
                {},
            ).items():
                self.assertEqual(
                    properties[field].get('default'),
                    expected_default,
                    f'{tool.name}.{field} default changed',
                )

        tools_by_name = {tool.name: tool for tool in tools}
        for tool_name in (
            'osmo_search_pools',
            'osmo_list_resources',
            'osmo_list_workflows',
            'osmo_list_apps',
        ):
            properties = tools_by_name[tool_name].inputSchema['properties']
            self.assertEqual(properties['limit']['minimum'], 1)
            self.assertEqual(properties['limit']['maximum'], 200)
            self.assertEqual(properties['offset']['minimum'], 0)

        log_properties = tools_by_name[
            'osmo_get_workflow_logs'
        ].inputSchema['properties']
        self.assertEqual(log_properties['last_n_lines']['anyOf'][0]['minimum'], 1)
        self.assertEqual(
            log_properties['last_n_lines']['anyOf'][0]['maximum'],
            10_000,
        )
        self.assertEqual(log_properties['retry_id']['anyOf'][0]['minimum'], 0)

    async def test_selection_retains_canonical_order(self) -> None:
        selected_names = {
            'osmo_get_app_spec',
            'osmo_health',
            'osmo_get_resource',
        }
        selected_specs = tool_registry.select_tool_specs(selected_names)
        self.assertEqual(
            [spec.name for spec in selected_specs],
            [
                'osmo_health',
                'osmo_get_resource',
                'osmo_get_app_spec',
            ],
        )

        mcp_server = protocol.OSMOFastMCP(
            name='OSMO MCP selected catalog test'
        )
        tool_registry.register_tools(mcp_server, names=selected_names)
        self.assertEqual(
            [tool.name for tool in await mcp_server.list_tools()],
            [
                'osmo_health',
                'osmo_get_resource',
                'osmo_get_app_spec',
            ],
        )

    def test_unknown_selection_is_rejected_before_registration(self) -> None:
        mcp_server = mock.Mock()

        with self.assertRaisesRegex(
            ValueError,
            r'^Unknown OSMO MCP tool name\(s\): osmo_unknown\.$',
        ):
            tool_registry.register_tools(
                mcp_server,
                names={'osmo_unknown'},
            )

        mcp_server.add_tool.assert_not_called()

    def _assert_recursively_closed(
        self,
        schema: object,
        path: str,
    ) -> None:
        if isinstance(schema, Mapping):
            if schema.get('type') == 'object':
                additional_properties = schema.get('additionalProperties')
                if 'properties' in schema:
                    self.assertIs(
                        additional_properties,
                        False,
                        f'{path} permits undeclared object properties',
                    )
                else:
                    self.assertIsInstance(
                        additional_properties,
                        Mapping,
                        f'{path} contains an untyped open object',
                    )
            for key, value in schema.items():
                self._assert_recursively_closed(value, f'{path}.{key}')
        elif isinstance(schema, list):
            for index, value in enumerate(schema):
                self._assert_recursively_closed(value, f'{path}[{index}]')


if __name__ == '__main__':
    unittest.main()
