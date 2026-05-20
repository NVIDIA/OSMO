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

import unittest
from unittest import mock

from src.cli import pool
from src.lib.utils import osmo_errors


class TestFetchDefaultPool(unittest.TestCase):
    """fetch_default_pool: profile default wins; otherwise auto-pick the only pool."""

    def _client_with(self, profile_pool, pools_response=None, pools_raises=None):
        client = mock.MagicMock()

        def request(_method, path, *_args, **_kwargs):
            if path == 'api/profile/settings':
                return {'profile': {'pool': profile_pool}}
            if path == '/api/pool':
                if pools_raises is not None:
                    raise pools_raises
                return pools_response
            raise AssertionError(f'unexpected path {path}')

        client.request.side_effect = request
        return client

    def test_profile_default_wins(self):
        client = self._client_with(profile_pool='my-pool')
        self.assertEqual(pool.fetch_default_pool(client), 'my-pool')

    def test_auto_pick_single_pool(self):
        client = self._client_with(
            profile_pool=None,
            pools_response={'node_sets': [{'pools': [{'name': 'only-pool'}]}]})
        self.assertEqual(pool.fetch_default_pool(client), 'only-pool')

    def test_auto_pick_dedupes_across_nodesets(self):
        client = self._client_with(
            profile_pool=None,
            pools_response={'node_sets': [
                {'pools': [{'name': 'shared'}]},
                {'pools': [{'name': 'shared'}]},
            ]})
        self.assertEqual(pool.fetch_default_pool(client), 'shared')

    def test_multiple_pools_raises(self):
        client = self._client_with(
            profile_pool=None,
            pools_response={'node_sets': [
                {'pools': [{'name': 'one'}, {'name': 'two'}]},
            ]})
        with self.assertRaises(osmo_errors.OSMOUserError):
            pool.fetch_default_pool(client)

    def test_no_pools_raises(self):
        client = self._client_with(
            profile_pool=None,
            pools_response={'node_sets': []})
        with self.assertRaises(osmo_errors.OSMOUserError):
            pool.fetch_default_pool(client)

    def test_list_pools_failure_preserves_user_error(self):
        client = self._client_with(
            profile_pool=None,
            pools_raises=RuntimeError('transport blew up'))
        with self.assertRaises(osmo_errors.OSMOUserError):
            pool.fetch_default_pool(client)


if __name__ == '__main__':
    unittest.main()
