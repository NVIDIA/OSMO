"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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
import subprocess
import tempfile
import textwrap
import unittest
from unittest import mock

from src.utils.job import task as task_module
from src.utils.local_executor import LocalExecutor, TaskNode, TaskResult, run_workflow_locally


# ---------------------------------------------------------------------------
# Helper: detect Docker availability once for the entire module
# ---------------------------------------------------------------------------
def _docker_available() -> bool:
    """Return True if the Docker daemon is reachable via 'docker info', False otherwise."""
    try:
        result = subprocess.run(
            ['docker', 'info'],
            capture_output=True,
            timeout=10,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


DOCKER_AVAILABLE = _docker_available()
SKIP_DOCKER_MSG = 'Docker is not available on this machine'


# ============================================================================
# Unit tests — no Docker required; exercise parsing, DAG, tokens, validation
# ============================================================================
class TestLoadSpec(unittest.TestCase):
    """Verify that real OSMO YAML specs are parsed correctly via the existing Pydantic models."""

    def test_single_task_spec(self):
        """Parse a minimal single-task workflow and verify name, task count, and image."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: hello-osmo
              tasks:
              - name: hello
                image: ubuntu:24.04
                command: ["echo"]
                args: ["Hello from OSMO!"]
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        self.assertEqual(spec.name, 'hello-osmo')
        self.assertEqual(len(spec.tasks), 1)
        self.assertEqual(spec.tasks[0].name, 'hello')
        self.assertEqual(spec.tasks[0].image, 'ubuntu:24.04')

    def test_serial_tasks_spec(self):
        """Parse a two-task serial workflow and verify the task input dependency is resolved."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: serial-tasks
              tasks:
              - name: task1
                image: ubuntu:22.04
                command: [sh]
                args: [/tmp/run.sh]
                files:
                - contents: |
                    echo "Hello from task1"
                    echo "data" > {{output}}/test.txt
                  path: /tmp/run.sh
              - name: task2
                image: ubuntu:22.04
                command: [sh]
                args: [/tmp/run.sh]
                files:
                - contents: |
                    cat {{input:0}}/test.txt
                  path: /tmp/run.sh
                inputs:
                - task: task1
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        self.assertEqual(spec.name, 'serial-tasks')
        self.assertEqual(len(spec.tasks), 2)
        first_input = spec.tasks[1].inputs[0]
        self.assertIsInstance(first_input, task_module.TaskInputOutput)
        if isinstance(first_input, task_module.TaskInputOutput):
            self.assertEqual(first_input.task, 'task1')

    def test_groups_spec(self):
        """Parse a grouped workflow and verify group structure and the lead task flag."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: grouped
              groups:
              - name: first-group
                tasks:
                - name: leader
                  lead: true
                  image: ubuntu:24.04
                  command: ["echo", "leader"]
                - name: follower
                  image: ubuntu:24.04
                  command: ["echo", "follower"]
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        self.assertEqual(len(spec.groups), 1)
        self.assertEqual(len(spec.groups[0].tasks), 2)
        self.assertTrue(spec.groups[0].tasks[0].lead)

    def test_versioned_spec(self):
        """Parse a spec with an explicit version field and verify it loads correctly."""
        spec_text = textwrap.dedent('''\
            version: 2
            workflow:
              name: versioned
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo", "ok"]
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        self.assertEqual(spec.name, 'versioned')

    def test_invalid_version_rejected(self):
        """Reject a spec with an unsupported version number."""
        spec_text = textwrap.dedent('''\
            version: 99
            workflow:
              name: bad-version
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo", "ok"]
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        with self.assertRaises(ValueError):
            executor.load_spec(spec_text)

    def test_both_tasks_and_groups_rejected(self):
        """Reject a spec that defines both top-level tasks and groups simultaneously."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: invalid
              tasks:
              - name: t
                image: alpine:3.18
                command: ["echo"]
              groups:
              - name: g
                tasks:
                - name: t2
                  image: alpine:3.18
                  command: ["echo"]
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        with self.assertRaises(ValueError):
            executor.load_spec(spec_text)

    def test_empty_workflow_rejected(self):
        """Reject a spec with no tasks or groups defined."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: empty
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        with self.assertRaises(ValueError):
            executor.load_spec(spec_text)

    def test_resources_spec_parsed(self):
        """Parse a spec with resource definitions and verify cpu/memory values."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: with-resources
              resources:
                default:
                  cpu: 2
                  memory: 4Gi
                  storage: 10Gi
              tasks:
              - name: task
                image: ubuntu:24.04
                command: ["echo", "ok"]
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        self.assertEqual(spec.resources['default'].cpu, 2)
        self.assertEqual(spec.resources['default'].memory, '4Gi')

    def test_environment_parsed(self):
        """Parse a spec with environment variables and verify key-value pairs are preserved."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: env-test
              tasks:
              - name: task
                image: alpine:3.18
                command: ["printenv"]
                environment:
                  MY_VAR: hello
                  ANOTHER: world
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        self.assertEqual(spec.tasks[0].environment['MY_VAR'], 'hello')
        self.assertEqual(spec.tasks[0].environment['ANOTHER'], 'world')


class TestBuildDag(unittest.TestCase):
    """Verify DAG construction from task dependencies."""

    def _make_executor(self) -> LocalExecutor:
        """Create a LocalExecutor with a throwaway work directory for DAG-only tests."""
        return LocalExecutor(work_dir='/tmp/unused')

    def test_no_dependencies(self):
        """All tasks with no input dependencies have empty upstream and downstream sets."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: parallel
              tasks:
              - name: a
                image: alpine:3.18
                command: ["echo", "a"]
              - name: b
                image: alpine:3.18
                command: ["echo", "b"]
              - name: c
                image: alpine:3.18
                command: ["echo", "c"]
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)

        self.assertEqual(len(executor._task_nodes), 3)
        for node in executor._task_nodes.values():
            self.assertEqual(len(node.upstream), 0)
            self.assertEqual(len(node.downstream), 0)

    def test_serial_chain(self):
        """A three-task chain produces correct upstream/downstream links at each step."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: serial
              tasks:
              - name: first
                image: alpine:3.18
                command: ["echo"]
              - name: second
                image: alpine:3.18
                command: ["echo"]
                inputs:
                - task: first
              - name: third
                image: alpine:3.18
                command: ["echo"]
                inputs:
                - task: second
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)

        self.assertEqual(executor._task_nodes['first'].upstream, set())
        self.assertEqual(executor._task_nodes['first'].downstream, {'second'})
        self.assertEqual(executor._task_nodes['second'].upstream, {'first'})
        self.assertEqual(executor._task_nodes['second'].downstream, {'third'})
        self.assertEqual(executor._task_nodes['third'].upstream, {'second'})
        self.assertEqual(executor._task_nodes['third'].downstream, set())

    def test_diamond_dependency(self):
        """A diamond DAG (root -> left/right -> join) wires fan-out and fan-in edges correctly."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: diamond
              tasks:
              - name: root
                image: alpine:3.18
                command: ["echo"]
              - name: left
                image: alpine:3.18
                command: ["echo"]
                inputs:
                - task: root
              - name: right
                image: alpine:3.18
                command: ["echo"]
                inputs:
                - task: root
              - name: join
                image: alpine:3.18
                command: ["echo"]
                inputs:
                - task: left
                - task: right
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)

        self.assertEqual(executor._task_nodes['root'].downstream, {'left', 'right'})
        self.assertEqual(executor._task_nodes['join'].upstream, {'left', 'right'})

    def test_unknown_dependency_raises(self):
        """Referencing a non-existent upstream task raises ValueError."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: broken
              tasks:
              - name: task1
                image: alpine:3.18
                command: ["echo"]
                inputs:
                - task: nonexistent
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        with self.assertRaises(ValueError) as context:
            executor._build_dag(spec)
        self.assertIn('nonexistent', str(context.exception))

    def test_groups_with_cross_group_deps(self):
        """Dependencies between tasks in different groups are wired correctly."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: cross-group
              groups:
              - name: fetch
                tasks:
                - name: download
                  lead: true
                  image: alpine:3.18
                  command: ["echo"]
              - name: process
                tasks:
                - name: transform
                  lead: true
                  image: alpine:3.18
                  command: ["echo"]
                  inputs:
                  - task: download
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)

        self.assertEqual(executor._task_nodes['download'].downstream, {'transform'})
        self.assertEqual(executor._task_nodes['transform'].upstream, {'download'})


