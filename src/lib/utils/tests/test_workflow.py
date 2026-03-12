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
        sections = workflow_utils.parse_workflow_spec(spec)
        self.assertIn('workflow', sections)
        self.assertEqual(set(sections.keys()), {'workflow'})

    def test_workflow_then_default_values(self):
        spec = """\
workflow:
  name: my-wf
  groups: []
default-values:
  foo: bar
"""
        sections = workflow_utils.parse_workflow_spec(spec)
        self.assertEqual(set(sections.keys()), {'workflow', 'default-values'})
        self.assertIn('name: my-wf', sections['workflow'])
        self.assertIn('foo: bar', sections['default-values'])

    def test_default_values_before_workflow(self):
        spec = """\
default-values:
  foo: bar
workflow:
  name: my-wf
  groups: []
"""
        sections = workflow_utils.parse_workflow_spec(spec)
        self.assertEqual(set(sections.keys()), {'workflow', 'default-values'})
        self.assertIn('name: my-wf', sections['workflow'])
        self.assertIn('foo: bar', sections['default-values'])

    def test_jinja_content_not_at_root_indent(self):
        spec = """\
workflow:
  name: my-wf
  groups:
{% for i in range(3) %}
  - name: task-{{ i }}
{% endfor %}
"""
        sections = workflow_utils.parse_workflow_spec(spec)
        self.assertIn('workflow', sections)
        self.assertIn('task-', sections['workflow'])

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

    def test_unknown_top_level_key_is_returned(self):
        """parse_workflow_spec returns all keys; callers decide what is allowed."""
        spec = """\
workflow:
  name: my-wf
resources:
  default:
    cpu: 10
"""
        sections = workflow_utils.parse_workflow_spec(spec)
        self.assertIn('resources', sections)
        self.assertIn('workflow', sections)
