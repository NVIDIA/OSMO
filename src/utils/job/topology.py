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

import dataclasses
import logging
from typing import Any, Dict, List, Optional

from src.lib.utils import osmo_errors


@dataclasses.dataclass
class TopologyKey:
    """Single topology key definition from pool configuration."""
    key: str  # User-friendly key (e.g., "z", "r")
    label: str  # K8s label (e.g., "topology.kubernetes.io/zone")


@dataclasses.dataclass
class TopologyRequirement:
    """Single topology requirement from workflow."""
    key: str  # Topology key (e.g., "z", "r")
    group: str  # Subgroup name (e.g., "model-1")
    required: bool  # Whether the constraint is required or preferred


@dataclasses.dataclass
class TaskTopology:
    """Task information for topology building."""
    name: str  # Task name
    topology_requirements: List[TopologyRequirement]  # Empty if no requirements


@dataclasses.dataclass
class TopologyTreeNode:
    """Represents a node in the topology constraint tree."""
    label: Optional[str]  # Kubernetes label (e.g., "topology.kubernetes.io/zone"), None for root
    subgroup: Optional[str]  # Subgroup identifier (e.g., "model-1-group")
    required: bool  # Whether this is a required or preferred constraint
    children: List['TopologyTreeNode'] = dataclasses.field(default_factory=list)
    tasks: List[str] = dataclasses.field(default_factory=list)  # Task names at this leaf


@dataclasses.dataclass
class TopologyTreeResult:
    """Result from building the topology constraint tree."""
    top_level_constraint: Optional[Dict[str, str]]  # Top-level PodGroup topology constraint
    subgroups: List[Dict[str, Any]]  # List of subgroup specs for PodGroup
    task_subgroups: Dict[str, str]  # Mapping from task name to subgroup name


def validate_topology_requirements(
    tasks: List[TaskTopology],
    topology_keys: List[TopologyKey]
) -> None:
    """
    Validates topology requirements at workflow submission time.
    Raises OSMOResourceError if validation fails.

    This should be called early (during workflow submission) so users get
    immediate feedback on invalid topology specifications.

    Args:
        tasks: List of tasks with topology requirements
        topology_keys: Available topology keys from pool configuration

    Raises:
        OSMOResourceError: If validation fails (uniform keys or invalid keys)
    """
    # Build key mappings
    available_keys = {topology_key.key for topology_key in topology_keys}

    # Collect unique key sets from tasks
    key_sets = set()
    for task in tasks:
        if task.topology_requirements:
            keys = tuple(sorted(req.key for req in task.topology_requirements))
            key_sets.add(keys)

    # Validate uniform keys
    if len(key_sets) > 1:
        key_list = [', '.join(keys) for keys in key_sets]
        raise osmo_errors.OSMOResourceError(
            f'Topology validation failed: All tasks must use the same topology keys. '
            f'Found different key sets: {key_list}. '
            f'Either all tasks should have topology requirements with the same keys, '
            f'or no tasks should have topology requirements.'
        )

    # Validate keys exist in configuration
    for task in tasks:
        for req in task.topology_requirements:
            if req.key not in available_keys:
                raise osmo_errors.OSMOResourceError(
                    f'Topology validation failed: Topology key "{req.key}" in task '
                    f'"{task.name}" not found in pool. '
                    f'Available keys: {list(available_keys)}'
                )


