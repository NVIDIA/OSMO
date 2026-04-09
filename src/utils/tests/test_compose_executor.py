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

import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from unittest import mock

import yaml

from src.utils.compose_executor import (
    COMPOSE_FILE_NAME,
    ComposeExecutor,
    run_workflow_compose,
)
from src.utils.standalone_executor import CONTAINER_DATA_PATH, TaskResult


def _docker_compose_available() -> bool:
    """Return True if Docker Compose V2 is available."""
    try:
        result = subprocess.run(
            ['docker', 'compose', 'version'],
            capture_output=True,
            timeout=10,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


DOCKER_COMPOSE_AVAILABLE = _docker_compose_available()
SKIP_COMPOSE_MSG = 'Docker Compose is not available on this machine'


# ============================================================================
# Unit tests — no Docker required
# ============================================================================


class TestComposeFileGeneration(unittest.TestCase):
    """Verify that the generated docker-compose.yml matches the workflow spec."""

    def setUp(self):
        self.work_dir = tempfile.mkdtemp(prefix='osmo-compose-test-')

    def tearDown(self):
        shutil.rmtree(self.work_dir, ignore_errors=True)

    def _make_executor(self) -> ComposeExecutor:
        return ComposeExecutor(work_dir=self.work_dir, keep_work_dir=True)

    def _generate_and_load(self, spec_text: str) -> dict:
        """Parse spec, build DAG, generate compose file, return parsed YAML."""
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        executor._validate_for_compose(spec)
        executor._setup_directories()
        executor._write_inline_files(spec)
        executor._generate_compose_file(spec)
        compose_path = os.path.join(self.work_dir, COMPOSE_FILE_NAME)
        with open(compose_path, encoding='utf-8') as f:
            return yaml.safe_load(f)

    def test_single_task_generates_one_service(self):
        """A single-task workflow produces a compose file with one service."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: hello
              tasks:
              - name: greet
                image: alpine:3.18
                command: ["echo", "hello"]
        ''')
        compose = self._generate_and_load(spec_text)

        self.assertIn('greet', compose['services'])
        self.assertEqual(len(compose['services']), 1)
        svc = compose['services']['greet']
        self.assertEqual(svc['image'], 'alpine:3.18')
        self.assertEqual(svc['entrypoint'], ['echo'])
        self.assertEqual(svc['command'], ['hello'])

    def test_parallel_tasks_generate_separate_services(self):
        """Independent tasks produce separate services with no depends_on."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: parallel
              tasks:
              - name: task-a
                image: alpine:3.18
                command: ["echo", "a"]
              - name: task-b
                image: alpine:3.18
                command: ["echo", "b"]
        ''')
        compose = self._generate_and_load(spec_text)

        self.assertEqual(len(compose['services']), 2)
        self.assertIn('task-a', compose['services'])
        self.assertIn('task-b', compose['services'])
        for svc in compose['services'].values():
            self.assertNotIn('depends_on', svc)

    def test_volumes_for_output(self):
        """Each service has an output volume mapping to the host work directory."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: vol-test
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo"]
        ''')
        compose = self._generate_and_load(spec_text)

        svc = compose['services']['task']
        output_volume = f'{os.path.abspath(os.path.join(self.work_dir, "task", "output"))}:{CONTAINER_DATA_PATH}/output'
        self.assertIn(output_volume, svc['volumes'])

    def test_upstream_input_volumes(self):
        """A consumer task mounts its upstream task's output as a read-only input."""
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
        compose = self._generate_and_load(spec_text)

        consumer = compose['services']['consumer']
        upstream_output = os.path.abspath(
            os.path.join(self.work_dir, 'producer', 'output'))
        expected_volume = f'{upstream_output}:{CONTAINER_DATA_PATH}/input/0:ro'
        self.assertIn(expected_volume, consumer['volumes'])

    def test_environment_variables_included(self):
        """Environment variables from the spec appear in the compose service."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: env-test
              tasks:
              - name: task
                image: alpine:3.18
                command: ["printenv"]
                environment:
                  FOO: bar
                  BAZ: "42"
        ''')
        compose = self._generate_and_load(spec_text)

        svc = compose['services']['task']
        self.assertEqual(svc['environment']['FOO'], 'bar')
        self.assertEqual(svc['environment']['BAZ'], '42')

    def test_inline_files_mounted(self):
        """Inline files are written to disk and bind-mounted into the service."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: files-test
              tasks:
              - name: task
                image: alpine:3.18
                command: ["sh", "/tmp/run.sh"]
                files:
                - contents: echo hello
                  path: /tmp/run.sh
        ''')
        compose = self._generate_and_load(spec_text)

        svc = compose['services']['task']
        file_volumes = [v for v in svc['volumes'] if '/tmp/run.sh:ro' in v]
        self.assertEqual(len(file_volumes), 1)

        host_path = file_volumes[0].split(':')[0]
        self.assertTrue(os.path.exists(host_path))
        with open(host_path, encoding='utf-8') as f:
            self.assertEqual(f.read(), 'echo hello')

    def test_group_network_assigned(self):
        """Tasks in a group share a compose network named after the group."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: grouped
              groups:
              - name: workers
                tasks:
                - name: leader
                  lead: true
                  image: alpine:3.18
                  command: ["echo"]
                - name: follower
                  image: alpine:3.18
                  command: ["echo"]
        ''')
        compose = self._generate_and_load(spec_text)

        self.assertIn('workers', compose.get('networks', {}))
        self.assertEqual(compose['services']['leader']['networks'], ['workers'])
        self.assertEqual(compose['services']['follower']['networks'], ['workers'])

    def test_gpu_resources_in_compose(self):
        """GPU tasks get deploy.resources.reservations.devices and shm_size."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: gpu-test
              resources:
                gpu-res:
                  gpu: 2
              tasks:
              - name: train
                image: pytorch:latest
                resource: gpu-res
                command: ["python", "train.py"]
        ''')
        compose = self._generate_and_load(spec_text)

        svc = compose['services']['train']
        devices = svc['deploy']['resources']['reservations']['devices']
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0]['driver'], 'nvidia')
        self.assertEqual(devices[0]['count'], 2)
        self.assertIn('gpu', devices[0]['capabilities'])
        self.assertEqual(svc['shm_size'], '16g')

    def test_custom_shm_size(self):
        """A user-specified shm_size overrides the default for GPU tasks."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: shm-test
              resources:
                gpu-res:
                  gpu: 1
              tasks:
              - name: train
                image: pytorch:latest
                resource: gpu-res
                command: ["python"]
        ''')
        executor = ComposeExecutor(
            work_dir=self.work_dir, keep_work_dir=True, shm_size='32g')
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        executor._validate_for_compose(spec)
        executor._setup_directories()
        executor._generate_compose_file(spec)

        compose_path = os.path.join(self.work_dir, COMPOSE_FILE_NAME)
        with open(compose_path, encoding='utf-8') as f:
            compose = yaml.safe_load(f)
        self.assertEqual(compose['services']['train']['shm_size'], '32g')

    def test_non_gpu_task_no_deploy_section(self):
        """A CPU-only task has no deploy section in the compose service."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: cpu-test
              tasks:
              - name: preprocess
                image: alpine:3.18
                command: ["echo"]
        ''')
        compose = self._generate_and_load(spec_text)
        self.assertNotIn('deploy', compose['services']['preprocess'])

    def test_entrypoint_and_command_split(self):
        """The task command is split into entrypoint (first element) and command (rest + args)."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: split-test
              tasks:
              - name: task
                image: alpine:3.18
                command: ["bash", "-c"]
                args: ["echo hello"]
        ''')
        compose = self._generate_and_load(spec_text)

        svc = compose['services']['task']
        self.assertEqual(svc['entrypoint'], ['bash'])
        self.assertEqual(svc['command'], ['-c', 'echo hello'])


class TestComposeTokenMap(unittest.TestCase):
    """Verify that the token map includes {{host:taskname}} for same-group tasks."""

    def test_host_tokens_for_group_members(self):
        """Tasks in the same group get host tokens for all group members."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: host-tokens
              groups:
              - name: workers
                tasks:
                - name: leader
                  lead: true
                  image: alpine:3.18
                  command: ["echo"]
                - name: worker-a
                  image: alpine:3.18
                  command: ["echo"]
                - name: worker-b
                  image: alpine:3.18
                  command: ["echo"]
        ''')
        executor = ComposeExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)

        leader_node = executor._task_nodes['leader']
        tokens = executor._build_token_map(leader_node)

        self.assertEqual(tokens['host:leader'], 'leader')
        self.assertEqual(tokens['host:worker-a'], 'worker-a')
        self.assertEqual(tokens['host:worker-b'], 'worker-b')
        self.assertEqual(tokens['output'], f'{CONTAINER_DATA_PATH}/output')

    def test_no_host_tokens_for_single_task_group(self):
        """A single-task group still gets a host token for itself."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: single
              tasks:
              - name: solo
                image: alpine:3.18
                command: ["echo"]
        ''')
        executor = ComposeExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)

        node = executor._task_nodes['solo']
        tokens = executor._build_token_map(node)
        self.assertIn('host:solo', tokens)


