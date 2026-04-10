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

import dataclasses
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
from typing import Dict, List, Set

import yaml

from src.utils.job import task as task_module
from src.utils.job import workflow as workflow_module


logger = logging.getLogger(__name__)

STATE_FILE_NAME = '.osmo-state.json'
CONTAINER_DATA_PATH = '/osmo/data'


@dataclasses.dataclass
class TaskNode:
    """A node in the workflow DAG, linking a task spec to its upstream and downstream dependencies."""

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


class StandaloneExecutor:
    """
    Executes an OSMO workflow spec in standalone mode using Docker, without Kubernetes.

    Supports:
      - Serial and parallel task DAGs
      - Task groups with lead-task failure policy (ignoreNonleadStatus)
      - {{output}} and {{input:N}} / {{input:taskname}} token substitution
      - Inline `files:` written to the container
      - `environment:` passed as Docker env vars
      - Task-to-task data flow via shared local directories
      - GPU passthrough via --gpus for tasks that declare gpu > 0 in resources

    Does NOT support (raises clear errors):
      - Dataset / URL inputs/outputs (require object storage)
      - Credentials, checkpoints, volumeMounts (require cluster infra)
      - Templated specs with Jinja (require server-side expansion; use --dry-run first)
      - {{host:taskname}} tokens (require parallel containers with shared networking)
    """

    DEFAULT_SHM_SIZE = '16g'

    def __init__(self, work_dir: str, keep_work_dir: bool = False, docker_cmd: str = 'docker',
                 shm_size: str | None = None):
        """Initialize the executor with a work directory, cleanup preference, and container runtime command."""
        self._work_dir = work_dir
        self._keep_work_dir = keep_work_dir
        self._docker_cmd = docker_cmd
        self._shm_size = shm_size
        self._task_nodes: Dict[str, TaskNode] = {}
        self._group_specs: Dict[str, task_module.TaskGroupSpec] = {}
        self._results: Dict[str, TaskResult] = {}
        self._available_gpus: int | None = None

    def _detect_available_gpus(self) -> int:
        """Query nvidia-smi to count available GPUs, caching the result for subsequent calls."""
        if self._available_gpus is not None:
            return self._available_gpus
        try:
            result = subprocess.run(
                ['nvidia-smi', '--query-gpu=index', '--format=csv,noheader'],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                gpu_indices = [line.strip() for line in result.stdout.strip().splitlines() if line.strip()]
                self._available_gpus = len(gpu_indices)
            else:
                logger.warning('nvidia-smi failed (exit %d) — assuming 0 GPUs available', result.returncode)
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
        if not isinstance(raw, dict):
            raise ValueError(
                f'Expected a YAML mapping for the workflow spec, '
                f'got {type(raw).__name__}')
        versioned = workflow_module.VersionedWorkflowSpec(**raw)
        return versioned.workflow

    def execute(self, spec: workflow_module.WorkflowSpec,
                resume: bool = False, from_step: str | None = None) -> bool:
        """Run all tasks in topological order, returning True if the entire workflow succeeds."""
        self._results.clear()
        self._build_dag(spec)
        self._validate_for_standalone(spec)
        self._setup_directories()

        if resume or from_step:
            self._restore_completed_tasks(from_step)

        total_tasks = sum(len(g.tasks) for g in self._groups(spec))
        skipped = len(self._results)
        remaining = total_tasks - skipped
        if skipped > 0:
            logger.info('Workflow "%s": resuming — %d task(s) skipped, %d remaining',
                         spec.name, skipped, remaining)
        else:
            logger.info('Workflow "%s": %d task(s) across %d group(s)',
                         spec.name, total_tasks, len(self._groups(spec)))

        ready = self._find_ready_tasks()
        while ready:
            for task_name in ready:
                node = self._task_nodes[task_name]
                logger.info('--- Running task: %s (image: %s) ---', task_name, node.spec.image)
                result = self._run_task(node, spec)
                self._results[task_name] = result
                self._save_state()

                if result.exit_code != 0:
                    if self._is_nonlead_failure_ignorable(task_name):
                        logger.warning(
                            'Non-lead task "%s" failed with exit code %d '
                            '(ignored — group "%s" has ignoreNonleadStatus=true)',
                            task_name, result.exit_code, node.group)
                    else:
                        logger.error('Task "%s" failed with exit code %d', task_name, result.exit_code)
                        self._cancel_downstream(task_name)
                        return False
                else:
                    logger.info('Task "%s" completed successfully', task_name)

            ready = self._find_ready_tasks()

        unexecuted = set(self._task_nodes.keys()) - set(self._results.keys())
        if unexecuted:
            logger.error('Workflow "%s" stalled — tasks could not be scheduled (possible cycle): %s',
                         spec.name, ', '.join(sorted(unexecuted)))
            return False

        fatal_failures = [
            name for name, r in self._results.items()
            if r.exit_code != 0 and not self._is_nonlead_failure_ignorable(name)
        ]
        if fatal_failures:
            logger.error('Workflow failed. Failed tasks: %s', ', '.join(fatal_failures))
            return False

        logger.info('Workflow "%s" completed successfully', spec.name)
        return True

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
        """Reload completed tasks from a previous run, optionally invalidating from a given step onward."""
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
        """Construct the internal DAG of TaskNodes from the workflow spec's tasks and input dependencies."""
        self._task_nodes.clear()
        self._group_specs.clear()

        for group in self._groups(spec):
            self._group_specs[group.name] = group
            for task_spec in group.tasks:
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
                                f'Task "{task_spec.name}" depends on unknown task "{upstream_task}"')
                        self._task_nodes[task_spec.name].upstream.add(upstream_task)
                        self._task_nodes[upstream_task].downstream.add(task_spec.name)

        self._check_for_cycles()

    def _check_for_cycles(self):
        """Raise ValueError if the task DAG contains any cycles, reporting the cycle path."""
        UNVISITED, IN_PROGRESS, DONE = 0, 1, 2
        state: Dict[str, int] = {name: UNVISITED for name in self._task_nodes}
        path: List[str] = []

        def visit(name: str) -> List[str] | None:
            if state[name] == DONE:
                return None
            if state[name] == IN_PROGRESS:
                cycle_start = path.index(name)
                return path[cycle_start:] + [name]

            state[name] = IN_PROGRESS
            path.append(name)
            for downstream in self._task_nodes[name].downstream:
                cycle = visit(downstream)
                if cycle is not None:
                    return cycle
            path.pop()
            state[name] = DONE
            return None

        for name in self._task_nodes:
            cycle = visit(name)
            if cycle is not None:
                raise ValueError(
                    f'Circular dependency detected: {" -> ".join(cycle)}')

    _HOST_TOKEN_PATTERN = re.compile(r'\{\{\s*host:[^}]+\}\}')

    def _validate_for_standalone(self, spec: workflow_module.WorkflowSpec):
        """Raise ValueError if the spec uses features unsupported in standalone mode (datasets, URLs, credentials, etc.)."""
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
                    if isinstance(output, (task_module.DatasetInputOutput, task_module.URLInputOutput)):
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
                        f'Task "{task_spec.name}": privileged containers are not supported in standalone mode')

                if task_spec.hostNetwork:
                    unsupported_features.append(
                        f'Task "{task_spec.name}": hostNetwork is not supported in standalone mode')

                if self._task_uses_host_tokens(task_spec):
                    unsupported_features.append(
                        f'Task "{task_spec.name}": {{{{host:taskname}}}} tokens require '
                        f'parallel containers with shared networking')

        if unsupported_features:
            raise ValueError(
                'The following features are not supported in standalone execution mode:\n  - '
                + '\n  - '.join(unsupported_features))

    def _task_uses_host_tokens(self, task_spec: task_module.TaskSpec) -> bool:
        """Return True if any text field in the task spec contains {{host:...}} tokens."""
        fields_to_check = list(task_spec.command) + list(task_spec.args)
        fields_to_check += list(task_spec.environment.values())
        fields_to_check += [file_spec.contents for file_spec in task_spec.files]
        return any(self._HOST_TOKEN_PATTERN.search(field) for field in fields_to_check)

    def _setup_directories(self):
        """Create the work directory and per-task output directories on the host filesystem."""
        os.makedirs(self._work_dir, exist_ok=True)
        for task_name in self._task_nodes:
            os.makedirs(os.path.join(self._work_dir, task_name, 'output'), exist_ok=True)

    def _is_nonlead_failure_ignorable(self, task_name: str) -> bool:
        """Return True if the task is a non-lead task in a group with ignoreNonleadStatus=true."""
        node = self._task_nodes[task_name]
        group_spec = self._group_specs[node.group]
        return group_spec.ignoreNonleadStatus and not node.spec.lead

    def _is_task_satisfied(self, task_name: str) -> bool:
        """Return True if a completed task's result counts as satisfied for downstream scheduling."""
        result = self._results[task_name]
        if result.exit_code == 0:
            return True
        return self._is_nonlead_failure_ignorable(task_name)

    def _find_ready_tasks(self) -> List[str]:
        """Return tasks whose upstream dependencies have all been satisfied, in spec declaration order."""
        completed = set(self._results.keys())
        ready = []
        for name, node in self._task_nodes.items():
            if name in completed:
                continue
            if node.upstream.issubset(completed):
                all_upstream_ok = all(self._is_task_satisfied(u) for u in node.upstream)
                if all_upstream_ok:
                    ready.append(name)
        return ready

    def _cancel_downstream(self, failed_task: str):
        """Mark all transitive downstream tasks of a failed task as cancelled (exit_code -1)."""
        visited: Set[str] = set()
        queue = [failed_task]
        while queue:
            current = queue.pop(0)
            for downstream in self._task_nodes[current].downstream:
                if downstream not in visited and downstream not in self._results:
                    visited.add(downstream)
                    self._results[downstream] = TaskResult(
                        name=downstream, exit_code=-1, output_dir='')
                    queue.append(downstream)

    def _task_gpu_count(self, task_spec: task_module.TaskSpec,
                        spec: workflow_module.WorkflowSpec) -> int:
        """Return the number of GPUs requested by a task's resource spec, defaulting to 0."""
        resource_spec = spec.resources.get(task_spec.resource)
        if resource_spec and resource_spec.gpu:
            return resource_spec.gpu
        return 0

    def _run_task(self, node: TaskNode, spec: workflow_module.WorkflowSpec) -> TaskResult:
        """Execute a single task as a Docker container, mounting inputs/outputs/files and returning the result."""
        task_spec = node.spec
        task_dir = os.path.join(self._work_dir, node.name)
        output_dir = os.path.join(task_dir, 'output')
        files_dir = os.path.join(task_dir, 'files')
        os.makedirs(files_dir, exist_ok=True)

        token_map = self._build_token_map(node)

        for file_spec in task_spec.files:
            resolved_contents = self._substitute_tokens(file_spec.contents, token_map)
            host_path = os.path.realpath(os.path.join(files_dir, file_spec.path.lstrip('/')))
            if not host_path.startswith(os.path.realpath(files_dir) + os.sep):
                raise ValueError(
                    f'Task "{node.name}": file path "{file_spec.path}" escapes the task directory')
            os.makedirs(os.path.dirname(host_path), exist_ok=True)
            with open(host_path, 'w', encoding='utf-8') as f:
                f.write(resolved_contents)

        resolved_command = [self._substitute_tokens(c, token_map) for c in task_spec.command]
        resolved_args = [self._substitute_tokens(a, token_map) for a in task_spec.args]
        resolved_env_values = [self._substitute_tokens(v, token_map) for v in task_spec.environment.values()]

        all_resolved = resolved_command + resolved_args + resolved_env_values
        all_resolved += [self._substitute_tokens(f.contents, token_map) for f in task_spec.files]
        self._check_unresolved_tokens(node.name, all_resolved)

        docker_args = [self._docker_cmd, 'run', '--rm']

        gpu_count = self._task_gpu_count(task_spec, spec)
        if gpu_count > 0:
            available = self._detect_available_gpus()
            if available == 0:
                logger.warning(
                    'Task "%s" requests %d GPU(s) but no GPUs are available — running without GPU support',
                    node.name, gpu_count)
            elif gpu_count > available:
                logger.warning(
                    'Task "%s" requests %d GPU(s) but only %d available — running with %d GPU(s)',
                    node.name, gpu_count, available, available)
                docker_args += ['--gpus', f'device={",".join(str(i) for i in range(available))}']
            else:
                docker_args += ['--gpus', f'device={",".join(str(i) for i in range(gpu_count))}']
            logger.info('Task "%s" requesting %d GPU(s), using %d', node.name, gpu_count, min(gpu_count, available))

            docker_args += ['--shm-size', self._shm_size or self.DEFAULT_SHM_SIZE]
        elif self._shm_size:
            docker_args += ['--shm-size', self._shm_size]

        for env_key, resolved_value in zip(task_spec.environment.keys(), resolved_env_values):
            docker_args += ['-e', f'{env_key}={resolved_value}']

        docker_args += ['-v', f'{output_dir}:{CONTAINER_DATA_PATH}/output']

        for index, input_source in enumerate(task_spec.inputs):
            if isinstance(input_source, task_module.TaskInputOutput):
                upstream_result = self._results[input_source.task]
                docker_args += ['-v', f'{upstream_result.output_dir}:{CONTAINER_DATA_PATH}/input/{index}:ro']

        for file_spec in task_spec.files:
            host_path = os.path.realpath(os.path.join(files_dir, file_spec.path.lstrip('/')))
            docker_args += ['-v', f'{host_path}:{file_spec.path}:ro']

        if resolved_command:
            docker_args += ['--entrypoint', resolved_command[0]]
        docker_args.append(task_spec.image)
        docker_args += resolved_command[1:] + resolved_args

        if logger.isEnabledFor(logging.DEBUG):
            redacted_args = []
            skip_next = False
            for arg in docker_args:
                if skip_next:
                    redacted_args.append(arg.split('=', 1)[0] + '=REDACTED')
                    skip_next = False
                elif arg == '-e':
                    redacted_args.append(arg)
                    skip_next = True
                else:
                    redacted_args.append(arg)
            logger.debug('Docker command: %s', ' '.join(redacted_args))

        try:
            process = subprocess.run(docker_args, capture_output=False)
            return TaskResult(name=node.name, exit_code=process.returncode, output_dir=output_dir)
        except FileNotFoundError:
            logger.error('Docker not found. Is Docker installed and in your PATH?')
            return TaskResult(name=node.name, exit_code=127, output_dir=output_dir)

    def _build_token_map(self, node: TaskNode) -> Dict[str, str]:
        """Build a mapping of {{token}} keys to container-side paths matching on-cluster layout."""
        tokens: Dict[str, str] = {
            'output': f'{CONTAINER_DATA_PATH}/output',
        }
        for index, input_source in enumerate(node.spec.inputs):
            if isinstance(input_source, task_module.TaskInputOutput):
                container_input_path = f'{CONTAINER_DATA_PATH}/input/{index}'
                tokens[f'input:{input_source.task}'] = container_input_path
                tokens[f'input:{index}'] = container_input_path
        return tokens

    _UNRESOLVED_TOKEN_PATTERN = re.compile(r'\{\{[^}]+\}\}')

    def _substitute_tokens(self, text: str, tokens: Dict[str, str]) -> str:
        """Replace all {{key}} placeholders in text with their corresponding token values."""
        for key, value in tokens.items():
            text = re.sub(r'\{\{\s*' + re.escape(key) + r'\s*\}\}', value, text)
        return text

    def _check_unresolved_tokens(self, task_name: str, resolved_fields: List[str]):
        """Raise ValueError if any resolved field still contains {{ }} placeholders."""
        unresolved: List[str] = []
        for field in resolved_fields:
            for match in self._UNRESOLVED_TOKEN_PATTERN.finditer(field):
                token = match.group(0)
                if token not in unresolved:
                    unresolved.append(token)
        if unresolved:
            raise ValueError(
                f'Task "{task_name}" has unresolved token(s): {", ".join(unresolved)}. '
                f'If this spec uses Jinja templates, run "osmo workflow submit --dry-run -f <spec>" '
                f'first to expand them.')


