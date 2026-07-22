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
    """PostgreSQL-backed fixture for label list filters (see TaskDbFixture)."""

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

    def test_warning_column_is_not_part_of_the_canonical_schema(self):
        column_rows = self.database.execute_fetch_command(
            '''SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'workflows'
                 AND column_name = 'warnings' ''', (), True)

        self.assertEqual(column_rows, [])

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
            {'PPP': 'robotics_alpha', 'stage': 'prod'})
        robotics_beta_id = self.insert_workflow(
            'labels-robotics-beta',
            {'PPP': 'robotics_beta', 'stage': 'dev'})
        robotics_no_underscore_id = self.insert_workflow(
            'labels-robotics-no-underscore',
            {'PPP': 'roboticsXalpha', 'stage': 'prod'})
        case_variant_id = self.insert_workflow(
            'labels-robotics-case-variant',
            {'PPP': 'Robotics_alpha', 'stage': 'prod'})
        team_a_id = self.insert_workflow(
            'labels-team-a', {'PPP': 'team_a'})
        team_b_id = self.insert_workflow(
            'labels-team-b', {'PPP': 'team_b'})
        team_c_id = self.insert_workflow('labels-team-c', {'PPP': 'team_c'})
        osmo_alpha_id = self.insert_workflow(
            'labels-osmo-alpha', {'PPP': 'osmo_alpha'})
        legacy_id = self.insert_workflow('labels-selector-legacy', {})
        self.database.execute_commit_command(
            'UPDATE workflows SET labels = NULL WHERE workflow_id = %s',
            (legacy_id,))

        context = SimpleNamespace(database=self.database)
        with mock.patch.object(
                objects.WorkflowServiceContext, 'get', return_value=context):
            glob_rows = helpers.get_workflows(
                label_filters=['PPP=robotics_*'], return_raw=True)
            alternation_rows = helpers.get_workflows(
                label_filters=['PPP=(team_a|team_b)'], return_raw=True)
            wildcard_alternation_rows = helpers.get_workflows(
                label_filters=['PPP=(team_*|osmo_*)'], return_raw=True)
            inline_alternation_rows = helpers.get_workflows(
                label_filters=['PPP=team_(a|b)'], return_raw=True)
            combined_rows = helpers.get_workflows(
                label_filters=['PPP=robotics_*', 'stage=prod'],
                return_raw=True)
            match_all_rows = helpers.get_workflows(
                label_filters=['PPP=*'], return_raw=True)
            match_all_alternative_rows = helpers.get_workflows(
                label_filters=['PPP=(*|absent)'], return_raw=True)

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

    def test_deployment_specific_ppp_indexes_are_planner_eligible(self):
        self.database.execute_autocommit_command(
            '''
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                workflow_labels_ppp_pattern_idx
            ON workflows ((labels ->> 'PPP') text_pattern_ops)
            ''',
            (),
        )
        self.database.execute_autocommit_command(
            '''
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                workflow_labels_ppp_missing_idx
            ON workflows (submit_time DESC)
            WHERE labels IS NULL OR NOT (labels ? 'PPP')
            ''',
            (),
        )

        explain_cases = (
            (
                'workflow_labels_gin_idx',
                "SELECT workflow_id FROM workflows WHERE labels ? 'PPP'",
                (),
            ),
            (
                'workflow_labels_gin_idx',
                (
                    'SELECT workflow_id FROM workflows '
                    "WHERE labels @> jsonb_build_object('PPP', %s)"
                ),
                ('team_a',),
            ),
            (
                'workflow_labels_ppp_pattern_idx',
                (
                    'SELECT workflow_id FROM workflows '
                    "WHERE labels ->> 'PPP' LIKE %s ESCAPE '#'"
                ),
                ('team#_%',),
            ),
            (
                'workflow_labels_ppp_missing_idx',
                (
                    'SELECT workflow_id FROM workflows '
                    "WHERE labels IS NULL OR NOT (labels ? 'PPP') "
                    'ORDER BY submit_time DESC'
                ),
                (),
            ),
        )

        for expected_index, query, parameters in explain_cases:
            with self.subTest(expected_index=expected_index):
                plan_rows = self.database.execute_fetch_command(
                    'SET LOCAL enable_seqscan = off; '
                    f'EXPLAIN (FORMAT JSON, COSTS OFF) {query}',
                    parameters,
                    True,
                )
                self.assertIn(expected_index, str(plan_rows))


if __name__ == '__main__':
    unittest.main()
