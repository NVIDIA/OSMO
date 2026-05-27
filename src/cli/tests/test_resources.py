# pylint: disable=line-too-long
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
import json
import unittest
from unittest import mock

from src.cli import resources
from src.lib.utils import client, osmo_errors


def _capture(mock_print) -> str:
    """Join all mock_print positional args into a single string."""
    return ' '.join(str(arg) for call in mock_print.call_args_list for arg in call.args)


def _make_resource(
        pool_name: str = 'pool-1',
        platform_name: str = 'platform-1',
        node: str = 'node-1') -> dict:
    """Build a minimal resource dict that the cluster/info handlers can consume."""
    return {
        'resource_type': 'GPU',
        'allocatable_fields': {
            'cpu': '8', 'gpu': '2', 'storage': '100Gi', 'memory': '32Gi',
        },
        'usage_fields': {
            'cpu': '4', 'gpu': '1', 'storage': '50Gi', 'memory': '16Gi',
        },
        'platform_allocatable_fields': {
            pool_name: {
                platform_name: {
                    'cpu': '8', 'gpu': '2',
                    'storage': '100Gi', 'memory': '32Gi',
                }
            }
        },
        'exposed_fields': {
            'pool/platform': [f'{pool_name}/{platform_name}'],
            'node': node,
            'storage': '100Gi',
            'cpu': '8',
            'memory': '32Gi',
            'gpu': '2',
        },
        'pool_platform_labels': {pool_name: [platform_name]},
        'config_fields': {
            pool_name: {
                platform_name: {
                    'host_network': True,
                    'privileged': False,
                    'default_mounts': ['/data'],
                    'allowed_mounts': ['/data', '/scratch'],
                }
            }
        },
    }


class TestSetupParser(unittest.TestCase):
    """Test cases for setup_parser argparse wiring."""

    def _build_parser(self) -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        resources.setup_parser(subparsers)
        return parser

    def test_list_defaults(self):
        parser = self._build_parser()
        args = parser.parse_args(['resource', 'list'])
        self.assertEqual(args.command, 'list')
        self.assertEqual(args.pool, [])
        self.assertEqual(args.platform, [])
        self.assertFalse(args.all)
        self.assertEqual(args.format_type, 'text')
        self.assertEqual(args.mode, 'used')

    def test_list_with_pool_and_platform(self):
        parser = self._build_parser()
        args = parser.parse_args(
            ['resource', 'list', '--pool', 'p1', 'p2', '--platform', 'plat1'])
        self.assertEqual(args.pool, ['p1', 'p2'])
        self.assertEqual(args.platform, ['plat1'])

    def test_list_with_all_flag(self):
        parser = self._build_parser()
        args = parser.parse_args(['resource', 'list', '--all'])
        self.assertTrue(args.all)

    def test_list_with_format_and_mode_flags(self):
        parser = self._build_parser()
        args = parser.parse_args(
            ['resource', 'list', '-t', 'json', '-m', 'free'])
        self.assertEqual(args.format_type, 'json')
        self.assertEqual(args.mode, 'free')

    def test_info_defaults(self):
        parser = self._build_parser()
        args = parser.parse_args(['resource', 'info', 'node-1'])
        self.assertEqual(args.command, 'info')
        self.assertEqual(args.node_name, 'node-1')
        self.assertIsNone(args.pool)
        self.assertIsNone(args.platform)

    def test_info_with_pool_and_platform(self):
        parser = self._build_parser()
        args = parser.parse_args(
            ['resource', 'info', 'node-1', '-p', 'pool-1', '-pl', 'plat-1'])
        self.assertEqual(args.pool, 'pool-1')
        self.assertEqual(args.platform, 'plat-1')


class TestRoundResources(unittest.TestCase):
    """Test cases for round_resources (ceil request, floor allocatable, clamp)."""

    def test_request_below_allocatable_ceil_request_floor_allocatable(self):
        final_total_request, rounded_allocatable = resources.round_resources(0.5, 100.7)
        self.assertEqual(final_total_request, 1)
        self.assertEqual(rounded_allocatable, 100)

    def test_request_exceeds_allocatable_clamps_to_allocatable(self):
        # ceil(110.7) = 111, floor(99.3) = 99, min(111, 99) = 99 — numerator
        # must never exceed denominator.
        final_total_request, rounded_allocatable = resources.round_resources(110.7, 99.3)
        self.assertEqual(final_total_request, 99)
        self.assertEqual(rounded_allocatable, 99)

    def test_zero_inputs(self):
        final_total_request, rounded_allocatable = resources.round_resources(0.0, 0.0)
        self.assertEqual(final_total_request, 0)
        self.assertEqual(rounded_allocatable, 0)

    def test_integer_values_unchanged(self):
        final_total_request, rounded_allocatable = resources.round_resources(5.0, 10.0)
        self.assertEqual(final_total_request, 5)
        self.assertEqual(rounded_allocatable, 10)

    def test_request_exactly_one_more_than_allocatable_after_rounding(self):
        # ceil(2.1) = 3, floor(2.9) = 2 — request would exceed allocatable
        # so the helper must clamp it to 2.
        final_total_request, rounded_allocatable = resources.round_resources(2.1, 2.9)
        self.assertEqual(final_total_request, 2)
        self.assertEqual(rounded_allocatable, 2)


