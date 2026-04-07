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
# Security: This module executes workflow specs by generating a
# docker-compose.yml and invoking Docker Compose via subprocess.
# Specs must come from trusted sources.  Path-traversal protections
# are in place for data directories, but the spec itself is not sandboxed.

import dataclasses
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
from collections import deque
from typing import Dict, List, Set

import yaml

from src.utils import spec_includes
from src.utils.job import task as task_module
from src.utils.job import workflow as workflow_module


logger = logging.getLogger(__name__)

STATE_FILE_NAME = '.osmo-state.json'
COMPOSE_FILE_NAME = 'docker-compose.yml'

OSMO_OUTPUT_PATH = '/osmo/data/output'
OSMO_INPUT_PATH_PREFIX = '/osmo/data/input'

_OSMO_RUNTIME_TOKEN = re.compile(
    r'\{\{\s*(uuid|workflow_id|output|input:[^}]+|host:[^}]+|item)\s*\}\}')
_ANY_DOUBLE_BRACE = re.compile(r'\{\{[^}]+?\}\}')


@dataclasses.dataclass
class TaskNode:
    """A node in the workflow DAG, linking a task spec to its upstream
    and downstream dependencies."""

    name: str
    spec: task_module.TaskSpec
    group: str
    upstream: Set[str] = dataclasses.field(default_factory=set)
    downstream: Set[str] = dataclasses.field(default_factory=set)


@dataclasses.dataclass
class TaskResult:
    """Outcome of a single task execution, capturing its exit code and output directory path."""

    name: str
    exit_code: int
    output_dir: str


