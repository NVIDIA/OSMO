"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES.
All rights reserved.

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

import base64
import dataclasses
import hashlib
import json
import logging
import os
from typing import Any, Dict, List, Optional

import pydantic

from src.lib.utils import common as common_utils, priority as wf_priority, osmo_errors
from src.utils import connectors
from src.utils.job import backend_job_defs, common, topology

DATA_LOCATION = '/osmo/data'


@dataclasses.dataclass
class TopologyTreeNode:
    """Represents a node in the topology constraint tree."""
    label: Optional[str]  # Kubernetes label (e.g., "nvidia.com/rack"), None for root
    subgroup: Optional[str]  # Subgroup identifier (e.g., "model-1-group")
    required: bool  # Whether this is a required or preferred constraint
    children: List['TopologyTreeNode'] = dataclasses.field(default_factory=list)
    tasks: List[str] = dataclasses.field(default_factory=list)  # Task names at this leaf


@dataclasses.dataclass
class TopologyTreeResult:
    """Result from building the topology constraint tree."""
    top_level_constraint: Optional[Dict[str, str]]  # Top-level PodGroup topology constraint
    subgroups: List[Dict[str, Any]]  # List of subgroup specs for PodGroup
    pod_subgroups: Dict[str, str]  # Mapping from pod name to subgroup name


def k8s_name(name: str) -> str:
    """ Gets the k8s acceptable name. """
    return name.lower().replace('_', '-')


def construct_pod_name(workflow_uuid: str, task_uuid: str) -> str:
    return f'{workflow_uuid[:16]}-{task_uuid[:16]}'