class TestFetchResources(unittest.TestCase):
    """Test cases for fetch_resources HTTP wrapper."""

    def test_fetch_resources_basic_pools(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'resources': []}
        result = resources.fetch_resources(service_client, ['pool-1'])
        service_client.request.assert_called_once_with(
            client.RequestMethod.GET,
            'api/resources',
            params={'pools': ['pool-1'], 'all_pools': False})
        self.assertEqual(result, {'resources': []})

    def test_fetch_resources_with_platform(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'resources': []}
        resources.fetch_resources(
            service_client, ['pool-1'], platform=['plat-1'], all_pools=False)
        params = service_client.request.call_args[1]['params']
        self.assertEqual(params['pools'], ['pool-1'])
        self.assertEqual(params['platforms'], ['plat-1'])
        self.assertFalse(params['all_pools'])

    def test_fetch_resources_all_pools(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'resources': []}
        resources.fetch_resources(service_client, [], all_pools=True)
        params = service_client.request.call_args[1]['params']
        self.assertTrue(params['all_pools'])
        self.assertNotIn('platforms', params)

    def test_fetch_resources_empty_platform_list_omitted(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'resources': []}
        resources.fetch_resources(service_client, ['pool-1'], platform=[])
        params = service_client.request.call_args[1]['params']
        self.assertNotIn('platforms', params)


