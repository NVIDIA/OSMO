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

from src.lib.utils import osmo_errors, workflow as workflow_utils


class ParseWorkflowSpecTests(unittest.TestCase):
    """Unit tests for parse_workflow_spec."""

    def test_workflow_only(self):
        spec = """\
workflow:
  name: my-wf
  groups: []
"""
        workflow_spec, default_values = workflow_utils.parse_workflow_spec(spec)
        self.assertIn('workflow:', workflow_spec)
        self.assertIsNone(default_values)

    def test_workflow_then_default_values(self):
        spec = """\
workflow:
  name: my-wf
  groups: []
default-values:
  foo: bar
"""
        workflow_spec, default_values = workflow_utils.parse_workflow_spec(spec)
        self.assertIn('name: my-wf', workflow_spec)
        self.assertEqual(default_values, {'foo': 'bar'})

    def test_default_values_before_workflow(self):
        spec = """\
default-values:
  foo: bar
workflow:
  name: my-wf
  groups: []
"""
        workflow_spec, default_values = workflow_utils.parse_workflow_spec(spec)
        self.assertIn('name: my-wf', workflow_spec)
        self.assertEqual(default_values, {'foo': 'bar'})

    def test_jinja_content_not_at_root_indent(self):
        spec = """\
workflow:
  name: my-wf
  groups:
{% for i in range(3) %}
  - name: task-{{ i }}
{% endfor %}
"""
        workflow_spec, default_values = workflow_utils.parse_workflow_spec(spec)
        self.assertIn('task-', workflow_spec)
        self.assertIsNone(default_values)

    def test_duplicate_workflow_raises(self):
        spec = """\
workflow:
  name: first
workflow:
  name: second
"""
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            workflow_utils.parse_workflow_spec(spec)
        self.assertIn('workflow', str(context.exception))

    def test_version_key_allowed(self):
        spec = """\
version: 2
workflow:
  name: my-wf
  groups: []
"""
        workflow_spec, default_values = workflow_utils.parse_workflow_spec(spec)
        self.assertIn('name: my-wf', workflow_spec)
        self.assertIsNone(default_values)

    def test_unknown_top_level_key_raises(self):
        spec = """\
workflow:
  name: my-wf
resources:
  default:
    cpu: 10
"""
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            workflow_utils.parse_workflow_spec(spec)
        self.assertIn('resources', str(context.exception))


if __name__ == '__main__':
    unittest.main()
