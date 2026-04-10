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
import logging
import os
import re
import shutil
import subprocess
import tempfile
from typing import Dict, List

import yaml

from src.utils.job import task as task_module
from src.utils.job import workflow as workflow_module
from src.utils.standalone_executor import (
    CONTAINER_DATA_PATH,
    StandaloneExecutor,
    TaskNode,
    TaskResult,
)


logger = logging.getLogger(__name__)

COMPOSE_FILE_NAME = 'docker-compose.yml'


class ComposeExecutor(StandaloneExecutor):
    """
    Executes an OSMO workflow spec using Docker Compose for parallel task execution.

    Extends StandaloneExecutor with:
      - True parallel execution of independent tasks within each scheduling wave
      - {{host:taskname}} token support via Docker Compose DNS
      - Shared network per task group for gang-scheduled communication
      - GPU passthrough via compose deploy.resources.reservations

    Execution model:
      Generates a single docker-compose.yml with all services defined up-front,
      then executes them in waves.  Each wave contains all tasks whose upstream
      dependencies are satisfied.  Tasks within a wave run in parallel via
      ``docker compose up``.  Group co-scheduling is enforced so that all members
      of a multi-task group start together in the same wave.
    """

    def __init__(self, work_dir: str, keep_work_dir: bool = False,
                 compose_cmd: str = 'docker compose', shm_size: str | None = None):
        super().__init__(work_dir=work_dir, keep_work_dir=keep_work_dir,
                         docker_cmd='docker', shm_size=shm_size)
        self._compose_cmd = compose_cmd

    @property
    def _compose_file_path(self) -> str:
        return os.path.join(self._work_dir, COMPOSE_FILE_NAME)

    def _compose_project_name(self, spec: workflow_module.WorkflowSpec) -> str:
        return f'osmo-{re.sub(r"[^a-z0-9-]", "-", spec.name.lower())}'

    def _compose_base_cmd(self, spec: workflow_module.WorkflowSpec) -> List[str]:
        return (
            self._compose_cmd.split()
            + ['-p', self._compose_project_name(spec), '-f', self._compose_file_path]
        )

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def execute(self, spec: workflow_module.WorkflowSpec,
                resume: bool = False, from_step: str | None = None) -> bool:
        """Run all tasks in wave-parallel order via Docker Compose."""
        if resume or from_step:
            raise NotImplementedError(
                'docker-compose mode does not support --resume or --from-step yet. '
                'Use standalone mode for resume functionality.')
        self._results.clear()
        self._build_dag(spec)
        self._validate_for_compose(spec)
        self._setup_directories()
        self._write_inline_files(spec)
        self._generate_compose_file(spec)

        total_tasks = sum(len(g.tasks) for g in self._groups(spec))
        logger.info('Workflow "%s": %d task(s) across %d group(s) [docker-compose mode]',
                     spec.name, total_tasks, len(self._groups(spec)))

        try:
            wave_number = 0
            while True:
                wave = self._find_ready_wave()
                if not wave:
                    break

                wave_number += 1
                logger.info('=== Wave %d: %s ===', wave_number, ', '.join(wave))

                wave_results = self._run_wave(wave, spec)

                fatal_failure = False
                for task_name, exit_code in wave_results.items():
                    output_dir = os.path.join(self._work_dir, task_name, 'output')
                    self._results[task_name] = TaskResult(
                        name=task_name, exit_code=exit_code, output_dir=output_dir)

                    if exit_code != 0:
                        if self._is_nonlead_failure_ignorable(task_name):
                            logger.warning(
                                'Non-lead task "%s" failed with exit code %d '
                                '(ignored — group "%s" has ignoreNonleadStatus=true)',
                                task_name, exit_code, self._task_nodes[task_name].group)
                        else:
                            logger.error('Task "%s" failed with exit code %d',
                                         task_name, exit_code)
                            self._cancel_downstream(task_name)
                            fatal_failure = True
                    else:
                        logger.info('Task "%s" completed successfully', task_name)

                if fatal_failure:
                    return False

            unexecuted = set(self._task_nodes.keys()) - set(self._results.keys())
            if unexecuted:
                logger.error(
                    'Workflow "%s" stalled — tasks could not be scheduled '
                    '(possible cycle or unsatisfiable group): %s',
                    spec.name, ', '.join(sorted(unexecuted)))
                return False

            fatal_failures = [
                name for name, result in self._results.items()
                if result.exit_code != 0
                and not self._is_nonlead_failure_ignorable(name)
            ]
            if fatal_failures:
                logger.error('Workflow failed. Failed tasks: %s',
                             ', '.join(fatal_failures))
                return False

            logger.info('Workflow "%s" completed successfully', spec.name)
            return True
        finally:
            self._compose_cleanup(spec)

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def _validate_for_compose(self, spec: workflow_module.WorkflowSpec):
        """Reject cluster-only features while allowing {{host:}} tokens."""
        unsupported_features: List[str] = []
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
                    if isinstance(output, (task_module.DatasetInputOutput,
                                           task_module.URLInputOutput)):
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
                        f'Task "{task_spec.name}": privileged containers are not '
                        f'supported in docker-compose mode')

                if task_spec.hostNetwork:
                    unsupported_features.append(
                        f'Task "{task_spec.name}": hostNetwork is not supported '
                        f'in docker-compose mode')

                self._validate_host_tokens(task_spec, group)

        if unsupported_features:
            raise ValueError(
                'The following features are not supported in docker-compose '
                'execution mode:\n  - '
                + '\n  - '.join(unsupported_features))

    _HOST_TOKEN_NAME_PATTERN = re.compile(r'\{\{\s*host:(\S+)\s*\}\}')

    def _validate_host_tokens(self, task_spec: task_module.TaskSpec,
                              group: task_module.TaskGroupSpec):
        """Ensure {{host:taskname}} tokens only reference tasks in the same group."""
        group_task_names = {t.name for t in group.tasks}
        fields_to_check = list(task_spec.command) + list(task_spec.args)
        fields_to_check += list(task_spec.environment.values())
        fields_to_check += [file_spec.contents for file_spec in task_spec.files]

        for field in fields_to_check:
            for match in self._HOST_TOKEN_NAME_PATTERN.finditer(field):
                referenced_task = match.group(1)
                if referenced_task not in group_task_names:
                    raise ValueError(
                        f'Task "{task_spec.name}": {{{{host:{referenced_task}}}}} '
                        f'references a task outside its group "{group.name}". '
                        f'Host tokens can only reference tasks within the same group.')

    # ------------------------------------------------------------------
    # Token map (extended with {{host:taskname}})
    # ------------------------------------------------------------------

    def _build_token_map(self, node: TaskNode) -> Dict[str, str]:
        tokens = super()._build_token_map(node)
        group_spec = self._group_specs[node.group]
        for task_spec in group_spec.tasks:
            tokens[f'host:{task_spec.name}'] = task_spec.name
        return tokens

    # ------------------------------------------------------------------
    # Inline files
    # ------------------------------------------------------------------

    def _write_inline_files(self, spec: workflow_module.WorkflowSpec):
        """Write all inline file specs to disk with token substitution."""
        for group in self._groups(spec):
            for task_spec in group.tasks:
                node = self._task_nodes[task_spec.name]
                token_map = self._build_token_map(node)
                files_dir = os.path.join(self._work_dir, task_spec.name, 'files')
                os.makedirs(files_dir, exist_ok=True)

                for file_spec in task_spec.files:
                    resolved_contents = self._substitute_tokens(
                        file_spec.contents, token_map)
                    host_path = os.path.realpath(
                        os.path.join(files_dir, file_spec.path.lstrip('/')))
                    if not host_path.startswith(os.path.realpath(files_dir) + os.sep):
                        raise ValueError(
                            f'Task "{task_spec.name}": file path '
                            f'"{file_spec.path}" escapes the task directory')
                    os.makedirs(os.path.dirname(host_path), exist_ok=True)
                    with open(host_path, 'w', encoding='utf-8') as f:
                        f.write(resolved_contents)

    # ------------------------------------------------------------------
    # Compose file generation
    # ------------------------------------------------------------------

    def _generate_compose_file(self, spec: workflow_module.WorkflowSpec):
        """Write a docker-compose.yml containing every task as a service."""
        compose: Dict = {'services': {}}
        networks_needed: set = set()

        for task_name, node in self._task_nodes.items():
            service = self._build_compose_service(node, spec)
            compose['services'][task_name] = service
            networks_needed.add(node.group)

        if networks_needed:
            compose['networks'] = {
                name: {'driver': 'bridge'}
                for name in sorted(networks_needed)
            }

        with open(self._compose_file_path, 'w', encoding='utf-8') as f:
            yaml.safe_dump(compose, f, default_flow_style=False, sort_keys=False)

        logger.info('Generated compose file: %s', self._compose_file_path)

    @staticmethod
    def _escape_compose_interpolation(text: str) -> str:
        """Escape ``$`` as ``$$`` so Docker Compose passes them literally to the container."""
        return text.replace('$', '$$')

    def _build_compose_service(self, node: TaskNode,
                               spec: workflow_module.WorkflowSpec) -> Dict:
        """Build a single Docker Compose service definition for a task."""
        task_spec = node.spec
        token_map = self._build_token_map(node)

        resolved_command = [
            self._substitute_tokens(c, token_map) for c in task_spec.command]
        resolved_args = [
            self._substitute_tokens(a, token_map) for a in task_spec.args]
        resolved_environment = {
            key: self._substitute_tokens(value, token_map)
            for key, value in task_spec.environment.items()
        }

        all_resolved = (
            resolved_command + resolved_args + list(resolved_environment.values())
            + [self._substitute_tokens(f.contents, token_map)
               for f in task_spec.files]
        )
        self._check_unresolved_tokens(node.name, all_resolved)

        esc = self._escape_compose_interpolation

        service: Dict = {'image': task_spec.image}

        if resolved_command:
            service['entrypoint'] = [esc(resolved_command[0])]
            trailing = resolved_command[1:] + resolved_args
            if trailing:
                service['command'] = [esc(t) for t in trailing]
        elif resolved_args:
            service['command'] = [esc(a) for a in resolved_args]

        if resolved_environment:
            service['environment'] = {
                k: esc(v) for k, v in resolved_environment.items()
            }

        volumes: List[str] = []
        task_dir = os.path.abspath(os.path.join(self._work_dir, node.name))
        output_dir = os.path.join(task_dir, 'output')
        volumes.append(f'{output_dir}:{CONTAINER_DATA_PATH}/output')

        for index, input_source in enumerate(task_spec.inputs):
            if isinstance(input_source, task_module.TaskInputOutput):
                upstream_output = os.path.abspath(
                    os.path.join(self._work_dir, input_source.task, 'output'))
                volumes.append(
                    f'{upstream_output}:{CONTAINER_DATA_PATH}/input/{index}:ro')

        files_dir = os.path.join(task_dir, 'files')
        for file_spec in task_spec.files:
            host_path = os.path.realpath(
                os.path.join(files_dir, file_spec.path.lstrip('/')))
            volumes.append(f'{host_path}:{file_spec.path}:ro')

        if volumes:
            service['volumes'] = volumes

        service['networks'] = [node.group]

        gpu_count = self._task_gpu_count(task_spec, spec)
        if gpu_count > 0:
            service['deploy'] = {
                'resources': {
                    'reservations': {
                        'devices': [{
                            'driver': 'nvidia',
                            'count': gpu_count,
                            'capabilities': ['gpu'],
                        }]
                    }
                }
            }
            service['shm_size'] = self._shm_size or self.DEFAULT_SHM_SIZE
        elif self._shm_size:
            service['shm_size'] = self._shm_size

        return service

    # ------------------------------------------------------------------
    # Wave scheduling
    # ------------------------------------------------------------------

    def _find_ready_wave(self) -> List[str]:
        """
        Return the next batch of tasks to run in parallel.

        All members of a multi-task group are co-scheduled: a group is only
        included when every unfinished member has its upstream dependencies
        satisfied.  If co-scheduling stalls (e.g. cross-group edges inside a
        multi-task group), we fall back to plain task-level readiness to avoid
        deadlocks.
        """
        ready_tasks = self._find_ready_tasks()
        if not ready_tasks:
            return []

        ready_set = set(ready_tasks)

        groups_with_ready: Dict[str, List[str]] = {}
        for task_name in ready_tasks:
            group = self._task_nodes[task_name].group
            groups_with_ready.setdefault(group, []).append(task_name)

        wave: List[str] = []
        for group_name, group_ready in groups_with_ready.items():
            group_spec = self._group_specs[group_name]
            all_members = {t.name for t in group_spec.tasks}
            unfinished = all_members - set(self._results.keys())

            if unfinished.issubset(ready_set):
                wave.extend(sorted(unfinished))
            elif len(all_members) == 1:
                wave.extend(group_ready)

        if not wave and ready_tasks:
            wave = ready_tasks

        return wave

    # ------------------------------------------------------------------
    # Wave execution
    # ------------------------------------------------------------------

    def _run_wave(self, task_names: List[str],
                  spec: workflow_module.WorkflowSpec) -> Dict[str, int]:
        """Start *task_names* in parallel and block until they all exit."""
        base_cmd = self._compose_base_cmd(spec)

        up_cmd = base_cmd + ['up', '--no-deps', '--no-log-prefix'] + list(task_names)
        logger.debug('Compose command: %s', ' '.join(up_cmd))

        try:
            subprocess.run(up_cmd, check=False)
        except FileNotFoundError:
            logger.error(
                'Docker Compose not found. Is "%s" available in your PATH?',
                self._compose_cmd)
            return {name: 127 for name in task_names}

        results: Dict[str, int] = {}
        for task_name in task_names:
            results[task_name] = self._get_service_exit_code(task_name, spec)

        rm_cmd = base_cmd + ['rm', '-f'] + list(task_names)
        subprocess.run(rm_cmd, capture_output=True, check=False)

        return results

    def _get_service_exit_code(self, service_name: str,
                               spec: workflow_module.WorkflowSpec) -> int:
        """Query Docker Compose for the exit code of *service_name*."""
        ps_cmd = self._compose_base_cmd(spec) + [
            'ps', '-a', '--format', 'json', service_name,
        ]
        try:
            result = subprocess.run(
                ps_cmd, capture_output=True, text=True, timeout=30)
            if result.returncode != 0:
                logger.warning('Failed to query exit code for "%s": %s',
                               service_name, result.stderr.strip())
                return 1

            for line in result.stdout.strip().splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    container_info = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(container_info, list):
                    for entry in container_info:
                        if entry.get('Service') == service_name:
                            return entry.get('ExitCode', 1)
                elif container_info.get('Service') == service_name:
                    return container_info.get('ExitCode', 1)

            logger.warning('No container info found for service "%s"', service_name)
            return 1
        except (subprocess.TimeoutExpired, FileNotFoundError):
            logger.warning('Could not determine exit code for "%s"', service_name)
            return 1

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def _compose_cleanup(self, spec: workflow_module.WorkflowSpec):
        """Tear down containers and networks created by Docker Compose."""
        down_cmd = self._compose_base_cmd(spec) + ['down', '--remove-orphans']
        try:
            subprocess.run(down_cmd, capture_output=True, timeout=60, check=False)
        except (subprocess.TimeoutExpired, FileNotFoundError):
            logger.warning('Failed to clean up Docker Compose resources')


