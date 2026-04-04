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
import shutil
import tempfile
import textwrap
import unittest

import yaml

from src.lib.utils import osmo_errors
from src.utils.spec_includes import deep_merge_dicts, resolve_includes


class DeepMergeDictsTests(unittest.TestCase):
    """Unit tests for deep_merge_dicts."""

    def test_disjoint_keys(self):
        result = deep_merge_dicts({'a': 1}, {'b': 2})
        self.assertEqual(result, {'a': 1, 'b': 2})

    def test_override_scalar(self):
        result = deep_merge_dicts({'a': 1}, {'a': 99})
        self.assertEqual(result, {'a': 99})

    def test_nested_dict_merge(self):
        base = {'a': {'x': 1, 'y': 2}, 'b': 3}
        override = {'a': {'y': 99, 'z': 100}}
        result = deep_merge_dicts(base, override)
        self.assertEqual(result, {'a': {'x': 1, 'y': 99, 'z': 100}, 'b': 3})

    def test_plain_list_replacement(self):
        base = {'items': [1, 2, 3]}
        override = {'items': [4, 5]}
        result = deep_merge_dicts(base, override)
        self.assertEqual(result, {'items': [4, 5]})

    def test_named_list_merge_disjoint(self):
        base = {'tasks': [{'name': 'a', 'image': 'img-a'}]}
        override = {'tasks': [{'name': 'b', 'image': 'img-b'}]}
        result = deep_merge_dicts(base, override)
        self.assertEqual(result['tasks'], [
            {'name': 'a', 'image': 'img-a'},
            {'name': 'b', 'image': 'img-b'},
        ])

    def test_named_list_merge_override_existing(self):
        base = {'tasks': [
            {'name': 'train', 'image': 'train:v1', 'command': ['python3']},
            {'name': 'eval', 'image': 'eval:v1'},
        ]}
        override = {'tasks': [
            {'name': 'train', 'image': 'train:v2'},
        ]}
        result = deep_merge_dicts(base, override)
        self.assertEqual(result['tasks'], [
            {'name': 'train', 'image': 'train:v2', 'command': ['python3']},
            {'name': 'eval', 'image': 'eval:v1'},
        ])

    def test_named_list_preserves_base_order_appends_new(self):
        base = {'tasks': [
            {'name': 'first', 'val': 1},
            {'name': 'second', 'val': 2},
        ]}
        override = {'tasks': [
            {'name': 'third', 'val': 3},
            {'name': 'first', 'val': 10},
        ]}
        result = deep_merge_dicts(base, override)
        names = [t['name'] for t in result['tasks']]
        self.assertEqual(names, ['first', 'second', 'third'])
        self.assertEqual(result['tasks'][0]['val'], 10)

    def test_named_list_empty_base(self):
        base = {'tasks': []}
        override = {'tasks': [{'name': 'a', 'image': 'img'}]}
        result = deep_merge_dicts(base, override)
        self.assertEqual(result['tasks'], [{'name': 'a', 'image': 'img'}])

    def test_named_list_empty_override_clears(self):
        base = {'tasks': [{'name': 'a', 'image': 'img'}]}
        override = {'tasks': []}
        result = deep_merge_dicts(base, override)
        self.assertEqual(result['tasks'], [])

    def test_mixed_list_without_name_key_replaced(self):
        base = {'args': [{'cmd': 'echo'}, {'cmd': 'ls'}]}
        override = {'args': [{'cmd': 'cat'}]}
        result = deep_merge_dicts(base, override)
        self.assertEqual(result['args'], [{'cmd': 'cat'}])

    def test_override_dict_with_scalar(self):
        result = deep_merge_dicts({'a': {'nested': 1}}, {'a': 'flat'})
        self.assertEqual(result, {'a': 'flat'})

    def test_override_scalar_with_dict(self):
        result = deep_merge_dicts({'a': 'flat'}, {'a': {'nested': 1}})
        self.assertEqual(result, {'a': {'nested': 1}})

    def test_empty_base(self):
        result = deep_merge_dicts({}, {'a': 1})
        self.assertEqual(result, {'a': 1})

    def test_empty_override(self):
        result = deep_merge_dicts({'a': 1}, {})
        self.assertEqual(result, {'a': 1})

    def test_deeply_nested(self):
        base = {'l1': {'l2': {'l3': {'val': 'base', 'keep': True}}}}
        override = {'l1': {'l2': {'l3': {'val': 'override'}}}}
        result = deep_merge_dicts(base, override)
        self.assertEqual(result, {'l1': {'l2': {'l3': {'val': 'override', 'keep': True}}}})


