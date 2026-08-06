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

from types import SimpleNamespace
import unittest
from unittest import mock

from src.lib.utils import common, priority
from src.service.core.workflow import helpers, objects
from src.tests.common import fixtures
from src.utils.connectors import postgres
from src.utils.job import workflow


class WorkflowLabelFiltersFixture(
        fixtures.PostgresFixture,
        fixtures.PostgresTestIsolationFixture,
        fixtures.OsmoTestFixture):
    """PostgreSQL-backed fixture for label list filters.

    Mirrors TaskDbFixture in src/utils/job/tests/test_task_db.py; BUILD
    layering prevents sharing the class across the two test trees.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        postgres.PostgresConnector(
            postgres.PostgresConfig(
                postgres_host=cls.postgres_container.get_container_host_ip(),
                postgres_port=cls.postgres_container.get_database_port(),
                postgres_password=cls.postgres_container.password,
                postgres_database_name=cls.postgres_container.dbname,
                postgres_user=cls.postgres_container.username,
                method='dev',
            ))

    @classmethod
    def tearDownClass(cls):
        try:
            if postgres.PostgresConnector._instance:  # pylint: disable=protected-access
                postgres.PostgresConnector._instance.close()  # pylint: disable=protected-access
                postgres.PostgresConnector._instance = None  # pylint: disable=protected-access
        finally:
            super().tearDownClass()

    @property
    def database(self) -> postgres.PostgresConnector:
        return postgres.PostgresConnector.get_instance()

    def insert_workflow(self, name: str, labels: dict[str, str]) -> str:
        workflow_obj = workflow.Workflow(
            workflow_name=name,
            workflow_uuid=common.generate_unique_id(),
            groups=[],
            user='alice',
            labels=labels,
            logs='',
            database=self.database,
            priority=priority.WorkflowPriority.NORMAL,
            backend='backend',
            pool='pool',
        )
        workflow_obj.insert_to_db()
        return workflow_obj.workflow_id


class WorkflowLabelFiltersDatabaseTest(WorkflowLabelFiltersFixture):
    """Label list filters compile to predicates that execute against JSONB."""

    def test_exact_and_missing_filters_execute_against_jsonb(self):
        expected_id = self.insert_workflow(
            'labels-match', {'team': 'alpha', 'run': '42'})
        self.insert_workflow('labels-wrong-run', {'team': 'alpha', 'run': '43'})
        legacy_id = self.insert_workflow('labels-legacy', {})
        self.database.execute_commit_command(
            'UPDATE workflows SET labels = NULL WHERE workflow_id = %s',
            (legacy_id,))

        context = SimpleNamespace(database=self.database)
        with mock.patch.object(
                objects.WorkflowServiceContext, 'get', return_value=context):
            matching_rows = helpers.get_workflows(
                label_filters=['team=alpha', 'run=42'], return_raw=True)
            missing_rows = helpers.get_workflows(
                missing_label_filters=['team'], return_raw=True)

        self.assertEqual(
            [row['workflow_id'] for row in matching_rows], [expected_id])
        self.assertEqual(
            [row['workflow_id'] for row in missing_rows], [legacy_id])
        legacy_workflow = workflow.Workflow.fetch_from_db(
            self.database, legacy_id, fetch_groups=False)
        self.assertEqual(legacy_workflow.labels, {})

    def test_glob_and_alternation_filters_execute_against_jsonb(self):
        robotics_alpha_id = self.insert_workflow(
            'labels-robotics-alpha',
            {'project': 'robotics_alpha', 'stage': 'prod'})
        robotics_beta_id = self.insert_workflow(
            'labels-robotics-beta',
            {'project': 'robotics_beta', 'stage': 'dev'})
        robotics_no_underscore_id = self.insert_workflow(
            'labels-robotics-no-underscore',
            {'project': 'roboticsXalpha', 'stage': 'prod'})
        case_variant_id = self.insert_workflow(
            'labels-robotics-case-variant',
            {'project': 'Robotics_alpha', 'stage': 'prod'})
        team_a_id = self.insert_workflow(
            'labels-team-a', {'project': 'team_a'})
        team_b_id = self.insert_workflow(
            'labels-team-b', {'project': 'team_b'})
        team_c_id = self.insert_workflow('labels-team-c', {'project': 'team_c'})
        osmo_alpha_id = self.insert_workflow(
            'labels-osmo-alpha', {'project': 'osmo_alpha'})
        legacy_id = self.insert_workflow('labels-selector-legacy', {})
        self.database.execute_commit_command(
            'UPDATE workflows SET labels = NULL WHERE workflow_id = %s',
            (legacy_id,))

        context = SimpleNamespace(database=self.database)
        with mock.patch.object(
                objects.WorkflowServiceContext, 'get', return_value=context):
            glob_rows = helpers.get_workflows(
                label_filters=['project=robotics_*'], return_raw=True)
            alternation_rows = helpers.get_workflows(
                label_filters=['project=(team_a|team_b)'], return_raw=True)
            wildcard_alternation_rows = helpers.get_workflows(
                label_filters=['project=(team_*|osmo_*)'], return_raw=True)
            inline_alternation_rows = helpers.get_workflows(
                label_filters=['project=team_(a|b)'], return_raw=True)
            combined_rows = helpers.get_workflows(
                label_filters=['project=robotics_*', 'stage=prod'],
                return_raw=True)
            match_all_rows = helpers.get_workflows(
                label_filters=['project=*'], return_raw=True)
            match_all_alternative_rows = helpers.get_workflows(
                label_filters=['project=(*|absent)'], return_raw=True)

        self.assertEqual(
            {row['workflow_id'] for row in glob_rows},
            {robotics_alpha_id, robotics_beta_id})
        self.assertEqual(
            {row['workflow_id'] for row in alternation_rows},
            {team_a_id, team_b_id})
        self.assertEqual(
            {row['workflow_id'] for row in wildcard_alternation_rows},
            {team_a_id, team_b_id, team_c_id, osmo_alpha_id})
        self.assertEqual(
            {row['workflow_id'] for row in inline_alternation_rows},
            {team_a_id, team_b_id})
        self.assertEqual(
            [row['workflow_id'] for row in combined_rows],
            [robotics_alpha_id])
        self.assertEqual(
            {row['workflow_id'] for row in match_all_rows},
            {
                robotics_alpha_id,
                robotics_beta_id,
                robotics_no_underscore_id,
                case_variant_id,
                team_a_id,
                team_b_id,
                team_c_id,
                osmo_alpha_id,
            })
        self.assertEqual(
            {row['workflow_id'] for row in match_all_alternative_rows},
            {row['workflow_id'] for row in match_all_rows},
        )

    def test_shipped_gin_index_is_planner_eligible(self):
        # Assert on plan shape, not the index name: the isolation fixture
        # restores tables with LIKE ... INCLUDING ALL, which regenerates
        # index names between tests. Only one index exists on labels.
        explain_cases = (
            ("SELECT workflow_id FROM workflows WHERE labels ? 'project'", ()),
            (
                'SELECT workflow_id FROM workflows '
                'WHERE labels @> jsonb_build_object(%s, %s)',
                ('project', 'team_a'),
            ),
        )

        for query, parameters in explain_cases:
            with self.subTest(query=query):
                plan_rows = self.database.execute_fetch_command(
                    'SET LOCAL enable_seqscan = off; '
                    f'EXPLAIN (FORMAT JSON, COSTS OFF) {query}',
                    parameters,
                    True,
                )
                plan_text = str(plan_rows)
                self.assertIn('Bitmap Index Scan', plan_text)
                self.assertIn('Index Cond', plan_text)


if __name__ == '__main__':
    unittest.main()
