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

import copy
import dataclasses
import datetime
from typing import TYPE_CHECKING, Any, Dict, List, Mapping

import yaml

if TYPE_CHECKING:
    from src.lib.utils import priority as wf_priority
    from src.utils import connectors
    from src.utils.job import common as task_common
    from src.utils.job import task
    from src.utils.progress_check import progress


@dataclasses.dataclass(frozen=True)
class RenderedTaskGroup:
    """Kubernetes resources and per-task pod specs rendered for a task group."""

    resources: List[Dict[str, Any]]
    pod_specs: Dict[str, Dict[str, Any]]

    def as_runtime_config(self) -> Dict[str, Any]:
        """Return the CRD runtimeConfig payload consumed by the Go KAI reconciler."""
        return {'resources': copy.deepcopy(self.resources)}


def render_task_group_k8s_resources(
    task_group: 'task.TaskGroup',
    workflow_uuid: str,
    user: str,
    workflow_config: 'connectors.WorkflowConfig',
    backend_config_cache: 'connectors.BackendConfigCache',
    backend_name: str,
    pool: str,
    progress_writer: 'progress.ProgressWriter',
    progress_iter_freq: datetime.timedelta,
    workflow_plugins: 'task_common.WorkflowPlugins',
    priority: 'wf_priority.WorkflowPriority',
) -> RenderedTaskGroup:
    """Render Kubernetes resources without submitting backend jobs."""
    resources, pod_specs = task_group.get_kb_specs(
        workflow_uuid,
        user,
        workflow_config,
        backend_config_cache,
        backend_name,
        pool,
        progress_writer,
        progress_iter_freq,
        workflow_plugins,
        priority,
    )
    return RenderedTaskGroup(resources=resources, pod_specs=pod_specs)


def normalize_rendered_object(value: Any) -> Any:
    """Normalize volatile Kubernetes fields while preserving resource order."""
    if isinstance(value, list):
        return [normalize_rendered_object(item) for item in value]
    if not isinstance(value, dict):
        return value

    normalized: Dict[str, Any] = {}
    for key in sorted(value.keys()):
        if key in {'creationTimestamp', 'managedFields', 'resourceVersion', 'uid'}:
            continue
        if key == 'status':
            continue
        item = value[key]
        if key == 'annotations' and isinstance(item, Mapping):
            annotations = {
                annotation_key: annotation_value
                for annotation_key, annotation_value in item.items()
                if annotation_key not in {
                    'kubectl.kubernetes.io/last-applied-configuration',
                }
            }
            normalized[key] = normalize_rendered_object(annotations)
            continue
        normalized[key] = normalize_rendered_object(item)
    return normalized


def normalize_rendered_task_group(rendered: RenderedTaskGroup) -> Dict[str, Any]:
    """Return a stable structure suitable for golden-file comparison."""
    return {
        'resources': normalize_rendered_object(rendered.resources),
        'pod_specs': normalize_rendered_object(rendered.pod_specs),
    }


def dump_normalized_rendered_task_group(rendered: RenderedTaskGroup) -> str:
    """Dump normalized output as deterministic YAML."""
    return yaml.safe_dump(
        normalize_rendered_task_group(rendered),
        default_flow_style=False,
        sort_keys=True,
    )
