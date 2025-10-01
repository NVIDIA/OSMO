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

import datetime
import unittest

from src.lib.utils import config_history
from src.service.core.config import config_history_helpers, objects
from src.utils.connectors.postgres import ListOrder


config_types = list(config_history.ConfigHistoryType)
lowercase_config_types = [type.value.lower() for type in config_types]
base_time = datetime.datetime(2024, 1, 1, 12, 0, 0)


class TestConfigHistoryQueryBuilder(unittest.TestCase):
    """Test suite for config history query builder."""

    def test_basic_query_construction(self):
        """Test basic query construction with minimal parameters."""
        query, params = config_history_helpers.build_get_configs_history_query(
            objects.ConfigHistoryQueryParams(
                offset=0,
                limit=10,
                order=ListOrder.DESC,
            )
        )

        expected_query = '''
        SELECT * FROM (
            SELECT config_type, name, revision, username, created_at, tags, description, data
            FROM config_history
            WHERE TRUE AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 10 OFFSET 0
        ) AS ch
        ORDER BY created_at DESC
        '''
        self.assertEqual(query.strip(), expected_query.strip())
        self.assertEqual(params, ())

    def test_config_types_filter(self):
        """Test query construction with config_types filter."""
        query, params = config_history_helpers.build_get_configs_history_query(
            objects.ConfigHistoryQueryParams(
                config_types=config_types,
            )
        )

        expected_query = '''
        SELECT * FROM (
            SELECT config_type, name, revision, username, created_at, tags, description, data
            FROM config_history
            WHERE config_type = ANY(%s) AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 20 OFFSET 0
        ) AS ch
        ORDER BY created_at ASC
        '''
        self.assertEqual(query.strip(), expected_query.strip())
        self.assertEqual(params, (lowercase_config_types,))

    def test_name_filter(self):
        """Test query construction with name filter."""
        name = 'test_name'
        query, params = config_history_helpers.build_get_configs_history_query(
            objects.ConfigHistoryQueryParams(
                name=name,
            )
        )

        expected_query = '''
        SELECT * FROM (
            SELECT config_type, name, revision, username, created_at, tags, description, data
            FROM config_history
            WHERE name = %s AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 20 OFFSET 0
        ) AS ch
        ORDER BY created_at ASC
        '''
        self.assertEqual(query.strip(), expected_query.strip())
        self.assertEqual(params, (name,))

    def test_revision_filter(self):
        """Test query construction with revision filter."""
        query, params = config_history_helpers.build_get_configs_history_query(
            objects.ConfigHistoryQueryParams(
                revision=5,
            )
        )

        expected_query = '''
        SELECT * FROM (
            SELECT config_type, name, revision, username, created_at, tags, description, data
            FROM config_history
            WHERE revision = %s AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 20 OFFSET 0
        ) AS ch
        ORDER BY created_at ASC
        '''
        self.assertEqual(query.strip(), expected_query.strip())
        self.assertEqual(params, (5,))

    def test_at_timestamp_filter(self):
        """Test query construction with at_timestamp filter using DISTINCT ON."""
        at_time = base_time

        query, params = config_history_helpers.build_get_configs_history_query(
            objects.ConfigHistoryQueryParams(
                at_timestamp=at_time,
            )
        )

        expected_query = '''
            SELECT * FROM (
                SELECT DISTINCT ON (config_type)
                    config_type, name, revision, username, created_at, tags, description, data
                FROM config_history
                WHERE created_at <= %s AND deleted_at IS NULL
                ORDER BY config_type, created_at DESC
            ) AS ch
            ORDER BY created_at ASC
        '''
        self.assertEqual(query.strip(), expected_query.strip())
        self.assertEqual(params, (at_time,))

    def test_at_timestamp_with_filters(self):
        """Test query construction with at_timestamp and additional filters."""
        at_time = base_time
        tags = ['tag1', 'tag2']

        query, params = config_history_helpers.build_get_configs_history_query(
            objects.ConfigHistoryQueryParams(
                offset=0,
                limit=10,
                order=ListOrder.DESC,
                config_types=[config_history.ConfigHistoryType.SERVICE],
                tags=tags,
                at_timestamp=at_time,
            )
        )

        expected_query = '''
            SELECT * FROM (
                SELECT DISTINCT ON (config_type)
                    config_type, name, revision, username, created_at, tags, description, data
                FROM config_history
                WHERE config_type = %s AND tags @> %s AND created_at <= %s AND deleted_at IS NULL
                ORDER BY config_type, created_at DESC
            ) AS ch
            ORDER BY created_at DESC
        '''
        self.assertEqual(query.strip(), expected_query.strip())
        self.assertEqual(
            params, (config_history.ConfigHistoryType.SERVICE.value.lower(), tags, at_time))

    def test_at_timestamp_with_multiple_config_types(self):
        """Test query construction with at_timestamp and multiple config types."""
        at_time = base_time
        # Use the first two config_types from the global list
        query, params = config_history_helpers.build_get_configs_history_query(
            objects.ConfigHistoryQueryParams(
                offset=0,
                limit=10,
                order=ListOrder.DESC,
                config_types=config_types[:2],
                at_timestamp=at_time,
            )
        )

        expected_query = '''
            SELECT * FROM (
                SELECT DISTINCT ON (config_type)
                    config_type, name, revision, username, created_at, tags, description, data
                FROM config_history
                WHERE config_type = ANY(%s) AND created_at <= %s AND deleted_at IS NULL
                ORDER BY config_type, created_at DESC
            ) AS ch
            ORDER BY created_at DESC
        '''
        self.assertEqual(query.strip(), expected_query.strip())
        self.assertEqual(params, (lowercase_config_types[:2], at_time))

    def test_combined_filters(self):
        """Test query construction with multiple filters combined."""
        query, params = config_history_helpers.build_get_configs_history_query(
            objects.ConfigHistoryQueryParams(
                offset=5,
                limit=20,
                order=ListOrder.DESC,
                config_types=config_types,
                name='test-name',
                revision=3,
                tags=['tag1'],
                created_before=base_time + datetime.timedelta(hours=1),
                created_after=base_time - datetime.timedelta(hours=1),
            )
        )

        expected_query = '''
        SELECT * FROM (
            SELECT config_type, name, revision, username, created_at, tags, description, data
            FROM config_history
            WHERE config_type = ANY(%s) AND name = %s AND revision = %s AND tags @> %s AND created_at < %s AND created_at > %s AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 20 OFFSET 5
        ) AS ch
        ORDER BY created_at DESC
        '''
        self.assertEqual(query.strip(), expected_query.strip())
        self.assertEqual(
            params,
            (
                lowercase_config_types,
                'test-name',
                3,
                ['tag1'],
                base_time + datetime.timedelta(hours=1),
                base_time - datetime.timedelta(hours=1),
            ),
        )


