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

from src.lib.utils import common, priority
from src.tests.common import fixtures
from src.utils.connectors import postgres
from src.utils.job import workflow


class WorkflowLabelsDatabaseFixture(
        fixtures.PostgresFixture,
        fixtures.PostgresTestIsolationFixture,
        fixtures.OsmoTestFixture):
    """PostgreSQL-backed fixture for workflow-label persistence."""

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


class WorkflowLabelsDatabaseTest(WorkflowLabelsDatabaseFixture):

    def test_jsonb_round_trip_survives_saved_spec_derivation(self):
        expected_labels = {'team': 'alpha', 'run': '42'}
        source_id = self.insert_workflow('labels-source', expected_labels)
        source = workflow.Workflow.fetch_from_db(
            self.database, source_id, fetch_groups=False)

        saved_spec = workflow.WorkflowSpec(
            name='labels-derived-spec',
            labels=source.labels,
            groups=[{
                'name': 'group',
                'tasks': [{'name': 'task', 'image': 'image', 'command': ['echo']}],
            }],
        ).saved_spec()
        reparsed_spec = workflow.WorkflowSpec(**saved_spec)
        derived_id = self.insert_workflow('labels-derived', reparsed_spec.labels)
        derived = workflow.Workflow.fetch_from_db(
            self.database, derived_id, fetch_groups=False)
        column_rows = self.database.execute_fetch_command(
            '''SELECT data_type FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'workflows'
                 AND column_name = 'labels' ''', (), True)

        self.assertEqual(column_rows, [{'data_type': 'jsonb'}])
        self.assertEqual(source.labels, expected_labels)
        self.assertEqual(reparsed_spec.labels, expected_labels)
        self.assertEqual(derived.labels, expected_labels)

    def test_legacy_null_labels_fetch_as_empty_map(self):
        workflow_id = self.insert_workflow('labels-legacy', {})
        self.database.execute_commit_command(
            'UPDATE workflows SET labels = NULL WHERE workflow_id = %s',
            (workflow_id,))

        fetched = workflow.Workflow.fetch_from_db(
            self.database, workflow_id, fetch_groups=False)

        self.assertEqual(fetched.labels, {})