def run_workflow_standalone(spec_path: str, work_dir: str | None = None,
                            keep_work_dir: bool = False,
                            resume: bool = False,
                            from_step: str | None = None,
                            docker_cmd: str = 'docker',
                            shm_size: str | None = None) -> bool:
    """Load a workflow spec from disk and execute it in standalone mode via Docker, managing the work directory lifecycle."""
    if (resume or from_step) and work_dir is None:
        raise ValueError(
            '--resume and --from-step require --work-dir pointing to a previous run directory.')

    with open(spec_path, encoding='utf-8') as f:
        spec_text = f.read()

    template_markers = ('{%', '{#', 'default-values')
    if any(marker in spec_text for marker in template_markers):
        raise ValueError(
            'This spec uses Jinja templates which require server-side expansion.\n'
            'Run "osmo workflow submit --dry-run -f <spec>" first to get the expanded spec,\n'
            'then save that output and run it standalone.')

    created_work_dir = work_dir is None
    if work_dir is None:
        work_dir = tempfile.mkdtemp(prefix='osmo-standalone-')
        logger.info('Using temporary work directory: %s', work_dir)

    success = False
    try:
        executor = StandaloneExecutor(work_dir=work_dir, keep_work_dir=keep_work_dir,
                                       docker_cmd=docker_cmd, shm_size=shm_size)
        spec = executor.load_spec(spec_text)
        success = executor.execute(spec, resume=resume or from_step is not None,
                                   from_step=from_step)
    finally:
        if created_work_dir and not keep_work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)
        elif not success:
            logger.info('Work directory preserved for debugging: %s', work_dir)

    return success