class TestConfigHistoryQueryParams(unittest.TestCase):
    """Test suite for ConfigHistoryQueryParams validation."""

    def test_valid_config_types(self):
        """Test validation of valid config types."""
        params = objects.ConfigHistoryQueryParams(
            config_types=config_types
        )
        self.assertEqual(
            params.config_types, config_types
        )

    def test_invalid_config_types(self):
        """Test validation of invalid config types."""
        with self.assertRaises(ValueError) as context:
            objects.ConfigHistoryQueryParams(config_types=['invalid_type'])
        self.assertIn('config_types', str(context.exception))
        self.assertIn('not a valid enumeration member', str(context.exception))

    def test_at_timestamp_with_created_before(self):
        """Test validation of at_timestamp with created_before."""
        with self.assertRaises(ValueError) as context:
            objects.ConfigHistoryQueryParams(at_timestamp=base_time, created_before=base_time)
        self.assertIn('Cannot specify both at_timestamp and created_before', str(context.exception))

    def test_at_timestamp_with_created_after(self):
        """Test validation of at_timestamp with created_after."""
        with self.assertRaises(ValueError) as context:
            objects.ConfigHistoryQueryParams(at_timestamp=base_time, created_after=base_time)
        self.assertIn('Cannot specify both at_timestamp and created_after', str(context.exception))


if __name__ == '__main__':
    unittest.main()