class K8sObjectFactory:
    """ Creates k8s objects when tasks are submitted """
    def __init__(self, scheduler_name: str):
        self._scheduler_name = scheduler_name

    def create_secret(self, name: str, labels: Dict[str, str], data: Dict,
                      string_data: Dict, secret_type: str = 'Opaque') -> Dict:
        """
        Returns an object for kubernetes to create a secret in supplied namespace.

        Args:
            name: Name of the secret.
            labels: Labels.
            data: A dict contains the secret key.
            stringData: A dict with values are strings
            secret_type: Type of the secret. Default to Opaque
        """
        return {
            'apiVersion': 'v1',
            'data': data,
            'stringData': string_data,
            'kind': 'Secret',
            'metadata': {
                'name': name,
                'labels': labels
            },
            'type': secret_type
        }

    def create_group_k8s_resources(
            self, group_uuid: str, pods: List[Dict],
            labels: Dict[str, str], pool_name: str,
            priority: wf_priority.WorkflowPriority,
            topology_constraints: topology.GroupTopologyConstraints
    ) -> List[Dict[str, Any]]:
        """
        Given the target pod specs, this returns the k8s resources needed to create tme as a gang
        scheduled group.

        Args:
            group_uuid (str): The group uuid.
            pods (List[Dict]): The list of pod specs to create in the backend.
            labels (Dict[str, str]): OSMO labels.
            topology_constraints: Topology constraints for the PodGroup

        Returns:
            List[Dict]: A list of k8s objects to create in the cluster.
        """
        # pylint: disable=unused-argument
        for pod in pods:
            self.update_pod_k8s_resource(pod, group_uuid, pool_name, priority)
        return pods

    def update_pod_k8s_resource(self, pod: Dict, group_uuid: str, pool_name: str,
                                priority: wf_priority.WorkflowPriority):
        """
        Given the target pod spec, this adds the k8s resource needed to create the pod.
        """
        # pylint: disable=unused-argument
        pod['spec']['schedulerName'] = self._scheduler_name

    def get_group_cleanup_specs(self, labels: Dict[str, str]) -> \
        List[backend_job_defs.BackendCleanupSpec]:
        """Returns the objects to cleanup for this pod group"""
        return [backend_job_defs.BackendCleanupSpec(resource_type='Pod', labels=labels)]

    def get_error_log_specs(self, labels: Dict[str, str]) -> backend_job_defs.BackendCleanupSpec:
        return backend_job_defs.BackendCleanupSpec(resource_type='Pod', labels=labels)

    def retry_allowed(self) -> bool:
        return True

    def create_init_container(
        self,
        login_config: Dict,
        user_config: Dict,
        extra_args: List[str],
    ) -> Dict:
        """
        Init containers for OSMO exec.

        Args:
            login_config (Dict): User login config to be copied into ctrl and user container paths
            user_config (Dict): User data config to be copied into user container path

        Returns:
            Dict: The init container dict.
        """
        container: str = \
            connectors.PostgresConnector.get_instance().get_workflow_configs().backend_images.init

        return {
            'imagePullPolicy': 'Always',
            'name': 'osmo-init',
            'image': container,
            'command': ['osmo_init'],
            'args': [
                '--data_location', DATA_LOCATION,
                '--login_location', common.LOGIN_LOCATION,
                '--user_bin_location', common.USER_BIN_LOCATION,
                '--run_location', common.RUN_LOCATION,
            ] + extra_args,
            'volumeMounts': [{'name': 'osmo', 'mountPath': '/osmo_binaries'},
                             {'name': 'osmo-data', 'mountPath': DATA_LOCATION},
                             {'name': 'osmo-login', 'mountPath': common.LOGIN_LOCATION},
                             {'name': 'osmo-usr-bin', 'mountPath': common.USER_BIN_LOCATION},
                             {'name': 'osmo-run', 'mountPath': common.RUN_LOCATION},
                             login_config,
                             user_config],
            'resources': {
                'requests': {'cpu': '250m', 'ephemeral-storage': '1Gi'},
                'limits': {'cpu': '500m', 'ephemeral-storage': '1Gi'}
            }
        }

    def create_control_container(self, extra_args: List, image: str, task_uid: str,
                                 file_mounts: List[Dict[str, str]],
                                 download_type: str, task_resources: connectors.ResourceSpec,
                                 cache_size: int)\
                                 -> Dict:
        """
        Converts to k8s pod container.

        Args:
            image (str): image to use for the data
            task_uid (str): uid for the secret file name

        Returns:
            Dict: Pod container spec.
        """
        websocket_timeout = connectors.PostgresConnector.get_instance()\
            .get_workflow_configs().workflow_data.websocket_timeout
        data_timeout = connectors.PostgresConnector.get_instance()\
            .get_workflow_configs().workflow_data.data_timeout
        input_mount = {
            'name': 'osmo-data',
            'mountPath': DATA_LOCATION + '/input',
            'subPath': 'input'
        }
        mounting = connectors.DownloadType.from_str(download_type).is_mounting()
        if mounting:
            input_mount['mountPropagation'] = 'Bidirectional'
        container: Dict = {
            'imagePullPolicy': 'Always',
            'name': k8s_name('osmo_ctrl'),
            'image': image,
            'securityContext': {'privileged': mounting},
            'volumeMounts': [{'name': 'osmo', 'mountPath': '/osmo/bin/osmo_ctrl',
                              'subPath': 'osmo/osmo_ctrl', 'readOnly': True},
                             {'name': 'osmo-data', 'mountPath': DATA_LOCATION +
                              '/socket', 'subPath': 'socket'},
                             {'name': 'osmo-data', 'mountPath': DATA_LOCATION +
                              '/benchmarks', 'subPath': 'benchmarks'},
                             input_mount,
                             {'name': 'osmo-data', 'mountPath': DATA_LOCATION +
                              '/output', 'subPath': 'output', 'readOnly': True},
                             {'name': 'osmo-login', 'mountPath': common.LOGIN_LOCATION +
                              '/config', 'subPath': 'ctrl/config'}],
            'command': ['/osmo/bin/osmo_ctrl'],
            'args': ['-socketPath', DATA_LOCATION + '/socket/data.sock',
                     '-inputPath', DATA_LOCATION + '/input/',
                     '-outputPath', DATA_LOCATION + '/output/',
                     '-metadataFile', DATA_LOCATION + '/default_metadata.yaml',
                     '-downloadType', str(download_type),
                     '-timeout', str(websocket_timeout),
                     '-dataTimeout', str(data_timeout),
                     '-cacheSize', str(cache_size)]
        }

        container['args'] += extra_args
        container['env'] = [
            {
                'name': 'OSMO_CONFIG_FILE_DIR',
                'valueFrom': {
                    'secretKeyRef': {
                        'name': task_uid + '-file-dir',
                        'key': 'fileDir'
                    }
                }
            },
            {
                'name': 'OSMO_NODE_NAME',
                'valueFrom': {
                    'fieldRef': {
                        'fieldPath': 'spec.nodeName'
                    }
                }
            }
        ]

        if task_resources.cpu:
            container['env'].append(
                # Set CPU Count for Ctrl data
                {
                    'name': 'CPU_COUNT',
                    'value': str(task_resources.cpu)
                }
            )

        container['volumeMounts'] += file_mounts

        return container

    def create_headless_service(self, name: str, labels: Dict[str, str]) -> Dict:
        """
        Returns an object for kubernetes to create a headless service.

        Args:
            name: Name of the service.
            labels: Labels
        """
        return {
            'apiVersion': 'v1',
            'kind': 'Service',
            'metadata': {
                'name': common_utils.get_group_subdomain_name(name),
                'labels': labels
            },
            'spec': {
                'selector': labels,
                'clusterIP': 'None'
            }
        }

    def create_config_map(self, name: str, labels: Dict[str, str], data: Dict) -> Dict:
        """
        Returns an object for kubernetes to create a config map.

        Args:
            name: Name of the secret.
            labels: Labels.
            data: A dict contains the data mapping.
        """
        config_map = {
            'apiVersion': 'v1',
            'kind': 'ConfigMap',
            'metadata': {
                'name': name,
                'labels': labels,
            },
            'data': data
        }
        return config_map

    def create_image_secret(self, secret_name: str, labels: Dict[str, str],
                            cred: Dict[str, Dict[str, str]]):
        """ Create Kubernetes Docker-Registry Secret object. """
        docker_config_encoded = \
            base64.b64encode(json.dumps({'auths': cred}).encode('utf-8')).decode('utf-8')

        return {
            'apiVersion': 'v1',
            'kind': 'Secret',
            'metadata': {
                'name': secret_name,
                'labels': labels
            },
            'type': 'kubernetes.io/dockerconfigjson',
            'data': {
                '.dockerconfigjson': docker_config_encoded
            }
        }

    def list_scheduler_resources_spec(self, backend: connectors.Backend) \
        -> List[backend_job_defs.BackendCleanupSpec]:
        """
        Return cleanup specs for listing scheduler resources (queues, topologies, etc.)
        for a backend. Returns empty list if no scheduler resources are used.
        """
        # pylint: disable=unused-argument
        return []

    def get_scheduler_resources_spec(
            self, backend: connectors.Backend,
            pools: List[connectors.Pool]) -> List[Dict] | None:
        """
        Gets a list of scheduler resources (queues, topologies, etc.) that belong on the backend.
        Returns None if scheduler resources aren't supported by this backend.
        """
        # pylint: disable=unused-argument
        return None

    def priority_supported(self) -> bool:
        """Whether this scheduler supports priority"""
        return False

    def topology_supported(self) -> bool:
        """Whether this scheduler supports topology constraints"""
        return False