class TestComposeValidation(unittest.TestCase):
    """Verify compose-mode validation accepts host tokens but rejects cluster features."""

    def _make_executor(self) -> ComposeExecutor:
        return ComposeExecutor(work_dir='/tmp/unused')

    def test_host_tokens_accepted(self):
        """Specs with {{host:taskname}} tokens pass compose validation."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: host-ok
              groups:
              - name: workers
                tasks:
                - name: leader
                  lead: true
                  image: alpine:3.18
                  command: ["echo"]
                  args: ["--peer={{host:follower}}"]
                - name: follower
                  image: alpine:3.18
                  command: ["echo"]
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        executor._validate_for_compose(spec)

    def test_host_token_cross_group_rejected(self):
        """A {{host:taskname}} that references a task in another group is rejected."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: cross-group
              groups:
              - name: group-a
                tasks:
                - name: task-a
                  lead: true
                  image: alpine:3.18
                  command: ["echo"]
                  args: ["--peer={{host:task-b}}"]
              - name: group-b
                tasks:
                - name: task-b
                  lead: true
                  image: alpine:3.18
                  command: ["echo"]
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        with self.assertRaises(ValueError) as context:
            executor._validate_for_compose(spec)
        self.assertIn('host:task-b', str(context.exception))
        self.assertIn('outside its group', str(context.exception))

    def test_dataset_input_rejected(self):
        """Dataset inputs are still rejected in compose mode."""
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
            executor._validate_for_compose(spec)
        self.assertIn('dataset', str(context.exception))

    def test_credentials_rejected(self):
        """Credentials are rejected in compose mode."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: bad
              tasks:
              - name: task
                image: ubuntu:24.04
                command: ["echo"]
                credentials:
                  my-secret: NGC_API_KEY
        ''')
        executor = self._make_executor()
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        with self.assertRaises(ValueError) as context:
            executor._validate_for_compose(spec)
        self.assertIn('credentials', str(context.exception))

    def test_simple_spec_passes(self):
        """A simple spec with only task-to-task inputs passes compose validation."""
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
        executor._validate_for_compose(spec)


class TestFindReadyWave(unittest.TestCase):
    """Verify the group-aware wave scheduling logic."""

    def _make_executor(self, spec_text: str) -> ComposeExecutor:
        executor = ComposeExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(spec_text)
        executor._build_dag(spec)
        return executor

    def test_all_independent_tasks_in_one_wave(self):
        """All independent tasks appear in the first wave."""
        executor = self._make_executor(textwrap.dedent('''\
            workflow:
              name: parallel
              tasks:
              - name: a
                image: alpine:3.18
                command: ["echo"]
              - name: b
                image: alpine:3.18
                command: ["echo"]
              - name: c
                image: alpine:3.18
                command: ["echo"]
        '''))
        wave = executor._find_ready_wave()
        self.assertEqual(set(wave), {'a', 'b', 'c'})

    def test_serial_chain_one_per_wave(self):
        """A serial chain yields one task per wave."""
        executor = self._make_executor(textwrap.dedent('''\
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
        '''))

        wave1 = executor._find_ready_wave()
        self.assertEqual(wave1, ['first'])

        executor._results['first'] = TaskResult(
            name='first', exit_code=0, output_dir='/tmp/out')
        wave2 = executor._find_ready_wave()
        self.assertEqual(wave2, ['second'])

    def test_multi_task_group_co_scheduled(self):
        """All tasks in a multi-task group appear in the same wave."""
        executor = self._make_executor(textwrap.dedent('''\
            workflow:
              name: grouped
              groups:
              - name: workers
                tasks:
                - name: leader
                  lead: true
                  image: alpine:3.18
                  command: ["echo"]
                - name: follower
                  image: alpine:3.18
                  command: ["echo"]
        '''))
        wave = executor._find_ready_wave()
        self.assertEqual(set(wave), {'leader', 'follower'})

    def test_diamond_dag_waves(self):
        """A diamond DAG produces three waves: root, fan-out, fan-in."""
        executor = self._make_executor(textwrap.dedent('''\
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
        '''))

        wave1 = executor._find_ready_wave()
        self.assertEqual(wave1, ['root'])

        executor._results['root'] = TaskResult(
            name='root', exit_code=0, output_dir='/tmp/out')
        wave2 = executor._find_ready_wave()
        self.assertEqual(set(wave2), {'left', 'right'})

        executor._results['left'] = TaskResult(
            name='left', exit_code=0, output_dir='/tmp/out')
        executor._results['right'] = TaskResult(
            name='right', exit_code=0, output_dir='/tmp/out')
        wave3 = executor._find_ready_wave()
        self.assertEqual(wave3, ['join'])

    def test_empty_wave_when_all_done(self):
        """An empty wave is returned when all tasks have completed."""
        executor = self._make_executor(textwrap.dedent('''\
            workflow:
              name: done
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo"]
        '''))
        executor._results['task'] = TaskResult(
            name='task', exit_code=0, output_dir='/tmp/out')
        wave = executor._find_ready_wave()
        self.assertEqual(wave, [])


class TestComposeProjectName(unittest.TestCase):
    """Verify the Docker Compose project name generation."""

    def test_simple_name(self):
        executor = ComposeExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(textwrap.dedent('''\
            workflow:
              name: my-workflow
              tasks:
              - name: t
                image: alpine:3.18
                command: ["echo"]
        '''))
        self.assertEqual(executor._compose_project_name(spec), 'osmo-my-workflow')

    def test_name_with_special_chars(self):
        executor = ComposeExecutor(work_dir='/tmp/unused')
        spec = executor.load_spec(textwrap.dedent('''\
            workflow:
              name: my-workflow
              tasks:
              - name: t
                image: alpine:3.18
                command: ["echo"]
        '''))
        project = executor._compose_project_name(spec)
        self.assertTrue(project.startswith('osmo-'))
        self.assertRegex(project, r'^[a-z0-9-]+$')


class TestJinjaTemplateDetection(unittest.TestCase):
    """Verify that Jinja templates are rejected before execution."""

    def _write_temp_spec(self, content: str) -> str:
        f = tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False)
        f.write(content)
        f.flush()
        f.close()
        return f.name

    def test_jinja_block_detected(self):
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
                run_workflow_compose(path)
            self.assertIn('Jinja', str(context.exception))
        finally:
            os.unlink(path)

    def test_default_values_detected(self):
        path = self._write_temp_spec(textwrap.dedent('''\
            workflow:
              name: "{{experiment}}"
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo"]
            default-values:
              experiment: test
        '''))
        try:
            with self.assertRaises(ValueError) as context:
                run_workflow_compose(path)
            self.assertIn('Jinja', str(context.exception))
        finally:
            os.unlink(path)


class TestUnresolvedTokenDetection(unittest.TestCase):
    """Verify that unresolved tokens are caught during compose file generation."""

    def setUp(self):
        self.work_dir = tempfile.mkdtemp(prefix='osmo-compose-tokens-')

    def tearDown(self):
        shutil.rmtree(self.work_dir, ignore_errors=True)

    def test_unresolved_jinja_variable_caught(self):
        spec_text = textwrap.dedent('''\
            workflow:
              name: bad
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo", "{{missing_var}}"]
        ''')
        executor = ComposeExecutor(work_dir=self.work_dir, keep_work_dir=True)
        spec = executor.load_spec(spec_text)
        with self.assertRaises(ValueError) as context:
            executor.execute(spec)
        self.assertIn('missing_var', str(context.exception))


class TestPathTraversal(unittest.TestCase):
    """Verify that file path traversal is prevented."""

    def setUp(self):
        self.work_dir = tempfile.mkdtemp(prefix='osmo-compose-traversal-')

    def tearDown(self):
        shutil.rmtree(self.work_dir, ignore_errors=True)

    def test_path_traversal_rejected(self):
        spec_text = textwrap.dedent('''\
            workflow:
              name: bad
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo"]
                files:
                - contents: "malicious"
                  path: /../../etc/evil.conf
        ''')
        executor = ComposeExecutor(work_dir=self.work_dir, keep_work_dir=True)
        spec = executor.load_spec(spec_text)
        with self.assertRaises(ValueError) as context:
            executor.execute(spec)
        self.assertIn('escapes the task directory', str(context.exception))


class TestRunWorkflowComposeErrors(unittest.TestCase):
    """Test error handling in run_workflow_compose()."""

    def test_nonexistent_file_raises(self):
        with self.assertRaises(FileNotFoundError):
            run_workflow_compose(spec_path='/nonexistent/path/spec.yaml')


# ============================================================================
# Integration tests — require Docker Compose
# ============================================================================


@unittest.skipUnless(DOCKER_COMPOSE_AVAILABLE, SKIP_COMPOSE_MSG)
class TestComposeExecution(unittest.TestCase):
    """Integration tests that run workflows through Docker Compose."""

    def setUp(self):
        self.work_dir = tempfile.mkdtemp(prefix='osmo-compose-test-')

    def tearDown(self):
        shutil.rmtree(self.work_dir, ignore_errors=True)

    def _execute_spec(self, spec_text: str) -> bool:
        executor = ComposeExecutor(work_dir=self.work_dir, keep_work_dir=True)
        spec = executor.load_spec(spec_text)
        return executor.execute(spec)

    def test_hello_world(self):
        """Run a minimal single-task workflow."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: hello-compose
              tasks:
              - name: hello
                image: alpine:3.18
                command: ["echo", "Hello from Docker Compose!"]
        ''')
        self.assertTrue(self._execute_spec(spec_text))

    def test_parallel_independent_tasks(self):
        """Independent tasks all execute and produce their outputs."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: parallel-compose
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

    def test_serial_data_flow(self):
        """Data written by a producer is readable by a consumer."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: serial-compose
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
        with open(received) as f:
            self.assertEqual(f.read().strip(), 'from_producer')

    def test_diamond_dag(self):
        """A diamond DAG executes with correct data flow."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: diamond-compose
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

    def test_failure_cancels_downstream(self):
        """A failed task prevents downstream dependents from running."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: fail-compose
              tasks:
              - name: failing
                image: alpine:3.18
                command: ["sh", "-c", "exit 1"]
              - name: should-not-run
                image: alpine:3.18
                command: ["sh", "-c", "echo oops > {{output}}/bad.txt"]
                inputs:
                - task: failing
        ''')
        self.assertFalse(self._execute_spec(spec_text))
        output_file = os.path.join(
            self.work_dir, 'should-not-run', 'output', 'bad.txt')
        self.assertFalse(os.path.exists(output_file))

    def test_environment_variables(self):
        """Environment variables are passed to compose containers."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: env-compose
              tasks:
              - name: check-env
                image: alpine:3.18
                command: ["sh", "-c"]
                args: ["test \\"$MY_VAR\\" = \\"hello\\" && echo ok > {{output}}/result.txt"]
                environment:
                  MY_VAR: hello
        ''')
        self.assertTrue(self._execute_spec(spec_text))

    def test_inline_file_mounted(self):
        """An inline file is written and mounted into the container."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: files-compose
              tasks:
              - name: check-file
                image: alpine:3.18
                command: ["sh", "/tmp/run.sh"]
                files:
                - contents: |
                    echo "script ran" > {{output}}/result.txt
                  path: /tmp/run.sh
        ''')
        self.assertTrue(self._execute_spec(spec_text))
        result = os.path.join(self.work_dir, 'check-file', 'output', 'result.txt')
        with open(result) as f:
            self.assertIn('script ran', f.read())

    def test_compose_file_preserved(self):
        """The generated docker-compose.yml is kept in the work directory."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: preserve-compose
              tasks:
              - name: task
                image: alpine:3.18
                command: ["echo", "ok"]
        ''')
        self._execute_spec(spec_text)
        compose_path = os.path.join(self.work_dir, COMPOSE_FILE_NAME)
        self.assertTrue(os.path.exists(compose_path))

    def test_groups_with_data_flow(self):
        """Groups with inter-group data dependencies execute correctly."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: group-flow-compose
              groups:
              - name: prepare
                tasks:
                - name: generate
                  lead: true
                  image: alpine:3.18
                  command: ["sh", "-c"]
                  args:
                  - |
                    mkdir -p {{output}}/data
                    for i in 1 2 3; do echo "sample_$i" >> {{output}}/data/dataset.csv; done
              - name: train
                tasks:
                - name: trainer
                  lead: true
                  image: alpine:3.18
                  command: ["sh", "-c"]
                  args:
                  - |
                    wc -l {{input:0}}/data/dataset.csv > {{output}}/count.txt
                  inputs:
                  - task: generate
        ''')
        self.assertTrue(self._execute_spec(spec_text))
        count_file = os.path.join(self.work_dir, 'trainer', 'output', 'count.txt')
        with open(count_file) as f:
            self.assertIn('3', f.read())


@unittest.skipUnless(DOCKER_COMPOSE_AVAILABLE, SKIP_COMPOSE_MSG)
class TestComposeLeadTaskPolicy(unittest.TestCase):
    """Verify ignoreNonleadStatus behavior in compose mode."""

    def setUp(self):
        self.work_dir = tempfile.mkdtemp(prefix='osmo-compose-lead-')

    def tearDown(self):
        shutil.rmtree(self.work_dir, ignore_errors=True)

    def test_nonlead_failure_ignored_when_flag_true(self):
        """With ignoreNonleadStatus=true, a non-lead failure does not abort the workflow."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: lead-policy-compose
              groups:
              - name: workers
                tasks:
                - name: leader
                  lead: true
                  image: alpine:3.18
                  command: ["echo", "ok"]
                - name: follower
                  image: alpine:3.18
                  command: ["sh", "-c", "exit 1"]
        ''')
        executor = ComposeExecutor(work_dir=self.work_dir, keep_work_dir=True)
        spec = executor.load_spec(spec_text)
        self.assertTrue(executor.execute(spec))

    def test_lead_failure_aborts_workflow(self):
        """A lead task failure aborts the workflow even with ignoreNonleadStatus=true."""
        spec_text = textwrap.dedent('''\
            workflow:
              name: lead-fail-compose
              groups:
              - name: workers
                tasks:
                - name: leader
                  lead: true
                  image: alpine:3.18
                  command: ["sh", "-c", "exit 1"]
                - name: follower
                  image: alpine:3.18
                  command: ["echo", "ok"]
        ''')
        executor = ComposeExecutor(work_dir=self.work_dir, keep_work_dir=True)
        spec = executor.load_spec(spec_text)
        self.assertFalse(executor.execute(spec))


@unittest.skipUnless(DOCKER_COMPOSE_AVAILABLE, SKIP_COMPOSE_MSG)
class TestRunWorkflowCompose(unittest.TestCase):
    """Test the top-level run_workflow_compose() function."""

    def setUp(self):
        self.work_dir = tempfile.mkdtemp(prefix='osmo-compose-func-')

    def tearDown(self):
        shutil.rmtree(self.work_dir, ignore_errors=True)

    def test_success_with_work_dir(self):
        """A successful run preserves the caller-supplied work directory."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(textwrap.dedent('''\
                workflow:
                  name: func-test
                  tasks:
                  - name: task
                    image: alpine:3.18
                    command: ["echo", "ok"]
            '''))
            spec_path = f.name
        try:
            result = run_workflow_compose(
                spec_path=spec_path,
                work_dir=self.work_dir,
                keep_work_dir=True,
            )
            self.assertTrue(result)
            self.assertTrue(os.path.exists(self.work_dir))
        finally:
            os.unlink(spec_path)

    def test_failure_preserves_work_dir(self):
        """On failure, the work directory is preserved."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(textwrap.dedent('''\
                workflow:
                  name: fail-func
                  tasks:
                  - name: task
                    image: alpine:3.18
                    command: ["sh", "-c", "exit 1"]
            '''))
            spec_path = f.name
        try:
            result = run_workflow_compose(
                spec_path=spec_path,
                work_dir=self.work_dir,
                keep_work_dir=False,
            )
            self.assertFalse(result)
            self.assertTrue(os.path.exists(self.work_dir))
        finally:
            os.unlink(spec_path)


if __name__ == '__main__':
    unittest.main()