def run_workflow_compose(spec_path: str, work_dir: str | None = None,
                         keep_work_dir: bool = False,
                         compose_cmd: str = 'docker compose',
                         shm_size: str | None = None) -> bool:
    """Load a workflow spec and execute it via Docker Compose."""
    with open(spec_path, encoding='utf-8') as f:
        spec_text = f.read()

    template_markers = ('{%', '{#', 'default-values')
    if any(marker in spec_text for marker in template_markers):
        raise ValueError(
            'This spec uses Jinja templates which require server-side expansion.\n'
            'Run "osmo workflow submit --dry-run -f <spec>" first to get the '
            'expanded spec,\nthen save that output and run it with docker-compose.')

    created_work_dir = work_dir is None
    if work_dir is None:
        work_dir = tempfile.mkdtemp(prefix='osmo-compose-')
        logger.info('Using temporary work directory: %s', work_dir)

    success = False
    try:
        executor = ComposeExecutor(work_dir=work_dir, keep_work_dir=keep_work_dir,
                                    compose_cmd=compose_cmd, shm_size=shm_size)
        spec = executor.load_spec(spec_text)
        success = executor.execute(spec)
    finally:
        if created_work_dir and not keep_work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)
        elif not success:
            logger.info('Work directory preserved for debugging: %s', work_dir)

    return success