class KaiK8sObjectFactory(K8sObjectFactory):
    """Define a k8s object factory for the KAI scheduler"""

    def __init__(self, backend: connectors.Backend):
        super().__init__(backend.scheduler_settings.scheduler_name)
        self._namespace = backend.k8s_namespace

    def create_group_k8s_resources(self, group_uuid: str,
        pods: List[Dict], labels: Dict[str, str], pool_name: str,
        priority: wf_priority.WorkflowPriority,
        topology_constraints: topology.GroupTopologyConstraints) -> List[Dict]:
        """
        Given the target pod specs, this returns the k8s resources needed to create them as a gang
        scheduled group.

        Uses a tree-based algorithm to build PodGroup with hierarchical subgroups based on
        topology constraints.

        Args:
            group_uuid (str): The group uuid.
            pods (List[Dict]): The list of pod specs to create in the backend.
            labels (Dict[str, str]): OSMO labels.
            topology_constraints: Topology constraints for the PodGroup

        Returns:
            List[Dict]: A list of k8s objects to create in the cluster.
        """
        queue = f'osmo-pool-{self._namespace}-{pool_name}'
        priority_class = f'osmo-{priority.value.lower()}'
        topology_name = f'osmo-pool-{self._namespace}-{pool_name}-topology'

        # Convert topology constraints to PodGroup spec format using tree-based algorithm
        top_level_constraint = None
        subgroups = []
        pod_subgroups = {}

        if topology_constraints.task_topology_constraints:
            # Build tree and create PodGroup structure
            tree_result = self._build_topology_tree(
                topology_constraints, topology_name, pods
            )
            top_level_constraint = tree_result.top_level_constraint
            subgroups = tree_result.subgroups
            pod_subgroups = tree_result.pod_subgroups

        # Apply pod-level configuration
        for pod in pods:
            if 'annotations' not in pod['metadata']:
                pod['metadata']['annotations'] = {}
            pod['metadata']['annotations']['pod-group-name'] = group_uuid
            pod['spec']['schedulerName'] = self._scheduler_name
            pod['metadata']['labels']['kai.scheduler/queue'] = queue
            # Backwards compatibility for Kai Scheduler before v0.6.0
            pod['metadata']['labels']['runai/queue'] = queue

            # Add subgroup label if topology is used
            pod_name = pod['metadata']['name']
            if pod_name in pod_subgroups:
                subgroup_name = pod_subgroups[pod_name]
                logging.info('Setting kai.scheduler/subgroup-name=%s on pod %s',
                             subgroup_name, pod_name)
                pod['metadata']['labels']['kai.scheduler/subgroup-name'] = subgroup_name
            else:
                logging.info('Pod %s not in any subgroup', pod_name)

        pod_group_labels = {
            'kai.scheduler/queue': queue,
            # Backwards compatibility for Kai Scheduler before v0.6.0
            'runai/queue': queue,
        }
        pod_group_labels.update(labels)

        pod_group_spec = {
            'queue': queue,
            'priorityClassName': priority_class,
        }

        # Add minMember: only at top level if no subgroups, otherwise in leaf subgroups
        if not subgroups:
            pod_group_spec['minMember'] = len(pods)

        # Add topology constraints if present
        if top_level_constraint:
            pod_group_spec['topologyConstraint'] = top_level_constraint

        if subgroups:
            logging.info('Adding %d subgroups to PodGroup spec', len(subgroups))
            pod_group_spec['subGroups'] = subgroups
        else:
            logging.info('No subgroups, not adding to PodGroup spec')

        return [{
            'apiVersion': 'scheduling.run.ai/v2alpha2',
            'kind': 'PodGroup',
            'metadata': {
                'name': group_uuid,
                'labels': pod_group_labels
            },
            'spec': pod_group_spec
        }] + pods

    def update_pod_k8s_resource(self, pod: Dict, group_uuid: str, pool_name: str,
                                priority: wf_priority.WorkflowPriority):
        """
        Given the target pod spec, this adds the k8s resource needed to create the pod.
        """
        if 'annotations' not in pod['metadata']:
            pod['metadata']['annotations'] = {}
        pod['metadata']['annotations']['pod-group-name'] = group_uuid
        pod['spec']['schedulerName'] = self._scheduler_name
        pod['metadata']['labels']['kai.scheduler/queue'] = \
            f'osmo-pool-{self._namespace}-{pool_name}'
        # Backwards compatibility for Kai Scheduler before v0.6.0
        pod['metadata']['labels']['runai/queue'] = \
            f'osmo-pool-{self._namespace}-{pool_name}'
        pod['metadata']['labels']['osmo.priority'] = priority.value.lower()

    def get_group_cleanup_specs(self, labels: Dict[str, str]) -> \
        List[backend_job_defs.BackendCleanupSpec]:
        """Returns the objects to cleanup for this pod group"""
        return [
            backend_job_defs.BackendCleanupSpec(resource_type='Pod', labels=labels),
            backend_job_defs.BackendCleanupSpec(
                    resource_type='PodGroup',
                    labels=labels,
                    custom_api=backend_job_defs.BackendCustomApi(
                        api_major='scheduling.run.ai',
                        api_minor='v2alpha2',
                        path='podgroups'))]

    def list_scheduler_resources_spec(self, backend: connectors.Backend) \
        -> List[backend_job_defs.BackendCleanupSpec]:
        """Returns cleanup specs for queues and topology CRDs"""
        specs = [
            # Queue cleanup spec
            backend_job_defs.BackendCleanupSpec(
                resource_type='Queue',
                labels={'osmo.namespace': backend.k8s_namespace},
                custom_api=backend_job_defs.BackendCustomApi(
                    api_major='scheduling.run.ai',
                    api_minor='v2',
                    path='queues'
                )),
            # Topology cleanup spec
            backend_job_defs.BackendCleanupSpec(
                resource_type='Topology',
                labels={'osmo.namespace': backend.k8s_namespace},
                custom_api=backend_job_defs.BackendCustomApi(
                    api_major='kai.scheduler',
                    api_minor='v1alpha1',
                    path='topologies'
                ))
        ]
        return specs

    def get_scheduler_resources_spec(
            self, backend: connectors.Backend,
            pools: List[connectors.Pool]) -> List[Dict] | None:
        """
        Gets queue and topology CRD specs for all pools in the backend.
        Returns list containing both Queue and Topology CRDs.
        """
        resources = []

        # Create queue specs
        resources.extend(self._create_queue_specs(backend, pools))

        # Create topology CRD specs
        resources.extend(self._create_topology_specs(backend, pools))

        return resources

    def _create_queue_specs(self, backend: connectors.Backend, pools: List[connectors.Pool]) \
        -> List[Dict]:
        """Creates queue specs (existing logic from get_queue_spec)"""
        # Define a no-op quota that will never block pods from being scheduled.
        default_quota = {
            'quota': -1,
            'limit': -1,
            'overQuotaWeight': 1
        }

        # KAI scheduler requires all queues that are submitted to to have a parent queue.
        specs = [{
            'apiVersion': 'scheduling.run.ai/v2',
            'kind': 'Queue',
            'metadata': {
                'name': f'osmo-default-{backend.k8s_namespace}',
                'labels': {
                    'osmo.namespace': backend.k8s_namespace
                }
            },
            'spec': {
                'resources': {
                    'gpu': default_quota,
                    'cpu': default_quota,
                    'memory': default_quota
                }
            }
        }]

        # Create one KAI queue to represent each pool.
        for pool in pools:
            gpu_spec = pool.resources.gpu or \
                connectors.PoolResourceCountable(guarantee=-1, maximum=-1)
            specs.append({
                'apiVersion': 'scheduling.run.ai/v2',
                'kind': 'Queue',
                'metadata': {
                    'name': f'osmo-pool-{backend.k8s_namespace}-{pool.name}',
                    'labels': {
                        'osmo.namespace': backend.k8s_namespace
                    }
                },
                'spec': {
                    'parentQueue': f'osmo-default-{backend.k8s_namespace}',
                    'resources': {
                        'gpu': {
                            'quota': gpu_spec.guarantee,
                            'limit': gpu_spec.maximum,
                            'overQuotaWeight': gpu_spec.weight,
                        },
                        'cpu': default_quota,
                        'memory': default_quota
                    }
                }
            })
        return specs

    def _create_topology_specs(self, backend: connectors.Backend, pools: List[connectors.Pool]) \
        -> List[Dict]:
        """Creates Topology CRD specs for pools with topology_keys configured.

        Topology levels must be ordered from coarsest to finest (e.g., zone -> rack -> hostname).
        Pool topology_keys are expected to be in coarsest-to-finest order.
        """
        topology_crds = []
        for pool in pools:
            if pool.topology_keys:
                topology_crds.append({
                    'apiVersion': 'kai.scheduler/v1alpha1',
                    'kind': 'Topology',
                    'metadata': {
                        'name': f'osmo-pool-{backend.k8s_namespace}-{pool.name}-topology',
                        'labels': {
                            'osmo.namespace': backend.k8s_namespace,
                            'osmo.pool': pool.name
                        }
                    },
                    'spec': {
                        'levels': [
                            {'nodeLabel': topology_key.label}
                            for topology_key in pool.topology_keys
                        ]
                    }
                })
        return topology_crds

    def _build_topology_tree(
        self,
        topology_constraints: topology.GroupTopologyConstraints,
        topology_name: str,
        pods: List[Dict]
    ) -> TopologyTreeResult:
        """
        Builds a tree structure from topology constraints and creates PodGroup subgroups.

        Algorithm:
        1. Determine topology levels at play (which appear in task requirements)
        2. Sort from coarsest to finest
        3. Build tree: root -> coarsest level groups -> finer levels -> leaf nodes (tasks)
        4. Walk down tree through single-node layers (shared topology)
        5. Create subgroups for multi-node layers with hierarchical parent relationships
        6. Add minMember only to leaf subgroups
        7. IMPORTANT: All leaf nodes must be at the same level. Tasks without topology
           constraints are placed in a catch-all subgroup with "preferred" constraint.

        Returns:
            TopologyTreeResult with top_level_constraint, subgroups, and pod_subgroups
        """
        # Collect all task names from pods
        all_task_names = {
            pod['metadata']['labels'].get('osmo.task_name')
            for pod in pods
            if pod['metadata']['labels'].get('osmo.task_name')
        }

        # Step 1: Collect all topology levels used and organize tasks by their constraints
        # Map: (label, subgroup, required) -> list of task names
        constraint_to_tasks: Dict[tuple, List[str]] = {}

        # Separate tasks with and without topology constraints
        constrained_tasks = set()
        for task_name, task_constraints in topology_constraints.task_topology_constraints.items():
            if not task_constraints.constraints:
                continue

            constrained_tasks.add(task_name)

            # Group by the tuple of all constraints (label, subgroup, required)
            constraint_key = tuple(
                (c.label, c.subgroup, c.required) for c in task_constraints.constraints
            )

            if constraint_key not in constraint_to_tasks:
                constraint_to_tasks[constraint_key] = []
            constraint_to_tasks[constraint_key].append(task_name)

        # Find tasks without topology constraints
        unconstrained_tasks = list(all_task_names - constrained_tasks)

        if not constraint_to_tasks and not unconstrained_tasks:
            return TopologyTreeResult(
                top_level_constraint=None,
                subgroups=[],
                pod_subgroups={}
            )

        # Step 2: Determine all topology levels in play and the deepest level used
        # The constraints are already in coarsest-to-finest order from the pool config
        all_levels_used = set()
        max_depth = 0
        deepest_constraint_tuple = None

        for constraint_tuple in constraint_to_tasks:
            if len(constraint_tuple) > max_depth:
                max_depth = len(constraint_tuple)
                deepest_constraint_tuple = constraint_tuple
            for label, _, _ in constraint_tuple:
                all_levels_used.add(label)

        # Get ordering of levels from the deepest constraint tuple
        if deepest_constraint_tuple:
            levels_in_order = [label for label, _, _ in deepest_constraint_tuple]
        else:
            levels_in_order = []

        # Step 2.5: Pad tasks to same depth - all leaf nodes must be at the same level
        if max_depth > 1 and deepest_constraint_tuple:
            # Pad constraint tuples that are shorter than max_depth
            padded_constraint_to_tasks = {}
            for constraint_tuple, task_list in constraint_to_tasks.items():
                if len(constraint_tuple) < max_depth:
                    # Pad with preferred constraints at finer levels
                    padded_tuple = list(constraint_tuple)
                    # Get the subgroup name from the existing constraints for continuity
                    base_subgroup = constraint_tuple[-1][1] if constraint_tuple else 'default'
                    for i in range(len(constraint_tuple), max_depth):
                        label = levels_in_order[i]
                        padded_tuple.append((label, f'{base_subgroup}-padded-{i}', False))
                    padded_constraint_to_tasks[tuple(padded_tuple)] = task_list
                else:
                    padded_constraint_to_tasks[constraint_tuple] = task_list
            constraint_to_tasks = padded_constraint_to_tasks

        # Pad unconstrained tasks to same depth as other tasks
        if unconstrained_tasks and deepest_constraint_tuple:
            # Create a constraint tuple with all levels marked as "preferred" with a default group
            padded_constraint_tuple = tuple(
                (label, 'default-unconstrained', False)  # False = preferred
                for label, _, _ in deepest_constraint_tuple
            )
            constraint_to_tasks[padded_constraint_tuple] = unconstrained_tasks
        elif unconstrained_tasks and not deepest_constraint_tuple:
            # No constrained tasks, only unconstrained tasks - no subgroups needed
            return TopologyTreeResult(
                top_level_constraint=None,
                subgroups=[],
                pod_subgroups={}
            )

        # Step 3: Build tree structure using TopologyTreeNode
        root = TopologyTreeNode(label=None, subgroup=None, required=True)

        # Build tree by grouping tasks at each level
        for constraint_tuple, task_list in constraint_to_tasks.items():
            # Navigate/create path in tree for this constraint set
            current_node = root
            for label, subgroup, required in constraint_tuple:
                # Find or create child node for this (label, subgroup, required)
                child_node = None
                for child in current_node.children:
                    if (child.label == label and
                        child.subgroup == subgroup and
                        child.required == required):
                        child_node = child
                        break

                if child_node is None:
                    child_node = TopologyTreeNode(
                        label=label,
                        subgroup=subgroup,
                        required=required
                    )
                    current_node.children.append(child_node)

                current_node = child_node

            # Add tasks to the leaf node
            current_node.tasks.extend(task_list)

        # Step 4: Walk down tree to find shared topology levels
        top_level_constraint = None
        subgroup_creation_root = root

        # Walk down while there's only one child (shared topology)
        current_level = root
        while len(current_level.children) == 1:
            single_child = current_level.children[0]
            # This level is shared by all tasks
            top_level_constraint = {
                'topology': topology_name,
                ('requiredTopologyLevel' if single_child.required
                 else 'preferredTopologyLevel'): single_child.label
            }
            current_level = single_child

        # Start creating subgroups from this level
        subgroup_creation_root = current_level

        # Step 5: Create subgroups with hierarchical relationships
        subgroups = []
        pod_subgroups = {}
        subgroup_counter = [0]  # Use list to allow modification in nested function

        def create_subgroups_recursive(node: TopologyTreeNode, parent_name=None):
            """Recursively create subgroups for tree nodes"""
            if not node.children:
                # Leaf node - create subgroup for tasks
                if node.tasks:
                    subgroup_counter[0] += 1
                    subgroup_name = f'{node.subgroup}-sg-{subgroup_counter[0]}'

                    subgroup = {
                        'name': subgroup_name,
                        'minMember': len(node.tasks),
                        'topologyConstraint': {
                            'topology': topology_name,
                            ('requiredTopologyLevel' if node.required
                             else 'preferredTopologyLevel'): node.label
                        }
                    }

                    if parent_name:
                        subgroup['parent'] = parent_name

                    subgroups.append(subgroup)

                    # Map pods to this subgroup
                    for task_name in node.tasks:
                        for pod in pods:
                            if pod['metadata']['labels'].get('osmo.task_name') == task_name:
                                pod_subgroups[pod['metadata']['name']] = subgroup_name
                                break

                    return subgroup_name
                return None

            # Non-leaf node - create subgroup and recurse
            if len(node.children) > 1 or parent_name is not None:
                # Create intermediate subgroup only if there are multiple children
                # or if we already have a parent (to maintain hierarchy)
                subgroup_counter[0] += 1
                subgroup_name = f'{node.subgroup}-sg-{subgroup_counter[0]}'

                # For non-leaf subgroups, minMember is sum of children
                # But we'll compute this after creating children
                subgroup = {
                    'name': subgroup_name,
                    'topologyConstraint': {
                        'topology': topology_name,
                        ('requiredTopologyLevel' if node.required
                         else 'preferredTopologyLevel'): node.label
                    }
                }

                if parent_name:
                    subgroup['parent'] = parent_name

                # Placeholder for minMember - will be computed from children
                placeholder_idx = len(subgroups)
                subgroups.append(subgroup)

                # Recurse into children
                total_tasks = 0
                for child in node.children:
                    create_subgroups_recursive(child, subgroup_name)
                    # Count tasks from child
                    total_tasks += _count_tasks_in_tree(child)

                # Update minMember with total from children (only for non-leaf subgroups)
                subgroups[placeholder_idx]['minMember'] = total_tasks

                return subgroup_name

            # Single child and no parent - pass through
            return create_subgroups_recursive(node.children[0], parent_name)

        def _count_tasks_in_tree(node: TopologyTreeNode):
            """Count total tasks in a tree node"""
            count = len(node.tasks)
            for child in node.children:
                count += _count_tasks_in_tree(child)
            return count

        # Create subgroups starting from where tree branches
        if subgroup_creation_root.children:
            for child in subgroup_creation_root.children:
                create_subgroups_recursive(child)

        logging.info('Built topology tree with %d subgroups', len(subgroups))
        return TopologyTreeResult(
            top_level_constraint=top_level_constraint,
            subgroups=subgroups,
            pod_subgroups=pod_subgroups
        )

    def priority_supported(self) -> bool:
        """Whether this scheduler supports priority"""
        return True

    def topology_supported(self) -> bool:
        """Whether this scheduler supports topology constraints"""
        return True