class LocalExecutor:
    """
    Executes an OSMO workflow spec locally using Docker Compose, without Kubernetes.

    Generates a docker-compose.yml from the workflow spec and runs
    ``docker compose up``, giving:

      - Correct container paths matching on-cluster behavior
        (``/osmo/data/output``, ``/osmo/data/input/N``)
      - Real parallel execution with native dependency ordering
        via ``depends_on: condition: service_completed_successfully``
      - Cycle detection (Compose validates the DAG; also checked upfront)
      - DNS-addressable service names for ``{{host:taskname}}``
      - GPU passthrough via ``deploy.resources.reservations.devices``

    Does NOT support (raises clear errors):
      - Dataset / URL inputs/outputs (require object storage)
      - Credentials, checkpoints, volumeMounts (require cluster infra)
      - Templated specs with Jinja (require server-side expansion; use --dry-run first)
    """

    DEFAULT_SHM_SIZE = '16g'

    _ENTRYPOINT_COMMANDS = frozenset({
        'bash', 'sh', 'dash', 'zsh',
        'python', 'python3', 'python3.10', 'python3.11', 'python3.12',
        'perl', 'ruby', 'node',
    })

    def __init__(self, work_dir: str, keep_work_dir: bool = False,
                 docker_cmd: str = 'docker',
                 shm_size: str | None = None,
                 extra_volumes: List[str] | None = None):
        """Initialize the executor with a work directory, cleanup preference,
        and container runtime command.

        Args:
            extra_volumes: Additional Docker volume mounts (``host:container``
                strings) added to every task.  Useful for making host paths
                (e.g. repository root, credential directories) visible inside
                containers.
        """
        self._work_dir = os.path.abspath(work_dir)
        self._keep_work_dir = keep_work_dir
        self._docker_cmd = docker_cmd
        self._shm_size = shm_size
        self._extra_volumes = list(extra_volumes) if extra_volumes else []
        self._task_nodes: Dict[str, TaskNode] = {}
        self._results: Dict[str, TaskResult] = {}
        self._available_gpus: int | None = None

    def _detect_available_gpus(self) -> int:
        """Query nvidia-smi to count available GPUs, caching the result for subsequent calls."""
        if self._available_gpus is not None:
            return self._available_gpus
        try:
            result = subprocess.run(
                ['nvidia-smi', '--query-gpu=index',
                 '--format=csv,noheader'],
                capture_output=True, text=True, timeout=10,
                check=False,
            )
            if result.returncode == 0:
                gpu_indices = [
                    line.strip()
                    for line in result.stdout.strip().splitlines()
                    if line.strip()
                ]
                self._available_gpus = len(gpu_indices)
            else:
                logger.warning(
                    'nvidia-smi failed (exit %d) — assuming 0 GPUs available',
                    result.returncode)
                self._available_gpus = 0
        except FileNotFoundError:
            logger.warning('nvidia-smi not found — assuming 0 GPUs available')
            self._available_gpus = 0
        except subprocess.TimeoutExpired:
            logger.warning('nvidia-smi timed out — assuming 0 GPUs available')
            self._available_gpus = 0
        return self._available_gpus

    def load_spec(self, spec_text: str) -> workflow_module.WorkflowSpec:
        """Parse raw YAML text into a validated WorkflowSpec via the versioned spec model."""
        raw = yaml.safe_load(spec_text)
        versioned = workflow_module.VersionedWorkflowSpec(**raw)
        return versioned.workflow

    def execute(self, spec: workflow_module.WorkflowSpec,
                resume: bool = False, from_step: str | None = None) -> bool:
        """Run all tasks via Docker Compose, returning True if the entire workflow succeeds."""
        self._results.clear()
        self._build_dag(spec)
        self._detect_cycles()
        self._validate_for_local(spec)
        self._setup_directories()

        if resume or from_step:
            self._restore_completed_tasks(from_step)

        tasks_to_run = set(self._task_nodes.keys()) - set(self._results.keys())
        if not tasks_to_run:
            logger.info('Workflow "%s": all tasks already completed', spec.name)
            return True

        total_tasks = sum(len(g.tasks) for g in self._groups(spec))
        skipped = len(self._results)
        if skipped > 0:
            logger.info('Workflow "%s": resuming — %d task(s) skipped, %d remaining',
                         spec.name, skipped, len(tasks_to_run))
        else:
            logger.info('Workflow "%s": %d task(s) across %d group(s)',
                         spec.name, total_tasks, len(self._groups(spec)))

        compose_config = self._generate_compose_config(spec, tasks_to_run)
        compose_path = os.path.join(self._work_dir, COMPOSE_FILE_NAME)
        with open(compose_path, 'w', encoding='utf-8') as f:
            yaml.dump(compose_config, f, default_flow_style=False, sort_keys=False)

        logger.info('Generated %s', compose_path)

        project_name = re.sub(r'[^a-z0-9-]', '-', os.path.basename(self._work_dir).lower())
        compose_cmd = [
            self._docker_cmd, 'compose',
            '-f', compose_path,
            '--project-name', project_name,
            'up',
        ]

        logger.info('Starting Docker Compose execution')

        try:
            process = subprocess.run(compose_cmd, capture_output=False, check=False)
            compose_exit_code = process.returncode
        except FileNotFoundError:
            logger.error(
                '%s not found. Is Docker (with Compose V2) installed and in your PATH?',
                self._docker_cmd)
            return False

        self._collect_compose_results(compose_path, project_name, tasks_to_run)
        self._save_state()
        self._compose_down(compose_path, project_name)

        failed = [name for name, r in self._results.items()
                  if r.exit_code not in (0, -1)]
        not_run = [name for name, r in self._results.items() if r.exit_code == -1]

        if failed:
            logger.error('Workflow failed. Failed tasks: %s', ', '.join(sorted(failed)))
            if not_run:
                logger.error('Tasks not started (blocked by failures): %s',
                             ', '.join(sorted(not_run)))
            return False

        unexecuted = set(self._task_nodes.keys()) - set(self._results.keys())
        if unexecuted:
            logger.error(
                'Workflow "%s" stalled — tasks not completed: %s',
                spec.name, ', '.join(sorted(unexecuted)))
            return False

        if compose_exit_code != 0:
            logger.error('Docker Compose exited with code %d', compose_exit_code)
            return False

        logger.info('Workflow "%s" completed successfully', spec.name)
        return True

    def _detect_cycles(self):
        """Detect cycles in the task DAG using Kahn's algorithm (topological sort).

        Raises ValueError with the names of tasks involved in the cycle."""
        in_degree = {name: len(node.upstream) for name, node in self._task_nodes.items()}
        queue: deque[str] = deque(
            name for name, degree in in_degree.items() if degree == 0)
        visited_count = 0

        while queue:
            current = queue.popleft()
            visited_count += 1
            for downstream in self._task_nodes[current].downstream:
                in_degree[downstream] -= 1
                if in_degree[downstream] == 0:
                    queue.append(downstream)

        if visited_count != len(self._task_nodes):
            cycle_members = sorted(
                name for name, degree in in_degree.items() if degree > 0)
            raise ValueError(
                f'Circular dependency detected among tasks: {", ".join(cycle_members)}')

    def _generate_compose_config(self, spec: workflow_module.WorkflowSpec,
                                 tasks_to_run: Set[str]) -> Dict:
        """Generate a docker-compose.yml configuration dict for the tasks that need to run."""
        services: Dict[str, Dict] = {}
        for task_name in self._topological_order():
            if task_name not in tasks_to_run:
                continue
            node = self._task_nodes[task_name]
            services[task_name] = self._build_service_config(node, spec, tasks_to_run)
        return {'services': services}

    def _topological_order(self) -> List[str]:
        """Return task names in topological order (stable, respecting insertion order)."""
        in_degree = {name: len(node.upstream) for name, node in self._task_nodes.items()}
        queue: deque[str] = deque(
            name for name in self._task_nodes if in_degree[name] == 0)
        order: List[str] = []
        while queue:
            current = queue.popleft()
            order.append(current)
            for downstream in self._task_nodes[current].downstream:
                in_degree[downstream] -= 1
                if in_degree[downstream] == 0:
                    queue.append(downstream)
        return order

    @staticmethod
    def _escape_compose_interpolation(text: str) -> str:
        """Escape ``$`` as ``$$`` to prevent Docker Compose host-variable interpolation.

        Docker Compose expands ``$VAR`` and ``${VAR}`` from the host
        environment before passing values to containers.  Doubling the
        dollar sign makes it a literal ``$`` that the container's shell
        can then expand from the container's own environment."""
        return text.replace('$', '$$')

    def _build_service_config(self, node: TaskNode,
                              spec: workflow_module.WorkflowSpec,
                              tasks_to_run: Set[str]) -> Dict:
        """Build a single Docker Compose service configuration for a task."""
        task_spec = node.spec
        task_dir = os.path.join(self._work_dir, node.name)
        output_dir = os.path.join(task_dir, 'output')
        os.makedirs(output_dir, exist_ok=True)

        token_map = self._build_container_token_map(node)
        service: Dict = {'image': task_spec.image}

        volumes = [f'{output_dir}:{OSMO_OUTPUT_PATH}']
        for index, input_source in enumerate(task_spec.inputs):
            if isinstance(input_source, task_module.TaskInputOutput):
                upstream_task = input_source.task
                if upstream_task in self._results:
                    upstream_output = self._results[upstream_task].output_dir
                else:
                    upstream_output = os.path.join(self._work_dir, upstream_task, 'output')

                container_index = f'{OSMO_INPUT_PATH_PREFIX}/{index}'
                container_named = f'{OSMO_INPUT_PATH_PREFIX}/{upstream_task}'
                volumes.append(f'{upstream_output}:{container_index}:ro')
                if container_index != container_named:
                    volumes.append(f'{upstream_output}:{container_named}:ro')

        files_dir = os.path.join(task_dir, 'files')
        os.makedirs(files_dir, exist_ok=True)
        for file_spec in task_spec.files:
            resolved_contents = self._substitute_tokens(file_spec.contents, token_map)
            host_path = os.path.realpath(os.path.join(files_dir, file_spec.path.lstrip('/')))
            if not host_path.startswith(os.path.realpath(files_dir) + os.sep):
                raise ValueError(
                    f'Task "{node.name}": file path "{file_spec.path}" escapes the task directory')
            os.makedirs(os.path.dirname(host_path), exist_ok=True)
            with open(host_path, 'w', encoding='utf-8') as f:
                f.write(resolved_contents)
            volumes.append(f'{host_path}:{file_spec.path}:ro')

        volumes.extend(self._extra_volumes)
        service['volumes'] = volumes

        resolved_command = [
            self._escape_compose_interpolation(self._substitute_tokens(c, token_map))
            for c in task_spec.command]
        resolved_args = [
            self._escape_compose_interpolation(self._substitute_tokens(a, token_map))
            for a in task_spec.args]

        if resolved_command:
            first_cmd = resolved_command[0]
            if first_cmd.startswith('/') or first_cmd in self._ENTRYPOINT_COMMANDS:
                service['entrypoint'] = [first_cmd]
                rest = resolved_command[1:] + resolved_args
            else:
                rest = resolved_command + resolved_args
            if rest:
                service['command'] = rest
        elif resolved_args:
            service['command'] = resolved_args

        if task_spec.environment:
            service['environment'] = {
                key: self._escape_compose_interpolation(
                    self._substitute_tokens(value, token_map))
                for key, value in task_spec.environment.items()
            }

        gpu_count = self._task_gpu_count(task_spec, spec)
        if gpu_count > 0:
            available = self._detect_available_gpus()
            effective_count = min(gpu_count, available) if available > 0 else 0
            if effective_count > 0:
                service['deploy'] = {
                    'resources': {
                        'reservations': {
                            'devices': [{
                                'driver': 'nvidia',
                                'count': effective_count,
                                'capabilities': ['gpu'],
                            }]
                        }
                    }
                }
                logger.info(
                    'Task "%s" requesting %d GPU(s), using %d',
                    node.name, gpu_count, effective_count)
            else:
                logger.warning(
                    'Task "%s" requests %d GPU(s) but no GPUs available'
                    ' — running without GPU support',
                    node.name, gpu_count)
            service['shm_size'] = self._shm_size or self.DEFAULT_SHM_SIZE
        elif self._shm_size:
            service['shm_size'] = self._shm_size

        depends_on: Dict[str, Dict] = {}
        for upstream_task in sorted(node.upstream):
            if upstream_task in tasks_to_run:
                depends_on[upstream_task] = {
                    'condition': 'service_completed_successfully'}
        if depends_on:
            service['depends_on'] = depends_on

        return service

    def _build_container_token_map(self, node: TaskNode) -> Dict[str, str]:
        """Build a mapping of {{token}} keys to on-cluster container paths."""
        tokens: Dict[str, str] = {
            'output': OSMO_OUTPUT_PATH,
        }
        for index, input_source in enumerate(node.spec.inputs):
            if isinstance(input_source, task_module.TaskInputOutput):
                tokens[f'input:{input_source.task}'] = (
                    f'{OSMO_INPUT_PATH_PREFIX}/{input_source.task}')
                tokens[f'input:{index}'] = f'{OSMO_INPUT_PATH_PREFIX}/{index}'

        for task_name in self._task_nodes:
            tokens[f'host:{task_name}'] = task_name

        return tokens

    def _collect_compose_results(self, compose_path: str, project_name: str,
                                 tasks_to_run: Set[str]):
        """Collect exit codes from Docker Compose services after execution."""
        try:
            result = subprocess.run(
                [self._docker_cmd, 'compose', '-f', compose_path,
                 '--project-name', project_name,
                 'ps', '-a', '--format', 'json'],
                capture_output=True, text=True, check=False, timeout=30)

            if result.returncode == 0 and result.stdout.strip():
                for info in self._parse_compose_ps_output(result.stdout):
                    service_name = info.get('Service', '')
                    if service_name in tasks_to_run and service_name not in self._results:
                        exit_code = info.get('ExitCode', -1)
                        output_dir = os.path.join(
                            self._work_dir, service_name, 'output')
                        self._results[service_name] = TaskResult(
                            name=service_name,
                            exit_code=exit_code,
                            output_dir=output_dir)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

        for task_name in tasks_to_run:
            if task_name not in self._results:
                output_dir = os.path.join(self._work_dir, task_name, 'output')
                self._results[task_name] = TaskResult(
                    name=task_name, exit_code=-1, output_dir=output_dir)

    @staticmethod
    def _parse_compose_ps_output(output: str) -> List[Dict]:
        """Parse the JSON output from ``docker compose ps --format json``.

        Handles both a single JSON array and newline-delimited JSON objects."""
        output = output.strip()
        try:
            data = json.loads(output)
            if isinstance(data, list):
                return data
            return [data]
        except json.JSONDecodeError:
            results: List[Dict] = []
            for line in output.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    results.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
            return results

    def _compose_down(self, compose_path: str, project_name: str):
        """Clean up Docker Compose containers and networks (preserves bind-mounted data)."""
        try:
            subprocess.run(
                [self._docker_cmd, 'compose', '-f', compose_path,
                 '--project-name', project_name,
                 'down', '--remove-orphans'],
                capture_output=True, check=False, timeout=60)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    @property
    def _state_file_path(self) -> str:
        """Absolute path to the JSON state file used for resume tracking."""
        return os.path.join(self._work_dir, STATE_FILE_NAME)

    def _save_state(self):
        """Persist current task results to the state file so runs can be resumed later."""
        state = {
            'tasks': {
                name: {'exit_code': result.exit_code, 'output_dir': result.output_dir}
                for name, result in self._results.items()
                if result.exit_code != -1
            }
        }
        with open(self._state_file_path, 'w', encoding='utf-8') as f:
            json.dump(state, f, indent=2)

    def _load_state(self) -> Dict | None:
        """Load previously saved task state from disk, returning None if no state file exists."""
        if not os.path.exists(self._state_file_path):
            return None
        with open(self._state_file_path, encoding='utf-8') as f:
            return json.load(f)

    def _restore_completed_tasks(self, from_step: str | None = None):
        """Reload completed tasks from a previous run, optionally
        invalidating from a given step onward."""
        state = self._load_state()
        if state is None:
            logger.info('No previous state found — starting from scratch')
            return

        completed: Dict[str, Dict] = {}
        for name, info in state.get('tasks', {}).items():
            if name not in self._task_nodes:
                continue
            if info['exit_code'] == 0 and os.path.isdir(info['output_dir']):
                completed[name] = info

        if from_step:
            if from_step not in self._task_nodes:
                raise ValueError(f'Task "{from_step}" not found in workflow')
            to_invalidate = self._get_downstream_tasks(from_step)
            to_invalidate.add(from_step)
            for name in to_invalidate:
                completed.pop(name, None)

        for name, info in completed.items():
            self._results[name] = TaskResult(
                name=name, exit_code=0, output_dir=info['output_dir'])
            logger.info('Resuming: skipping completed task "%s"', name)

    def _get_downstream_tasks(self, task_name: str) -> Set[str]:
        """Return all transitive downstream dependents of the given task via BFS."""
        visited: Set[str] = set()
        queue = [task_name]
        while queue:
            current = queue.pop(0)
            for downstream in self._task_nodes[current].downstream:
                if downstream not in visited:
                    visited.add(downstream)
                    queue.append(downstream)
        return visited

    def _groups(self, spec: workflow_module.WorkflowSpec) -> List[task_module.TaskGroupSpec]:
        """Return the spec's groups, or synthesize one group per task when groups are absent."""
        if spec.groups:
            return spec.groups
        return [task_module.TaskGroupSpec(name=t.name, tasks=[t]) for t in spec.tasks]

    def _build_dag(self, spec: workflow_module.WorkflowSpec):
        """Construct the internal DAG of TaskNodes from the workflow spec's
        tasks and input dependencies."""
        self._task_nodes.clear()
        task_to_group: Dict[str, str] = {}

        for group in self._groups(spec):
            for task_spec in group.tasks:
                task_to_group[task_spec.name] = group.name
                self._task_nodes[task_spec.name] = TaskNode(
                    name=task_spec.name,
                    spec=task_spec,
                    group=group.name,
                )

        for group in self._groups(spec):
            for task_spec in group.tasks:
                for input_source in task_spec.inputs:
                    if isinstance(input_source, task_module.TaskInputOutput):
                        upstream_task = input_source.task
                        if upstream_task not in self._task_nodes:
                            raise ValueError(
                                f'Task "{task_spec.name}" depends on '
                                f'unknown task "{upstream_task}"')
                        self._task_nodes[task_spec.name].upstream.add(upstream_task)
                        self._task_nodes[upstream_task].downstream.add(task_spec.name)

        # For flat task lists (no explicit groups), add implicit sequential
        # dependencies so each task waits for the previous one — matching
        # on-cluster behavior where tasks in a list run sequentially.
        if not spec.groups and spec.tasks:
            task_names = [t.name for t in spec.tasks]
            for i in range(1, len(task_names)):
                prev, curr = task_names[i - 1], task_names[i]
                self._task_nodes[curr].upstream.add(prev)
                self._task_nodes[prev].downstream.add(curr)

    def _validate_for_local(self, spec: workflow_module.WorkflowSpec):
        """Raise ValueError if the spec uses features unsupported
        in local mode (datasets, URLs, credentials, etc.)."""
        unsupported_features = []
        for group in self._groups(spec):
            for task_spec in group.tasks:
                for input_source in task_spec.inputs:
                    if isinstance(input_source, task_module.DatasetInputOutput):
                        unsupported_features.append(
                            f'Task "{task_spec.name}": dataset inputs require object storage')
                    elif isinstance(input_source, task_module.URLInputOutput):
                        unsupported_features.append(
                            f'Task "{task_spec.name}": URL inputs require network/storage access')

                for output in task_spec.outputs:
                    unsupported_output = (
                        task_module.DatasetInputOutput,
                        task_module.URLInputOutput,
                    )
                    if isinstance(output, unsupported_output):
                        unsupported_features.append(
                            f'Task "{task_spec.name}": dataset/URL outputs require object storage')

                if task_spec.credentials:
                    unsupported_features.append(
                        f'Task "{task_spec.name}": credentials require the OSMO secret manager')

                if task_spec.checkpoint:
                    unsupported_features.append(
                        f'Task "{task_spec.name}": checkpoints require object storage')

                if task_spec.volumeMounts:
                    unsupported_features.append(
                        f'Task "{task_spec.name}": volumeMounts require cluster-level host paths')

                if task_spec.privileged:
                    unsupported_features.append(
                        f'Task "{task_spec.name}": privileged containers '
                        f'are not supported in local mode')

                if task_spec.hostNetwork:
                    unsupported_features.append(
                        f'Task "{task_spec.name}": hostNetwork is not supported in local mode')

        if unsupported_features:
            raise ValueError(
                'The following features are not supported in local execution mode:\n  - '
                + '\n  - '.join(unsupported_features))

    def _setup_directories(self):
        """Create the work directory and per-task output directories on the host filesystem."""
        os.makedirs(self._work_dir, exist_ok=True)
        for task_name in self._task_nodes:
            os.makedirs(os.path.join(self._work_dir, task_name, 'output'), exist_ok=True)

    def _task_gpu_count(self, task_spec: task_module.TaskSpec,
                        spec: workflow_module.WorkflowSpec) -> int:
        """Return the number of GPUs requested by a task's resource spec, defaulting to 0."""
        resource_spec = spec.resources.get(task_spec.resource)
        if resource_spec and resource_spec.gpu:
            return resource_spec.gpu
        return 0

    def _substitute_tokens(self, text: str, tokens: Dict[str, str]) -> str:
        """Replace all {{key}} placeholders in text with their corresponding token values."""
        for key, value in tokens.items():
            text = re.sub(r'\{\{\s*' + re.escape(key) + r'\s*\}\}', value, text)
        return text