class PodGroupTopologyBuilder:
    """
    Unified builder for PodGroup topology structure.
    Validates topology requirements and builds complete tree structure in one step.
    """

    def __init__(self, topology_name: str, topology_keys: List[TopologyKey]):
        """
        Args:
            topology_name: Name of the Topology CRD
            topology_keys: Ordered list of topology keys (coarsest → finest)
        """
        self.topology_name = topology_name
        self.topology_keys = topology_keys
        # Create mappings for fast lookup
        self.key_to_label = {
            topology_key.key: topology_key.label for topology_key in topology_keys
        }
        self.label_to_key = {
            topology_key.label: topology_key.key for topology_key in topology_keys
        }
        self.label_order = {
            topology_key.label: i for i, topology_key in enumerate(topology_keys)
        }

    def build(self, tasks: List[TaskTopology]) -> TopologyTreeResult:
        """
        Validates topology requirements and builds complete tree structure.

        Algorithm:
        1. Validate all tasks use same topology keys (or no keys)
        2. Validate keys exist in topology configuration
        3. Build tree with namespaced subgroup names (concatenate parent path)
        4. Find shared topology levels
        5. Create subgroups with hierarchical relationships

        Args:
            tasks: List of tasks with topology requirements

        Returns:
            TopologyTreeResult with complete PodGroup structure

        Raises:
            ValueError: If validation fails
        """
        # Handle empty topology case
        if not any(t.topology_requirements for t in tasks):
            return TopologyTreeResult(
                top_level_constraint=None,
                subgroups=[],
                task_subgroups={}
            )

        # Step 1 & 2: Validate topology requirements
        validate_topology_requirements(tasks, self.topology_keys)

        # Step 3: Build tree with namespaced names
        root = self._build_tree(tasks)

        # Step 4: Find shared topology levels
        top_level_constraint, subgroup_root = self._find_shared_topology(root)

        # Step 5: Create subgroups
        subgroups, task_subgroups = self._create_subgroups(subgroup_root)

        logging.info('Built topology tree with %d subgroups', len(subgroups))
        return TopologyTreeResult(
            top_level_constraint=top_level_constraint,
            subgroups=subgroups,
            task_subgroups=task_subgroups
        )

    def _build_tree(self, tasks: List[TaskTopology]) -> TopologyTreeNode:
        """
        Builds tree structure with namespaced subgroup names.

        Subgroup names are namespaced by concatenating parent groups:
        e.g., zone=z1, rack=r1 → subgroup name is "z1-r1"

        Algorithm:
        - For each task, traverse from root down through topology levels
        - Build namespaced subgroup path at each level
        - Reuse existing nodes or create new ones as needed
        - Tasks with no requirements are added to root
        """
        root = TopologyTreeNode(label=None, subgroup=None, required=True)

        # Dictionary: subgroup_path -> node
        # The subgroup path is the namespaced name (e.g., 'z1-r1-n2')
        subgroup_map: Dict[str, TopologyTreeNode] = {}

        # Process each task
        for task in tasks:
            current_node = root
            current_path = ''

            # Sort requirements by topology order
            # If task has no requirements, this will be an empty list
            sorted_requirements = sorted(
                task.topology_requirements,
                key=lambda r: self.label_order[self.key_to_label[r.key]]
            )

            # Traverse/build tree for this task
            # If task has no requirements, loop doesn't execute and task is added to root
            for req in sorted_requirements:
                label = self.key_to_label[req.key]
                group = req.group

                # Build namespaced subgroup name
                if current_path:
                    subgroup_name = f'{current_path}-{group}'
                else:
                    subgroup_name = group

                # Check if node exists
                if subgroup_name not in subgroup_map:
                    # Create new node
                    new_node = TopologyTreeNode(
                        label=label,
                        subgroup=subgroup_name,
                        required=req.required
                    )
                    subgroup_map[subgroup_name] = new_node
                    current_node.children.append(new_node)

                # Traverse to child
                current_node = subgroup_map[subgroup_name]
                current_path = subgroup_name

            # Add task to current node (root if no requirements, else leaf subgroup)
            current_node.tasks.append(task.name)

        return root

    def _find_shared_topology(
        self,
        root: TopologyTreeNode
    ) -> tuple[Optional[Dict[str, str]], TopologyTreeNode]:
        """Walks down single-child path to find shared topology levels."""
        top_level_constraint = None
        current = root

        # Walk down while there's only one child (shared by all tasks)
        while len(current.children) == 1:
            child = current.children[0]
            top_level_constraint = {
                'topology': self.topology_name,
                ('requiredTopologyLevel' if child.required
                 else 'preferredTopologyLevel'): child.label
            }
            current = child

        return top_level_constraint, current

    def _create_subgroups(
        self,
        root: TopologyTreeNode
    ) -> tuple[List[Dict[str, Any]], Dict[str, str]]:
        """Creates subgroups with hierarchical relationships."""
        subgroups = []
        task_subgroups = {}

        def create_recursive(
            node: TopologyTreeNode,
            parent_name: Optional[str] = None
        ) -> Optional[str]:
            """Recursively creates subgroups."""
            # Use the namespaced subgroup name from the node
            name = node.subgroup

            # Leaf node - create subgroup for tasks
            if not node.children and node.tasks:
                subgroup = {
                    'name': name,
                    'minMember': len(node.tasks),
                    'topologyConstraint': {
                        'topology': self.topology_name,
                        ('requiredTopologyLevel' if node.required
                         else 'preferredTopologyLevel'): node.label
                    }
                }
                if parent_name:
                    subgroup['parent'] = parent_name

                subgroups.append(subgroup)

                # Map tasks to subgroup
                for task_name in node.tasks:
                    task_subgroups[task_name] = name

                return name

            # Non-leaf - create parent subgroup if multiple children or has parent
            if len(node.children) > 1 or parent_name is not None:
                subgroup = {
                    'name': name,
                    'topologyConstraint': {
                        'topology': self.topology_name,
                        ('requiredTopologyLevel' if node.required
                         else 'preferredTopologyLevel'): node.label
                    }
                }
                if parent_name:
                    subgroup['parent'] = parent_name

                idx = len(subgroups)
                subgroups.append(subgroup)

                # Recurse into children
                total = sum(self._count_tasks(child) for child in node.children)
                for child in node.children:
                    create_recursive(child, name)

                subgroups[idx]['minMember'] = total
                return name

            # Single child, no parent - pass through
            return create_recursive(node.children[0], parent_name)

        # Create subgroups from branching point
        for child in root.children:
            create_recursive(child)

        return subgroups, task_subgroups

    def _count_tasks(self, node: TopologyTreeNode) -> int:
        """Counts total tasks in a tree node."""
        return len(node.tasks) + sum(self._count_tasks(c) for c in node.children)
