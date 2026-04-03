"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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


@dataclasses.dataclass
class TaskNode:
    name: str
    spec: task_module.TaskSpec
    group: str
    upstream: Set[str] = dataclasses.field(default_factory=set)
    downstream: Set[str] = dataclasses.field(default_factory=set)


@dataclasses.dataclass
class TaskResult:
    name: str
    exit_code: int
    output_dir: str


class LocalExecutor:
    """
    Executes an OSMO workflow spec locally using Docker, without Kubernetes.

    Supports:
      - Serial and parallel task DAGs (groups flattened to individual tasks)
      - {{output}} and {{input:N}} / {{input:taskname}} token substitution
      - Inline `files:` written to the container
      - `environment:` passed as Docker env vars
      - Task-to-task data flow via shared local directories
      - GPU passthrough via --gpus for tasks that declare gpu > 0 in resources

    Does NOT support (raises clear errors):
      - Dataset / URL inputs/outputs (require object storage)
      - Credentials, checkpoints, volumeMounts (require cluster infra)
      - Templated specs with Jinja (require server-side expansion; use --dry-run first)
    """

    def __init__(self, work_dir: str, keep_work_dir: bool = False, docker_cmd: str = 'docker'):
        self._work_dir = work_dir
        self._keep_work_dir = keep_work_dir
        self._docker_cmd = docker_cmd
        self._task_nodes: Dict[str, TaskNode] = {}
        self._results: Dict[str, TaskResult] = {}

    def load_spec(self, spec_text: str) -> workflow_module.WorkflowSpec:
        raw = yaml.safe_load(spec_text)
        versioned = workflow_module.VersionedWorkflowSpec(**raw)
        return versioned.workflow

    def execute(self, spec: workflow_module.WorkflowSpec) -> bool:
        self._build_dag(spec)
        self._validate_for_local(spec)
        self._setup_directories()

        logger.info('Workflow "%s": %d task(s) across %d group(s)',
                     spec.name, sum(len(g.tasks) for g in self._groups(spec)), len(self._groups(spec)))

        ready = self._find_ready_tasks()
        while ready:
            for task_name in ready:
                node = self._task_nodes[task_name]
                logger.info('--- Running task: %s (image: %s) ---', task_name, node.spec.image)
                result = self._run_task(node, spec)
                self._results[task_name] = result

                if result.exit_code != 0:
                    logger.error('Task "%s" failed with exit code %d', task_name, result.exit_code)
                    self._cancel_downstream(task_name)
                    return False

                logger.info('Task "%s" completed successfully', task_name)

            ready = self._find_ready_tasks()

        failed = [name for name, r in self._results.items() if r.exit_code != 0]
        if failed:
            logger.error('Workflow failed. Failed tasks: %s', ', '.join(failed))
            return False

        logger.info('Workflow "%s" completed successfully', spec.name)
        return True

    def _groups(self, spec: workflow_module.WorkflowSpec) -> List[task_module.TaskGroupSpec]:
        if spec.groups:
            return spec.groups
        return [task_module.TaskGroupSpec(name=t.name, tasks=[t]) for t in spec.tasks]

    def _build_dag(self, spec: workflow_module.WorkflowSpec):
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
                                f'Task "{task_spec.name}" depends on unknown task "{upstream_task}"')
                        self._task_nodes[task_spec.name].upstream.add(upstream_task)
                        self._task_nodes[upstream_task].downstream.add(task_spec.name)

    def _validate_for_local(self, spec: workflow_module.WorkflowSpec):
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

        if unsupported_features:
            raise ValueError(
                'The following features are not supported in local execution mode:\n  - '
                + '\n  - '.join(unsupported_features))

    def _setup_directories(self):
        os.makedirs(self._work_dir, exist_ok=True)
        for task_name in self._task_nodes:
            os.makedirs(os.path.join(self._work_dir, task_name, 'output'), exist_ok=True)

    def _find_ready_tasks(self) -> List[str]:
        completed = set(self._results.keys())
        ready = []
        for name, node in self._task_nodes.items():
            if name in completed:
                continue
            if node.upstream.issubset(completed):
                all_upstream_ok = all(self._results[u].exit_code == 0 for u in node.upstream)
                if all_upstream_ok:
                    ready.append(name)
        return ready

    def _cancel_downstream(self, failed_task: str):
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
        resource_spec = spec.resources.get(task_spec.resource)
        if resource_spec and resource_spec.gpu:
            return resource_spec.gpu
        return 0

    def _run_task(self, node: TaskNode, spec: workflow_module.WorkflowSpec) -> TaskResult:
        task_spec = node.spec
        task_dir = os.path.join(self._work_dir, node.name)
        output_dir = os.path.join(task_dir, 'output')
        files_dir = os.path.join(task_dir, 'files')
        os.makedirs(files_dir, exist_ok=True)

        token_map = self._build_token_map(node, output_dir)

        for file_spec in task_spec.files:
            resolved_contents = self._substitute_tokens(file_spec.contents, token_map)
            host_path = os.path.join(files_dir, file_spec.path.lstrip('/'))
            os.makedirs(os.path.dirname(host_path), exist_ok=True)
            with open(host_path, 'w') as f:
                f.write(resolved_contents)

        resolved_command = [self._substitute_tokens(c, token_map) for c in task_spec.command]
        resolved_args = [self._substitute_tokens(a, token_map) for a in task_spec.args]

        docker_args = [self._docker_cmd, 'run', '--rm']

        gpu_count = self._task_gpu_count(task_spec, spec)
        if gpu_count > 0:
            docker_args += ['--gpus', f'"device={",".join(str(i) for i in range(gpu_count))}"']
            logger.info('Task "%s" requesting %d GPU(s)', node.name, gpu_count)

        for key, value in task_spec.environment.items():
            resolved_value = self._substitute_tokens(value, token_map)
            docker_args += ['-e', f'{key}={resolved_value}']

        docker_args += ['-v', f'{output_dir}:{output_dir}']

        for index, input_source in enumerate(task_spec.inputs):
            if isinstance(input_source, task_module.TaskInputOutput):
                upstream_result = self._results[input_source.task]
                input_mount = token_map.get(f'input:{index}', upstream_result.output_dir)
                docker_args += ['-v', f'{upstream_result.output_dir}:{input_mount}:ro']

        for file_spec in task_spec.files:
            host_path = os.path.join(files_dir, file_spec.path.lstrip('/'))
            docker_args += ['-v', f'{host_path}:{file_spec.path}:ro']

        if resolved_command:
            docker_args += ['--entrypoint', resolved_command[0]]
        docker_args.append(task_spec.image)
        docker_args += resolved_command[1:] + resolved_args

        logger.debug('Docker command: %s', ' '.join(docker_args))

        try:
            process = subprocess.run(docker_args, capture_output=False)
            return TaskResult(name=node.name, exit_code=process.returncode, output_dir=output_dir)
        except FileNotFoundError:
            logger.error('Docker not found. Is Docker installed and in your PATH?')
            return TaskResult(name=node.name, exit_code=127, output_dir=output_dir)

    def _build_token_map(self, node: TaskNode, output_dir: str) -> Dict[str, str]:
        tokens: Dict[str, str] = {
            'output': output_dir,
        }
        for index, input_source in enumerate(node.spec.inputs):
            if isinstance(input_source, task_module.TaskInputOutput):
                upstream_result = self._results[input_source.task]
                tokens[f'input:{input_source.task}'] = upstream_result.output_dir
                tokens[f'input:{index}'] = upstream_result.output_dir
        return tokens

    def _substitute_tokens(self, text: str, tokens: Dict[str, str]) -> str:
        for key, value in tokens.items():
            text = re.sub(r'\{\{\s*' + re.escape(key) + r'\s*\}\}', value, text)
        return text


def run_workflow_locally(spec_path: str, work_dir: str | None = None,
                         keep_work_dir: bool = False) -> bool:
    if work_dir is None:
        work_dir = tempfile.mkdtemp(prefix='osmo-local-')
        logger.info('Using temporary work directory: %s', work_dir)

    with open(spec_path) as f:
        spec_text = f.read()

    template_markers = ('{%%', '{#', 'default-values')
    if any(marker in spec_text for marker in template_markers):
        raise ValueError(
            'This spec uses Jinja templates which require server-side expansion.\n'
            'Run "osmo workflow submit --dry-run -f <spec>" first to get the expanded spec,\n'
            'then save that output and run it locally.')

    executor = LocalExecutor(work_dir=work_dir, keep_work_dir=keep_work_dir)
    spec = executor.load_spec(spec_text)
    success = executor.execute(spec)

    if not keep_work_dir and success:
        logger.info('Cleaning up work directory: %s', work_dir)
        shutil.rmtree(work_dir, ignore_errors=True)
    elif not success:
        logger.info('Work directory preserved for debugging: %s', work_dir)

    return success