def check_unresolved_variables(spec_text: str):
    """Raise ValueError if the spec contains ``{{ variable }}`` placeholders
    that are not OSMO runtime tokens.

    OSMO runtime tokens (``{{output}}``, ``{{input:…}}``, ``{{host:…}}``,
    ``{{uuid}}``, ``{{workflow_id}}``, ``{{item}}``) are left intact since
    they are resolved at container runtime.  Any other ``{{ }}`` pattern
    indicates a template variable that was not expanded by ``default-values``
    and would pass through silently, causing subtle breakage.
    """
    all_braces = _ANY_DOUBLE_BRACE.findall(spec_text)
    unresolved = [
        token for token in all_braces
        if not _OSMO_RUNTIME_TOKEN.match(token)
    ]
    if unresolved:
        unique = sorted(set(unresolved))
        raise ValueError(
            'Unresolved template variables found in spec (did you forget to '
            'add them to default-values?):\n  '
            + '\n  '.join(unique)
            + '\nHint: use "osmo workflow submit --dry-run -f <spec>" to '
            'expand Jinja templates server-side, or add the variables to '
            'the default-values section.')


def run_workflow_locally(spec_path: str, work_dir: str | None = None,
                         keep_work_dir: bool = False,
                         resume: bool = False,
                         from_step: str | None = None,
                         docker_cmd: str = 'docker',
                         shm_size: str | None = None,
                         extra_volumes: List[str] | None = None) -> bool:
    """Load a workflow spec from disk and execute it locally via Docker Compose,
    managing the work directory lifecycle."""
    if (resume or from_step) and work_dir is None:
        raise ValueError(
            '--resume and --from-step require --work-dir pointing to a previous run directory.')

    with open(spec_path, encoding='utf-8') as f:
        spec_text = f.read()

    abs_path = os.path.abspath(spec_path)
    spec_text = spec_includes.resolve_includes(
        spec_text, os.path.dirname(abs_path), source_path=abs_path)
    spec_text = spec_includes.resolve_default_values(spec_text)

    template_markers = ('{%', '{#')
    if any(marker in spec_text for marker in template_markers):
        raise ValueError(
            'This spec uses Jinja templates which require server-side expansion.\n'
            'Run "osmo workflow submit --dry-run -f <spec>" first to get the expanded spec,\n'
            'then save that output and run it locally.')

    check_unresolved_variables(spec_text)

    created_work_dir = work_dir is None
    effective_work_dir: str = (
        os.path.abspath(work_dir) if work_dir is not None
        else tempfile.mkdtemp(prefix='osmo-local-')
    )
    if created_work_dir:
        logger.info('Using temporary work directory: %s', effective_work_dir)

    executor = LocalExecutor(work_dir=effective_work_dir, keep_work_dir=keep_work_dir,
                              docker_cmd=docker_cmd, shm_size=shm_size,
                              extra_volumes=extra_volumes)
    spec = executor.load_spec(spec_text)
    success = executor.execute(spec, resume=resume or from_step is not None,
                               from_step=from_step)

    if created_work_dir and not keep_work_dir and success:
        logger.info('Cleaning up work directory: %s', effective_work_dir)
        shutil.rmtree(effective_work_dir, ignore_errors=True)
    elif not success:
        logger.info('Work directory preserved for debugging: %s', effective_work_dir)

    return success