class TestClusterResources(unittest.TestCase):
    """Test cases for _cluster_resources."""

    def _make_args(self, **overrides) -> argparse.Namespace:
        defaults: dict = {
            'pool': ['pool-1'],
            'platform': [],
            'all': False,
            'format_type': 'text',
            'mode': 'used',
        }
        defaults.update(overrides)
        return argparse.Namespace(**defaults)

    def test_invalid_pool_raises_user_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._make_args(pool=['unknown-pool'])
        with mock.patch('src.cli.resources.pool.list_pools',
                        return_value={'pools': {'pool-1': {}}}):
            with self.assertRaises(osmo_errors.OSMOUserError) as cm:
                resources._cluster_resources(service_client, args)
        self.assertIn('unknown-pool', str(cm.exception))

    def test_no_pool_uses_default_pool(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._make_args(pool=[])
        with mock.patch('src.cli.resources.pool.fetch_default_pool',
                        return_value='default-pool') as default_mock, \
             mock.patch('src.cli.resources.pool.list_pools',
                        return_value={'pools': {'default-pool': {}}}), \
             mock.patch('src.cli.resources.fetch_resources',
                        return_value={'resources': []}), \
             mock.patch('builtins.print'):
            resources._cluster_resources(service_client, args)
        default_mock.assert_called_once_with(service_client)
        self.assertEqual(args.pool, ['default-pool'])

    def test_json_format_prints_full_response(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._make_args(format_type='json')
        response = {'resources': [{'a': 1}]}
        with mock.patch('src.cli.resources.pool.list_pools',
                        return_value={'pools': {'pool-1': {}}}), \
             mock.patch('src.cli.resources.fetch_resources',
                        return_value=response), \
             mock.patch('builtins.print') as mock_print:
            resources._cluster_resources(service_client, args)
        mock_print.assert_called_once()
        parsed = json.loads(mock_print.call_args[0][0])
        self.assertEqual(parsed, response)

    def test_no_resources_in_response_prints_empty_message(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._make_args()
        with mock.patch('src.cli.resources.pool.list_pools',
                        return_value={'pools': {'pool-1': {}}}), \
             mock.patch('src.cli.resources.fetch_resources',
                        return_value={'resources': []}), \
             mock.patch('builtins.print') as mock_print:
            resources._cluster_resources(service_client, args)
        output = _capture(mock_print)
        self.assertIn('no available resources', output)

    def test_response_missing_resources_key_prints_empty_message(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._make_args()
        with mock.patch('src.cli.resources.pool.list_pools',
                        return_value={'pools': {'pool-1': {}}}), \
             mock.patch('src.cli.resources.fetch_resources',
                        return_value={}), \
             mock.patch('builtins.print') as mock_print:
            resources._cluster_resources(service_client, args)
        output = _capture(mock_print)
        self.assertIn('no available resources', output)

    def test_used_mode_renders_used_over_total(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._make_args(mode='used')
        with mock.patch('src.cli.resources.pool.list_pools',
                        return_value={'pools': {'pool-1': {}}}), \
             mock.patch('src.cli.resources.fetch_resources',
                        return_value={'resources': [_make_resource()]}), \
             mock.patch('builtins.print') as mock_print:
            resources._cluster_resources(service_client, args)
        output = _capture(mock_print)
        self.assertIn('node-1', output)
        self.assertIn('pool-1', output)
        self.assertIn('platform-1', output)
        # used mode renders "used/total" format — cpu has usage=4 alloc=8
        self.assertIn('4/8', output)

    def test_free_mode_renders_available_only(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._make_args(mode='free')
        with mock.patch('src.cli.resources.pool.list_pools',
                        return_value={'pools': {'pool-1': {}}}), \
             mock.patch('src.cli.resources.fetch_resources',
                        return_value={'resources': [_make_resource()]}), \
             mock.patch('builtins.print') as mock_print:
            resources._cluster_resources(service_client, args)
        output = _capture(mock_print)
        # free mode: cpu free = 8 - 4 = 4 — must not contain "/" pair from used mode
        self.assertIn('node-1', output)
        self.assertNotIn('4/8', output)

    def test_malformed_resource_prints_warning(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._make_args()
        # A resource missing 'exposed_fields' should trigger the malformed warning,
        # but the handler still requires at least one well-formed resource to render.
        well_formed = _make_resource()
        malformed = {'resource_type': 'GPU'}
        with mock.patch('src.cli.resources.pool.list_pools',
                        return_value={'pools': {'pool-1': {}}}), \
             mock.patch('src.cli.resources.fetch_resources',
                        return_value={'resources': [well_formed, malformed]}), \
             mock.patch('builtins.print') as mock_print:
            with self.assertRaises(KeyError):
                resources._cluster_resources(service_client, args)
        output = _capture(mock_print)
        self.assertIn('malformed', output)


class TestInfoResource(unittest.TestCase):
    """Test cases for _info_resource."""

    def _make_args(self, **overrides) -> argparse.Namespace:
        defaults: dict = {
            'node_name': 'node-1',
            'pool': None,
            'platform': None,
        }
        defaults.update(overrides)
        return argparse.Namespace(**defaults)

    def test_pool_without_platform_prints_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._make_args(pool='pool-1', platform=None)
        with mock.patch('builtins.print') as mock_print:
            resources._info_resource(service_client, args)
        output = _capture(mock_print)
        self.assertIn('Pool and platform must be specified', output)
        service_client.request.assert_not_called()

    def test_platform_without_pool_prints_error(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._make_args(pool=None, platform='plat-1')
        with mock.patch('builtins.print') as mock_print:
            resources._info_resource(service_client, args)
        output = _capture(mock_print)
        self.assertIn('Pool and platform must be specified', output)
        service_client.request.assert_not_called()

    def test_resource_not_found_prints_message(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'resources': []}
        args = self._make_args()
        with mock.patch('builtins.print') as mock_print:
            resources._info_resource(service_client, args)
        output = _capture(mock_print)
        self.assertIn('node-1 is not a resource', output)

    def test_response_missing_resources_key_prints_not_a_resource(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {}
        args = self._make_args()
        with mock.patch('builtins.print') as mock_print:
            resources._info_resource(service_client, args)
        output = _capture(mock_print)
        self.assertIn('not a resource', output)

    def test_auto_selects_first_pool_platform_when_unspecified(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'resources': [_make_resource()]}
        args = self._make_args()
        with mock.patch('builtins.print') as mock_print:
            resources._info_resource(service_client, args)
        output = _capture(mock_print)
        self.assertIn('node-1', output)
        self.assertIn('pool-1', output)
        self.assertIn('platform-1', output)
        self.assertIn('Resource Capacity', output)

    def test_invalid_pool_prints_keyerror_message(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'resources': [_make_resource()]}
        args = self._make_args(pool='wrong-pool', platform='wrong-platform')
        with mock.patch('builtins.print') as mock_print:
            resources._info_resource(service_client, args)
        output = _capture(mock_print)
        self.assertIn('not in pool wrong-pool', output)
        self.assertIn('wrong-platform', output)

    def test_specified_pool_platform_renders_capacity(self):
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'resources': [_make_resource()]}
        args = self._make_args(pool='pool-1', platform='platform-1')
        with mock.patch('builtins.print') as mock_print:
            resources._info_resource(service_client, args)
        output = _capture(mock_print)
        # Storage allocatable is 100Gi → unit "Gi" appended to capacity
        self.assertIn('100Gi', output)
        # CPU has no unit
        self.assertIn('cpu: 8', output)
        self.assertIn('Default Mounts', output)
        self.assertIn('/data', output)


if __name__ == '__main__':
    unittest.main()