class TestFindReadyTasks(unittest.TestCase):
    """Verify correct identification of tasks ready to execute."""

    def test_all_root_tasks_ready(self):
        """Tasks with no upstream dependencies are immediately ready."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: parallel
              tasks:
              - name: a
                image: alpine:3.18
                command: ["echo"]
              - name: b
                image: alpine:3.18
                command: ["echo"]
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)

        ready = executor._find_ready_tasks()
        self.assertEqual(set(ready), {'a', 'b'})

    def test_dependent_not_ready_until_upstream_completes(self):
        """A downstream task only becomes ready after its upstream dependency completes."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: serial
              tasks:
              - name: first
                image: alpine:3.18
                command: ["echo"]
              - name: second
                image: alpine:3.18
                command: ["echo"]
                inputs:
                - task: first
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)

        ready = executor._find_ready_tasks()
        self.assertEqual(ready, ['first'])

        executor._results['first'] = TaskResult(name='first', exit_code=0, output_dir='/tmp/out')
        ready = executor._find_ready_tasks()
        self.assertEqual(ready, ['second'])

    def test_failed_upstream_blocks_downstream(self):
        """A failed upstream task prevents its downstream dependents from becoming ready."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: serial
              tasks:
              - name: first
                image: alpine:3.18
                command: ["echo"]
              - name: second
                image: alpine:3.18
                command: ["echo"]
                inputs:
                - task: first
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)

        executor._results['first'] = TaskResult(name='first', exit_code=1, output_dir='/tmp/out')
        ready = executor._find_ready_tasks()
        self.assertEqual(ready, [])


class TestCancelDownstream(unittest.TestCase):
    """Verify that downstream tasks are cancelled when an upstream task fails."""

    def test_cascading_cancel(self):
        """Cancellation of a failed task propagates to all transitive downstream dependents."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: chain
              tasks:
              - name: a
                image: alpine:3.18
                command: ["echo"]
              - name: b
                image: alpine:3.18
                command: ["echo"]
                inputs:
                - task: a
              - name: c
                image: alpine:3.18
                command: ["echo"]
                inputs:
                - task: b
        ''')
        executor = LocalExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)

        executor._results['a'] = TaskResult(name='a', exit_code=1, output_dir='/tmp')
        executor._cancel_downstream('a')

        self.assertIn('b', executor._results)
        self.assertIn('c', executor._results)
        self.assertEqual(executor._results['b'].exit_code, -1)
        self.assertEqual(executor._results['c'].exit_code, -1)


class TestSubstituteTokens(unittest.TestCase):
    """Verify {{token}} placeholder replacement in command strings and file contents."""

    def test_output_token(self):
        """The {{output}} token is replaced with the task output directory path."""
        executor = LocalExecutor(work_dir='/tmp/unused')
        tokens = {'output': '/work/task1/output'}
        result = executor._substitute_tokens('echo data > {{output}}/file.txt', tokens)
        self.assertEqual(result, 'echo data > /work/task1/output/file.txt')

    def test_input_by_index(self):
        """The {{input:N}} token is replaced with the Nth upstream output directory."""
        executor = LocalExecutor(work_dir='/tmp/unused')
        tokens = {'input:0': '/work/upstream/output'}
        result = executor._substitute_tokens('cat {{input:0}}/data.csv', tokens)
        self.assertEqual(result, 'cat /work/upstream/output/data.csv')

    def test_input_by_name(self):
        """The {{input:taskname}} token is replaced with the named task's output directory."""
        executor = LocalExecutor(work_dir='/tmp/unused')
        tokens = {'input:task1': '/work/task1/output'}
        result = executor._substitute_tokens('cat {{ input:task1 }}/data.csv', tokens)
        self.assertEqual(result, 'cat /work/task1/output/data.csv')

    def test_whitespace_around_tokens(self):
        """Whitespace inside {{ token }} braces is tolerated during substitution."""
        executor = LocalExecutor(work_dir='/tmp/unused')
        tokens = {'output': '/out'}
        result = executor._substitute_tokens('{{ output }}/file.txt', tokens)
        self.assertEqual(result, '/out/file.txt')

    def test_multiple_tokens_in_one_string(self):
        """Multiple distinct tokens in the same string are all replaced."""
        executor = LocalExecutor(work_dir='/tmp/unused')
        tokens = {'output': '/out', 'input:0': '/in0'}
        result = executor._substitute_tokens('cp {{input:0}}/src {{output}}/dst', tokens)
        self.assertEqual(result, 'cp /in0/src /out/dst')

    def test_no_tokens_unchanged(self):
        """Text without any token placeholders passes through unchanged."""
        executor = LocalExecutor(work_dir='/tmp/unused')
        result = executor._substitute_tokens('plain text no tokens', {})
        self.assertEqual(result, 'plain text no tokens')


class TestBuildTokenMap(unittest.TestCase):
    """Verify that token maps are built correctly from task DAG relationships."""

    def test_output_only(self):
        """A task with no inputs produces a token map containing only the output key."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: simple
              tasks:
              - name: task1
                image: alpine:3.18
                command: ["echo"]
        ''')
        executor = LocalExecutor(work_dir='/tmp/work')
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)

        node = executor._task_nodes['task1']
        tokens = executor._build_token_map(node, '/tmp/work/task1/output')
        self.assertEqual(tokens['output'], '/tmp/work/task1/output')
        self.assertEqual(len(tokens), 1)

    def test_with_upstream_inputs(self):
        """A task with upstream inputs gets both index-based and name-based input tokens."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: serial
              tasks:
              - name: producer
                image: alpine:3.18
                command: ["echo"]
              - name: consumer
                image: alpine:3.18
                command: ["echo"]
                inputs:
                - task: producer
        ''')
        executor = LocalExecutor(work_dir='/tmp/work')
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)

        executor._results['producer'] = TaskResult(
            name='producer', exit_code=0, output_dir='/tmp/work/producer/output')

        node = executor._task_nodes['consumer']
        tokens = executor._build_token_map(node, '/tmp/work/consumer/output')

        self.assertEqual(tokens['output'], '/tmp/work/consumer/output')
        self.assertEqual(tokens['input:0'], '/tmp/work/producer/output')
        self.assertEqual(tokens['input:producer'], '/tmp/work/producer/output')


class TestValidateForLocal(unittest.TestCase):
    """Verify that unsupported features are detected and rejected."""

    def _make_executor(self) -> LocalExecutor:
        """Create a LocalExecutor with a throwaway work directory for validation-only tests."""
        return LocalExecutor(work_dir='/tmp/unused')

    def test_simple_spec_passes(self):
        """A spec using only task-to-task inputs passes local validation."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: ok
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo", "ok"]
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        executor._validate_for_local(spec)

    def test_dataset_input_rejected(self):
        """A spec with dataset inputs is rejected as unsupported in local mode."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: bad
              tasks:
              - name: task
                image: ubuntu:24.04
                command: ["echo"]
                inputs:
                - dataset:
                    name: my_dataset
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        with self.assertRaises(ValueError) as context:
            executor._validate_for_local(spec)
        self.assertIn('dataset', str(context.exception))

    def test_url_input_rejected(self):
        """A spec with URL inputs is rejected as unsupported in local mode."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: bad
              tasks:
              - name: task
                image: ubuntu:24.04
                command: ["echo"]
                inputs:
                - url: s3://my-bucket/data/
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        with self.assertRaises(ValueError) as context:
            executor._validate_for_local(spec)
        self.assertIn('URL', str(context.exception))

    def test_dataset_output_rejected(self):
        """A spec with dataset outputs is rejected as unsupported in local mode."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: bad
              tasks:
              - name: task
                image: ubuntu:24.04
                command: ["echo"]
                outputs:
                - dataset:
                    name: my_dataset
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        with self.assertRaises(ValueError) as context:
            executor._validate_for_local(spec)
        self.assertIn('dataset', str(context.exception).lower())

    def test_url_output_rejected(self):
        """A spec with URL outputs is rejected as unsupported in local mode."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: bad
              tasks:
              - name: task
                image: ubuntu:24.04
                command: ["echo"]
                outputs:
                - url: s3://my-bucket/models/
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        with self.assertRaises(ValueError) as context:
            executor._validate_for_local(spec)
        self.assertIn('object storage', str(context.exception).lower())

    def test_multiple_unsupported_features_all_reported(self):
        """All unsupported features across multiple tasks are reported in a single error."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: bad
              tasks:
              - name: task1
                image: ubuntu:24.04
                command: ["echo"]
                inputs:
                - url: s3://bucket/data/
              - name: task2
                image: ubuntu:24.04
                command: ["echo"]
                inputs:
                - dataset:
                    name: ds
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        with self.assertRaises(ValueError) as context:
            executor._validate_for_local(spec)
        error_message = str(context.exception)
        self.assertIn('task1', error_message)
        self.assertIn('task2', error_message)

    def test_task_deps_only_passes(self):
        """A spec with only task-to-task dependencies passes local validation."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: ok
              tasks:
              - name: producer
                image: alpine:3.18
                command: ["echo"]
              - name: consumer
                image: alpine:3.18
                command: ["echo"]
                inputs:
                - task: producer
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        executor._validate_for_local(spec)

    def test_files_and_env_pass(self):
        """A spec using files and environment variables passes local validation."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: ok
              tasks:
              - name: task
                image: alpine:3.18
                command: ["sh", "/tmp/run.sh"]
                environment:
                  MY_VAR: hello
                files:
                - contents: echo hi
                  path: /tmp/run.sh
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        executor._validate_for_local(spec)


class TestValidateForLocalRemainingBranches(unittest.TestCase):
    """Verify that _validate_for_local rejects credentials, checkpoint, volumeMounts, privileged, and hostNetwork."""

    _UNSUPPORTED_SPECS = {
        'credentials': {
            'yaml': textwrap.dedent('''\
                workflow:
                  name: bad
                  tasks:
                  - name: task
                    image: ubuntu:24.04
                    command: ["echo"]
                    credentials:
                      my-secret: NGC_API_KEY
            '''),
            'expected_substring': 'credentials',
        },
        'checkpoint': {
            'yaml': textwrap.dedent('''\
                workflow:
                  name: bad
                  tasks:
                  - name: task
                    image: ubuntu:24.04
                    command: ["echo"]
                    checkpoint:
                    - path: /output/model
                      url: s3://bucket/checkpoints/
                      frequency: 300
            '''),
            'expected_substring': 'checkpoint',
        },
        'volumeMounts': {
            'yaml': textwrap.dedent('''\
                workflow:
                  name: bad
                  tasks:
                  - name: task
                    image: ubuntu:24.04
                    command: ["echo"]
                    volumeMounts:
                    - "/data:/data:ro"
            '''),
            'expected_substring': 'volumeMounts',
        },
        'privileged': {
            'yaml': textwrap.dedent('''\
                workflow:
                  name: bad
                  tasks:
                  - name: task
                    image: ubuntu:24.04
                    command: ["echo"]
                    privileged: true
            '''),
            'expected_substring': 'privileged',
        },
        'hostNetwork': {
            'yaml': textwrap.dedent('''\
                workflow:
                  name: bad
                  tasks:
                  - name: task
                    image: ubuntu:24.04
                    command: ["echo"]
                    hostNetwork: true
            '''),
            'expected_substring': 'hostNetwork',
        },
    }

    def test_unsupported_fields_rejected(self):
        """Each unsupported task-level field is detected and rejected with a descriptive error."""
        for feature, case in self._UNSUPPORTED_SPECS.items():
            with self.subTest(feature=feature):
                executor = LocalExecutor(work_dir='/tmp/unused')
                spec = executor.load_spec(case['yaml'])
                executor._build_dag(spec)
                with self.assertRaises(ValueError) as context:
                    executor._validate_for_local(spec)
                self.assertIn(case['expected_substring'], str(context.exception))


class TestFilePathTraversal(unittest.TestCase):
    """Verify that file paths cannot escape the task directory."""

    def setUp(self):
        """Create a temporary work directory."""
        self.work_dir = tempfile.mkdtemp(prefix='osmo-local-traversal-')

    def tearDown(self):
        """Remove the temporary work directory."""
        shutil.rmtree(self.work_dir, ignore_errors=True)

    @mock.patch('subprocess.run')
    def test_path_traversal_rejected(self, mock_run):
        """A file spec with a path that escapes the task directory raises ValueError."""
        mock_run.return_value = mock.Mock(returncode=0)
        spec_text = textwrap.dedent('''\
            workflow:
              name: traversal
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo"]
                files:
                - contents: "malicious"
                  path: /../../etc/evil.conf
        ''')
        executor = LocalExecutor(work_dir=self.work_dir, keep_work_dir=True)
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        executor._setup_directories()
        node = executor._task_nodes['task']
        with self.assertRaises(ValueError) as context:
            executor._run_task(node, spec)
        self.assertIn('escapes the task directory', str(context.exception))

    @mock.patch('subprocess.run')
    def test_safe_nested_path_accepted(self, mock_run):
        """A file spec with a safe nested path is accepted without error."""
        mock_run.return_value = mock.Mock(returncode=0)
        spec_text = textwrap.dedent('''\
            workflow:
              name: safe
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo"]
                files:
                - contents: "safe"
                  path: /tmp/scripts/run.sh
        ''')
        executor = LocalExecutor(work_dir=self.work_dir, keep_work_dir=True)
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        executor._setup_directories()
        node = executor._task_nodes['task']
        executor._run_task(node, spec)
        mock_run.assert_called_once()


class TestShmSize(unittest.TestCase):
    """Verify that --shm-size is passed to Docker for GPU tasks."""

    def setUp(self):
        """Create a temporary work directory for shm-size tests."""
        self.work_dir = tempfile.mkdtemp(prefix='osmo-local-shm-')

    def tearDown(self):
        """Remove the temporary work directory after each test."""
        shutil.rmtree(self.work_dir, ignore_errors=True)

    @mock.patch('subprocess.run')
    def test_gpu_task_gets_default_shm_size(self, mock_run):
        """A GPU task includes --shm-size with the default value when none is specified."""
        mock_run.return_value = mock.Mock(returncode=0, stdout='0\n')
        spec_text = textwrap.dedent('''\
            workflow:
              name: shm-test
              resources:
                gpu-resource:
                  gpu: 1
              tasks:
              - name: train
                image: pytorch:latest
                resource: gpu-resource
                command: ["python", "train.py"]
        ''')
        executor = LocalExecutor(work_dir=self.work_dir, keep_work_dir=True)
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        executor._setup_directories()
        node = executor._task_nodes['train']
        executor._run_task(node, spec)

        docker_call_args = mock_run.call_args_list[-1][0][0]
        self.assertIn('--shm-size', docker_call_args)
        shm_index = docker_call_args.index('--shm-size')
        self.assertEqual(docker_call_args[shm_index + 1], '16g')

    @mock.patch('subprocess.run')
    def test_gpu_task_gets_custom_shm_size(self, mock_run):
        """A GPU task uses the user-specified --shm-size value."""
        mock_run.return_value = mock.Mock(returncode=0, stdout='0\n')
        spec_text = textwrap.dedent('''\
            workflow:
              name: shm-test
              resources:
                gpu-resource:
                  gpu: 1
              tasks:
              - name: train
                image: pytorch:latest
                resource: gpu-resource
                command: ["python", "train.py"]
        ''')
        executor = LocalExecutor(work_dir=self.work_dir, keep_work_dir=True, shm_size='32g')
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        executor._setup_directories()
        node = executor._task_nodes['train']
        executor._run_task(node, spec)

        docker_call_args = mock_run.call_args_list[-1][0][0]
        self.assertIn('--shm-size', docker_call_args)
        shm_index = docker_call_args.index('--shm-size')
        self.assertEqual(docker_call_args[shm_index + 1], '32g')

    @mock.patch('subprocess.run')
    def test_non_gpu_task_has_no_default_shm_size(self, mock_run):
        """A CPU-only task without explicit shm_size does not include --shm-size."""
        mock_run.return_value = mock.Mock(returncode=0)
        spec_text = textwrap.dedent('''\
            workflow:
              name: no-gpu
              tasks:
              - name: preprocess
                image: alpine:3.18
                command: ["echo", "ok"]
        ''')
        executor = LocalExecutor(work_dir=self.work_dir, keep_work_dir=True)
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        executor._setup_directories()
        node = executor._task_nodes['preprocess']
        executor._run_task(node, spec)

        docker_call_args = mock_run.call_args[0][0]
        self.assertNotIn('--shm-size', docker_call_args)

    @mock.patch('subprocess.run')
    def test_non_gpu_task_gets_explicit_shm_size(self, mock_run):
        """A CPU-only task gets --shm-size when the user explicitly specifies it."""
        mock_run.return_value = mock.Mock(returncode=0)
        spec_text = textwrap.dedent('''\
            workflow:
              name: no-gpu
              tasks:
              - name: preprocess
                image: alpine:3.18
                command: ["echo", "ok"]
        ''')
        executor = LocalExecutor(work_dir=self.work_dir, keep_work_dir=True, shm_size='8g')
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        executor._setup_directories()
        node = executor._task_nodes['preprocess']
        executor._run_task(node, spec)

        docker_call_args = mock_run.call_args[0][0]
        self.assertIn('--shm-size', docker_call_args)
        shm_index = docker_call_args.index('--shm-size')
        self.assertEqual(docker_call_args[shm_index + 1], '8g')


class TestJinjaTemplateDetection(unittest.TestCase):
    """Verify that specs containing Jinja template markers are rejected before execution."""

    def _write_temp_spec(self, content: str) -> str:
        """Write YAML content to a temporary file and return its path."""
        f = tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False)
        f.write(content)
        f.flush()
        f.close()
        return f.name

    def test_jinja_block_detected(self):
        """A spec containing {% %} Jinja block tags is rejected."""
        path = self._write_temp_spec(textwrap.dedent('''\
            workflow:
              name: {% if true %}test{% endif %}
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo"]
        '''))
        try:
            with self.assertRaises(ValueError) as context:
                run_workflow_locally(path)
            self.assertIn('Jinja', str(context.exception))
        finally:
            os.unlink(path)

    def test_jinja_comment_detected(self):
        """A spec containing {# #} Jinja comment tags is rejected."""
        path = self._write_temp_spec(textwrap.dedent('''\
            {# A comment #}
            workflow:
              name: test
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo"]
        '''))
        try:
            with self.assertRaises(ValueError) as context:
                run_workflow_locally(path)
            self.assertIn('Jinja', str(context.exception))
        finally:
            os.unlink(path)

    def test_default_values_section_detected(self):
        """A spec containing a 'default-values' section is rejected as a Jinja template."""
        path = self._write_temp_spec(textwrap.dedent('''\
            workflow:
              name: "{{experiment_name}}"
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo"]
            default-values:
              experiment_name: my-experiment
        '''))
        try:
            with self.assertRaises(ValueError) as context:
                run_workflow_locally(path)
            self.assertIn('Jinja', str(context.exception))
        finally:
            os.unlink(path)


# ============================================================================
# Tests that exercise error paths without requiring Docker
# ============================================================================
class TestDockerNotFoundHandling(unittest.TestCase):
    """Verify graceful failure when Docker is not available (no Docker required to run)."""

    def setUp(self):
        """Create a temporary work directory."""
        self.work_dir = tempfile.mkdtemp(prefix='osmo-local-test-')

    def tearDown(self):
        """Remove the temporary work directory."""
        shutil.rmtree(self.work_dir, ignore_errors=True)

    def test_docker_not_found_graceful_failure(self):
        """Using a non-existent docker binary results in a graceful failure rather than a crash."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: no-docker
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo", "ok"]
        ''')
        executor = LocalExecutor(
            work_dir=self.work_dir,
            keep_work_dir=True,
            docker_cmd='nonexistent-docker-binary-12345',
        )
        spec = executor.load_spec(spec_text)
        self.assertFalse(executor.execute(spec))


class TestCookbookSpecValidation(unittest.TestCase):
    """
    Validate that cookbook specs using unsupported features are rejected
    before any container is started (no Docker required to run).
    """

    COOKBOOK_DIR = os.path.join(os.path.dirname(__file__), '..', '..', '..',
                               'cookbook', 'tutorials')

    def setUp(self):
        """Create a temporary work directory for cookbook validation tests."""
        self.work_dir = tempfile.mkdtemp(prefix='osmo-local-cookbook-')

    def tearDown(self):
        """Remove the temporary work directory after each test."""
        shutil.rmtree(self.work_dir, ignore_errors=True)

    def _run_cookbook_spec(self, filename: str) -> bool:
        """Execute a cookbook tutorial spec file through the local executor."""
        spec_path = os.path.join(self.COOKBOOK_DIR, filename)
        self.assertTrue(os.path.exists(spec_path),
                        f'Cookbook file not found: {spec_path}')
        return run_workflow_locally(
            spec_path=spec_path,
            work_dir=self.work_dir,
            keep_work_dir=True,
        )

    def test_unsupported_spec_data_download(self):
        """data_download.yaml uses URL inputs — verify it is cleanly rejected."""
        with self.assertRaises(ValueError) as context:
            self._run_cookbook_spec('data_download.yaml')
        self.assertIn('URL', str(context.exception))

    def test_unsupported_spec_data_upload(self):
        """data_upload.yaml uses URL outputs — verify it is cleanly rejected."""
        with self.assertRaises(ValueError) as context:
            self._run_cookbook_spec('data_upload.yaml')
        self.assertIn('object storage', str(context.exception).lower())

    def test_unsupported_spec_dataset_upload(self):
        """dataset_upload.yaml uses dataset outputs — verify it is cleanly rejected."""
        with self.assertRaises(ValueError) as context:
            self._run_cookbook_spec('dataset_upload.yaml')
        self.assertIn('dataset', str(context.exception).lower())

    def test_unsupported_spec_template(self):
        """template_hello_world.yaml uses default-values templating — verify it is rejected."""
        spec_path = os.path.join(self.COOKBOOK_DIR, 'template_hello_world.yaml')
        self.assertTrue(os.path.exists(spec_path),
                        f'Cookbook file not found: {spec_path}')
        with self.assertRaises(ValueError) as context:
            run_workflow_locally(
                spec_path=spec_path,
                work_dir=self.work_dir,
                keep_work_dir=True,
            )
        self.assertIn('Jinja', str(context.exception))


class TestRunWorkflowLocallyErrors(unittest.TestCase):
    """Test error handling in run_workflow_locally() that does not require Docker."""

    def test_nonexistent_file_raises(self):
        """Passing a non-existent spec file path raises FileNotFoundError."""
        with self.assertRaises(FileNotFoundError):
            run_workflow_locally(spec_path='/nonexistent/path/spec.yaml')


# ============================================================================
# Integration tests — require Docker; test actual container execution
# ============================================================================
@unittest.skipUnless(DOCKER_AVAILABLE, SKIP_DOCKER_MSG)
class TestDockerExecution(unittest.TestCase):
    """
    Integration tests that run real OSMO workflow specs through the local executor
    using Docker. Each test uses a spec that would normally run on a Kubernetes cluster.
    """

    def setUp(self):
        """Create a temporary work directory for each Docker execution test."""
        self.work_dir = tempfile.mkdtemp(prefix='osmo-local-test-')

    def tearDown(self):
        """Remove the temporary work directory after each test."""
        shutil.rmtree(self.work_dir, ignore_errors=True)

    def _execute_spec(self, spec_text: str) -> bool:
        """Parse and execute a workflow spec string, returning the success status."""
        executor = LocalExecutor(work_dir=self.work_dir, keep_work_dir=True)
        spec = executor.load_spec(spec_text)
        return executor.execute(spec)

    # ---- Single task tests ----

    def test_hello_world(self):
        """Run a minimal single-task workflow that echoes a message."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: hello-osmo
              tasks:
              - name: hello
                image: alpine:3.18
                command: ["echo", "Hello from OSMO!"]
        ''')
        self.assertTrue(self._execute_spec(spec_text))

    def test_single_task_with_args(self):
        """Run a task with separate command and args fields."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: args-test
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo"]
                args: ["argument1", "argument2"]
        ''')
        self.assertTrue(self._execute_spec(spec_text))

    def test_task_failure_returns_false(self):
        """A task that exits with a non-zero code causes execute() to return False."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: will-fail
              tasks:
              - name: failing-task
                image: alpine:3.18
                command: ["sh", "-c", "exit 42"]
        ''')
        self.assertFalse(self._execute_spec(spec_text))

    # ---- Environment variable tests ----

    def test_environment_variables(self):
        """Environment variables declared in the spec are passed to the Docker container."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: env-test
              tasks:
              - name: check-env
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["test \\"$MY_VAR\\" = \\"hello_world\\" && test \\"$SECOND\\" = \\"42\\""]
                environment:
                  MY_VAR: hello_world
                  SECOND: "42"
        ''')
        self.assertTrue(self._execute_spec(spec_text))

    # ---- Files mount tests ----

    def test_inline_file_mounted(self):
        """An inline file declared in the spec is mounted and executable inside the container."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: files-test
              tasks:
              - name: check-file
                image: alpine:3.18
                command: ["sh", "/tmp/run.sh"]
                files:
                - contents: |
                    echo "script ran successfully"
                  path: /tmp/run.sh
        ''')
        self.assertTrue(self._execute_spec(spec_text))

    def test_multiple_files_mounted(self):
        """Multiple inline files at different paths are all mounted into the container."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: multi-files
              tasks:
              - name: check-files
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["cat /tmp/config.txt && sh /scripts/run.sh"]
                files:
                - contents: "key=value"
                  path: /tmp/config.txt
                - contents: |
                    echo "second script ok"
                  path: /scripts/run.sh
        ''')
        self.assertTrue(self._execute_spec(spec_text))

    # ---- Data output tests ----

    def test_output_directory_writable(self):
        """The {{output}} directory is writable from inside the container and persists on the host."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: output-test
              tasks:
              - name: write-output
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["echo 'payload' > {{output}}/result.txt"]
        ''')
        self.assertTrue(self._execute_spec(spec_text))
        output_file = os.path.join(self.work_dir, 'write-output', 'output', 'result.txt')
        self.assertTrue(os.path.exists(output_file))
        with open(output_file) as f:
            self.assertEqual(f.read().strip(), 'payload')

    # ---- Serial data flow tests ----

    def test_serial_data_flow_two_tasks(self):
        """Data written to {{output}} by a producer is readable via {{input:0}} by the consumer."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: serial-data
              tasks:
              - name: producer
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["echo 'from_producer' > {{output}}/data.txt"]
              - name: consumer
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["cat {{input:0}}/data.txt > {{output}}/received.txt"]
                inputs:
                - task: producer
        ''')
        self.assertTrue(self._execute_spec(spec_text))
        received = os.path.join(self.work_dir, 'consumer', 'output', 'received.txt')
        self.assertTrue(os.path.exists(received))
        with open(received) as f:
            self.assertEqual(f.read().strip(), 'from_producer')

    def test_serial_chain_three_tasks(self):
        """Mimics cookbook/tutorials/serial_workflow.yaml"""
        spec_text = textwrap.dedent('''\
            workflow:
              name: serial-chain
              tasks:
              - name: task1
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["echo 'task1_data' > {{output}}/result.txt"]

              - name: task2
                image: alpine:3.18
                command: ["sh", "-c"]
                args:
                - |
                  cat {{input:0}}/result.txt > {{output}}/result.txt
                  echo '_plus_task2' >> {{output}}/result.txt
                inputs:
                - task: task1

              - name: task3
                image: alpine:3.18
                command: ["sh", "-c"]
                args:
                - |
                  cat {{input:0}}/result.txt > {{output}}/final.txt
                  cat {{input:1}}/result.txt >> {{output}}/final.txt
                inputs:
                - task: task1
                - task: task2
        ''')
        self.assertTrue(self._execute_spec(spec_text))
        final = os.path.join(self.work_dir, 'task3', 'output', 'final.txt')
        with open(final) as f:
            content = f.read()
        self.assertIn('task1_data', content)
        self.assertIn('_plus_task2', content)

    # ---- Parallel execution tests ----

    def test_parallel_independent_tasks(self):
        """Independent tasks with no dependencies all execute and produce their respective outputs."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: parallel-tasks
              tasks:
              - name: task-a
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["echo 'a' > {{output}}/marker.txt"]
              - name: task-b
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["echo 'b' > {{output}}/marker.txt"]
              - name: task-c
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["echo 'c' > {{output}}/marker.txt"]
        ''')
        self.assertTrue(self._execute_spec(spec_text))
        for task_name, expected in [('task-a', 'a'), ('task-b', 'b'), ('task-c', 'c')]:
            marker = os.path.join(self.work_dir, task_name, 'output', 'marker.txt')
            with open(marker) as f:
                self.assertEqual(f.read().strip(), expected)

    # ---- Diamond DAG tests ----

    def test_diamond_dag(self):
        """A diamond-shaped DAG executes correctly with fan-out and fan-in data flow."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: diamond
              tasks:
              - name: root
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["echo 'root_data' > {{output}}/base.txt"]
              - name: left
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["echo 'left:' > {{output}}/result.txt && cat {{input:0}}/base.txt >> {{output}}/result.txt"]
                inputs:
                - task: root
              - name: right
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["echo 'right:' > {{output}}/result.txt && cat {{input:0}}/base.txt >> {{output}}/result.txt"]
                inputs:
                - task: root
              - name: join
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["cat {{input:0}}/result.txt > {{output}}/final.txt && cat {{input:1}}/result.txt >> {{output}}/final.txt"]
                inputs:
                - task: left
                - task: right
        ''')
        self.assertTrue(self._execute_spec(spec_text))
        final = os.path.join(self.work_dir, 'join', 'output', 'final.txt')
        with open(final) as f:
            content = f.read()
        self.assertIn('left:', content)
        self.assertIn('right:', content)
        self.assertIn('root_data', content)

    # ---- Failure propagation tests ----

    def test_failure_cancels_downstream(self):
        """A failed task prevents its downstream dependent from running."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: fail-chain
              tasks:
              - name: failing
                image: alpine:3.18
                command: ["sh", "-c", "exit 1"]
              - name: should-not-run
                image: alpine:3.18
                command: ["sh", "-c", "echo 'oops' > {{output}}/should_not_exist.txt"]
                inputs:
                - task: failing
        ''')
        self.assertFalse(self._execute_spec(spec_text))
        output_file = os.path.join(self.work_dir, 'should-not-run', 'output', 'should_not_exist.txt')
        self.assertFalse(os.path.exists(output_file))

    def test_parallel_failure_does_not_affect_independent_branch(self):
        """When one branch of a parallel DAG fails, the executor stops with overall failure."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: partial-fail
              tasks:
              - name: root
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["echo ok > {{output}}/data.txt"]
              - name: fail-branch
                image: alpine:3.18
                command: ["sh", "-c", "exit 1"]
                inputs:
                - task: root
              - name: ok-branch
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["cat {{input:0}}/data.txt > {{output}}/received.txt"]
                inputs:
                - task: root
        ''')
        result = self._execute_spec(spec_text)
        # The executor should stop on first failure, so the overall result is False.
        # root succeeds, then one of the branches fails.
        self.assertFalse(result)

    # ---- Groups (ganged tasks) tests ----

    def test_group_with_single_task(self):
        """A group containing a single lead task executes and produces output."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: single-group
              groups:
              - name: my-group
                tasks:
                - name: leader
                  lead: true
                  image: alpine:3.18
                  command: ["sh", "-c"]
                  args: ["echo 'group_ok' > {{output}}/marker.txt"]
        ''')
        self.assertTrue(self._execute_spec(spec_text))
        marker = os.path.join(self.work_dir, 'leader', 'output', 'marker.txt')
        with open(marker) as f:
            self.assertEqual(f.read().strip(), 'group_ok')

    def test_groups_with_data_flow(self):
        """Mimics cookbook/tutorials/combination_workflow_simple.yaml structure."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: data-pipeline
              groups:
              - name: prepare-data
                tasks:
                - name: generate-dataset
                  lead: true
                  image: alpine:3.18
                  command: ["sh", "-c"]
                  args:
                  - |
                    mkdir -p {{output}}/data
                    for i in 1 2 3; do echo "sample_$i" >> {{output}}/data/dataset.csv; done
              - name: train-models
                tasks:
                - name: train-model
                  lead: true
                  image: alpine:3.18
                  command: ["sh", "-c"]
                  args:
                  - |
                    wc -l {{input:0}}/data/dataset.csv > {{output}}/line_count.txt
                  inputs:
                  - task: generate-dataset
        ''')
        self.assertTrue(self._execute_spec(spec_text))
        line_count_file = os.path.join(self.work_dir, 'train-model', 'output', 'line_count.txt')
        with open(line_count_file) as f:
            content = f.read()
        self.assertIn('3', content)

    # ---- Input by task name tests ----

    def test_input_by_task_name(self):
        """The {{input:taskname}} token resolves to the named upstream task's output directory."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: named-input
              tasks:
              - name: producer
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["echo 'named_data' > {{output}}/out.txt"]
              - name: consumer
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["cat {{input:producer}}/out.txt > {{output}}/received.txt"]
                inputs:
                - task: producer
        ''')
        self.assertTrue(self._execute_spec(spec_text))
        received = os.path.join(self.work_dir, 'consumer', 'output', 'received.txt')
        with open(received) as f:
            self.assertEqual(f.read().strip(), 'named_data')

    # ---- Files with token substitution ----

    def test_file_contents_with_token_substitution(self):
        """Mimics cookbook/tutorials/serial_workflow.yaml pattern of inline scripts with tokens."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: file-tokens
              tasks:
              - name: writer
                image: alpine:3.18
                command: ["sh", "/tmp/run.sh"]
                files:
                - contents: |
                    echo "writing output"
                    echo "file_data" > {{output}}/result.txt
                  path: /tmp/run.sh
              - name: reader
                image: alpine:3.18
                command: ["sh", "/tmp/run.sh"]
                files:
                - contents: |
                    cat {{input:0}}/result.txt > {{output}}/received.txt
                  path: /tmp/run.sh
                inputs:
                - task: writer
        ''')
        self.assertTrue(self._execute_spec(spec_text))
        received = os.path.join(self.work_dir, 'reader', 'output', 'received.txt')
        with open(received) as f:
            self.assertEqual(f.read().strip(), 'file_data')

    # ---- Resource spec ignored gracefully ----

    def test_resources_ignored_gracefully(self):
        """Resource specs are K8s-specific; local executor should accept and ignore them."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: with-resources
              resources:
                default:
                  cpu: 2
                  memory: 4Gi
                  storage: 10Gi
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo", "ok"]
        ''')
        self.assertTrue(self._execute_spec(spec_text))

    # ---- Alternative container runtime ----

    def test_custom_docker_command(self):
        """An explicitly specified docker command is used to run the container."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: custom-cmd
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo", "ok"]
        ''')
        executor = LocalExecutor(
            work_dir=self.work_dir,
            keep_work_dir=True,
            docker_cmd='docker',
        )
        spec = executor.load_spec(spec_text)
        self.assertTrue(executor.execute(spec))


# ============================================================================
# Integration tests using actual cookbook spec files from the repo
# ============================================================================
@unittest.skipUnless(DOCKER_AVAILABLE, SKIP_DOCKER_MSG)
class TestCookbookSpecs(unittest.TestCase):
    """
    Run real OSMO cookbook YAML specs that are designed for Kubernetes clusters,
    and verify they execute successfully in the local Docker executor.
    """

    COOKBOOK_DIR = os.path.join(os.path.dirname(__file__), '..', '..', '..',
                               'cookbook', 'tutorials')

    def setUp(self):
        """Create a temporary work directory for cookbook spec tests."""
        self.work_dir = tempfile.mkdtemp(prefix='osmo-local-cookbook-')

    def tearDown(self):
        """Remove the temporary work directory after each cookbook test."""
        shutil.rmtree(self.work_dir, ignore_errors=True)

    def _run_cookbook_spec(self, filename: str) -> bool:
        """Execute a cookbook tutorial spec file through the local executor."""
        spec_path = os.path.join(self.COOKBOOK_DIR, filename)
        self.assertTrue(os.path.exists(spec_path),
                        f'Cookbook file not found: {spec_path}')
        return run_workflow_locally(
            spec_path=spec_path,
            work_dir=self.work_dir,
            keep_work_dir=True,
        )

    def test_hello_world_yaml(self):
        """Execute the hello_world.yaml cookbook tutorial spec."""
        self.assertTrue(self._run_cookbook_spec('hello_world.yaml'))

    def test_parallel_tasks_yaml(self):
        """Execute the parallel_tasks.yaml cookbook tutorial spec."""
        self.assertTrue(self._run_cookbook_spec('parallel_tasks.yaml'))

    def test_serial_workflow_yaml(self):
        """Execute the serial_workflow.yaml cookbook tutorial spec."""
        self.assertTrue(self._run_cookbook_spec('serial_workflow.yaml'))

    def test_resources_basic_yaml(self):
        """Execute the resources_basic.yaml cookbook tutorial spec."""
        self.assertTrue(self._run_cookbook_spec('resources_basic.yaml'))

    def test_combination_workflow_simple_yaml(self):
        """
        The combination_workflow_simple.yaml has a 'sleep 120' in transform-a.
        We skip it here because it would take 2+ minutes; a trimmed version
        of the same structure is tested in TestDockerExecution.test_groups_with_data_flow.
        """
        self.skipTest('Contains sleep 120; covered by test_groups_with_data_flow')


# ============================================================================
# run_workflow_locally() integration tests
# ============================================================================
@unittest.skipUnless(DOCKER_AVAILABLE, SKIP_DOCKER_MSG)
class TestRunWorkflowLocally(unittest.TestCase):
    """Test the top-level run_workflow_locally() convenience function."""

    def setUp(self):
        """Create a temporary work directory for run_workflow_locally tests."""
        self.work_dir = tempfile.mkdtemp(prefix='osmo-local-func-')

    def tearDown(self):
        """Remove the temporary work directory after each test."""
        shutil.rmtree(self.work_dir, ignore_errors=True)

    def test_caller_supplied_work_dir_preserved_on_success(self):
        """A caller-supplied work_dir is never deleted, even with keep_work_dir=False."""
        work_dir = tempfile.mkdtemp(prefix='osmo-local-cleanup-')
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(textwrap.dedent('''\
                workflow:
                  name: cleanup-test
                  tasks:
                  - name: task
                    image: alpine:3.18
                    command: ["echo", "ok"]
            '''))
            spec_path = f.name
        try:
            result = run_workflow_locally(
                spec_path=spec_path,
                work_dir=work_dir,
                keep_work_dir=False,
            )
            self.assertTrue(result)
            self.assertTrue(os.path.exists(work_dir))
        finally:
            os.unlink(spec_path)
            if os.path.exists(work_dir):
                shutil.rmtree(work_dir, ignore_errors=True)

    def test_failure_preserves_work_dir(self):
        """On failure, the work directory is preserved for debugging regardless of the keep flag."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(textwrap.dedent('''\
                workflow:
                  name: fail-test
                  tasks:
                  - name: task
                    image: alpine:3.18
                    command: ["sh", "-c", "exit 1"]
            '''))
            spec_path = f.name
        try:
            result = run_workflow_locally(
                spec_path=spec_path,
                work_dir=self.work_dir,
                keep_work_dir=False,
            )
            self.assertFalse(result)
            self.assertTrue(os.path.exists(self.work_dir))
        finally:
            os.unlink(spec_path)

    def test_keep_flag_preserves_on_success(self):
        """With keep_work_dir=True, the work directory is preserved even on success."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(textwrap.dedent('''\
                workflow:
                  name: keep-test
                  tasks:
                  - name: task
                    image: alpine:3.18
                    command: ["echo", "ok"]
            '''))
            spec_path = f.name
        try:
            result = run_workflow_locally(
                spec_path=spec_path,
                work_dir=self.work_dir,
                keep_work_dir=True,
            )
            self.assertTrue(result)
            self.assertTrue(os.path.exists(self.work_dir))
        finally:
            os.unlink(spec_path)


if __name__ == '__main__':
    unittest.main()
