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

Topology constraint building logic for KAI scheduler.
"""

from typing import Dict, List

import pydantic

from src.utils import connectors


class TaskTopologyConstraint(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """
    Represents a single topology constraint for a task.

    Things with the same subgroup for the same label must be matched
    on a label that has the same value.
    """
    label: str  # The Kubernetes label (e.g., k8s.io/hostname)
    subgroup: str  # Subgroup identifier for grouping constraints
    required: bool  # Whether the constraint is required or preferred


class TaskTopologyConstraints(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """Contains all topology constraints for a single task"""
    constraints: List[TaskTopologyConstraint] = []


class GroupTopologyConstraints(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """
    Maps task names to their topology constraints.
    Used as input to kb_objects.py create_group_k8s_resources.
    """
    task_topology_constraints: Dict[str, TaskTopologyConstraints]


class TopologyConstraintBuilder:
    """Builds topology constraints for PodGroups from workflow specs"""

    def __init__(self, pool: connectors.Pool):
        """
        Args:
            pool: Pool configuration containing topology_keys
        """
        self.pool = pool
        self.key_to_label = {
            topology_key.key: topology_key.label for topology_key in pool.topology_keys
        }

    def build_constraints(self, tasks: List, pods: List[Dict],
                         pool_name: str, namespace: str) -> GroupTopologyConstraints:
        """
        Builds topology constraints for a task group.

        Algorithm:
        1. Collect all topology requirements from all tasks
        2. For each task, create TaskTopologyConstraint objects
        3. Build a GroupTopologyConstraints mapping task names to their constraints

        Args:
            tasks: List of tasks in the group
            pods: List of pod specs (in same order as tasks)
            pool_name: Name of the pool
            namespace: K8s namespace for the backend

        Returns:
            GroupTopologyConstraints with task constraints (empty if no constraints)
        """
        # pylint: disable=unused-argument
        task_topology_constraints: Dict[str, TaskTopologyConstraints] = {}

        # If pool has no topology keys, return empty constraints
        if not self.pool.topology_keys:
            return GroupTopologyConstraints(task_topology_constraints={})

        # Build task topology constraints for tasks with topology requirements
        for task_obj in tasks:
            if not task_obj.resources.topology:
                continue

            # Get the task name from the task object
            task_name = task_obj.name

            # Create TaskTopologyConstraint for each topology requirement
            constraints = []
            for req in task_obj.resources.topology:
                label = self.key_to_label[req.key]
                constraint = TaskTopologyConstraint(
                    label=label,
                    subgroup=req.group,
                    required=(req.requirementType == connectors.TopologyRequirementType.REQUIRED)
                )
                constraints.append(constraint)

            task_topology_constraints[task_name] = TaskTopologyConstraints(
                constraints=constraints
            )

        return GroupTopologyConstraints(
            task_topology_constraints=task_topology_constraints
        )

    def validate_topology_requirements(self, resource_spec: connectors.ResourceSpec):
        """Validates that topology requirements reference valid pool keys"""
        for req in resource_spec.topology:
            if req.key not in self.key_to_label:
                raise ValueError(
                    f'Topology key "{req.key}" not found in pool topology_keys. '
                    f'Available keys: {list(self.key_to_label.keys())}'
                )
