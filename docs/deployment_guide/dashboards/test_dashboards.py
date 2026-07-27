# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

"""Structural checks for the Grafana dashboard JSON definitions."""

import json
import pathlib
import unittest
from typing import Any


DASHBOARD_DIRECTORY = pathlib.Path(__file__).parent


def _load_dashboard(filename: str) -> dict[str, Any]:
    with (DASHBOARD_DIRECTORY / filename).open(encoding='utf-8') as dashboard_file:
        return json.load(dashboard_file)


def _variables(dashboard: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        variable['name']: variable
        for variable in dashboard.get('templating', {}).get('list', [])
    }


def _query(variable: dict[str, Any]) -> str:
    # Grafana stores template-variable queries as either a raw string or a
    # {query: ...} object depending on the dashboard schema version.
    query = variable.get('query', '')
    return query.get('query', '') if isinstance(query, dict) else query


class WorkflowResourcesDashboardTest(unittest.TestCase):
    """Structural and deployment-neutrality checks for the OSS dashboard."""

    dashboard: dict[str, Any]

    @classmethod
    def setUpClass(cls) -> None:
        cls.dashboard = _load_dashboard('workflow_resources_usage.json')

    def test_has_workflow_resource_panels(self):
        # Floor, not an exact count: panels may be added freely.
        self.assertGreaterEqual(len(self.dashboard['panels']), 8)

    def test_dashboard_is_deployment_neutral(self):
        variables = _variables(self.dashboard)
        self.assertNotIn('project', variables)
        uuid_query = _query(variables['uuid'])
        self.assertIn('kube_pod_info', uuid_query)
        self.assertNotIn('label_project', json.dumps(self.dashboard))

    def test_panel_ids_are_unique(self):
        panel_ids = [panel['id'] for panel in self.dashboard['panels']]
        self.assertEqual(len(panel_ids), len(set(panel_ids)))


if __name__ == '__main__':
    unittest.main()