def get_k8s_object_factory(backend: connectors.Backend) -> K8sObjectFactory:
    scheduler_settings = backend.scheduler_settings
    scheduler_type = scheduler_settings.scheduler_type
    if scheduler_type == connectors.BackendSchedulerType.KAI:
        return KaiK8sObjectFactory(backend)
    else:
        raise osmo_errors.OSMOServerError(f'Unsupported scheduler type: {scheduler_type}')


class FileMount(pydantic.BaseModel):
    """ A class to support add files to pods. """
    group_uid: str
    path: str
    content: str
    digest: str = ''
    k8s_factory: K8sObjectFactory

    class Config:
        arbitrary_types_allowed = True
        extra = 'forbid'

    @pydantic.root_validator(pre=True)
    @classmethod
    def digest_validator(cls, values):
        """By default, build the digest from the content and path"""
        if values.get('digest', ''):
            raise ValueError('Digest is not allowed to be set')
        content = values.get('content', '') + os.path.basename(values.get('path', ''))
        values['digest'] = hashlib.sha256(f'content-{content}'.encode('utf-8')).hexdigest()
        return values

    def custom_digest(self, hash_string: str):
        """Use a custom string to derive the digest"""
        self.digest = hashlib.sha256(f'custom-{hash_string}'.encode('utf-8')).hexdigest()

    @property
    def name(self):
        # Keep group uid short to avoid long secrets names. Digest is long enough to guarantee
        # uniqueness.
        return f'osmo-{self.group_uid[:16]}-{self.digest[:32]}'

    def volume(self) -> Dict:
        """ Gets the k8s "volume" specification that corresponds with this file mount. """
        return {
            'name': self.name,
            'secret': {'secretName': self.name}
        }

    def volume_mount(self) -> Dict:
        """ Gets the k8s "volumeMount" specification that corresponds with this file mount. """
        return {
            'mountPath': self.path,
            'subPath': os.path.basename(self.path),
            'name': self.name
        }

    def secret(self, labels: Dict[str, str]) -> Dict:
        """ Gets the k8s "Secret" specification that corresponds with this file mount. """
        return self.k8s_factory.create_secret(
            self.name, labels, {os.path.basename(self.path): self.content}, {})


class HostMount(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Encodes text contents to uniformly support text and binary files. """
    name: str
    path: str

    @property
    def src_path(self):
        return self.path.split(':', 2)[0]

    @property
    def dest_path(self):
        split_path = self.path.split(':', 2)
        return split_path[1] if len(split_path) > 1 else split_path[0]

    def volume(self) -> Dict:
        """Gets the k8s "volume" specification that corresponds with this host mount"""
        return {
            'name': self.name,
            'hostPath': {
                'path': self.src_path
            }
        }

    def volume_mount(self) -> Dict:
        """Gets the k8s "volumeMount" specification that corresponds with this host mount"""
        return {
            'mountPath': self.dest_path,
            'name': self.name
        }