class ResolveIncludesTests(unittest.TestCase):
    """Unit tests for resolve_includes."""

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.test_dir)

    def _write_file(self, relative_path: str, content: str) -> str:
        full_path = os.path.join(self.test_dir, relative_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'w', encoding='utf-8') as file_handle:
            file_handle.write(textwrap.dedent(content))
        return full_path

    def test_no_includes_returns_original_text(self):
        spec = 'workflow:\n  name: test\n'
        result = resolve_includes(spec, self.test_dir)
        self.assertEqual(result, spec)

    def test_simple_include_merges_workflow(self):
        self._write_file('base.yaml', '''\
            workflow:
              name: base
              resources:
                default:
                  cpu: 8
                  gpu: 1
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            workflow:
              name: child
              tasks:
                - name: task1
                  image: ubuntu
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        self.assertEqual(parsed['workflow']['name'], 'child')
        self.assertEqual(parsed['workflow']['resources']['default']['cpu'], 8)
        self.assertEqual(parsed['workflow']['resources']['default']['gpu'], 1)
        self.assertEqual(len(parsed['workflow']['tasks']), 1)
        self.assertNotIn('includes', parsed)

    def test_default_values_merged(self):
        self._write_file('base.yaml', '''\
            default-values:
              var1: base_val1
              var2: base_val2
            workflow:
              name: base
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            default-values:
              var2: child_val2
              var3: child_val3
            workflow:
              name: child
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        self.assertEqual(parsed['default-values'], {
            'var1': 'base_val1',
            'var2': 'child_val2',
            'var3': 'child_val3',
        })

    def test_main_file_overrides_included_values(self):
        self._write_file('base.yaml', '''\
            workflow:
              name: base
              resources:
                default:
                  cpu: 4
                  gpu: 1
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            workflow:
              name: override
              resources:
                default:
                  cpu: 16
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        self.assertEqual(parsed['workflow']['name'], 'override')
        self.assertEqual(parsed['workflow']['resources']['default']['cpu'], 16)
        self.assertEqual(parsed['workflow']['resources']['default']['gpu'], 1)

    def test_multiple_includes_merged_in_order(self):
        self._write_file('first.yaml', '''\
            workflow:
              name: first
              resources:
                default:
                  cpu: 2
        ''')
        self._write_file('second.yaml', '''\
            workflow:
              name: second
              resources:
                default:
                  cpu: 8
                  memory: 32Gi
        ''')
        spec = textwrap.dedent('''\
            includes:
              - first.yaml
              - second.yaml
            workflow:
              name: main
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        self.assertEqual(parsed['workflow']['name'], 'main')
        self.assertEqual(parsed['workflow']['resources']['default']['cpu'], 8)
        self.assertEqual(parsed['workflow']['resources']['default']['memory'], '32Gi')

    def test_nested_includes(self):
        self._write_file('grandparent.yaml', '''\
            workflow:
              name: grandparent
              resources:
                default:
                  cpu: 4
        ''')
        self._write_file('parent.yaml', '''\
            includes:
              - grandparent.yaml
            workflow:
              name: parent
              resources:
                default:
                  gpu: 2
        ''')
        spec = textwrap.dedent('''\
            includes:
              - parent.yaml
            workflow:
              name: child
              tasks:
                - name: task1
                  image: ubuntu
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        self.assertEqual(parsed['workflow']['name'], 'child')
        self.assertEqual(parsed['workflow']['resources']['default']['cpu'], 4)
        self.assertEqual(parsed['workflow']['resources']['default']['gpu'], 2)
        self.assertEqual(len(parsed['workflow']['tasks']), 1)

    def test_diamond_includes(self):
        self._write_file('shared.yaml', '''\
            workflow:
              name: shared
              resources:
                default:
                  cpu: 4
        ''')
        self._write_file('branch_a.yaml', '''\
            includes:
              - shared.yaml
            workflow:
              name: branch-a
        ''')
        self._write_file('branch_b.yaml', '''\
            includes:
              - shared.yaml
            workflow:
              name: branch-b
              resources:
                default:
                  memory: 16Gi
        ''')
        spec = textwrap.dedent('''\
            includes:
              - branch_a.yaml
              - branch_b.yaml
            workflow:
              name: root
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        self.assertEqual(parsed['workflow']['name'], 'root')
        self.assertEqual(parsed['workflow']['resources']['default']['cpu'], 4)
        self.assertEqual(parsed['workflow']['resources']['default']['memory'], '16Gi')

    def test_circular_include_raises(self):
        self._write_file('a.yaml', '''\
            includes:
              - b.yaml
            workflow:
              name: a
        ''')
        self._write_file('b.yaml', '''\
            includes:
              - a.yaml
            workflow:
              name: b
        ''')
        spec = textwrap.dedent('''\
            includes:
              - a.yaml
            workflow:
              name: root
        ''')
        root_path = os.path.join(self.test_dir, 'root.yaml')
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            resolve_includes(spec, self.test_dir, source_path=root_path)
        self.assertIn('Circular', str(context.exception))

    def test_self_include_raises(self):
        main_path = self._write_file('self.yaml', '''\
            includes:
              - self.yaml
            workflow:
              name: self-ref
        ''')
        with open(main_path, encoding='utf-8') as file_handle:
            spec = file_handle.read()
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            resolve_includes(spec, self.test_dir, source_path=main_path)
        self.assertIn('Circular', str(context.exception))

    def test_missing_include_file_raises(self):
        spec = textwrap.dedent('''\
            includes:
              - nonexistent.yaml
            workflow:
              name: test
        ''')
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            resolve_includes(spec, self.test_dir)
        self.assertIn('not found', str(context.exception))

    def test_includes_not_a_list_raises(self):
        spec = textwrap.dedent('''\
            includes: base.yaml
            workflow:
              name: test
        ''')
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            resolve_includes(spec, self.test_dir)
        self.assertIn('list', str(context.exception))

    def test_include_path_not_string_raises(self):
        spec = textwrap.dedent('''\
            includes:
              - 42
            workflow:
              name: test
        ''')
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            resolve_includes(spec, self.test_dir)
        self.assertIn('string', str(context.exception))

    def test_included_file_not_mapping_raises(self):
        self._write_file('list.yaml', '- item1\n- item2\n')
        spec = textwrap.dedent('''\
            includes:
              - list.yaml
            workflow:
              name: test
        ''')
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            resolve_includes(spec, self.test_dir)
        self.assertIn('mapping', str(context.exception))

    def test_relative_paths_in_subdirectories(self):
        self._write_file('bases/common.yaml', '''\
            workflow:
              name: common
              resources:
                default:
                  cpu: 8
        ''')
        spec = textwrap.dedent('''\
            includes:
              - bases/common.yaml
            workflow:
              name: main
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)
        self.assertEqual(parsed['workflow']['resources']['default']['cpu'], 8)

    def test_version_preserved_from_main(self):
        self._write_file('base.yaml', '''\
            version: 2
            workflow:
              name: base
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            version: 2
            workflow:
              name: child
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)
        self.assertEqual(parsed['version'], 2)
        self.assertEqual(parsed['workflow']['name'], 'child')

    def test_quoted_jinja_variables_preserved(self):
        self._write_file('base.yaml', '''\
            workflow:
              name: base
              resources:
                default:
                  cpu: 8
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            workflow:
              name: "{{ workflow_name }}"
              tasks:
                - name: task1
                  image: "my-image:{{ tag }}"
            default-values:
              workflow_name: my-wf
              tag: latest
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        self.assertEqual(parsed['workflow']['name'], '{{ workflow_name }}')
        self.assertEqual(parsed['workflow']['tasks'][0]['image'], 'my-image:{{ tag }}')
        self.assertEqual(parsed['workflow']['resources']['default']['cpu'], 8)

    def test_includes_substring_in_value_ignored(self):
        spec = textwrap.dedent('''\
            workflow:
              name: test
              tasks:
                - name: task1
                  image: ubuntu
                  command: ["echo", "this includes: some text"]
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)
        self.assertEqual(parsed['workflow']['name'], 'test')

    def test_tasks_composed_from_multiple_includes(self):
        self._write_file('tasks/preprocess.yaml', '''\
            workflow:
              tasks:
                - name: preprocess
                  image: preprocess:v1
                  command: ["python3", "preprocess.py"]
        ''')
        self._write_file('tasks/train.yaml', '''\
            workflow:
              tasks:
                - name: train
                  image: train:v1
                  command: ["python3", "train.py"]
        ''')
        self._write_file('tasks/evaluate.yaml', '''\
            workflow:
              tasks:
                - name: evaluate
                  image: evaluate:v1
                  command: ["python3", "evaluate.py"]
        ''')
        spec = textwrap.dedent('''\
            includes:
              - tasks/preprocess.yaml
              - tasks/train.yaml
              - tasks/evaluate.yaml
            workflow:
              name: full-pipeline
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        task_names = [t['name'] for t in parsed['workflow']['tasks']]
        self.assertEqual(task_names, ['preprocess', 'train', 'evaluate'])
        self.assertEqual(parsed['workflow']['name'], 'full-pipeline')

    def test_task_override_from_main_file(self):
        self._write_file('base_tasks.yaml', '''\
            workflow:
              tasks:
                - name: preprocess
                  image: preprocess:v1
                  command: ["python3", "preprocess.py"]
                - name: train
                  image: train:v1
                  command: ["python3", "train.py"]
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base_tasks.yaml
            workflow:
              name: my-pipeline
              tasks:
                - name: train
                  image: train:v2
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        task_names = [t['name'] for t in parsed['workflow']['tasks']]
        self.assertEqual(task_names, ['preprocess', 'train'])
        self.assertEqual(parsed['workflow']['tasks'][0]['image'], 'preprocess:v1')
        self.assertEqual(parsed['workflow']['tasks'][1]['image'], 'train:v2')
        self.assertEqual(parsed['workflow']['tasks'][1]['command'], ['python3', 'train.py'])

    def test_tasks_composed_with_shared_resources(self):
        self._write_file('base.yaml', '''\
            workflow:
              name: base
              resources:
                default:
                  cpu: 8
                  gpu: 1
              timeout:
                execution: 3600
        ''')
        self._write_file('tasks/step_a.yaml', '''\
            workflow:
              tasks:
                - name: step-a
                  image: step-a:latest
                  command: ["run"]
        ''')
        self._write_file('tasks/step_b.yaml', '''\
            workflow:
              tasks:
                - name: step-b
                  image: step-b:latest
                  command: ["run"]
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
              - tasks/step_a.yaml
              - tasks/step_b.yaml
            workflow:
              name: composed-pipeline
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        self.assertEqual(parsed['workflow']['name'], 'composed-pipeline')
        self.assertEqual(parsed['workflow']['resources']['default']['cpu'], 8)
        task_names = [t['name'] for t in parsed['workflow']['tasks']]
        self.assertEqual(task_names, ['step-a', 'step-b'])


class VariableReferenceTests(unittest.TestCase):
    """Unit tests for {{ ref }} task variable references in includes."""

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.test_dir)

    def _write_file(self, relative_path: str, content: str) -> str:
        full_path = os.path.join(self.test_dir, relative_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'w', encoding='utf-8') as file_handle:
            file_handle.write(textwrap.dedent(content))
        return full_path

    def test_basic_task_ref_from_default_values(self):
        self._write_file('base.yaml', '''\
            default-values:
              preprocess:
                image: preprocess:v1
                command: ["python3", "preprocess.py"]
              train:
                image: train:v1
                command: ["python3", "train.py"]
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            workflow:
              name: my-pipeline
              tasks:
                - "{{ preprocess }}"
                - "{{ train }}"
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        task_names = [t['name'] for t in parsed['workflow']['tasks']]
        self.assertEqual(task_names, ['preprocess', 'train'])
        self.assertEqual(parsed['workflow']['tasks'][0]['image'], 'preprocess:v1')
        self.assertEqual(parsed['workflow']['tasks'][1]['command'], ['python3', 'train.py'])

    def test_dot_path_ref(self):
        self._write_file('base.yaml', '''\
            default-values:
              task_library:
                preprocess:
                  image: preprocess:v1
                  command: ["python3", "preprocess.py"]
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            workflow:
              name: pipeline
              tasks:
                - "{{ task_library.preprocess }}"
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        task = parsed['workflow']['tasks'][0]
        self.assertEqual(task['name'], 'preprocess')
        self.assertEqual(task['image'], 'preprocess:v1')

    def test_ref_preserves_explicit_name(self):
        self._write_file('base.yaml', '''\
            default-values:
              my_task:
                name: custom-name
                image: img:v1
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            workflow:
              name: test
              tasks:
                - "{{ my_task }}"
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)
        self.assertEqual(parsed['workflow']['tasks'][0]['name'], 'custom-name')

    def test_ref_with_named_merge_override(self):
        self._write_file('base.yaml', '''\
            default-values:
              preprocess:
                image: preprocess:v1
                command: ["python3", "preprocess.py"]
              train:
                image: train:v1
                command: ["python3", "train.py"]
            workflow:
              tasks:
                - "{{ preprocess }}"
                - "{{ train }}"
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            workflow:
              name: my-pipeline
              tasks:
                - name: train
                  image: train:v2
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        task_names = [t['name'] for t in parsed['workflow']['tasks']]
        self.assertEqual(task_names, ['preprocess', 'train'])
        self.assertEqual(parsed['workflow']['tasks'][0]['image'], 'preprocess:v1')
        self.assertEqual(parsed['workflow']['tasks'][1]['image'], 'train:v2')
        self.assertEqual(parsed['workflow']['tasks'][1]['command'], ['python3', 'train.py'])

    def test_cross_file_ref(self):
        self._write_file('tasks.yaml', '''\
            default-values:
              my_task:
                image: worker:v1
                command: ["run"]
        ''')
        spec = textwrap.dedent('''\
            includes:
              - tasks.yaml
            workflow:
              name: pipeline
              tasks:
                - "{{ my_task }}"
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        self.assertEqual(parsed['workflow']['tasks'][0]['name'], 'my_task')
        self.assertEqual(parsed['workflow']['tasks'][0]['image'], 'worker:v1')

    def test_unresolvable_ref_left_for_jinja(self):
        self._write_file('base.yaml', '''\
            workflow:
              name: base
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            workflow:
              name: test
              tasks:
                - "{{ nonexistent }}"
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)
        self.assertEqual(parsed['workflow']['tasks'], ['{{ nonexistent }}'])

    def test_scalar_ref_left_for_jinja(self):
        self._write_file('base.yaml', '''\
            default-values:
              my_image: ubuntu:24.04
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            workflow:
              name: test
              tasks:
                - "{{ my_image }}"
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)
        self.assertEqual(parsed['workflow']['tasks'], ['{{ my_image }}'])

    def test_ref_mixed_with_inline_tasks(self):
        self._write_file('base.yaml', '''\
            default-values:
              preprocess:
                image: preprocess:v1
                command: ["python3", "preprocess.py"]
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            workflow:
              name: pipeline
              tasks:
                - "{{ preprocess }}"
                - name: custom-task
                  image: custom:v1
                  command: ["bash", "run.sh"]
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        task_names = [t['name'] for t in parsed['workflow']['tasks']]
        self.assertEqual(task_names, ['preprocess', 'custom-task'])

    def test_ref_in_group_tasks(self):
        self._write_file('base.yaml', '''\
            default-values:
              server:
                image: server:v1
                command: ["serve"]
                lead: true
              client:
                image: client:v1
                command: ["connect"]
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            workflow:
              name: grouped
              groups:
                - name: my-group
                  tasks:
                    - "{{ server }}"
                    - "{{ client }}"
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        group = parsed['workflow']['groups'][0]
        task_names = [t['name'] for t in group['tasks']]
        self.assertEqual(task_names, ['server', 'client'])
        self.assertTrue(group['tasks'][0]['lead'])

    def test_null_removes_task(self):
        self._write_file('base.yaml', '''\
            default-values:
              preprocess:
                image: preprocess:v1
                command: ["python3", "preprocess.py"]
              train:
                image: train:v1
                command: ["python3", "train.py"]
            workflow:
              tasks:
                - "{{ preprocess }}"
                - "{{ train }}"
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            default-values:
              train: null
            workflow:
              name: preprocess-only
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        task_names = [t['name'] for t in parsed['workflow']['tasks']]
        self.assertEqual(task_names, ['preprocess'])

    def test_null_removes_from_group_tasks(self):
        self._write_file('base.yaml', '''\
            default-values:
              server:
                image: server:v1
                lead: true
              client:
                image: client:v1
            workflow:
              groups:
                - name: my-group
                  tasks:
                    - "{{ server }}"
                    - "{{ client }}"
        ''')
        spec = textwrap.dedent('''\
            includes:
              - base.yaml
            default-values:
              client: null
            workflow:
              name: server-only
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        group = parsed['workflow']['groups'][0]
        task_names = [t['name'] for t in group['tasks']]
        self.assertEqual(task_names, ['server'])

    def test_null_with_multiple_includes(self):
        self._write_file('tasks_a.yaml', '''\
            default-values:
              task_a:
                image: a:v1
                command: ["run_a"]
        ''')
        self._write_file('tasks_b.yaml', '''\
            default-values:
              task_b:
                image: b:v1
                command: ["run_b"]
              task_c:
                image: c:v1
                command: ["run_c"]
        ''')
        spec = textwrap.dedent('''\
            includes:
              - tasks_a.yaml
              - tasks_b.yaml
            default-values:
              task_b: null
            workflow:
              name: selective
              tasks:
                - "{{ task_a }}"
                - "{{ task_b }}"
                - "{{ task_c }}"
        ''')
        result = resolve_includes(spec, self.test_dir)
        parsed = yaml.safe_load(result)

        task_names = [t['name'] for t in parsed['workflow']['tasks']]
        self.assertEqual(task_names, ['task_a', 'task_c'])


if __name__ == '__main__':
    unittest.main()
