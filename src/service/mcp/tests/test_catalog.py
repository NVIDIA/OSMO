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
    health,
    pools,
    profile,
    protocol,
    resources,
    tool_registry,
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
)

_EXPECTED_REQUIRED_FIELDS: dict[str, list[str]] = {
    'osmo_health': [],
    'osmo_get_profile': [],
    'osmo_search_pools': [],
    'osmo_list_resources': [],
    'osmo_get_resource': ['node_name'],
}

_EXPECTED_DEFAULTS: dict[str, dict[str, object]] = {
    'osmo_search_pools': {'query': None, 'limit': 50, 'offset': 0},
    'osmo_list_resources': {
        'pool': None,
        'platform': None,
        'all_pools': False,
        'limit': 50,
        'offset': 0,
    },
    'osmo_get_resource': {'pool': None, 'platform': None},
}


class ToolCatalogContractTest(unittest.IsolatedAsyncioTestCase):
    """Lock the ordered, agent-facing external MCP tool contract."""

    def test_registry_has_exact_metadata_and_direct_unique_functions(self) -> None:
        self.assertEqual(len(tool_registry.TOOL_SPECS), 5)
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
        self.assertEqual(len({id(function) for function in registered_functions}), 5)
        for spec, (function, _, _, _) in zip(
            tool_registry.TOOL_SPECS,
            _EXPECTED_SPECS,
            strict=True,
        ):
            self.assertIs(spec.function, function)

    def test_registration_preserves_metadata_and_read_only_contract(self) -> None:
        mcp_server = mock.Mock()

        tool_registry.register_tools(mcp_server)

        self.assertEqual(mcp_server.add_tool.call_count, 5)
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
            self.assertTrue(annotations.readOnlyHint)
            self.assertFalse(annotations.destructiveHint)
            self.assertTrue(annotations.idempotentHint)
            self.assertFalse(annotations.openWorldHint)

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
            self.assertTrue(tool.annotations.readOnlyHint)
            self.assertFalse(tool.annotations.destructiveHint)
            self.assertTrue(tool.annotations.idempotentHint)
            self.assertFalse(tool.annotations.openWorldHint)
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
        ):
            properties = tools_by_name[tool_name].inputSchema['properties']
            self.assertEqual(properties['limit']['minimum'], 1)
            self.assertEqual(properties['limit']['maximum'], 200)
            self.assertEqual(properties['offset']['minimum'], 0)

    async def test_selection_retains_canonical_order(self) -> None:
        selected_names = {
            'osmo_health',
            'osmo_get_resource',
        }
        selected_specs = tool_registry.select_tool_specs(selected_names)
        self.assertEqual(
            [spec.name for spec in selected_specs],
            [
                'osmo_health',
                'osmo_get_resource',
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
