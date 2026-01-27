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
import hashlib
import json
import os
from typing import Any, Dict, List

import pydantic

from src.lib.utils import common as common_utils, priority as wf_priority, osmo_errors
from src.utils import connectors
from src.utils.job import backend_job_defs, common, topology

DATA_LOCATION = '/osmo/data'


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
        queue = f'osmo-pool-{self._namespace}-{pool_name}'
        priority_class = f'osmo-{priority.value.lower()}'
        topology_name = f'osmo-pool-{self._namespace}-{pool_name}-topology'

        # Convert topology constraints to PodGroup spec format
        top_level_constraint = None
        subgroups = []
        pod_subgroups = {}

        if topology_constraints.task_topology_constraints:
            # Group tasks by their constraint sets (label, subgroup, required)
            # Key: (sorted tuple of (label, subgroup, required))
            # Value: list of (task_name, constraints)
            constraint_groups: Dict[tuple, List[tuple]] = {}

            for task_name, task_constraints in \
                    topology_constraints.task_topology_constraints.items():
                if not task_constraints.constraints:
                    continue

                # Create hashable key from constraints
                constraint_key = tuple(sorted(
                    (c.label, c.subgroup, c.required)
                    for c in task_constraints.constraints
                ))

                if constraint_key not in constraint_groups:
                    constraint_groups[constraint_key] = []
                constraint_groups[constraint_key].append((task_name, task_constraints))

            # Find coarsest shared constraint across all tasks
            if constraint_groups:
                all_constraints = list(topology_constraints.task_topology_constraints.values())
                if all_constraints and all_constraints[0].constraints:
                    # Get the last (coarsest) constraint from the first task
                    coarsest_constraint = all_constraints[0].constraints[-1]

                    # Check if all tasks share this constraint
                    all_share_coarsest = all(
                        any(
                            c.label == coarsest_constraint.label and
                            c.subgroup == coarsest_constraint.subgroup
                            for c in tc.constraints
                        )
                        for tc in all_constraints if tc.constraints
                    )

                    if all_share_coarsest:
                        if coarsest_constraint.required:
                            top_level_constraint = {
                                'topology': topology_name,
                                'requiredTopologyLevel': coarsest_constraint.label
                            }
                        else:  # preferred
                            top_level_constraint = {
                                'topology': topology_name,
                                'requiredTopologyLevel': coarsest_constraint.label,
                                'preferredTopologyLevel': coarsest_constraint.label
                            }

            # Create subgroups for each unique constraint set
            for idx, (constraint_key, group_tasks) in enumerate(constraint_groups.items()):
                if not group_tasks:
                    continue

                # Get the first (finest-grained) constraint
                _, first_task_constraints = group_tasks[0]
                if not first_task_constraints.constraints:
                    continue

                finest_constraint = first_task_constraints.constraints[0]
                subgroup_name = f'{finest_constraint.subgroup}-subgroup-{idx}'

                # Create subgroup
                subgroup = {
                    'name': subgroup_name,
                    'minMember': len(group_tasks),
                    'topologyConstraint': {
                        'topology': topology_name,
                        'requiredTopologyLevel': finest_constraint.label
                    }
                }
                subgroups.append(subgroup)

                # Map tasks to subgroups - we need to map pod names to subgroups
                for task_name, _ in group_tasks:
                    # Find the pod with this task name
                    for pod in pods:
                        # Task name is stored in pod metadata labels
                        if pod['metadata']['labels'].get('osmo.task') == task_name:
                            pod_name = pod['metadata']['name']
                            pod_subgroups[pod_name] = subgroup_name
                            break

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
                pod['metadata']['labels']['kai.scheduler/subgroup-name'] = pod_subgroups[pod_name]

        pod_group_labels = {
            'kai.scheduler/queue': queue,
            # Backwards compatibility for Kai Scheduler before v0.6.0
            'runai/queue': queue,
        }
        pod_group_labels.update(labels)

        pod_group_spec = {
            'minMember': len(pods),
            'queue': queue,
            'priorityClassName': priority_class,
        }

        # Add topology constraints if present
        if top_level_constraint:
            pod_group_spec['topologyConstraint'] = top_level_constraint
        if subgroups:
            pod_group_spec['subgroups'] = subgroups

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
                    api_minor='v1',
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
        """Creates Topology CRD specs for pools with topology_keys configured"""
        topology_crds = []
        for pool in pools:
            if pool.topology_keys:
                topology_crds.append({
                    'apiVersion': 'kai.scheduler/v1',
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

    def priority_supported(self) -> bool:
        """Whether this scheduler supports priority"""
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
