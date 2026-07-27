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

import os
import types
import unittest
from unittest import mock

from src.service.core.workflow import workflow_metrics
from src.utils import connectors


def _workflow_config(
        policy_allow_lists: dict[str, list[str]] | None = None,
) -> types.SimpleNamespace:
    policy_allow_lists = policy_allow_lists if policy_allow_lists is not None else {}
    policy = [
        connectors.LabelPolicy(key=key, allow_list=allow_list)
        for key, allow_list in policy_allow_lists.items()
    ]
    return types.SimpleNamespace(
        labels_config=types.SimpleNamespace(policy=policy)
    )


class GetTaskMetricsTest(unittest.TestCase):
    """Task counts are projected onto configured attribution dimensions."""

    def setUp(self):
        self._disable_metrics = os.environ.pop('OSMO_DISABLE_TASK_METRICS', None)
        workflow_metrics._metric_cache.clear()  # pylint: disable=protected-access
        workflow_metrics._last_refresh_time = 0  # pylint: disable=protected-access

    def tearDown(self):
        if self._disable_metrics is None:
            os.environ.pop('OSMO_DISABLE_TASK_METRICS', None)
        else:
            os.environ['OSMO_DISABLE_TASK_METRICS'] = self._disable_metrics
        workflow_metrics._metric_cache.clear()  # pylint: disable=protected-access
        workflow_metrics._last_refresh_time = 0  # pylint: disable=protected-access

    def _observe(self, database):
        with mock.patch.object(
            connectors.PostgresConnector, 'get_instance', return_value=database
        ), mock.patch.object(
            workflow_metrics.time, 'time', return_value=100
        ):
            return list(workflow_metrics.get_task_metrics())

    def test_sums_database_counts_and_collapses_non_policy_labels(self):
        rows = [
            {
                'pool': 'pool-a',
                'user': 'alice',
                'workflow_uuid': 'workflow-1',
                'status': 'RUNNING',
                'labels': {
                    'project': 'project-a',
                    'cost-center': 'center-1',
                    'experiment': 'first',
                },
                'count': 2,
            },
            {
                'pool': 'pool-a',
                'user': 'alice',
                'workflow_uuid': 'workflow-1',
                'status': 'RUNNING',
                'labels': {
                    'project': 'project-a',
                    'cost-center': 'center-1',
                    'experiment': 'second',
                },
                'count': 3,
            },
            {
                'pool': 'pool-a',
                'user': 'alice',
                'workflow_uuid': 'workflow-1',
                'status': 'RUNNING',
                'labels': {'project': 'project-a'},
                'count': 4,
            },
            {
                'pool': 'pool-a',
                'user': 'alice',
                'workflow_uuid': 'workflow-1',
                'status': 'RUNNING',
                'labels': None,
                'count': 1,
            },
            {
                'pool': 'pool-a',
                'user': 'alice',
                'workflow_uuid': 'workflow-1',
                'status': 'RUNNING',
                'labels': ['unexpected-type'],
                'count': 2,
            },
            {
                'pool': 'pool-a',
                'user': 'alice',
                'workflow_uuid': 'workflow-1',
                'status': 'RUNNING',
                'labels': {'project': 'unattributed'},
                'count': 6,
            },
        ]
        database = mock.Mock()
        database.get_workflow_configs.return_value = _workflow_config({
            'project': ['project-a'],
            'cost-center': ['center-1'],
        })

        with mock.patch.object(
                workflow_metrics.helpers, 'get_recent_tasks',
                return_value=rows):
            observations = self._observe(database)

        counts = {}
        for observation in observations:
            attributes = observation.attributes
            if attributes is None:
                self.fail('Task metric observation is missing attributes.')
            counts[(
                attributes['workflow_label_project'],
                attributes['workflow_label_cost_dash_center'],
            )] = observation.value
            self.assertEqual(attributes['pool'], 'pool-a')
            self.assertEqual(attributes['user'], 'alice')
            self.assertEqual(attributes['workflow_uuid'], 'workflow-1')
            self.assertEqual(attributes['status'], 'RUNNING')
        self.assertEqual(counts, {
            ('project-a', 'center-1'): 5,
            ('project-a', '<missing>'): 4,
            ('<missing>', '<missing>'): 3,
            ('<other>', '<missing>'): 6,
        })

    def test_empty_allow_list_clamps_all_present_values_to_other(self):
        label_policy = connectors.LabelPolicy(key='project')

        metric_value = workflow_metrics._workflow_label_metric_value  # pylint: disable=protected-access
        self.assertEqual(
            metric_value({'project': 'arbitrary'}, label_policy), '<other>')
        self.assertEqual(metric_value({}, label_policy), '<missing>')

    def test_policy_label_attributes_cannot_overwrite_or_sanitize_to_same_name(self):
        database = mock.Mock()
        database.get_workflow_configs.return_value = _workflow_config({
            'pool': ['label-pool'],
            'a.b': ['dot'],
            'a/b': ['slash'],
            'a_dot_b': ['literal-token'],
        })
        rows = [{
            'pool': 'pool-a',
            'user': 'alice',
            'workflow_uuid': 'workflow-1',
            'status': 'RUNNING',
            'labels': {
                'pool': 'label-pool',
                'a.b': 'dot',
                'a/b': 'slash',
                'a_dot_b': 'literal-token',
            },
            'count': 1,
        }]

        with mock.patch.object(
                workflow_metrics.helpers, 'get_recent_tasks',
                return_value=rows):
            observations = self._observe(database)

        attributes = observations[0].attributes
        if attributes is None:
            self.fail('Task metric observation is missing attributes.')
        self.assertEqual(attributes['pool'], 'pool-a')
        self.assertEqual(attributes['workflow_label_pool'], 'label-pool')
        self.assertEqual(attributes['workflow_label_a_dot_b'], 'dot')
        self.assertEqual(attributes['workflow_label_a_slash_b'], 'slash')
        self.assertEqual(
            attributes['workflow_label_a__dot__b'], 'literal-token'
        )

    def test_no_label_policies_keeps_base_dimensions_and_database_count(self):
        database = mock.Mock()
        database.get_workflow_configs.return_value = _workflow_config()
        rows = [{
            'pool': None,
            'user': 'alice',
            'workflow_uuid': 'workflow-1',
            'status': 'COMPLETED',
            'labels': {'experiment': 'ignored'},
            'count': 7,
        }]

        with mock.patch.object(
                workflow_metrics.helpers, 'get_recent_tasks',
                return_value=rows):
            observations = self._observe(database)

        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0].value, 7)
        attributes = observations[0].attributes
        if attributes is None:
            self.fail('Task metric observation is missing attributes.')
        self.assertEqual(dict(attributes), {
            'pool': 'unknown',
            'user': 'alice',
            'workflow_uuid': 'workflow-1',
            'status': 'COMPLETED',
        })

    def test_cache_is_reused_until_30_second_ttl_expires(self):
        database = mock.Mock()
        database.get_workflow_configs.return_value = _workflow_config({'project': ['project-a']})
        first_rows = [{
            'pool': 'pool-a',
            'user': 'alice',
            'workflow_uuid': 'workflow-1',
            'status': 'RUNNING',
            'labels': {'project': 'project-a'},
            'count': 2,
        }]
        refreshed_rows = [{
            **first_rows[0],
            'count': 9,
        }]

        with mock.patch.object(
            connectors.PostgresConnector, 'get_instance', return_value=database
        ), mock.patch.object(
            workflow_metrics.helpers,
            'get_recent_tasks',
            side_effect=[first_rows, refreshed_rows],
        ) as get_recent_tasks, mock.patch.object(
            workflow_metrics.time, 'time', side_effect=[100, 129, 131]
        ):
            first = list(workflow_metrics.get_task_metrics())
            cached = list(workflow_metrics.get_task_metrics())
            refreshed = list(workflow_metrics.get_task_metrics())

        self.assertEqual(first[0].value, 2)
        self.assertEqual(cached[0].value, 2)
        self.assertEqual(refreshed[0].value, 9)
        self.assertEqual(get_recent_tasks.call_count, 2)
        self.assertEqual(database.get_workflow_configs.call_count, 2)

    def test_disabled_metrics_do_not_query_database(self):
        os.environ['OSMO_DISABLE_TASK_METRICS'] = 'true'

        with mock.patch.object(
            connectors.PostgresConnector, 'get_instance'
        ) as get_database:
            observations = list(workflow_metrics.get_task_metrics())

        self.assertEqual(observations, [])
        get_database.assert_not_called()


class RegisterTaskMetricsTest(unittest.TestCase):
    def test_description_mentions_curated_workflow_labels(self):
        metric_creator = mock.Mock()

        with mock.patch.object(
            workflow_metrics.metrics.MetricCreator,
            'get_meter_instance',
            return_value=metric_creator,
        ):
            workflow_metrics.register_task_metrics()

        metric_creator.send_observable_gauge.assert_called_once()
        kwargs = metric_creator.send_observable_gauge.call_args.kwargs
        self.assertEqual(kwargs['name'], 'osmo_tasks_count')
        self.assertEqual(kwargs['callbacks'], workflow_metrics.get_task_metrics)
        self.assertIn('workflow labels', kwargs['description'])


if __name__ == '__main__':
    unittest.main()
